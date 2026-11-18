// Pure core of sync-community-calendars: link check and ICS text to events. No network, no Deno APIs.
// Keep calendarUrlProblem at least as strict as calendar_url_ok in the community_calendars migration.
import ICAL from 'ical.js';

export const ALLOWED_HOSTS = ['calendar.google.com', 'outlook.office365.com', 'outlook.office.com', 'outlook.live.com'];
export type SyncEvent = {
  uid: string;
  title: string;
  description: string;
  location: string;
  resort_id: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
};
export type Resort = { id: string; name: string };

const URL_PROBLEM = 'Use a Google, Outlook or iCloud calendar link.';
const DENVER = 'America/Denver';
const HOUR = 3_600_000;
const DAY = 86_400_000;
const MAX_EVENTS = 500;
const MAX_STEPS = 5000; // per series
const MAX_CANDIDATES = 20_000; // across the whole feed

// ---------------------------------------------------------------- links

/** Trims plain spaces (like the SQL btrim) and turns webcal(s):// into https://. */
export function normalizeCalendarUrl(url: string): string {
  return url.replace(/^ +| +$/g, '').replace(/^webcals?:\/\//i, 'https://');
}

export function calendarUrlProblem(url: string): string | null {
  const u = normalizeCalendarUrl(url);
  if (/[^\x21-\x7e]/.test(u) || u.includes('\\')) return URL_PROBLEM;
  const m = /^https:\/\/([^/?#@:]+)\//i.exec(u);
  if (!m || !/^[A-Za-z0-9.-]+$/.test(m[1])) return URL_PROBLEM;
  const host = m[1].toLowerCase();
  const ok = ALLOWED_HOSTS.includes(host) || /^[a-z0-9-]+(\.[a-z0-9-]+)*\.icloud\.com$/.test(host);
  if (!ok) return URL_PROBLEM;
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || parsed.hostname !== host) return URL_PROBLEM;
  } catch {
    return URL_PROBLEM;
  }
  return null;
}

// ---------------------------------------------------------------- Denver and zone math

type Wall = { y: number; mo: number; d: number; h: number; mi: number; s: number };
type Zone = { kind: 'utc' } | { kind: 'iana'; name: string } | { kind: 'feed'; tz: any };

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string) {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    formatters.set(zone, f);
  }
  return f;
}

function isIana(name: string) {
  try {
    formatter(name);
    return true;
  } catch {
    return false;
  }
}

/** Offset (zone minus UTC, in ms) at a UTC instant. */
function ianaOffset(zone: string, utcMs: number) {
  const p: Record<string, number> = {};
  for (const part of formatter(zone).formatToParts(new Date(utcMs))) if (part.type !== 'literal') p[part.type] = Number(part.value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(utcMs / 1000) * 1000;
}

function wallToUtc(w: Wall, zone: Zone): number {
  const wallMs = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
  if (zone.kind === 'utc') return wallMs;
  if (zone.kind === 'feed') {
    const t = ICAL.Time.fromData({ year: w.y, month: w.mo, day: w.d, hour: w.h, minute: w.mi, second: w.s });
    return wallMs - zone.tz.utcOffset(t) * 1000;
  }
  const first = wallMs - ianaOffset(zone.name, wallMs);
  const second = wallMs - ianaOffset(zone.name, first);
  return second === first ? first : wallMs - ianaOffset(zone.name, second);
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** The America/Denver calendar date (YYYY-MM-DD) of an instant. */
export function denverDate(ms: number): string {
  const p: Record<string, number> = {};
  for (const part of formatter(DENVER).formatToParts(new Date(ms))) if (part.type !== 'literal') p[part.type] = Number(part.value);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** The instant of midnight at the start of a Denver date. */
export function denverMidnight(date: string): number {
  const [y, mo, d] = date.split('-').map(Number);
  return wallToUtc({ y, mo, d, h: 0, mi: 0, s: 0 }, { kind: 'iana', name: DENVER });
}

function addDays(date: string, n: number): string {
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d + n)).toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string) {
  const f = (s: string) => Date.parse(`${s}T00:00:00Z`);
  return Math.round((f(b) - f(a)) / DAY);
}

// ---------------------------------------------------------------- text

function cut(value: unknown, max: number): string {
  const s = typeof value === 'string' ? value.trim() : '';
  const chars = Array.from(s);
  return chars.length > max ? chars.slice(0, max).join('') : s;
}

// ---------------------------------------------------------------- resorts

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function guessResort(text: string, resorts: Resort[]): string | null {
  let best: { id: string; len: number } | null = null;
  for (const r of resorts) {
    const names = [r.name.trim()];
    const short = r.name.trim().replace(/\s+(Mountain|Resort)$/i, '');
    if (short !== names[0] && (short.match(/\p{L}/gu) ?? []).length >= 5) names.push(short);
    for (const name of names) {
      if (!name) continue;
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name)}(?![\\p{L}\\p{N}])`, 'iu');
      if (re.test(text) && (!best || name.length > best.len)) best = { id: r.id, len: name.length };
    }
  }
  return best ? best.id : null;
}

// ---------------------------------------------------------------- ICS

type Info = { wall: Wall; isDate: boolean; zone: Zone; date: string };
type Candidate = { baseUid: string; keyDate: string; startMs: number; endMs: number; allDay: boolean; title: string; description: string; location: string };

function readTime(prop: any, time: any, feedZone: (tzid: string) => Zone | null): Info {
  const wall: Wall = { y: time.year, mo: time.month, d: time.day, h: time.isDate ? 0 : time.hour, mi: time.isDate ? 0 : time.minute, s: time.isDate ? 0 : time.second };
  const tzid = prop.getParameter('tzid');
  let zone: Zone;
  if (time.isDate) zone = { kind: 'iana', name: DENVER };
  else if (typeof tzid === 'string' && tzid) zone = feedZone(tzid) ?? (isIana(tzid) ? { kind: 'iana', name: tzid } : { kind: 'iana', name: DENVER });
  else zone = time.zone && time.zone.tzid === 'UTC' ? { kind: 'utc' } : { kind: 'iana', name: DENVER };
  return { wall, isDate: !!time.isDate, zone, date: `${pad(wall.y, 4)}-${pad(wall.mo)}-${pad(wall.d)}` };
}

const instant = (i: Info) => (i.isDate ? denverMidnight(i.date) : wallToUtc(i.wall, i.zone));
/** Identity of an occurrence for EXDATE and RECURRENCE-ID matching. */
const occurrenceId = (i: Info) => (i.isDate ? `D:${i.date}` : `T:${instant(i)}`);

export function eventsFromIcs(ics: string, now: Date, resorts: Resort[]): SyncEvent[] {
  let root: any;
  try {
    const jcal = ICAL.parse(ics);
    if (!Array.isArray(jcal) || jcal[0] !== 'vcalendar') throw new Error('not a calendar');
    root = new ICAL.Component(jcal);
  } catch {
    throw new Error('not a calendar');
  }

  const windowStart = now.getTime() - DAY;
  const windowEnd = now.getTime() + 180 * DAY;

  ICAL.TimezoneService.reset();
  try {
    for (const vtz of root.getAllSubcomponents('vtimezone')) {
      try {
        ICAL.TimezoneService.register(new ICAL.Timezone(vtz));
      } catch {
        // an unreadable zone falls back to IANA or Denver
      }
    }
    const feedZone = (tzid: string): Zone | null => (ICAL.TimezoneService.has(tzid) ? { kind: 'feed', tz: ICAL.TimezoneService.get(tzid) } : null);

    const masters: any[] = [];
    const overrides = new Map<string, Map<string, any>>(); // uid -> occurrence id -> VEVENT
    for (const ve of root.getAllSubcomponents('vevent')) {
      const uid = ve.getFirstPropertyValue('uid');
      if (typeof uid !== 'string' || !uid.trim()) continue;
      const rid = ve.getFirstProperty('recurrence-id');
      if (!rid) {
        masters.push(ve);
        continue;
      }
      try {
        const id = occurrenceId(readTime(rid, rid.getFirstValue(), feedZone));
        if (!overrides.has(uid)) overrides.set(uid, new Map());
        overrides.get(uid)!.set(id, ve);
      } catch {
        // bad recurrence id: ignore this override
      }
    }

    const candidates: Candidate[] = [];
    const text = (ve: any) => ({
      title: cut(ve.getFirstPropertyValue('summary'), 80),
      description: cut(ve.getFirstPropertyValue('description'), 1000),
      location: cut(ve.getFirstPropertyValue('location'), 120),
    });
    const cancelled = (ve: any) => String(ve.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED';

    /** Start, and how long it lasts: ms for timed events, last-day offset for all-day ones. */
    const shape = (ve: any) => {
      const sp = ve.getFirstProperty('dtstart');
      const start = readTime(sp, sp.getFirstValue(), feedZone);
      const ep = ve.getFirstProperty('dtend');
      const dur = ve.getFirstPropertyValue('duration');
      const end = ep ? readTime(ep, ep.getFirstValue(), feedZone) : null;
      if (start.isDate) {
        let span = 0;
        if (end && end.isDate) span = Math.max(0, daysBetween(start.date, end.date) - 1);
        else if (!end && dur && typeof dur.toSeconds === 'function') span = Math.max(0, Math.ceil(dur.toSeconds() / 86400) - 1);
        return { start, span, durationMs: 0 };
      }
      const startMs = instant(start);
      let durationMs = HOUR;
      if (end) durationMs = Math.max(0, instant(end) - startMs);
      else if (dur && typeof dur.toSeconds === 'function') durationMs = Math.max(0, dur.toSeconds() * 1000);
      return { start, span: 0, durationMs };
    };

    const build = (ve: any, baseUid: string, keyDate: string, start: Info, span: number, durationMs: number): Candidate => {
      const startMs = instant(start);
      const endMs = start.isDate ? denverMidnight(addDays(start.date, span)) : startMs + durationMs;
      return { baseUid, keyDate, startMs, endMs, allDay: start.isDate, ...text(ve) };
    };

    for (const ve of masters) {
      if (candidates.length >= MAX_CANDIDATES) break;
      try {
        const uid = ve.getFirstPropertyValue('uid') as string;
        const mine = overrides.get(uid);
        if (cancelled(ve) && !ve.getFirstProperty('rrule')) continue;
        const { start, span, durationMs } = shape(ve);
        const keyOf = (i: Info) => (i.isDate ? i.date : denverDate(instant(i)));

        const rrule = ve.getFirstPropertyValue('rrule');
        if (!rrule) {
          if (cancelled(ve)) continue;
          candidates.push(build(ve, uid, keyOf(start), start, span, durationMs));
          continue;
        }
        if (cancelled(ve)) continue;

        const excluded = new Set<string>();
        for (const p of ve.getAllProperties('exdate')) {
          for (const t of p.getValues()) excluded.add(occurrenceId(readTime(p, t, feedZone)));
        }
        const floating = ICAL.Time.fromData({ year: start.wall.y, month: start.wall.mo, day: start.wall.d, hour: start.wall.h, minute: start.wall.mi, second: start.wall.s, isDate: start.isDate });
        const it = rrule.iterator(floating);
        for (let step = 0; step < MAX_STEPS && candidates.length < MAX_CANDIDATES; step++) {
          const next = it.next();
          if (!next) break;
          const occ: Info = {
            wall: { y: next.year, mo: next.month, d: next.day, h: start.isDate ? 0 : next.hour, mi: start.isDate ? 0 : next.minute, s: start.isDate ? 0 : next.second },
            isDate: start.isDate,
            zone: start.zone,
            date: `${pad(next.year, 4)}-${pad(next.month)}-${pad(next.day)}`,
          };
          if (instant(occ) > windowEnd) break;
          const id = occurrenceId(occ);
          if (excluded.has(id) || mine?.has(id)) continue;
          candidates.push(build(ve, uid, keyOf(occ), occ, span, durationMs));
        }
      } catch {
        // one bad event never stops the rest
      }
    }

    for (const [uid, byId] of overrides) {
      for (const ve of byId.values()) {
        try {
          if (cancelled(ve)) continue;
          const rid = ve.getFirstProperty('recurrence-id');
          const original = readTime(rid, rid.getFirstValue(), feedZone);
          const keyDate = original.isDate ? original.date : denverDate(instant(original));
          const { start, span, durationMs } = shape(ve);
          candidates.push(build(ve, uid, keyDate, start, span, durationMs));
        } catch {
          // skip
        }
      }
    }

    const inWindow = candidates
      .filter((c) => c.endMs > windowStart && c.startMs < windowEnd)
      .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || (a.baseUid < b.baseUid ? -1 : a.baseUid > b.baseUid ? 1 : 0));

    const seen = new Map<string, number>();
    const out: SyncEvent[] = [];
    for (const c of inWindow) {
      const base = `${c.baseUid}|${c.keyDate}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      out.push({
        uid: n === 1 ? base : `${base}|${n}`,
        title: Array.from(c.title).length < 2 ? 'Club event' : c.title,
        description: c.description,
        location: c.location,
        resort_id: guessResort(`${c.location} ${c.title}`, resorts),
        starts_at: new Date(c.startMs).toISOString(),
        ends_at: new Date(c.endMs).toISOString(),
        all_day: c.allDay,
      });
      if (out.length >= MAX_EVENTS) break;
    }
    return out;
  } finally {
    ICAL.TimezoneService.reset();
  }
}
