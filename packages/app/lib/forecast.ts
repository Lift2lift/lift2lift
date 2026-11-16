import { RESORTS } from './resorts';
import type { DayForecast, Forecast } from './types';

const DAYS = 7;
const CACHE_MS = 30 * 60 * 1000;
/** Give up on a forecast request after this long, so the Snow tab never spins forever. */
export const FORECAST_TIMEOUT_MS = 12_000;
let cache: { at: number; value: Forecast } | null = null;
let inflight: Promise<Forecast> | null = null;

type OpenMeteoDaily = {
  time: string[];
  temperature_2m_max: (number | null)[];
  temperature_2m_min: (number | null)[];
  snowfall_sum: (number | null)[];
  precipitation_probability_max: (number | null)[];
};

/**
 * 7-day forecast for every Colorado ski area from Open-Meteo (free, no API key).
 * One request covers all 26 base areas. Cached in memory for 30 minutes, and
 * screens that ask at the same time share one request. If a refresh fails, the
 * last forecast is kept rather than showing an error.
 */
export function fetchForecast(timeoutMs = FORECAST_TIMEOUT_MS): Promise<Forecast> {
  if (cache && Date.now() - cache.at < CACHE_MS) return Promise.resolve(cache.value);
  if (!inflight) {
    inflight = load(timeoutMs)
      .then((value) => {
        cache = { at: Date.now(), value };
        return value;
      })
      .catch((e: Error) => {
        if (cache) return cache.value; // stale but better than nothing
        throw e;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

async function load(timeoutMs: number): Promise<Forecast> {
  const params = new URLSearchParams({
    latitude: RESORTS.map((r) => r.lat).join(','),
    longitude: RESORTS.map((r) => r.lon).join(','),
    daily: 'temperature_2m_max,temperature_2m_min,snowfall_sum,precipitation_probability_max',
    temperature_unit: 'fahrenheit',
    precipitation_unit: 'inch',
    timezone: 'America/Denver',
    forecast_days: String(DAYS),
  });

  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Race the request against a timer (not every platform can abort a fetch).
  const giveUp = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      ctrl?.abort();
      reject(new Error("The forecast service didn't answer. Check your connection and try again."));
    }, timeoutMs);
  });
  giveUp.catch(() => {}); // settled by the race below

  let json: unknown;
  try {
    const res = await Promise.race([fetch(`https://api.open-meteo.com/v1/forecast?${params}`, ctrl ? { signal: ctrl.signal } : undefined), giveUp]);
    if (res.status === 429) throw new Error('The forecast service is busy right now. Try again in a few minutes.');
    if (!res.ok) {
      const reason = await res
        .json()
        .then((b: { reason?: string }) => b?.reason)
        .catch(() => null);
      throw new Error(`Forecast unavailable (${res.status}${reason ? `: ${reason}` : ''}). Try again in a bit.`);
    }
    json = await Promise.race([res.json(), giveUp]);
  } catch (e) {
    if (timedOut) throw new Error("The forecast service didn't answer. Check your connection and try again.");
    if (e instanceof TypeError) {
      // fetch() itself failed: offline, DNS, or a content blocker stopped the request.
      throw new Error("Couldn't reach the forecast service (open-meteo.com). Check your connection, or allow it in any content blocker, and try again.");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }

  const list = (Array.isArray(json) ? json : [json]) as { daily?: OpenMeteoDaily }[];
  if (!list[0]?.daily?.time?.length) throw new Error('The forecast came back empty. Try again in a bit.');

  const byResort: Record<string, DayForecast[]> = {};
  RESORTS.forEach((r, i) => {
    const d = list[i]?.daily;
    if (!d) return;
    byResort[r.id] = d.time.map((date, j) => ({
      date,
      hi: Math.round(d.temperature_2m_max[j] ?? 0),
      lo: Math.round(d.temperature_2m_min[j] ?? 0),
      snowIn: Math.round((d.snowfall_sum[j] ?? 0) * 10) / 10,
      precipPct: Math.round(d.precipitation_probability_max[j] ?? 0),
    }));
  });

  return { updatedAt: new Date().toISOString(), days: list[0].daily.time, byResort };
}

export function forecastFor(forecast: Forecast | null, resortId: string, day: string) {
  return forecast?.byResort[resortId]?.find((d) => d.date === day) ?? null;
}
