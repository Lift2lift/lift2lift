// Run with: node --test packages/app/lib/events.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BoardRide, CommunityEvent } from './types.ts';
import {
  dayMarks,
  daysAway,
  eventDays,
  eventIsOver,
  eventOn,
  eventsOn,
  initialDay,
  isMultiDay,
  kicker,
  memberRidesByMountain,
  monthCells,
  nextEvent,
  ridesForEvent,
} from './events.ts';
import { denverDay, denverMidnight } from './dates.ts';

const iso = (y: number, m: number, d: number, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).toISOString();

let n = 0;
const ev = (o: Partial<CommunityEvent> = {}): CommunityEvent => ({
  id: `e${++n}`,
  communityId: 'c1',
  title: 'Club trip',
  description: '',
  location: '',
  resortId: null,
  startsAt: iso(2026, 12, 5, 9),
  endsAt: iso(2026, 12, 5, 17),
  allDay: false,
  source: 'manual',
  going: 0,
  iAmIn: false,
  goingPeople: [],
  rideCount: 0,
  ...o,
});

const ride = (o: Partial<BoardRide> = {}): BoardRide =>
  ({
    id: `r${++n}`,
    resortId: 'alta',
    departAt: iso(2026, 12, 5, 7),
    seatsTotal: 4,
    seatsTaken: 1,
    eventId: null,
    eventTitle: null,
    ...o,
  }) as BoardRide;

test('eventDays: timed single day', () => assert.deepEqual(eventDays(ev()), ['2026-12-05']));
test('eventDays: Dec 4 4 PM to Dec 6 2 PM is three days', () =>
  assert.deepEqual(eventDays(ev({ startsAt: iso(2026, 12, 4, 16), endsAt: iso(2026, 12, 6, 14) })), ['2026-12-04', '2026-12-05', '2026-12-06']));
// All-day events are stored at Denver midnight of their first and last day (see F1); these hold in any TZ.
const dm = denverMidnight;
test('eventDays: all-day single day does not spill', () =>
  assert.deepEqual(eventDays(ev({ allDay: true, startsAt: dm('2026-12-05'), endsAt: dm('2026-12-05') })), ['2026-12-05']));
test('eventDays: all-day multi day ends on last day', () =>
  assert.deepEqual(eventDays(ev({ allDay: true, startsAt: dm('2026-12-05'), endsAt: dm('2026-12-06') })), ['2026-12-05', '2026-12-06']));
test('eventDays: all-day at Denver midnight Dec 5 is Dec 5 in any device zone', () =>
  assert.deepEqual(eventDays(ev({ allDay: true, startsAt: '2026-12-05T07:00:00.000Z', endsAt: '2026-12-05T07:00:00.000Z' })), ['2026-12-05']));
test('eventDays: three-day all-day event', () =>
  assert.deepEqual(eventDays(ev({ allDay: true, startsAt: dm('2026-12-05'), endsAt: dm('2026-12-07') })), ['2026-12-05', '2026-12-06', '2026-12-07']));
test('eventDays: all-day across the DST change keeps its Denver dates', () =>
  assert.deepEqual(eventDays(ev({ allDay: true, startsAt: dm('2026-10-31'), endsAt: dm('2026-11-02') })), ['2026-10-31', '2026-11-01', '2026-11-02']));
test('eventDays: unparseable dates give no days (and do not hang)', () => {
  assert.deepEqual(eventDays(ev({ startsAt: 'not a date', endsAt: iso(2026, 12, 5, 17) })), []);
  assert.deepEqual(eventDays(ev({ allDay: true, startsAt: iso(2026, 12, 5), endsAt: 'nope' })), []);
  assert.equal(eventOn([ev({ startsAt: 'x', endsAt: 'y' })], '2026-12-05'), null);
});

test('denverMidnight: Denver wall-clock midnight, DST-correct, round-trips', () => {
  assert.equal(denverMidnight('2026-12-05'), '2026-12-05T07:00:00.000Z'); // MST
  assert.equal(denverMidnight('2026-07-04'), '2026-07-04T06:00:00.000Z'); // MDT
  assert.equal(denverMidnight('2027-03-14'), '2027-03-14T07:00:00.000Z'); // spring forward at 2 am, midnight is still MST
  assert.equal(denverMidnight('2027-03-15'), '2027-03-15T06:00:00.000Z');
  assert.equal(denverMidnight('2026-11-01'), '2026-11-01T06:00:00.000Z'); // fall back at 2 am, midnight is still MDT
  assert.equal(denverMidnight('2026-11-02'), '2026-11-02T07:00:00.000Z');
  for (const day of ['2027-03-13', '2027-03-14', '2027-03-15', '2026-10-31', '2026-11-01', '2026-11-02', '2026-12-31', '2027-01-01'])
    assert.equal(denverDay(denverMidnight(day)), day);
});
test('denverDay: late evening in Denver is still that day', () => {
  assert.equal(denverDay('2026-12-06T06:59:00.000Z'), '2026-12-05');
  assert.equal(denverDay('2026-12-06T07:00:00.000Z'), '2026-12-06');
  assert.equal(denverDay('bad'), '');
});

test('eventIsOver: timed at its end, all-day at the end of its last Denver day', () => {
  const timed = ev({ startsAt: '2026-12-05T16:00:00.000Z', endsAt: '2026-12-05T18:00:00.000Z' });
  assert.equal(eventIsOver(timed, new Date('2026-12-05T17:00:00.000Z')), false);
  assert.equal(eventIsOver(timed, new Date('2026-12-05T18:00:01.000Z')), true);
  const allDay = ev({ allDay: true, startsAt: dm('2026-12-05'), endsAt: dm('2026-12-06') });
  assert.equal(eventIsOver(allDay, new Date('2026-12-07T06:59:59.000Z')), false); // 11:59 pm Dec 6 in Denver
  assert.equal(eventIsOver(allDay, new Date('2026-12-07T07:00:00.000Z')), true);
});
test('eventDays: timed event ending at midnight skips that day', () =>
  assert.deepEqual(eventDays(ev({ startsAt: iso(2026, 12, 4, 20), endsAt: iso(2026, 12, 6) })), ['2026-12-04', '2026-12-05']));
test('eventDays: zero-length timed event at midnight keeps its day', () =>
  assert.deepEqual(eventDays(ev({ startsAt: iso(2026, 12, 6), endsAt: iso(2026, 12, 6) })), ['2026-12-06']));

test('isMultiDay', () => {
  assert.equal(isMultiDay(ev()), false);
  assert.equal(isMultiDay(ev({ startsAt: iso(2026, 12, 4, 16), endsAt: iso(2026, 12, 6, 14) })), true);
});

test('monthCells: November 2026 starts Sunday', () => {
  const c = monthCells(new Date(2026, 10, 1));
  assert.equal(c.filter((x) => x === null).length, c.length - 30);
  assert.equal(c[0], '2026-11-01');
  assert.equal(c.filter(Boolean).length, 30);
  assert.equal(c.length % 7, 0);
});
test('monthCells: December 2026 has 2 leading nulls and 35 cells', () => {
  const c = monthCells(new Date(2026, 11, 15));
  assert.deepEqual(c.slice(0, 3), [null, null, '2026-12-01']);
  assert.equal(c.length, 35);
  assert.equal(c.filter(Boolean).length, 31);
});

test('kicker', () => {
  const today = '2026-12-01';
  const soon = ev({ startsAt: iso(2026, 12, 5, 9), endsAt: iso(2026, 12, 5, 17) });
  const later = ev({ startsAt: iso(2026, 12, 18, 9), endsAt: iso(2026, 12, 18, 17) });
  assert.equal(kicker(soon, soon, today), 'Next up · in 4 days');
  assert.equal(kicker(later, soon, today), 'Club event · in 17 days');
  const tmrw = ev({ startsAt: iso(2026, 12, 2, 9), endsAt: iso(2026, 12, 2, 17) });
  assert.equal(kicker(tmrw, tmrw, today), 'Next up · tomorrow');
  assert.equal(kicker(tmrw, null, today), 'Club event · tomorrow');
  const now = ev({ startsAt: iso(2026, 12, 1, 9), endsAt: iso(2026, 12, 1, 17) });
  assert.equal(kicker(now, now, today), 'Next up · today');
  assert.equal(kicker(now, tmrw, today), 'Club event · today');
});

test('daysAway', () => {
  assert.equal(daysAway(ev({ startsAt: iso(2026, 12, 5, 9) }), '2026-12-01'), 4);
  const underway = ev({ startsAt: iso(2026, 11, 30, 9), endsAt: iso(2026, 12, 2, 9) });
  assert.equal(daysAway(underway, '2026-12-01'), 0);
});

test('initialDay', () => {
  const now = new Date(2026, 11, 1, 10);
  assert.equal(initialDay([], now), '2026-12-01');
  assert.equal(initialDay([ev({ startsAt: iso(2026, 12, 5, 9), endsAt: iso(2026, 12, 5, 17) })], now), '2026-12-05');
  assert.equal(initialDay([ev({ startsAt: iso(2026, 11, 20, 9), endsAt: iso(2026, 11, 20, 17) })], now), '2026-12-01');
  assert.equal(initialDay([ev({ startsAt: iso(2026, 11, 30, 9), endsAt: iso(2026, 12, 2, 9) })], now), '2026-12-01');
});

test('nextEvent skips ended, keeps under-way', () => {
  const now = new Date(2026, 11, 1, 10);
  const ended = ev({ startsAt: iso(2026, 12, 1, 7), endsAt: iso(2026, 12, 1, 9) });
  const underway = ev({ startsAt: iso(2026, 11, 30, 9), endsAt: iso(2026, 12, 2, 9) });
  const future = ev({ startsAt: iso(2026, 12, 9, 9), endsAt: iso(2026, 12, 9, 17) });
  assert.equal(nextEvent([ended, future, underway], now)?.id, underway.id);
  assert.equal(nextEvent([ended], now), null);
  assert.equal(nextEvent([future, ended], now)?.id, future.id);
});

test('multi-day across months: start, middle, end, eventOn', () => {
  const e = ev({ startsAt: iso(2026, 11, 30, 9), endsAt: iso(2026, 12, 2, 17) });
  const nov = dayMarks(new Date(2026, 10, 1), [e], []);
  assert.equal(nov['2026-11-30'].span, 'start');
  assert.equal(nov['2026-11-29'].span, 'none');
  const dec = dayMarks(new Date(2026, 11, 1), [e], []);
  assert.equal(dec['2026-12-01'].span, 'middle');
  assert.equal(dec['2026-12-02'].span, 'end');
  assert.equal(dec['2026-12-02'].event?.id, e.id);
  assert.equal(eventOn([e], '2026-12-01')?.id, e.id);
  assert.equal(eventOn([e], '2026-12-03'), null);
});

test('eventsOn: two events on one day, by start', () => {
  const a = ev({ startsAt: iso(2026, 12, 5, 14), endsAt: iso(2026, 12, 5, 16) });
  const b = ev({ startsAt: iso(2026, 12, 5, 8), endsAt: iso(2026, 12, 5, 10) });
  assert.deepEqual(eventsOn([a, b], '2026-12-05').map((e) => e.id), [b.id, a.id]);
  assert.deepEqual(eventsOn([a, b], '2026-12-06'), []);
});
test('eventsOn: single-day event comes before a multi-day span passing through', () => {
  const span = ev({ startsAt: iso(2026, 12, 4, 9), endsAt: iso(2026, 12, 7, 17) });
  const single = ev({ startsAt: iso(2026, 12, 5, 18), endsAt: iso(2026, 12, 5, 20) });
  assert.deepEqual(eventsOn([span, single], '2026-12-05').map((e) => e.id), [single.id, span.id]);
  assert.equal(eventOn([span, single], '2026-12-05')?.id, single.id);
  assert.deepEqual(eventsOn([span, single], '2026-12-04').map((e) => e.id), [span.id]);
  // The bar stays continuous and the single-day event still shows as a dot.
  const m = dayMarks(new Date(2026, 11, 1), [span, single], []);
  assert.equal(m['2026-12-05'].span, 'middle');
  assert.equal(m['2026-12-05'].single, true);
  assert.equal(m['2026-12-05'].event?.id, single.id);
  assert.equal(m['2026-12-06'].single, false);
});
test('eventsOn: a multi-day event starting that day comes before one passing through', () => {
  const longer = ev({ startsAt: iso(2026, 12, 1, 9), endsAt: iso(2026, 12, 20, 17), allDay: false });
  const trip = ev({ startsAt: iso(2026, 12, 5, 9), endsAt: iso(2026, 12, 6, 17) });
  assert.deepEqual(eventsOn([longer, trip], '2026-12-05').map((e) => e.id), [trip.id, longer.id]);
});

test('single-day span and eventOn earliest start wins', () => {
  const a = ev({ startsAt: iso(2026, 12, 5, 14), endsAt: iso(2026, 12, 5, 16) });
  const b = ev({ startsAt: iso(2026, 12, 5, 8), endsAt: iso(2026, 12, 5, 10) });
  assert.equal(eventOn([a, b], '2026-12-05')?.id, b.id);
  assert.equal(dayMarks(new Date(2026, 11, 1), [b], [])['2026-12-05'].span, 'single');
});

test('row edges: Fri Dec 4 to Mon Dec 7', () => {
  const e = ev({ startsAt: iso(2026, 12, 4, 9), endsAt: iso(2026, 12, 7, 17) });
  const m = dayMarks(new Date(2026, 11, 1), [e], []);
  assert.equal(m['2026-12-04'].span, 'start');
  assert.equal(m['2026-12-05'].span, 'middle');
  assert.equal(m['2026-12-05'].rowEnd, true);
  assert.equal(m['2026-12-06'].span, 'middle');
  assert.equal(m['2026-12-06'].rowStart, true);
  assert.equal(m['2026-12-07'].span, 'end');
  assert.equal(m['2026-12-04'].rowStart, false);
});

test('dayMarks: only non-null cells keyed, ride counts', () => {
  const m = dayMarks(new Date(2026, 11, 1), [], [ride(), ride({ departAt: iso(2026, 12, 5, 12) }), ride({ departAt: iso(2026, 12, 6, 7) })]);
  assert.equal(Object.keys(m).length, 31);
  assert.equal(m['2026-12-05'].rides, 2);
  assert.equal(m['2026-12-06'].rides, 1);
  assert.equal(m['2026-12-07'].rides, 0);
  assert.equal(m['2026-12-07'].event, null);
  assert.equal(m['2026-12-07'].span, 'none');
});

test('memberRidesByMountain', () => {
  const rides = [
    ride({ resortId: 'alta', seatsTotal: 4, seatsTaken: 1 }),
    ride({ resortId: 'brighton', seatsTotal: 3, seatsTaken: 0 }),
    ride({ resortId: 'alta', seatsTotal: 4, seatsTaken: 2 }),
    ride({ resortId: 'snowbird', eventId: 'e9', eventTitle: 'X' }),
    ride({ resortId: 'alta', departAt: iso(2026, 12, 6, 7) }),
  ];
  const g = memberRidesByMountain(rides, '2026-12-05');
  assert.deepEqual(g.map((x) => x.resortId), ['alta', 'brighton']);
  assert.equal(g[0].rides.length, 2);
  assert.equal(g[0].seatsOpen, 3 + 2);
  assert.equal(g[1].seatsOpen, 3);
});

test('memberRidesByMountain: ties broken by open seats', () => {
  const g = memberRidesByMountain([ride({ resortId: 'a', seatsTotal: 2, seatsTaken: 1 }), ride({ resortId: 'b', seatsTotal: 4, seatsTaken: 0 })], '2026-12-05');
  assert.deepEqual(g.map((x) => x.resortId), ['b', 'a']);
});

test('ridesForEvent sorted by departAt', () => {
  const late = ride({ eventId: 'x', departAt: iso(2026, 12, 5, 10) });
  const early = ride({ eventId: 'x', departAt: iso(2026, 12, 5, 6) });
  const other = ride({ eventId: 'y' });
  assert.deepEqual(ridesForEvent([late, other, early], 'x').map((r) => r.id), [early.id, late.id]);
});
