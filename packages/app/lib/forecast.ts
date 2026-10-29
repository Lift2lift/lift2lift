import { RESORTS } from './resorts';
import type { DayForecast, Forecast } from './types';

const DAYS = 7;
const CACHE_MS = 30 * 60 * 1000;
let cache: { at: number; value: Forecast } | null = null;

type OpenMeteoDaily = {
  time: string[];
  temperature_2m_max: (number | null)[];
  temperature_2m_min: (number | null)[];
  snowfall_sum: (number | null)[];
  precipitation_probability_max: (number | null)[];
};

/**
 * 7-day forecast for every Colorado ski area from Open-Meteo (free, no API key).
 * One request covers all 26 base areas. Cached in memory for 30 minutes.
 */
export async function fetchForecast(): Promise<Forecast> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;

  const params = new URLSearchParams({
    latitude: RESORTS.map((r) => r.lat).join(','),
    longitude: RESORTS.map((r) => r.lon).join(','),
    daily: 'temperature_2m_max,temperature_2m_min,snowfall_sum,precipitation_probability_max',
    temperature_unit: 'fahrenheit',
    precipitation_unit: 'inch',
    timezone: 'America/Denver',
    forecast_days: String(DAYS),
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) throw new Error(`Forecast unavailable (${res.status}). Try again in a bit.`);
  const json = (await res.json()) as { daily: OpenMeteoDaily }[] | { daily: OpenMeteoDaily };
  const list = Array.isArray(json) ? json : [json];

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

  const value: Forecast = { updatedAt: new Date().toISOString(), days: list[0]?.daily.time ?? [], byResort };
  cache = { at: Date.now(), value };
  return value;
}

export function forecastFor(forecast: Forecast | null, resortId: string, day: string) {
  return forecast?.byResort[resortId]?.find((d) => d.date === day) ?? null;
}
