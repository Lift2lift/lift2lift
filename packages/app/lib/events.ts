// Calendar math for community events. Pure: no React, no clock reads. Callers pass `now` / `today`.
// A "day" is the device-local day (YYYY-MM-DD from isoDay).
import type { BoardRide, CommunityEvent } from './types.ts';
import { addDays, isoDay, parseDay } from './dates.ts';

const byStart = (a: CommunityEvent, b: CommunityEvent) => +new Date(a.startsAt) - +new Date(b.startsAt);

/** Every local day the event touches, YYYY-MM-DD. An all-day event never spills into the next day. */
export function eventDays(e: CommunityEvent): string[] {
  const start = new Date(e.startsAt);
  const end = new Date(e.endsAt);
  const first = isoDay(start);
  let last = isoDay(end);
  // A timed event that ends exactly at local midnight does not touch the day it ends on.
  const atMidnight = end.getHours() === 0 && end.getMinutes() === 0 && end.getSeconds() === 0 && end.getMilliseconds() === 0;
  if (!e.allDay && atMidnight && end > start) last = isoDay(addDays(end, -1));
  if (last < first) last = first;
  const days: string[] = [];
  for (let d = parseDay(first), day = first; day <= last; d = addDays(d, 1), day = isoDay(d)) days.push(day);
  return days;
}

export function isMultiDay(e: CommunityEvent): boolean {
  return eventDays(e).length > 1;
}

export function eventOn(events: CommunityEvent[], day: string): CommunityEvent | null {
  const hits = events.filter((e) => eventDays(e).includes(day));
  return hits.length ? [...hits].sort(byStart)[0] : null;
}

/** When the event is over: all-day events last until the end of their final day. */
function endInstant(e: CommunityEvent): number {
  if (!e.allDay) return +new Date(e.endsAt);
  return +addDays(new Date(e.endsAt), 1);
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
  const diff = Math.round((+parseDay(eventDays(e)[0]) - +parseDay(today)) / 86400000);
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
  event: CommunityEvent | null;
  span: 'none' | 'single' | 'start' | 'middle' | 'end';
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
    marks[day] = { event: null, span: 'none', rowStart: dow === 0, rowEnd: dow === 6, rides: 0 };
  }
  for (const e of [...events].sort(byStart)) {
    const days = eventDays(e);
    days.forEach((day, i) => {
      const mark = marks[day];
      if (!mark || mark.event) return; // outside this month, or an earlier event already holds the day
      mark.event = e;
      mark.span = days.length === 1 ? 'single' : i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle';
    });
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
