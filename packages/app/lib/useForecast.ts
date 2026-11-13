import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../providers';
import type { Forecast } from './types';

/** Loads the forecast once; failures leave the rest of the app working. `retry` asks again. */
export function useForecast() {
  const api = useApi();
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setError(null);
    api
      .getForecast()
      .then((f) => alive && setForecast(f))
      .catch((e: Error) => alive && setError(e.message || "Couldn't load the forecast."));
    return () => {
      alive = false;
    };
  }, [api, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { forecast, error, retry };
}
