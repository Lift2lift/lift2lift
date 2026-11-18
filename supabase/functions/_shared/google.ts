// Google OAuth and Calendar API calls for club calendars. No Deno APIs: config and fetch are passed in,
// so this runs under `node --test` too. Nothing here logs a token, a calendar id or a Google response body.

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
];
const CALENDAR_SCOPES = GOOGLE_SCOPES.slice(2);

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://www.googleapis.com/calendar/v3';
const TIMEOUT_MS = 10_000;
const PAGE_SIZE = 250;
const MAX_PAGES = 10;

export type GoogleConfig = { clientId: string; clientSecret: string; redirectUri: string };
export type GoogleCalendar = { id: string; name: string; primary: boolean };

/** Google no longer honours the refresh token: revoked, password changed, or the 7-day Testing-mode expiry. */
export class GoogleAccessEnded extends Error {
  constructor() {
    super('Google access ended');
  }
}
/** The calendar is gone, or this account can no longer read it. */
export class GoogleCalendarGone extends Error {
  constructor() {
    super('Google calendar gone');
  }
}
/** Any other failure talking to Google. */
export class GoogleFailed extends Error {
  constructor(what: string) {
    super(`Google ${what} failed`);
  }
}

// ---------------------------------------------------------------- PKCE and state

function base64url(bytes: Uint8Array) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomToken(bytes = 32) {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Base64url(s: string) {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
}

export function authUrl(config: GoogleConfig, state: string, codeChallenge: string) {
  const q = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent', // always hands back a refresh token, even on a second sign-in
    include_granted_scopes: 'false',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${AUTH_URL}?${q}`;
}

// ---------------------------------------------------------------- tokens

async function post(fetchFn: typeof fetch, url: string, form: Record<string, string>) {
  return fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/** The `email` claim of an ID token. It came straight from Google's token endpoint over TLS, so it is not re-verified. */
export function emailFromIdToken(idToken: unknown): string {
  if (typeof idToken !== 'string') return '';
  try {
    const part = idToken.split('.')[1] ?? '';
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (part.length % 4)) % 4));
    const email = (JSON.parse(new TextDecoder().decode(Uint8Array.from(json, (c) => c.charCodeAt(0)))) as { email?: unknown }).email;
    return typeof email === 'string' ? email.slice(0, 320) : '';
  } catch {
    return '';
  }
}

export type CodeResult =
  | { ok: true; refreshToken: string; email: string }
  | { ok: false; reason: 'scopes' | 'failed' };

/** Swaps the sign-in code for tokens. `scopes` when the person unticked calendar access on Google's screen. */
export async function exchangeCode(config: GoogleConfig, code: string, codeVerifier: string, fetchFn: typeof fetch = fetch): Promise<CodeResult> {
  let body: { refresh_token?: unknown; id_token?: unknown; scope?: unknown };
  try {
    const res = await post(fetchFn, TOKEN_URL, {
      code,
      code_verifier: codeVerifier,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, reason: 'failed' };
    }
    body = await res.json();
  } catch {
    return { ok: false, reason: 'failed' };
  }
  const granted = new Set(typeof body.scope === 'string' ? body.scope.split(' ') : []);
  if (!CALENDAR_SCOPES.every((s) => granted.has(s))) return { ok: false, reason: 'scopes' };
  if (typeof body.refresh_token !== 'string' || !body.refresh_token) return { ok: false, reason: 'failed' };
  return { ok: true, refreshToken: body.refresh_token, email: emailFromIdToken(body.id_token) };
}

/** A fresh access token. Throws GoogleAccessEnded when Google says the grant is gone, GoogleFailed otherwise. */
export async function accessToken(config: GoogleConfig, refreshToken: string, fetchFn: typeof fetch = fetch): Promise<string> {
  let res: Response;
  try {
    res = await post(fetchFn, TOKEN_URL, {
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
    });
  } catch {
    throw new GoogleFailed('token');
  }
  const body = (await res.json().catch(() => ({}))) as { access_token?: unknown; error?: unknown };
  if (res.status === 400 && body.error === 'invalid_grant') throw new GoogleAccessEnded();
  if (!res.ok || typeof body.access_token !== 'string') throw new GoogleFailed('token');
  return body.access_token;
}

/** Best effort: the token is deleted on our side whatever Google answers. */
export async function revokeToken(token: string, fetchFn: typeof fetch = fetch): Promise<void> {
  try {
    const res = await post(fetchFn, REVOKE_URL, { token });
    await res.body?.cancel().catch(() => {});
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------- Calendar API

async function getJson(fetchFn: typeof fetch, url: string, token: string, what: string): Promise<any> {
  let res: Response;
  try {
    res = await fetchFn(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new GoogleFailed(what);
  }
  if (res.status === 401) {
    await res.body?.cancel().catch(() => {});
    throw new GoogleAccessEnded();
  }
  if (res.status === 403 || res.status === 404 || res.status === 410) {
    // 403 is also Google's rate limit; only a missing-permission 403 means the calendar is gone.
    const body = (await res.json().catch(() => ({}))) as { error?: { errors?: { reason?: string }[] } };
    const reason = body.error?.errors?.[0]?.reason ?? '';
    if (res.status !== 403 || reason === 'forbidden' || reason === 'notFound' || reason === 'insufficientPermissions') throw new GoogleCalendarGone();
    throw new GoogleFailed(what);
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new GoogleFailed(what);
  }
  try {
    return await res.json();
  } catch {
    throw new GoogleFailed(what);
  }
}

/** Calendars the account can read: primary first, then by name. */
export async function listCalendars(token: string, fetchFn: typeof fetch = fetch): Promise<GoogleCalendar[]> {
  const out: GoogleCalendar[] = [];
  let pageToken = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({ minAccessRole: 'reader', maxResults: '250', fields: 'items(id,summary,summaryOverride,primary),nextPageToken' });
    if (pageToken) q.set('pageToken', pageToken);
    const body = await getJson(fetchFn, `${API}/users/me/calendarList?${q}`, token, 'calendars');
    for (const c of Array.isArray(body?.items) ? body.items : []) {
      if (typeof c?.id !== 'string' || !c.id) continue;
      const name = typeof c.summaryOverride === 'string' && c.summaryOverride.trim() ? c.summaryOverride : typeof c.summary === 'string' ? c.summary : c.id;
      out.push({ id: c.id, name: name.trim().slice(0, 120) || c.id, primary: c.primary === true });
    }
    pageToken = typeof body?.nextPageToken === 'string' ? body.nextPageToken : '';
    if (!pageToken) break;
  }
  return out.sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name));
}

/**
 * One calendar's events from a day ago to 180 days out, recurring events expanded by Google.
 * `truncated` when there are more than 10 pages of 250 (the caller treats that as too large).
 */
export async function listEvents(token: string, calendarId: string, now: Date, fetchFn: typeof fetch = fetch): Promise<{ items: unknown[]; truncated: boolean }> {
  const DAY = 86_400_000;
  const items: unknown[] = [];
  let pageToken = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({
      singleEvents: 'true',
      showDeleted: 'false',
      timeMin: new Date(now.getTime() - DAY).toISOString(),
      timeMax: new Date(now.getTime() + 180 * DAY).toISOString(),
      maxResults: String(PAGE_SIZE),
      fields: 'items(id,iCalUID,status,eventType,summary,description,location,start,end,originalStartTime,recurringEventId),nextPageToken',
    });
    if (pageToken) q.set('pageToken', pageToken);
    const body = await getJson(fetchFn, `${API}/calendars/${encodeURIComponent(calendarId)}/events?${q}`, token, 'events');
    if (Array.isArray(body?.items)) items.push(...body.items);
    pageToken = typeof body?.nextPageToken === 'string' ? body.nextPageToken : '';
    if (!pageToken) return { items, truncated: false };
  }
  return { items, truncated: true };
}
