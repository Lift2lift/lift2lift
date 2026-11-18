export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD in the device's time zone. */
export function isoDay(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDay(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export function nextDays(count: number, from = new Date()) {
  return Array.from({ length: count }, (_, i) => isoDay(addDays(from, i)));
}

export function dayLabel(day: string, today = isoDay(new Date())) {
  if (day === today) return 'Today';
  if (day === isoDay(addDays(parseDay(today), 1))) return 'Tomorrow';
  const d = parseDay(day);
  return `${DOW[d.getDay()]} ${MON[d.getMonth()]} ${d.getDate()}`;
}

export function longDay(day: string) {
  const d = parseDay(day);
  return `${DOW[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}`;
}

export function clock(iso: string) {
  const d = new Date(iso);
  const h = d.getHours();
  return `${((h + 11) % 12) + 1}:${pad(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
}

export function clockFromHHMM(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Combine a local YYYY-MM-DD and HH:MM into an ISO timestamp. */
export function toISO(day: string, hhmm: string) {
  const [y, mo, d] = day.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  return new Date(y, mo - 1, d, h, mi).toISOString();
}

// All-day club events are Denver calendar dates everywhere, whatever the device's zone.
const denverParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** Denver wall-clock parts of an instant. */
function inDenver(ms: number) {
  const p: Record<string, number> = {};
  for (const part of denverParts.formatToParts(new Date(ms))) if (part.type !== 'literal') p[part.type] = Number(part.value);
  if (p.hour === 24) p.hour = 0; // some engines print midnight as 24
  return p as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** YYYY-MM-DD of the Denver calendar date at this instant; '' for an invalid date. */
export function denverDay(iso: string | Date) {
  const ms = +new Date(iso);
  if (Number.isNaN(ms)) return '';
  const p = inDenver(ms);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** ISO timestamp of Denver midnight starting the day YYYY-MM-DD (DST-correct). */
export function denverMidnight(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d);
  // Denver is UTC-7 or UTC-6; guess, then correct by the offset at the guess.
  let t = wall + 7 * 3600000;
  for (let i = 0; i < 2; i++) {
    const p = inDenver(t);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    t += wall - shown;
  }
  return new Date(t).toISOString();
}

/** The Denver day after YYYY-MM-DD. */
export function nextDayString(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  const n = new Date(Date.UTC(y, m - 1, d + 1));
  return `${n.getUTCFullYear()}-${pad(n.getUTCMonth() + 1)}-${pad(n.getUTCDate())}`;
}

export function driveText(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${pad(m)}` : `${h}h`;
}

export function nextSaturday(from = new Date()) {
  return isoDay(addDays(from, (6 - from.getDay() + 7) % 7 || 7));
}

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago". */
export function timeAgo(iso: string, now = Date.now()) {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}
