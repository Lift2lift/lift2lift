// Calendar math for community events. Pure: no React, no clock reads. Callers pass `now` / `today`.
// A "day" is YYYY-MM-DD. Timed events use the device-local day (isoDay); all-day events are Denver calendar
// dates everywhere, matching the server (they are stored at Denver midnight of their first and last day).
import type { BoardRide, CommunityEvent } from './types.ts';
import { addDays, denverDay, denverMidnight, isoDay, nextDayString, parseDay } from './dates.ts';

const byStart = (a: CommunityEvent, b: CommunityEvent) => +new Date(a.startsAt) - +new Date(b.startsAt);

/** Every day the event touches, YYYY-MM-DD. An all-day event never spills into the next day. [] for an unparseable date. */
export function eventDays(e: CommunityEvent): string[] {
  const start = new Date(e.startsAt);
  const end = new Date(e.endsAt);
  if (Number.isNaN(+start) || Number.isNaN(+end)) return [];
  if (e.allDay) {
    const first = denverDay(start);
    let last = denverDay(end);
    if (last < first) last = first;
    const days: string[] = [];
    for (let day = first; day <= last; day = nextDayString(day)) days.push(day);
    return days;
  }
  const first = isoDay(start);
  let last = isoDay(end);
  // A timed event that ends exactly at local midnight does not touch the day it ends on.
  const atMidnight = end.getHours() === 0 && end.getMinutes() === 0 && end.getSeconds() === 0 && end.getMilliseconds() === 0;
  if (atMidnight && end > start) last = isoDay(addDays(end, -1));
  if (last < first) last = first;
  const days: string[] = [];
  for (let d = parseDay(first), day = first; day <= last; d = addDays(d, 1), day = isoDay(d)) days.push(day);
  return days;
}

export function isMultiDay(e: CommunityEvent): boolean {
  return eventDays(e).length > 1;
}

/**
 * Every event touching `day`: single-day events first, then multi-day events that start that day, then
 * multi-day events that merely pass through it; ties by start.
 */
export function eventsOn(events: CommunityEvent[], day: string): CommunityEvent[] {
  const rank = (days: string[]) => (days.length === 1 ? 0 : days[0] === day ? 1 : 2);
  return events
    .map((e) => ({ e, days: eventDays(e) }))
    .filter((x) => x.days.includes(day))
    .sort((a, b) => rank(a.days) - rank(b.days) || byStart(a.e, b.e))
    .map((x) => x.e);
}

/** The day's lead event: the first of `eventsOn`. */
export function eventOn(events: CommunityEvent[], day: string): CommunityEvent | null {
  return eventsOn(events, day)[0] ?? null;
}

/** When the event is over: all-day events last until the end of their final Denver day. */
function endInstant(e: CommunityEvent): number {
  if (!e.allDay) return +new Date(e.endsAt);
  const days = eventDays(e);
  if (!days.length) return NaN;
  return +new Date(denverMidnight(nextDayString(days[days.length - 1])));
}

/** Has the event finished at `now`? Same rule as the server's event_is_over. */
export function eventIsOver(e: CommunityEvent, now: Date): boolean {
  const end = endInstant(e);
  if (Number.isNaN(end)) return false;
  return e.allDay ? +now >= end : +now > end;
}

/** First event that has not ended at `now`. */
export function nextEvent(events: CommunityEvent[], now: Date): CommunityEvent | null {
  return [...events].sort(byStart).find((e) => endInstant(e) > +now) ?? null;
}

/** Day the page opens on: the next event's first day (or today if it is under way), else today. */
export function initialDay(events: CommunityEvent[], now: Date): string {
  const today = isoDay(now);
  const next = nextEvent(events, now);
  if (!next) return today;
  const first = eventDays(next)[0];
  return first > today ? first : today;
}

/** Whole days from `today` to the event's first day; 0 if under way. */
export function daysAway(e: CommunityEvent, today: string): number {
  const days = eventDays(e);
  if (!days.length) return 0;
  const diff = Math.round((+parseDay(days[0]) - +parseDay(today)) / 86400000);
  return Math.max(0, diff);
}

/** "Next up · in 4 days", "Club event · in 17 days", "Next up · today", "Club event · tomorrow". */
export function kicker(e: CommunityEvent, next: CommunityEvent | null, today: string): string {
  const n = daysAway(e, today);
  const when = n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`;
  return `${next && next.id === e.id ? 'Next up' : 'Club event'} · ${when}`;
}

/** Leading nulls for the weekday offset, then each day of the month. Length is a multiple of 7. */
export function monthCells(month: Date): (string | null)[] {
  const y = month.getFullYear();
  const m = month.getMonth();
  const lead = new Date(y, m, 1).getDay();
  const count = new Date(y, m + 1, 0).getDate();
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= count; d++) cells.push(isoDay(new Date(y, m, d)));
  while (cells.length % 7) cells.push(null);
  return cells;
}

export type DayMark = {
  /** The day's lead event (first of `eventsOn`), or null. */
  event: CommunityEvent | null;
  /** The bar: from the earliest-starting multi-day event on the day, else 'single' when any event is on it. */
  span: 'none' | 'single' | 'start' | 'middle' | 'end';
  /** A single-day event is on this day (drawn as a dot, also inside a multi-day bar). */
  single: boolean;
  /** First column of the week (Sunday). */
  rowStart: boolean;
  /** Last column of the week (Saturday). */
  rowEnd: boolean;
  rides: number;
};

/**
 * One mark per non-null cell of `monthCells(month)`, keyed by day. `rides` counts the rides passed in that
 * leave that day: the caller filters out cancelled rides and other communities' rides.
 */
export function dayMarks(month: Date, events: CommunityEvent[], rides: BoardRide[]): Record<string, DayMark> {
  const marks: Record<string, DayMark> = {};
  for (const day of monthCells(month)) {
    if (!day) continue;
    const dow = parseDay(day).getDay();
    marks[day] = { event: null, span: 'none', single: false, rowStart: dow === 0, rowEnd: dow === 6, rides: 0 };
  }
  for (const day of Object.keys(marks)) {
    const on = eventsOn(events, day);
    if (!on.length) continue;
    const mark = marks[day];
    mark.event = on[0];
    mark.single = on.some((e) => eventDays(e).length === 1);
    const spans = on.filter((e) => eventDays(e).length > 1).sort(byStart);
    if (spans.length) {
      const days = eventDays(spans[0]);
      const i = days.indexOf(day);
      mark.span = i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle';
    } else mark.span = 'single';
  }
  for (const r of rides) {
    const mark = marks[isoDay(new Date(r.departAt))];
    if (mark) mark.rides++;
  }
  return marks;
}

export type MountainGroup = { resortId: string; rides: BoardRide[]; seatsOpen: number };

/** Rides with no event on `day`, grouped by mountain, most rides first, then most open seats. */
export function memberRidesByMountain(rides: BoardRide[], day: string): MountainGroup[] {
  const groups = new Map<string, MountainGroup>();
  for (const r of rides) {
    if (r.eventId || isoDay(new Date(r.departAt)) !== day) continue;
    const g = groups.get(r.resortId) ?? { resortId: r.resortId, rides: [], seatsOpen: 0 };
    g.rides.push(r);
    g.seatsOpen += r.seatsTotal - r.seatsTaken;
    groups.set(r.resortId, g);
  }
  return [...groups.values()].sort((a, b) => b.rides.length - a.rides.length || b.seatsOpen - a.seatsOpen);
}

export function ridesForEvent(rides: BoardRide[], eventId: string): BoardRide[] {
  return rides.filter((r) => r.eventId === eventId).sort((a, b) => +new Date(a.departAt) - +new Date(b.departAt));
}
