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

export function driveText(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${pad(m)}` : `${h}h`;
}

export function nextSaturday(from = new Date()) {
  return isoDay(addDays(from, (6 - from.getDay() + 7) % 7 || 7));
}
