import { useEffect, useState } from 'react';
import { useApi } from '../providers';
import type { Forecast } from './types';

/** Loads the forecast once; failures leave the rest of the app working. */
export function useForecast() {
  const api = useApi();
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .getForecast()
      .then((f) => alive && setForecast(f))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [api]);
  return { forecast, error };
}
