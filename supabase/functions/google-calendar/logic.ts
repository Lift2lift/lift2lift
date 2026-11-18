// Pure parts of the google-calendar function: where the browser may be sent back to after Google.

/** The iOS app's return address (expo-web-browser's auth session closes on it). */
export const APP_RETURN = 'lift2lift://google-calendar';

/**
 * True for a return address the callback may redirect to: a page on one of our web origins, the iOS app's
 * address, or an Expo Go address ending in /--/google-calendar while developing. Anything else would make
 * the callback an open redirect.
 */
export function returnToOk(returnTo: unknown, allowedOrigins: string[]): returnTo is string {
  if (typeof returnTo !== 'string' || returnTo.length > 2000 || /[^\x21-\x7e]/.test(returnTo)) return false;
  if (returnTo === APP_RETURN) return true;
  let u: URL;
  try {
    u = new URL(returnTo);
  } catch {
    return false;
  }
  if (u.username || u.password) return false;
  if (u.protocol === 'exp:' || u.protocol === 'exps:') return /\/--\/google-calendar$/.test(u.pathname) && !u.search && !u.hash;
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  return allowedOrigins.includes(u.origin);
}

/** The return address with `google_calendar=<result>` set (replacing any earlier result), hash dropped. */
export function withResult(returnTo: string, result: 'connected' | 'denied' | 'error'): string {
  if (returnTo === APP_RETURN) return `${APP_RETURN}?google_calendar=${result}`;
  const u = new URL(returnTo);
  u.hash = '';
  u.searchParams.set('google_calendar', result);
  return u.toString();
}
