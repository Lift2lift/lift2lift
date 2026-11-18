// Copies each club's calendar into community events: a pasted Google/Outlook/iCloud ICS link, or a Google
// calendar connected by Google sign-in (read through the Calendar API with the stored refresh token).
//
// Two ways in, one pipeline (syncOne):
//   cron      Authorization: Bearer <CRON_SECRET>, every 15 minutes: claims up to 20 communities, least recently
//             attempted first, and syncs them.
//   sync now  a signed-in club admin, POST { community_id }: syncs that one community.
//
// The server fetches a link an admin typed in, so every fetch goes through fetchCalendar (allowed hosts,
// redirects checked by hand, 10 second limit, 2 MB limit). A calendar link can be a secret address, so the
// link is never logged and neither it nor anything fetched is ever sent back to the caller. The same goes for
// Google tokens, calendar ids and Google's responses.

import { accessToken, GoogleAccessEnded, GoogleCalendarGone, listEvents, type GoogleConfig } from '../_shared/google.ts';
import { adminClient, corsHeaders, json, userClient } from '../_shared/http.ts';
import { eventsFromGoogle, fetchCalendar, parseCalendar, type GoogleEvent } from './logic.ts';

const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';
const READ_FAILED = 'Could not read that calendar link';
const TOO_LARGE = 'This calendar is too large to import';
const ACCESS_ENDED = 'Google Calendar access ended. Connect it again.';
const CALENDAR_GONE = "That Google calendar can't be read anymore";
const CRON_BATCH = 20; // communities claimed per cron run
const CRON_BUDGET_MS = 50_000; // stop starting new communities after this; the claim order rotates them to the front
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Same ids and names as packages/app/lib/resorts.ts (RESORTS). Keep this list in sync with that file.
const RESORTS = [
  { id: 'eldora', name: 'Eldora' },
  { id: 'echo', name: 'Echo Mountain' },
  { id: 'loveland', name: 'Loveland' },
  { id: 'abasin', name: 'Arapahoe Basin' },
  { id: 'keystone', name: 'Keystone' },
  { id: 'wp', name: 'Winter Park' },
  { id: 'copper', name: 'Copper Mountain' },
  { id: 'breck', name: 'Breckenridge' },
  { id: 'granby', name: 'Granby Ranch' },
  { id: 'vail', name: 'Vail' },
  { id: 'cooper', name: 'Ski Cooper' },
  { id: 'bc', name: 'Beaver Creek' },
  { id: 'steamboat', name: 'Steamboat' },
  { id: 'howelsen', name: 'Howelsen Hill' },
  { id: 'monarch', name: 'Monarch' },
  { id: 'sunlight', name: 'Sunlight' },
  { id: 'snowmass', name: 'Snowmass' },
  { id: 'ajax', name: 'Aspen Mountain' },
  { id: 'highlands', name: 'Aspen Highlands' },
  { id: 'buttermilk', name: 'Buttermilk' },
  { id: 'powderhorn', name: 'Powderhorn' },
  { id: 'cb', name: 'Crested Butte' },
  { id: 'wolf', name: 'Wolf Creek' },
  { id: 'telluride', name: 'Telluride' },
  { id: 'purg', name: 'Purgatory' },
  { id: 'silverton', name: 'Silverton Mountain' },
];

type Admin = ReturnType<typeof adminClient>;
type Failure = typeof READ_FAILED | typeof TOO_LARGE | typeof ACCESS_ENDED | typeof CALENDAR_GONE;
type SyncResult = { ok: true } | { ok: false; error: Failure };
type Outcome = SyncResult | { ok: false; error: string };
/** A row of claim_calendars_to_sync / calendar_sync_target. */
type Target = { community_id: string; source: 'ics' | 'google'; sync_key: string; ics_url: string | null; google_calendar_id: string | null };

function googleConfig(): GoogleConfig | null {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID') ?? '';
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '';
  const redirectUri = Deno.env.get('GOOGLE_REDIRECT_URI') ?? '';
  return clientId && clientSecret && redirectUri ? { clientId, clientSecret, redirectUri } : null;
}

/** The calendar's events, or throws. `truncated` means it was too large to read whole. */
async function fetchEvents(admin: Admin, target: Target, fetchFn: typeof fetch): Promise<{ events: unknown[]; truncated: boolean }> {
  const now = new Date();
  if (target.source === 'google') {
    const google = googleConfig();
    if (!google || !target.google_calendar_id) throw new Error('google not configured');
    const { data: refresh, error } = await admin.rpc('google_refresh_token', { p_community_id: target.community_id });
    if (error) throw new Error('could not read token');
    if (typeof refresh !== 'string' || !refresh) throw new GoogleAccessEnded();
    const token = await accessToken(google, refresh, fetchFn);
    const { items, truncated } = await listEvents(token, target.google_calendar_id, now, fetchFn);
    return { events: truncated ? [] : eventsFromGoogle(items as GoogleEvent[], now, RESORTS), truncated };
  }
  if (!target.ics_url) throw new Error('no link');
  return parseCalendar(await fetchCalendar(target.ics_url, fetchFn), now, RESORTS);
}

/**
 * The whole job for one community: fetch, parse, store. Used by both modes so they cannot drift.
 * `target.sync_key` is the exact link (or google:<calendar id>) read from the database; the database ignores the
 * result if the calendar changed meanwhile. Returns the outcome; the error text is only ever one of the fixed
 * strings above, the same one stored as last_error.
 */
export async function syncOne(admin: Admin, target: Target, fetchFn: typeof fetch = fetch): Promise<SyncResult> {
  const communityId = target.community_id;
  const record = async (events: unknown[] | null, error: string | null) => {
    const { error: dbError } = await admin.rpc('apply_calendar_sync', { p_community_id: communityId, p_events: events, p_error: error, p_url: target.sync_key });
    if (dbError) throw dbError;
  };
  let failure: Failure = READ_FAILED;
  try {
    const { events, truncated } = await fetchEvents(admin, target, fetchFn);
    if (truncated) failure = TOO_LARGE;
    else {
      await record(events, null);
      return { ok: true };
    }
  } catch (e) {
    console.error('calendar sync failed', communityId, target.source, e instanceof Error ? e.name : 'error');
    failure = e instanceof GoogleAccessEnded ? ACCESS_ENDED : e instanceof GoogleCalendarGone ? CALENDAR_GONE : READ_FAILED;
  }
  try {
    await record(null, failure);
  } catch (e) {
    console.error('calendar sync could not record failure', communityId, e instanceof Error ? e.message : 'error');
  }
  return { ok: false, error: failure };
}

async function sha256(s: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}

/** Constant-time check of the Authorization header against the cron secret. */
async function isCron(req: Request) {
  if (!CRON_SECRET) return false;
  const [a, b] = await Promise.all([sha256(req.headers.get('Authorization') ?? ''), sha256(`Bearer ${CRON_SECRET}`)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Use POST.' }, 405);

  if (await isCron(req)) {
    const admin = adminClient();
    // Claims (and stamps last_attempt_at on) the least recently attempted calendars, so every club gets its turn.
    const { data, error } = await admin.rpc('claim_calendars_to_sync', { p_limit: CRON_BATCH });
    if (error) {
      console.error('claim_calendars_to_sync', error.message);
      return json(req, { error: 'Could not start the sync.' }, 500);
    }
    const rows = (data ?? []) as Target[];
    const started = Date.now();
    let synced = 0;
    let failed = 0;
    let skipped = 0;
    for (const row of rows) {
      if (Date.now() - started > CRON_BUDGET_MS) {
        skipped += 1;
        continue;
      }
      try {
        if ((await syncOne(admin, row)).ok) synced += 1;
        else failed += 1;
      } catch (e) {
        console.error('calendar sync crashed', row.community_id, e instanceof Error ? e.message : 'error');
        failed += 1;
      }
    }
    return json(req, { synced, failed, skipped });
  }

  // Sync now: the caller must be a signed-in admin of that community.
  const user = userClient(req);
  const { data: auth } = await user.auth.getUser();
  if (!auth.user) return json(req, { error: 'Sign in first.' }, 401);

  const body = (await req.json().catch(() => null)) as { community_id?: unknown } | null;
  const communityId = body?.community_id;
  if (typeof communityId !== 'string' || !UUID.test(communityId)) return json(req, { error: 'Missing community.' }, 400);

  // is_community_admin runs as the caller.
  const { data: isAdmin, error } = await user.rpc('is_community_admin', { p_community_id: communityId });
  if (error) {
    console.error('is_community_admin', communityId, error.message);
    return json(req, { error: 'Could not start the sync.' }, 500);
  }
  if (isAdmin !== true) return json(req, { error: 'Only club admins can sync the calendar.' }, 403);

  const admin = adminClient();
  const { data: targets, error: targetError } = await admin.rpc('calendar_sync_target', { p_community_id: communityId });
  if (targetError) {
    console.error('calendar_sync_target', communityId, targetError.message);
    return json(req, { error: 'Could not start the sync.' }, 500);
  }
  const target = ((targets ?? []) as Target[])[0];
  if (!target) return json(req, { ok: false, error: 'No calendar is connected' } satisfies Outcome);
  return json(req, (await syncOne(admin, target)) satisfies Outcome);
});
