// Run with: node --test supabase/functions/sync-community-calendars/logic.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALLOWED_HOSTS, calendarUrlProblem, eventsFromIcs, fetchCalendar, guessResort, normalizeCalendarUrl, parseCalendar } from './logic.ts';

const NOW = new Date('2026-11-17T12:00:00Z');
const BAD = 'Use a Google, Outlook or iCloud calendar link.';
const resorts = [
  { id: 'copper', name: 'Copper Mountain' },
  { id: 'echo', name: 'Echo Mountain' },
  { id: 'vail', name: 'Vail' },
  { id: 'granby', name: 'Granby Ranch' },
  { id: 'granbyonly', name: 'Granby' },
  { id: 'eldora', name: 'Eldora Resort' },
];

const cal = (...events: string[][]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', ...events.flat(), 'END:VCALENDAR'].join('\r\n');
const ev = (...lines: string[]) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'];
const run = (ics: string, resortList = resorts, now = NOW) => eventsFromIcs(ics, now, resortList);

// ---------- URLs ----------
test('allowed URLs', () => {
  for (const u of [
    'https://calendar.google.com/calendar/ical/abc%40group.calendar.google.com/public/basic.ics',
    'https://outlook.office365.com/owa/calendar/x/y/calendar.ics',
    'https://outlook.office.com/owa/calendar/x/y/calendar.ics',
    'https://outlook.live.com/owa/calendar/x/y/calendar.ics',
    'https://p01-caldav.icloud.com/published/2/abc',
    'https://icloud.com.icloud.com/x',
    'webcal://p01-caldav.icloud.com/published/2/abc',
    'WEBCALS://calendar.google.com/x.ics',
    'https://Calendar.Google.com/x',
    '  https://calendar.google.com/x  ',
  ]) assert.equal(calendarUrlProblem(u), null, u);
});

test('rejected URLs', () => {
  for (const u of [
    '',
    'http://calendar.google.com/x',
    'ftp://calendar.google.com/x',
    'https://calendar.google.com',
    'https://calendar.google.com?x=1',
    'https://calendar.google.com:443/x',
    'https://user@calendar.google.com/x',
    'https://user:pw@calendar.google.com/x',
    'https://evil.test@calendar.google.com/x',
    'https://calendar.google.com@evil.test/x',
    'https://calendar.google.com\\@evil.test/x',
    'https://calendar.google.com/x y',
    'https://calendar.google.com/x\n',
    'https://calendar.google.com/x\t',
    'https://calendar.google.com/x\u0000',
    'https://calendar.google.com/x ',
    'https://calendar.google.com/x​',
    'https://calendar.google.com./x',
    'https://calendar%2egoogle.com/x',
    'https://outlooK.live.com/x', // Kelvin sign
    'https://evil.test/?h=calendar.google.com/',
    'https://evil.test/#https://calendar.google.com/x',
    'https://icloud.com/x',
    'https://evilicloud.com/x',
    'https://x.icloud.com.evil.test/x',
    'https://.icloud.com/x',
    'https://a..icloud.com/x',
    'https://x.icloud.com./x',
    'https://google.com/x',
    'https://notcalendar.google.com/x',
    'https://calendar.google.com.evil.test/x',
    'https://münchen.icloud.com/x',
    'javascript:alert(1)',
  ]) assert.equal(calendarUrlProblem(u), BAD, JSON.stringify(u));
});

test('normalizeCalendarUrl and ALLOWED_HOSTS', () => {
  assert.equal(normalizeCalendarUrl('  webcal://x.icloud.com/a  '), 'https://x.icloud.com/a');
  assert.equal(normalizeCalendarUrl('WEBCALS://x.icloud.com/a'), 'https://x.icloud.com/a');
  assert.equal(normalizeCalendarUrl('https://calendar.google.com/a'), 'https://calendar.google.com/a');
  assert.deepEqual(ALLOWED_HOSTS, ['calendar.google.com', 'outlook.office365.com', 'outlook.office.com', 'outlook.live.com']);
});

// ---------- not a calendar ----------
test('non-calendars throw', () => {
  for (const text of ['<html><body>Sign in</body></html>', '', 'random text\nmore', 'BEGIN:VEVENT\r\nEND:VEVENT', 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT']) {
    assert.throws(() => run(text), { message: 'not a calendar' }, JSON.stringify(text));
  }
});
test('empty calendar gives []', () => assert.deepEqual(run(cal()), []));

// ---------- time zones ----------
const one = (...lines: string[]) => run(cal(ev('UID:u1', 'SUMMARY:Meet', ...lines)));

test('TZID America/Denver with no VTIMEZONE (MST)', () => {
  const [e] = one('DTSTART;TZID=America/Denver:20261201T083000', 'DTEND;TZID=America/Denver:20261201T100000');
  assert.equal(e.starts_at, '2026-12-01T15:30:00.000Z');
  assert.equal(e.ends_at, '2026-12-01T17:00:00.000Z');
  assert.equal(e.uid, 'u1|2026-12-01');
  assert.equal(e.all_day, false);
});
test('TZID America/Denver with no VTIMEZONE (MDT)', () => {
  const [e] = one('DTSTART;TZID=America/Denver:20270320T083000', 'DTEND;TZID=America/Denver:20270320T100000');
  assert.equal(e.starts_at, '2027-03-20T14:30:00.000Z');
});
test('DST gap day: before and after the March change', () => {
  const [a, b] = run(cal(
    ev('UID:a', 'SUMMARY:Before', 'DTSTART;TZID=America/Denver:20270313T120000'),
    ev('UID:b', 'SUMMARY:After', 'DTSTART;TZID=America/Denver:20270314T120000'),
  ));
  assert.equal(a.starts_at, '2027-03-13T19:00:00.000Z');
  assert.equal(b.starts_at, '2027-03-14T18:00:00.000Z');
});
test('Z time', () => {
  const [e] = one('DTSTART:20261201T153000Z', 'DTEND:20261201T170000Z');
  assert.equal(e.starts_at, '2026-12-01T15:30:00.000Z');
  assert.equal(e.uid, 'u1|2026-12-01');
});
test('floating time is Denver', () => {
  const [e] = one('DTSTART:20261201T083000', 'DTEND:20261201T100000');
  assert.equal(e.starts_at, '2026-12-01T15:30:00.000Z');
});
test('Windows zone name falls back to Denver', () => {
  const [e] = one('DTSTART;TZID=Mountain Standard Time:20261201T083000');
  assert.equal(e.starts_at, '2026-12-01T15:30:00.000Z');
});
test('other IANA zone without VTIMEZONE', () => {
  const [e] = one('DTSTART;TZID=America/New_York:20261201T083000');
  assert.equal(e.starts_at, '2026-12-01T13:30:00.000Z');
});
test('feed VTIMEZONE is used for its TZID', () => {
  const vtz = [
    'BEGIN:VTIMEZONE', 'TZID:Custom/Five',
    'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0500', 'TZNAME:CF', 'END:STANDARD',
    'END:VTIMEZONE',
  ];
  const [e] = run(cal(vtz, ev('UID:v', 'SUMMARY:Meet', 'DTSTART;TZID=Custom/Five:20261201T083000')));
  assert.equal(e.starts_at, '2026-12-01T13:30:00.000Z');
});
test('feed VTIMEZONE for America/Denver (with DST rules)', () => {
  const vtz = [
    'BEGIN:VTIMEZONE', 'TZID:America/Denver',
    'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0700', 'TZOFFSETTO:-0600', 'TZNAME:MDT', 'DTSTART:19700308T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT',
    'BEGIN:STANDARD', 'TZOFFSETFROM:-0600', 'TZOFFSETTO:-0700', 'TZNAME:MST', 'DTSTART:19701101T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD',
    'END:VTIMEZONE',
  ];
  const out = run(cal(vtz,
    ev('UID:w', 'SUMMARY:Winter', 'DTSTART;TZID=America/Denver:20261201T083000'),
    ev('UID:s', 'SUMMARY:Spring', 'DTSTART;TZID=America/Denver:20270320T083000'),
  ));
  assert.deepEqual(out.map((e) => e.starts_at), ['2026-12-01T15:30:00.000Z', '2027-03-20T14:30:00.000Z']);
});
test('11 PM Mountain keeps its Mountain day', () => {
  const [a, b] = run(cal(
    ev('UID:a', 'SUMMARY:Late', 'DTSTART;TZID=America/Denver:20261204T230000'),
    ev('UID:b', 'SUMMARY:LateZ', 'DTSTART:20261205T060000Z'),
  ));
  assert.equal(a.starts_at, '2026-12-05T06:00:00.000Z');
  assert.equal(a.uid, 'a|2026-12-04');
  assert.equal(b.uid, 'b|2026-12-04');
});
test('timed event without end gets one hour; DURATION is honoured', () => {
  const [a, b] = run(cal(
    ev('UID:a', 'SUMMARY:NoEnd', 'DTSTART:20261201T153000Z'),
    ev('UID:b', 'SUMMARY:Dur', 'DTSTART:20261202T153000Z', 'DURATION:PT90M'),
  ));
  assert.equal(a.ends_at, '2026-12-01T16:30:00.000Z');
  assert.equal(b.ends_at, '2026-12-02T17:00:00.000Z');
});

// ---------- all-day ----------
test('all-day Dec 5 shows on Dec 5 only', () => {
  const [e] = one('DTSTART;VALUE=DATE:20261205', 'DTEND;VALUE=DATE:20261206');
  assert.equal(e.all_day, true);
  assert.equal(e.starts_at, '2026-12-05T07:00:00.000Z');
  assert.equal(e.ends_at, '2026-12-05T07:00:00.000Z');
  assert.equal(e.uid, 'u1|2026-12-05');
});
test('three-day all-day ends on Dec 6', () => {
  const [e] = one('DTSTART;VALUE=DATE:20261204', 'DTEND;VALUE=DATE:20261207');
  assert.equal(e.starts_at, '2026-12-04T07:00:00.000Z');
  assert.equal(e.ends_at, '2026-12-06T07:00:00.000Z');
});
test('all-day without DTEND, and with DTEND not after DTSTART', () => {
  const [a, b] = run(cal(
    ev('UID:a', 'SUMMARY:NoEnd', 'DTSTART;VALUE=DATE:20261205'),
    ev('UID:b', 'SUMMARY:BadEnd', 'DTSTART;VALUE=DATE:20261206', 'DTEND;VALUE=DATE:20261206'),
  ));
  assert.equal(a.ends_at, '2026-12-05T07:00:00.000Z');
  assert.equal(b.ends_at, '2026-12-06T07:00:00.000Z');
});
test('all-day across the March DST change', () => {
  const [e] = one('DTSTART;VALUE=DATE:20270313', 'DTEND;VALUE=DATE:20270316');
  assert.equal(e.starts_at, '2027-03-13T07:00:00.000Z'); // MST
  assert.equal(e.ends_at, '2027-03-15T06:00:00.000Z'); // MDT
});
test('all-day across the November DST change', () => {
  const [e] = run(cal(ev('UID:u1', 'SUMMARY:Meet', 'DTSTART;VALUE=DATE:20261031', 'DTEND;VALUE=DATE:20261103')), resorts, new Date('2026-10-20T12:00:00Z'));
  assert.equal(e.starts_at, '2026-10-31T06:00:00.000Z'); // MDT
  assert.equal(e.ends_at, '2026-11-02T07:00:00.000Z'); // MST
});

// ---------- recurrence ----------
const weekly = ['DTSTART;TZID=America/Denver:20261203T180000', 'DTEND;TZID=America/Denver:20261203T190000', 'RRULE:FREQ=WEEKLY;COUNT=4'];

test('weekly COUNT=4 gives four distinct dated uids', () => {
  const out = run(cal(ev('UID:w', 'SUMMARY:Weekly', ...weekly)));
  assert.deepEqual(out.map((e) => e.uid), ['w|2026-12-03', 'w|2026-12-10', 'w|2026-12-17', 'w|2026-12-24']);
  assert.equal(out[0].starts_at, '2026-12-04T01:00:00.000Z');
  assert.equal(out[0].ends_at, '2026-12-04T02:00:00.000Z');
  assert.equal(out[3].ends_at, '2026-12-25T02:00:00.000Z');
});
test('EXDATE removes one occurrence', () => {
  const out = run(cal(ev('UID:w', 'SUMMARY:Weekly', ...weekly, 'EXDATE;TZID=America/Denver:20261210T180000')));
  assert.deepEqual(out.map((e) => e.uid), ['w|2026-12-03', 'w|2026-12-17', 'w|2026-12-24']);
});
test('override moved by 30 minutes keeps the plain uid', () => {
  const out = run(cal(
    ev('UID:w', 'SUMMARY:Weekly', ...weekly),
    ev('UID:w', 'SUMMARY:Weekly moved', 'RECURRENCE-ID;TZID=America/Denver:20261210T180000', 'DTSTART;TZID=America/Denver:20261210T183000', 'DTEND;TZID=America/Denver:20261210T193000'),
  ));
  assert.equal(out.length, 4);
  const moved = out.find((e) => e.uid === 'w|2026-12-10')!;
  assert.equal(moved.title, 'Weekly moved');
  assert.equal(moved.starts_at, '2026-12-11T01:30:00.000Z');
  assert.equal(moved.ends_at, '2026-12-11T02:30:00.000Z');
});
test('override moved to another day keeps the original date in its uid', () => {
  const out = run(cal(
    ev('UID:w', 'SUMMARY:Weekly', ...weekly),
    ev('UID:w', 'SUMMARY:Weekly later', 'RECURRENCE-ID;TZID=America/Denver:20261210T180000', 'DTSTART;TZID=America/Denver:20261212T100000', 'DTEND;TZID=America/Denver:20261212T110000'),
  ));
  assert.deepEqual(out.map((e) => e.uid), ['w|2026-12-03', 'w|2026-12-10', 'w|2026-12-17', 'w|2026-12-24']);
  assert.equal(out[1].starts_at, '2026-12-12T17:00:00.000Z'); // sorted by actual start
  assert.equal(out[1].uid, 'w|2026-12-10');
});
test('cancelled override removes that occurrence', () => {
  const out = run(cal(
    ev('UID:w', 'SUMMARY:Weekly', ...weekly),
    ev('UID:w', 'SUMMARY:Weekly', 'STATUS:CANCELLED', 'RECURRENCE-ID;TZID=America/Denver:20261210T180000', 'DTSTART;TZID=America/Denver:20261210T180000'),
  ));
  assert.deepEqual(out.map((e) => e.uid), ['w|2026-12-03', 'w|2026-12-17', 'w|2026-12-24']);
});
test('recurrence keeps local time across DST', () => {
  const out = run(cal(ev('UID:w', 'SUMMARY:Weekly', 'DTSTART;TZID=America/Denver:20270306T180000', 'RRULE:FREQ=WEEKLY;COUNT=3')));
  assert.deepEqual(out.map((e) => e.starts_at), ['2027-03-07T01:00:00.000Z', '2027-03-14T01:00:00.000Z', '2027-03-21T00:00:00.000Z']);
});
test('RRULE UNTIL is respected and the window end stops open series', () => {
  const until = run(cal(ev('UID:w', 'SUMMARY:W', 'DTSTART;TZID=America/Denver:20261203T180000', 'RRULE:FREQ=WEEKLY;UNTIL=20261217T000000Z')));
  assert.equal(until.length, 2);
  const open = run(cal(ev('UID:w', 'SUMMARY:W', 'DTSTART;TZID=America/Denver:20261203T180000', 'RRULE:FREQ=WEEKLY')));
  assert.equal(open.length, 24); // Dec 3 .. May 13 (window ends May 16)
  assert.equal(open.at(-1)!.uid, 'w|2027-05-13');
});
test('several occurrences on one day get |2, |3', () => {
  const out = run(cal(ev('UID:h', 'SUMMARY:Hourly', 'DTSTART;TZID=America/Denver:20261203T090000', 'RRULE:FREQ=HOURLY;COUNT=3')));
  assert.deepEqual(out.map((e) => e.uid), ['h|2026-12-03', 'h|2026-12-03|2', 'h|2026-12-03|3']);
});
test('all-day recurring keeps its span', () => {
  const out = run(cal(ev('UID:a', 'SUMMARY:Camp', 'DTSTART;VALUE=DATE:20261204', 'DTEND;VALUE=DATE:20261206', 'RRULE:FREQ=WEEKLY;COUNT=2')));
  assert.deepEqual(out.map((e) => e.uid), ['a|2026-12-04', 'a|2026-12-11']);
  assert.equal(out[1].ends_at, '2026-12-12T07:00:00.000Z');
});
test('hostile RRULE terminates and is capped', () => {
  const t0 = Date.now();
  const out = eventsFromIcs(cal(
    ev('UID:h', 'SUMMARY:Boom', 'DTSTART:20261201T150000Z', 'RRULE:FREQ=SECONDLY'),
    ev('UID:h2', 'SUMMARY:Boom2', 'DTSTART:20200101T150000Z', 'RRULE:FREQ=SECONDLY'),
    ev('UID:h3', 'SUMMARY:Boom3', 'DTSTART:20261201T150000Z', 'RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=31'),
  ), NOW, resorts, 500);
  assert.ok(out.length <= 500);
  assert.ok(Date.now() - t0 < 1500, `took ${Date.now() - t0}ms`);
});
test('50 impossible rules are skipped fast; the normal event stays', () => {
  const evs = [];
  for (let i = 0; i < 50; i++) evs.push(ev(`UID:i${i}`, 'SUMMARY:Never', 'DTSTART:20200105T150000Z', 'RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30;BYDAY=MO'));
  evs.push(ev('UID:ok', 'SUMMARY:Normal', 'DTSTART;TZID=America/Denver:20261124T090000'));
  const t0 = Date.now();
  const out = run(cal(...evs));
  assert.deepEqual(out.map((e) => e.uid), ['ok|2026-11-24']);
  assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0}ms`);
});
test('BYMONTH=4,6,9,11 with day 31 is skipped fast', () => {
  const t0 = Date.now();
  assert.deepEqual(run(cal(ev('UID:i', 'SUMMARY:Never', 'DTSTART:20200105T150000Z', 'RRULE:FREQ=YEARLY;BYMONTH=4,6,9,11;BYMONTHDAY=31'))), []);
  assert.ok(Date.now() - t0 < 500);
});
test('a tiny work budget returns a partial array without throwing', () => {
  const evs = [];
  for (let i = 0; i < 5; i++) evs.push(ev(`UID:b${i}`, 'SUMMARY:Heavy', 'DTSTART:20200101T150000Z', 'RRULE:FREQ=SECONDLY'));
  const out = eventsFromIcs(cal(...evs), NOW, resorts, 1);
  assert.ok(Array.isArray(out));
});
test('long-running series do not starve later ones', () => {
  const evs = [];
  for (let i = 0; i < 41; i++) evs.push(ev(`UID:old${i}`, 'SUMMARY:Old', 'DTSTART;TZID=America/Denver:20160104T090000', 'RRULE:FREQ=WEEKLY'));
  evs.push(ev('UID:cur', 'SUMMARY:Current', 'DTSTART;TZID=America/Denver:20261119T090000', 'RRULE:FREQ=WEEKLY'));
  const out = run(cal(...evs));
  assert.ok(out.length <= 500);
  assert.ok(out.some((e) => e.uid === 'cur|2026-11-19'));
  assert.ok(out.some((e) => e.uid === 'cur|2026-12-03'));
});
test('daily series since 2010 yields exactly the window days', () => {
  const out = run(cal(ev('UID:d', 'SUMMARY:Daily', 'DTSTART;TZID=America/Denver:20100101T090000', 'RRULE:FREQ=DAILY')));
  assert.equal(out.length, 181);
  assert.equal(out[0].uid, 'd|2026-11-16');
  assert.equal(out[180].uid, 'd|2027-05-15');
});
test('weekdays since 2007 yields in-window occurrences', () => {
  const out = run(cal(ev('UID:w', 'SUMMARY:Weekdays', 'DTSTART;TZID=America/Denver:20070102T090000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')));
  assert.equal(out[0].uid, 'w|2026-11-16');
  assert.equal(out.at(-1)!.uid, 'w|2027-05-14');
  assert.equal(out.length, 130);
});
test('COUNT counts from the true DTSTART', () => {
  assert.deepEqual(run(cal(ev('UID:c', 'SUMMARY:Old', 'DTSTART;TZID=America/Denver:20150105T090000', 'RRULE:FREQ=WEEKLY;COUNT=3'))), []);
});

// ---------- window, status, text ----------
test('window: 200 days out and 3 days ago are left out; overlap kept', () => {
  const out = run(cal(
    ev('UID:far', 'SUMMARY:Far', 'DTSTART:20270605T150000Z', 'DTEND:20270605T160000Z'),
    ev('UID:old', 'SUMMARY:Old', 'DTSTART:20261114T150000Z', 'DTEND:20261114T160000Z'),
    ev('UID:span', 'SUMMARY:Span', 'DTSTART:20261110T150000Z', 'DTEND:20261117T170000Z'),
    ev('UID:near', 'SUMMARY:Near', 'DTSTART:20270510T150000Z', 'DTEND:20270510T160000Z'),
  ));
  assert.deepEqual(out.map((e) => e.title), ['Span', 'Near']);
});
test('STATUS:CANCELLED is left out', () => {
  assert.deepEqual(one('DTSTART:20261201T150000Z', 'STATUS:CANCELLED'), []);
});
test('titles: empty, one char, long, trimmed', () => {
  const t = (summary: string[]) => run(cal(ev('UID:t', ...summary, 'DTSTART:20261201T150000Z')))[0].title;
  assert.equal(t([]), 'Club event');
  assert.equal(t(['SUMMARY:']), 'Club event');
  assert.equal(t(['SUMMARY:  x ']), 'Club event');
  assert.equal(t(['SUMMARY:  Wax night ']), 'Wax night');
  assert.equal(t(['SUMMARY:' + 'a'.repeat(300)]), 'a'.repeat(80));
});
test('text cuts by code point', () => {
  const [e] = run(cal(ev('UID:t', 'SUMMARY:' + '\u{1F600}'.repeat(100), 'DESCRIPTION:' + '\u{1F600}'.repeat(1100), 'LOCATION:' + '\u{1F600}'.repeat(200), 'DTSTART:20261201T150000Z')));
  assert.equal(Array.from(e.title).length, 80);
  assert.equal(Array.from(e.description).length, 1000);
  assert.equal(Array.from(e.location).length, 120);
  assert.equal(e.title, '\u{1F600}'.repeat(80));
});
test('text fields: escapes decoded, trimmed, resort guessed from location + title', () => {
  const [e] = run(cal(ev('UID:t', 'SUMMARY:Dawn patrol', 'DESCRIPTION:Bring\\, snacks\\nand skis', 'LOCATION:Copper Mountain', 'DTSTART:20261201T150000Z')));
  assert.equal(e.description, 'Bring, snacks\nand skis');
  assert.equal(e.location, 'Copper Mountain');
  assert.equal(e.resort_id, 'copper');
});
test('no resort match gives null; missing fields give empty strings', () => {
  const [e] = one('DTSTART:20261201T150000Z');
  assert.equal(e.resort_id, null);
  assert.equal(e.description, '');
  assert.equal(e.location, '');
});
test('500 cap, earliest first', () => {
  const evs = [];
  for (let i = 0; i < 600; i++) {
    const d = new Date(Date.UTC(2026, 11, 1, 0, 0, 0) + (599 - i) * 3600_000);
    evs.push(ev(`UID:e${i}`, 'SUMMARY:Many', `DTSTART:${d.toISOString().replace(/[-:]|\.\d{3}/g, '')}`));
  }
  const out = run(cal(...evs));
  assert.equal(out.length, 500);
  assert.equal(out[0].starts_at, '2026-12-01T00:00:00.000Z');
  assert.equal(out[499].starts_at, '2026-12-21T19:00:00.000Z');
});
test('bad event is skipped, others kept', () => {
  const out = run(cal(ev('UID:bad', 'SUMMARY:Bad', 'DTSTART:garbage'), ev('UID:ok', 'SUMMARY:Ok', 'DTSTART:20261201T150000Z')));
  assert.deepEqual(out.map((e) => e.uid), ['ok|2026-12-01']);
});
test('feeds do not leak time zones into each other', () => {
  const vtz = ['BEGIN:VTIMEZONE', 'TZID:Custom/Five', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0500', 'END:STANDARD', 'END:VTIMEZONE'];
  run(cal(vtz, ev('UID:v', 'SUMMARY:A', 'DTSTART;TZID=Custom/Five:20261201T083000')));
  const [e] = run(cal(ev('UID:v', 'SUMMARY:A', 'DTSTART;TZID=Custom/Five:20261201T083000')));
  assert.equal(e.starts_at, '2026-12-01T15:30:00.000Z'); // unknown zone: Denver
});

// ---------- guessResort ----------
test('guessResort', () => {
  assert.equal(guessResort('Dawn patrol at Copper Mountain', resorts), 'copper');
  assert.equal(guessResort('dawn patrol at COPPER MOUNTAIN', resorts), 'copper');
  assert.equal(guessResort('Copper day', resorts), 'copper');
  assert.equal(guessResort('Wax night, Rec Center', resorts), null);
  assert.equal(guessResort('Prevail dinner', resorts), null);
  assert.equal(guessResort('Vail!', resorts), 'vail');
  assert.equal(guessResort('Echo night', resorts), null); // "Echo" is too short
  assert.equal(guessResort('Echo Mountain night', resorts), 'echo');
  assert.equal(guessResort('Granby Ranch day', resorts), 'granby'); // longest wins
  assert.equal(guessResort('Granby day', resorts), 'granbyonly');
  assert.equal(guessResort('Eldora opening', resorts), 'eldora');
  assert.equal(guessResort('', resorts), null);
  assert.equal(guessResort('Copper', []), null);
});

// ---------- parseCalendar ----------
test('parseCalendar: truncated only when the time budget runs out', () => {
  const heavy: string[][] = [];
  for (let i = 0; i < 5; i++) heavy.push(ev(`UID:b${i}`, 'SUMMARY:Heavy', 'DTSTART:20200101T150000Z', 'RRULE:FREQ=SECONDLY'));
  assert.equal(parseCalendar(cal(...heavy), NOW, resorts, 1).truncated, true);
  const normal = parseCalendar(cal(ev('UID:n', 'SUMMARY:Normal', 'DTSTART:20261201T150000Z')), NOW, resorts);
  assert.equal(normal.truncated, false);
  assert.equal(normal.events.length, 1);
  const capped = parseCalendar(cal(ev('UID:c', 'SUMMARY:Daily', 'DTSTART:20261118T150000Z', 'RRULE:FREQ=HOURLY')), NOW, resorts, 5000);
  assert.equal(capped.events.length, 500);
  assert.equal(capped.truncated, false);
});
test('parseCalendar: stopping at the candidate cap counts as truncated', () => {
  // 40 hourly series fill the 20,000-candidate cap (500 each); the 41st series is never expanded.
  const many: string[][] = [];
  for (let i = 0; i < 40; i++) many.push(ev(`UID:h${i}`, 'SUMMARY:Hourly', 'DTSTART:20261118T000000Z', 'RRULE:FREQ=HOURLY'));
  many.push(ev('UID:late', 'SUMMARY:Never reached', 'DTSTART:20261117T130000Z', 'RRULE:FREQ=WEEKLY'));
  const out = parseCalendar(cal(...many), NOW, resorts, 60_000);
  assert.equal(out.truncated, true);
  // 39 series fit under the cap: full expansion, so the 500 cut alone is not truncation.
  const fits = parseCalendar(cal(...many.slice(0, 39)), NOW, resorts, 60_000);
  assert.equal(fits.events.length, 500);
  assert.equal(fits.truncated, false);
});

// ---------- fetchCalendar ----------
const GOOD = 'https://calendar.google.com/calendar/ical/abc/public/basic.ics';
const FAILED = { message: 'Could not read that calendar link' };
type Call = { url: string; init: RequestInit };
const stub = (...responses: (Response | Error)[]) => {
  const calls: Call[] = [];
  const fn = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    const r = responses.shift();
    if (!r) throw new Error('unexpected request');
    if (r instanceof Error) throw r;
    return r;
  }) as typeof fetch;
  return { fn, calls };
};
const redirect = (location: string | null, status = 302) =>
  new Response(null, { status, headers: location ? { location } : {} });
const streamOf = (chunks: Uint8Array[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const x of chunks) c.enqueue(x);
      c.close();
    },
  });

test('fetchCalendar returns the text of a 200', async () => {
  const s = stub(new Response('BEGIN:VCALENDAR\r\nEND:VCALENDAR'));
  assert.equal(await fetchCalendar(GOOD, s.fn), 'BEGIN:VCALENDAR\r\nEND:VCALENDAR');
});
test('fetchCalendar sends a manual, credential-free request', async () => {
  const s = stub(new Response('x'));
  await fetchCalendar(GOOD, s.fn);
  const { init } = s.calls[0];
  assert.equal(init.redirect, 'manual');
  assert.equal(init.method, 'GET');
  const names = Object.keys(init.headers as Record<string, string>).map((h) => h.toLowerCase()).sort();
  assert.deepEqual(names, ['accept', 'user-agent']);
});
test('fetchCalendar follows allowed and relative redirects', async () => {
  const s = stub(redirect('/other.ics'), redirect('https://outlook.office365.com/x.ics', 301), new Response('ok'));
  assert.equal(await fetchCalendar(GOOD, s.fn), 'ok');
  assert.deepEqual(s.calls.map((c) => c.url), [GOOD, 'https://calendar.google.com/other.ics', 'https://outlook.office365.com/x.ics']);
});
test('fetchCalendar refuses a redirect to another host without requesting it', async () => {
  for (const bad of ['https://evil.example.com/x.ics', 'http://calendar.google.com/x.ics', 'https://169.254.169.254/', 'https://calendar.google.com:8443/x.ics']) {
    const s = stub(redirect(bad), new Response('leak'));
    await assert.rejects(fetchCalendar(GOOD, s.fn), FAILED);
    assert.equal(s.calls.length, 1);
  }
});
test('fetchCalendar rejects a redirect without Location and a fourth redirect', async () => {
  await assert.rejects(fetchCalendar(GOOD, stub(redirect(null)).fn), FAILED);
  const s = stub(redirect('/1'), redirect('/2'), redirect('/3'), redirect('/4'), new Response('ok'));
  await assert.rejects(fetchCalendar(GOOD, s.fn), FAILED);
  assert.equal(s.calls.length, 4);
  assert.equal(await fetchCalendar(GOOD, stub(redirect('/1'), redirect('/2'), redirect('/3'), new Response('ok')).fn), 'ok');
});
test('fetchCalendar refuses a disallowed first URL with zero requests', async () => {
  const s = stub(new Response('x'));
  await assert.rejects(fetchCalendar('https://evil.example.com/a.ics', s.fn), FAILED);
  assert.equal(s.calls.length, 0);
});
test('fetchCalendar rejects an oversized Content-Length without reading', async () => {
  let pulled = false;
  const body = new ReadableStream<Uint8Array>({ pull() { pulled = true; } }, { highWaterMark: 0 });
  const res = new Response(body, { status: 200, headers: { 'content-length': String(2 * 1024 * 1024 + 1) } });
  await assert.rejects(fetchCalendar(GOOD, stub(res).fn), FAILED);
  assert.equal(pulled, false);
});
test('fetchCalendar rejects a streamed body over 2 MB and accepts exactly 2 MB', async () => {
  const chunk = new Uint8Array(512 * 1024).fill(65);
  await assert.rejects(fetchCalendar(GOOD, stub(new Response(streamOf([chunk, chunk, chunk, chunk, new Uint8Array(1)]))).fn), FAILED);
  const ok = await fetchCalendar(GOOD, stub(new Response(streamOf([chunk, chunk, chunk, chunk]))).fn);
  assert.equal(ok.length, 2 * 1024 * 1024);
});
test('fetchCalendar rejects invalid UTF-8, empty bodies and non-200 statuses', async () => {
  await assert.rejects(fetchCalendar(GOOD, stub(new Response(new Uint8Array([0xff, 0xfe, 0xfd]))).fn), FAILED);
  await assert.rejects(fetchCalendar(GOOD, stub(new Response(null, { status: 200 })).fn), FAILED);
  await assert.rejects(fetchCalendar(GOOD, stub(new Response('nope', { status: 500 })).fn), FAILED);
  await assert.rejects(fetchCalendar(GOOD, stub(new Response('nope', { status: 404 })).fn), FAILED);
});
test('fetchCalendar maps a thrown fetch error to the generic message', async () => {
  await assert.rejects(fetchCalendar(GOOD, stub(new Error('secret detail https://x')).fn), FAILED);
});
