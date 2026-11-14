import { useEffect, useState } from 'react';
import { useApi, useDevice } from '../providers';
import { RESORTS } from './resorts';

/** Typical drive from Boulder, used until live times arrive or if they can't be had. */
const TYPICAL: Record<string, number> = Object.fromEntries(RESORTS.map((r) => [r.id, r.driveMinutes]));

/** Live times are reused for 10 minutes across screens, so traffic lookups stay cheap. */
const FRESH_MS = 10 * 60 * 1000;
let cache: { at: number; minutes: Record<string, number> } | null = null;

export type DriveTimes = {
  /** Minutes to each mountain by resort id. Live with traffic when `live`, otherwise typical from Boulder. */
  minutes: Record<string, number>;
  live: boolean;
};

/**
 * Drive time to every mountain from where the person is, with current traffic.
 * Asks for location the first time. Falls back to typical drive times from
 * Boulder if location is declined, the lookup fails, or it isn't set up.
 */
export function useDriveTimes(): DriveTimes {
  const api = useApi();
  const device = useDevice();
  const [state, setState] = useState<DriveTimes>(() =>
    cache && Date.now() - cache.at < FRESH_MS ? { minutes: { ...TYPICAL, ...cache.minutes }, live: true } : { minutes: TYPICAL, live: false },
  );

  useEffect(() => {
    if (cache && Date.now() - cache.at < FRESH_MS) return;
    let alive = true;
    (async () => {
      const here = await device.getLocation();
      if (!here) return;
      const minutes = await api.getDriveTimes(here.lat, here.lon);
      cache = { at: Date.now(), minutes };
      if (alive) setState({ minutes: { ...TYPICAL, ...minutes }, live: true });
    })().catch(() => {
      // keep the typical times
    });
    return () => {
      alive = false;
    };
  }, [api, device]);

  return state;
}
