import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { lockedLeg, type LegEvent } from '../lib/trips';
import type { Api, DeviceServices, Session, Trip } from '../lib/types';

/* ---------- Backend ---------- */

const ApiContext = createContext<Api | null>(null);

export function useApi() {
  const api = useContext(ApiContext);
  if (!api) throw new Error('useApi must be used inside <AppProviders>');
  return api;
}

/* ---------- Auth ---------- */

type AuthState = { session: Session | null; loading: boolean };
const AuthContext = createContext<AuthState>({ session: null, loading: true });

function AuthProvider({ api, children }: { api: Api; children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, loading: true });
  useEffect(() => {
    let alive = true;
    api.getSession().then((session) => alive && setState({ session, loading: false }));
    const off = api.onAuthChange((session) => alive && setState({ session, loading: false }));
    return () => {
      alive = false;
      off();
    };
  }, [api]);
  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

/* ---------- Navigation ----------
 * Each app (Next.js, Expo) passes in its own router, so the shared screens
 * never import a platform-specific navigation library.
 */

export type Route =
  | '/'
  | '/snow'
  | '/post'
  | '/account'
  | '/account/driver'
  | '/account/blocked'
  | '/privacy'
  | '/terms'
  | '/profile'
  | '/profile/setup'
  | '/u'
  | '/review'
  | '/rides'
  | '/friends'
  | '/verified'
  | '/sign-in'
  | '/sign-up'
  | '/verify'
  | '/forgot-password';
export type Nav = {
  push: (route: Route, params?: Record<string, string>) => void;
  replace: (route: Route, params?: Record<string, string>) => void;
  back: () => void;
  current: Route;
};

export const AUTH_ROUTES: Route[] = ['/sign-in', '/sign-up', '/verify', '/forgot-password'];
/** Open to everyone, signed in or not (Stripe's "you're done" page for iOS). */
export const PUBLIC_ROUTES: Route[] = ['/verified', '/privacy', '/terms'];

const NavContext = createContext<Nav | null>(null);

export function useNav() {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('useNav must be used inside <AppProviders>');
  return nav;
}

export function withQuery(route: Route, params?: Record<string, string>) {
  if (!params) return route;
  const q = Object.entries(params)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return q ? `${route}?${q}` : route;
}

/* ---------- Device features (photos, Stripe ID check) ---------- */

const DeviceContext = createContext<DeviceServices | null>(null);

export function useDevice() {
  const d = useContext(DeviceContext);
  if (!d) throw new Error('useDevice must be used inside <AppProviders>');
  return d;
}

/* ---------- Your Rides + lock-in ----------
 * Loads my trips, refreshes them every 30 seconds and whenever the app comes
 * back to the foreground, and from 30 minutes before a leg locks the app on
 * the Your Ride screen until 15 minutes after it leaves or check-in is done.
 * Also registers this phone for push reminders once there's a booking.
 */

type RidesState = { trips: Trip[] | null; locked: LegEvent | null; refresh: () => Promise<void> };
const RidesContext = createContext<RidesState>({ trips: null, locked: null, refresh: async () => {} });

export function useMyRides() {
  return useContext(RidesContext);
}

function RidesProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const nav = useNav();
  const device = useDevice();
  const { session } = useAuth();
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const pushDone = useRef(false);

  const refresh = useCallback(async () => {
    if (!session) {
      setTrips(null);
      return;
    }
    try {
      setTrips(await api.myTrips());
    } catch {
      // keep what we had
    }
    setNow(Date.now());
  }, [api, session]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30000);
    const tick = setInterval(() => setNow(Date.now()), 5000);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => {
      clearInterval(id);
      clearInterval(tick);
      sub.remove();
    };
  }, [refresh]);

  // Ask for notifications the first time there's a booked ride.
  useEffect(() => {
    if (!session || pushDone.current || !trips?.length) return;
    pushDone.current = true;
    device
      .registerForPush()
      .then((r) => (r ? api.registerPushToken(r.token, r.platform) : undefined))
      .catch(() => {});
  }, [api, device, session, trips]);

  const locked = session && trips ? lockedLeg(trips, session.userId, now) : null;

  // Lock into the Your Ride screen.
  useEffect(() => {
    if (locked && nav.current !== '/rides') nav.replace('/rides', { ride: locked.trip.id, leg: locked.leg });
  }, [locked?.trip.id, locked?.leg, nav.current]);

  const value = useMemo(() => ({ trips, locked, refresh }), [trips, locked?.trip.id, locked?.leg, refresh]);
  return <RidesContext.Provider value={value}>{children}</RidesContext.Provider>;
}

/* ---------- All together ---------- */

export function AppProviders({ api, nav, device, children }: { api: Api; nav: Nav; device: DeviceServices; children: ReactNode }) {
  const navValue = useMemo(() => nav, [nav]);
  return (
    <ApiContext.Provider value={api}>
      <DeviceContext.Provider value={device}>
        <AuthProvider api={api}>
          <NavContext.Provider value={navValue}>
            <RidesProvider>{children}</RidesProvider>
          </NavContext.Provider>
        </AuthProvider>
      </DeviceContext.Provider>
    </ApiContext.Provider>
  );
}
