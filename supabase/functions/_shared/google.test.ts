// Run with: node --test supabase/functions/_shared/google.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accessToken, authUrl, emailFromIdToken, exchangeCode, GoogleAccessEnded, GoogleCalendarGone, GoogleFailed, listCalendars, listEvents, sha256Base64url } from './google.ts';

const config = { clientId: 'cid', clientSecret: 'secret', redirectUri: 'https://x.supabase.co/functions/v1/google-calendar' };
const NOW = new Date('2026-11-17T12:00:00Z');
const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const idToken = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
const SCOPE = 'openid email https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.readonly';

test('authUrl asks for offline access, consent, PKCE and the read-only calendar scopes', () => {
  const u = new URL(authUrl(config, 'st', 'ch'));
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  const q = Object.fromEntries(u.searchParams);
  assert.equal(q.client_id, 'cid');
  assert.equal(q.redirect_uri, config.redirectUri);
  assert.equal(q.access_type, 'offline');
  assert.equal(q.prompt, 'consent');
  assert.equal(q.state, 'st');
  assert.equal(q.code_challenge, 'ch');
  assert.equal(q.code_challenge_method, 'S256');
  assert.equal(q.scope, SCOPE);
});

test('sha256Base64url matches the PKCE example in RFC 7636', async () => {
  assert.equal(await sha256Base64url('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('emailFromIdToken', () => {
  assert.equal(emailFromIdToken(idToken({ email: 'jané@gmail.com' })), 'jané@gmail.com');
  assert.equal(emailFromIdToken('nope'), '');
  assert.equal(emailFromIdToken(undefined), '');
});

test('exchangeCode: tokens, email, and the code and verifier sent', async () => {
  let sent: URLSearchParams | null = null;
  const fetchFn = (async (_url: string, init: RequestInit) => {
    sent = new URLSearchParams(String(init.body));
    return jsonRes({ refresh_token: 'rt', id_token: idToken({ email: 'a@b.c' }), scope: SCOPE });
  }) as typeof fetch;
  assert.deepEqual(await exchangeCode(config, 'code1', 'ver1', fetchFn), { ok: true, refreshToken: 'rt', email: 'a@b.c' });
  assert.equal(sent!.get('code'), 'code1');
  assert.equal(sent!.get('code_verifier'), 'ver1');
  assert.equal(sent!.get('grant_type'), 'authorization_code');
});

test('exchangeCode: unticked calendar scopes, no refresh token, Google error', async () => {
  const f = (body: unknown, status = 200) => (async () => jsonRes(body, status)) as unknown as typeof fetch;
  assert.deepEqual(await exchangeCode(config, 'c', 'v', f({ refresh_token: 'rt', scope: 'openid email' })), { ok: false, reason: 'scopes' });
  assert.deepEqual(await exchangeCode(config, 'c', 'v', f({ scope: SCOPE })), { ok: false, reason: 'failed' });
  assert.deepEqual(await exchangeCode(config, 'c', 'v', f({ error: 'invalid_grant' }, 400)), { ok: false, reason: 'failed' });
  const boom = (async () => {
    throw new Error('network');
  }) as unknown as typeof fetch;
  assert.deepEqual(await exchangeCode(config, 'c', 'v', boom), { ok: false, reason: 'failed' });
});

test('accessToken: invalid_grant means access ended; other errors are plain failures', async () => {
  const f = (body: unknown, status = 200) => (async () => jsonRes(body, status)) as unknown as typeof fetch;
  assert.equal(await accessToken(config, 'rt', f({ access_token: 'at' })), 'at');
  await assert.rejects(accessToken(config, 'rt', f({ error: 'invalid_grant' }, 400)), GoogleAccessEnded);
  await assert.rejects(accessToken(config, 'rt', f({ error: 'invalid_client' }, 401)), GoogleFailed);
  await assert.rejects(accessToken(config, 'rt', f({}, 500)), GoogleFailed);
});

test('listCalendars: pages, names (override first), primary first', async () => {
  const pages = [
    { items: [{ id: 'z@group', summary: 'Zeta' }, { id: 'me@gmail.com', summary: 'me@gmail.com', primary: true }], nextPageToken: 'p2' },
    { items: [{ id: 'a@group', summary: 'Alpha', summaryOverride: 'CU Freeride' }, { summary: 'no id' }] },
  ];
  const seen: string[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    seen.push(url);
    assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer at');
    return jsonRes(pages[seen.length - 1]);
  }) as unknown as typeof fetch;
  assert.deepEqual(await listCalendars('at', fetchFn), [
    { id: 'me@gmail.com', name: 'me@gmail.com', primary: true },
    { id: 'a@group', name: 'CU Freeride', primary: false },
    { id: 'z@group', name: 'Zeta', primary: false },
  ]);
  assert.match(seen[0], /minAccessRole=reader/);
  assert.match(seen[1], /pageToken=p2/);
});

test('listEvents: expanded window, encoded calendar id, pages, too many pages', async () => {
  const seen: string[] = [];
  const two = (async (url: string) => {
    seen.push(url);
    return jsonRes(seen.length === 1 ? { items: [{ id: '1' }], nextPageToken: 'n' } : { items: [{ id: '2' }] });
  }) as unknown as typeof fetch;
  assert.deepEqual(await listEvents('at', 'club#x@group.calendar.google.com', NOW, two), { items: [{ id: '1' }, { id: '2' }], truncated: false });
  const u = new URL(seen[0]);
  assert.equal(u.pathname, '/calendar/v3/calendars/club%23x%40group.calendar.google.com/events');
  assert.equal(u.searchParams.get('singleEvents'), 'true');
  assert.equal(u.searchParams.get('timeMin'), '2026-11-16T12:00:00.000Z');
  assert.equal(u.searchParams.get('timeMax'), '2027-05-16T12:00:00.000Z');

  const endless = (async () => jsonRes({ items: [{ id: 'x' }], nextPageToken: 'more' })) as unknown as typeof fetch;
  const r = await listEvents('at', 'c', NOW, endless);
  assert.equal(r.truncated, true);
  assert.equal(r.items.length, 10);
});

test('listEvents: 401 access ended, 404 and permission 403 calendar gone, rate-limit 403 a plain failure', async () => {
  const f = (body: unknown, status: number) => (async () => jsonRes(body, status)) as unknown as typeof fetch;
  await assert.rejects(listEvents('at', 'c', NOW, f({}, 401)), GoogleAccessEnded);
  await assert.rejects(listEvents('at', 'c', NOW, f({}, 404)), GoogleCalendarGone);
  await assert.rejects(listEvents('at', 'c', NOW, f({ error: { errors: [{ reason: 'forbidden' }] } }, 403)), GoogleCalendarGone);
  await assert.rejects(listEvents('at', 'c', NOW, f({ error: { errors: [{ reason: 'rateLimitExceeded' }] } }, 403)), GoogleFailed);
  await assert.rejects(listEvents('at', 'c', NOW, f({}, 500)), GoogleFailed);
});
