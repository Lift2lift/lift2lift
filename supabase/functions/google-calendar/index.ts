// Connects a club's Google Calendar with Google sign-in. The sync itself is sync-community-calendars.
//
//   POST { action: 'start', community_id, return_to }      admin → { url } of Google's consent screen
//   GET  ?code&state  (or ?error&state)                     Google → 302 back to return_to?google_calendar=…
//   POST { action: 'calendars', community_id }              admin → { calendars: [{ id, name, primary }] }
//   POST { action: 'choose', community_id, calendar_id }    admin → { ok: true } (the app then runs Sync now)
//   POST { action: 'disconnect', community_id }             admin → { ok: true }
//
// The refresh token is kept in Vault by the database and is never sent to the app or logged. verify_jwt is
// off because Google's redirect carries no user token; every POST checks the caller itself.
//
// Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI (this function's URL, exactly as
// registered on the OAuth client), ALLOWED_ORIGINS (web origins the browser may come back to).

import { accessToken, authUrl, exchangeCode, GoogleAccessEnded, listCalendars, randomToken, revokeToken, sha256Base64url, type GoogleConfig } from '../_shared/google.ts';
import { adminClient, corsHeaders, json, userClient } from '../_shared/http.ts';
import { returnToOk, withResult } from './logic.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCESS_ENDED = 'Google Calendar access ended. Connect it again.';
const GENERIC = "Couldn't reach Google. Try again.";
const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:3000,http://127.0.0.1:3000')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

function config(): GoogleConfig | null {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID') ?? '';
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '';
  const redirectUri = Deno.env.get('GOOGLE_REDIRECT_URI') ?? '';
  return clientId && clientSecret && redirectUri ? { clientId, clientSecret, redirectUri } : null;
}

/** Hosted Supabase serves function HTML as plain text, so the few dead-end pages are plain text. */
function page(text: string, status: number) {
  return new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function redirect(to: string) {
  return new Response(null, { status: 302, headers: { Location: to, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}

type Admin = ReturnType<typeof adminClient>;

/** Google's redirect back. Uses up the state, stores the token, and sends the browser home. */
async function callback(url: URL, google: GoogleConfig): Promise<Response> {
  const state = url.searchParams.get('state') ?? '';
  if (!state || state.length > 200) return page('This sign-in link is not valid. Go back to Lift2Lift and try again.', 400);
  const admin = adminClient();
  const { data, error } = await admin.rpc('take_google_oauth_state', { p_state_hash: await sha256Base64url(state) });
  if (error) {
    console.error('take_google_oauth_state', error.message);
    return page('Something went wrong. Go back to Lift2Lift and try again.', 500);
  }
  const row = (data as { community_id: string; user_id: string; return_to: string; code_verifier: string }[] | null)?.[0];
  if (!row) return page('This sign-in link has expired. Go back to Lift2Lift and try again.', 400);
  // Saved only after this check, but checked again: the allowed origins may have changed in 10 minutes.
  if (!returnToOk(row.return_to, allowedOrigins)) return page('Google Calendar was not connected. Go back to Lift2Lift and try again.', 400);

  if (url.searchParams.get('error')) return redirect(withResult(row.return_to, 'denied'));
  const code = url.searchParams.get('code');
  if (!code) return redirect(withResult(row.return_to, 'error'));

  const result = await exchangeCode(google, code, row.code_verifier);
  if (!result.ok) return redirect(withResult(row.return_to, result.reason === 'scopes' ? 'denied' : 'error'));
  const { error: saveError } = await admin.rpc('save_google_account', {
    p_community_id: row.community_id,
    p_user_id: row.user_id,
    p_email: result.email,
    p_refresh_token: result.refreshToken,
  });
  if (saveError) {
    console.error('save_google_account', row.community_id, saveError.code);
    await revokeToken(result.refreshToken); // not stored, so don't leave it live at Google
    return redirect(withResult(row.return_to, 'error'));
  }
  return redirect(withResult(row.return_to, 'connected'));
}

/** The account's stored refresh token, or null. */
async function refreshTokenOf(admin: Admin, communityId: string): Promise<string | null> {
  const { data, error } = await admin.rpc('google_refresh_token', { p_community_id: communityId });
  if (error) throw error;
  return typeof data === 'string' && data ? data : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  const google = config();

  if (req.method === 'GET') {
    if (!google) return page('Google Calendar is not set up on this server.', 503);
    try {
      return await callback(new URL(req.url), google);
    } catch (e) {
      console.error('google callback', e instanceof Error ? e.name : 'error');
      return page('Something went wrong. Go back to Lift2Lift and try again.', 500);
    }
  }
  if (req.method !== 'POST') return json(req, { error: 'Use POST.' }, 405);
  if (!google) return json(req, { error: 'Google Calendar is not set up yet.' }, 503);

  const user = userClient(req);
  const { data: auth } = await user.auth.getUser();
  if (!auth.user) return json(req, { error: 'Sign in first.' }, 401);
  const userId = auth.user.id;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action;
  const communityId = body?.community_id;
  if (typeof communityId !== 'string' || !UUID.test(communityId)) return json(req, { error: 'Missing community.' }, 400);

  const { data: isAdmin, error: adminError } = await user.rpc('is_community_admin', { p_community_id: communityId });
  if (adminError) {
    console.error('is_community_admin', adminError.message);
    return json(req, { error: GENERIC }, 500);
  }
  if (isAdmin !== true) return json(req, { error: 'Only club admins can connect the calendar.' }, 403);

  const admin = adminClient();
  try {
    if (action === 'start') {
      if (!returnToOk(body?.return_to, allowedOrigins)) return json(req, { error: "Can't connect from here." }, 400);
      const state = randomToken();
      const verifier = randomToken(48);
      const { error } = await admin.rpc('save_google_oauth_state', {
        p_state_hash: await sha256Base64url(state),
        p_community_id: communityId,
        p_user_id: userId,
        p_return_to: body.return_to,
        p_code_verifier: verifier,
      });
      if (error) throw error;
      return json(req, { url: authUrl(google, state, await sha256Base64url(verifier)) });
    }

    if (action === 'calendars') {
      const refresh = await refreshTokenOf(admin, communityId);
      if (!refresh) return json(req, { error: 'Sign in with Google first.' }, 400);
      try {
        return json(req, { calendars: await listCalendars(await accessToken(google, refresh)) });
      } catch (e) {
        if (e instanceof GoogleAccessEnded) return json(req, { error: ACCESS_ENDED }, 400);
        throw e;
      }
    }

    if (action === 'choose') {
      const calendarId = body?.calendar_id;
      if (typeof calendarId !== 'string' || !calendarId || calendarId.length > 1024) return json(req, { error: 'Pick a calendar.' }, 400);
      const refresh = await refreshTokenOf(admin, communityId);
      if (!refresh) return json(req, { error: 'Sign in with Google first.' }, 400);
      let picked;
      try {
        picked = (await listCalendars(await accessToken(google, refresh))).find((c) => c.id === calendarId);
      } catch (e) {
        if (e instanceof GoogleAccessEnded) return json(req, { error: ACCESS_ENDED }, 400);
        throw e;
      }
      if (!picked) return json(req, { error: "That calendar isn't on your Google account." }, 400);
      const { error } = await admin.rpc('set_google_calendar', { p_community_id: communityId, p_user_id: userId, p_calendar_id: picked.id, p_name: picked.name });
      if (error) throw error;
      return json(req, { ok: true });
    }

    if (action === 'disconnect') {
      const refresh = await refreshTokenOf(admin, communityId);
      if (refresh) await revokeToken(refresh);
      const { error } = await admin.rpc('remove_google_calendar', { p_community_id: communityId, p_user_id: userId });
      if (error) throw error;
      return json(req, { ok: true });
    }

    return json(req, { error: 'Unknown action.' }, 400);
  } catch (e) {
    console.error('google-calendar', action, e instanceof Error ? e.name : 'error');
    return json(req, { error: GENERIC }, 502);
  }
});
