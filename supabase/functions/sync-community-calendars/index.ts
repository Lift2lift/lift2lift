// Copies each club's Google/Outlook/iCloud calendar into community events.
//
// Two ways in, one pipeline (syncOne):
//   cron      Authorization: Bearer <CRON_SECRET>, every 15 minutes: claims up to 20 communities, least recently
//             attempted first, and syncs them.
//   sync now  a signed-in club admin, POST { community_id }: syncs that one community.
//
// The server fetches a link an admin typed in, so every fetch goes through fetchCalendar (allowed hosts,
// redirects checked by hand, 10 second limit, 2 MB limit). A calendar link can be a secret address, so the
// link is never logged and neither it nor anything fetched is ever sent back to the caller.

import { adminClient, corsHeaders, json, userClient } from '../_shared/http.ts';
import { fetchCalendar, parseCalendar } from './logic.ts';

const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';
const READ_FAILED = 'Could not read that calendar link';
const TOO_LARGE = 'This calendar is too large to import';
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
type SyncResult = { ok: true } | { ok: false; error: typeof READ_FAILED | typeof TOO_LARGE };
type Outcome = SyncResult | { ok: false; error: string };

/**
 * The whole job for one community: fetch, parse, store. Used by both modes so they cannot drift.
 * `url` is the exact link that was read from the database; the database ignores the result if the link changed meanwhile.
 * Returns the outcome; the error text is only ever one of two fixed strings, the same one stored as last_error.
 */
export async function syncOne(admin: Admin, communityId: string, url: string, fetchFn: typeof fetch = fetch): Promise<SyncResult> {
  const record = async (events: unknown[] | null, error: string | null) => {
    const { error: dbError } = await admin.rpc('apply_calendar_sync', { p_community_id: communityId, p_events: events, p_error: error, p_url: url });
    if (dbError) throw dbError;
  };
  let failure: typeof READ_FAILED | typeof TOO_LARGE = READ_FAILED;
  try {
    const text = await fetchCalendar(url, fetchFn);
    const { events, truncated } = parseCalendar(text, new Date(), RESORTS);
    if (truncated) failure = TOO_LARGE;
    else {
      await record(events, null);
      return { ok: true };
    }
  } catch (e) {
    console.error('calendar sync failed', communityId, e instanceof Error ? e.message : 'error');
    failure = READ_FAILED;
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
    const rows = (data ?? []) as { community_id: string; ics_url: string }[];
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
        if ((await syncOne(admin, row.community_id, row.ics_url)).ok) synced += 1;
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

  // community_calendar runs as the caller and raises for anyone who is not an admin of this community.
  const { data: calendar, error } = await user.rpc('community_calendar', { p_community_id: communityId });
  if (error) {
    if (error.code === '42501') return json(req, { error: 'Only club admins can sync the calendar.' }, 403);
    console.error('community_calendar', communityId, error.message);
    return json(req, { error: 'Could not start the sync.' }, 500);
  }
  const url = (calendar as { ics_url?: string | null } | null)?.ics_url;
  if (!url) return json(req, { ok: false, error: 'No calendar link is set' } satisfies Outcome);

  const admin = adminClient();
  return json(req, (await syncOne(admin, communityId, url)) satisfies Outcome);
});
