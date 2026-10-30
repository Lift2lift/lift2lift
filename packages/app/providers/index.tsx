import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Api, DeviceServices, Session } from '../lib/types';

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
  | '/profile'
  | '/profile/setup'
  | '/u'
  | '/review'
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
export const PUBLIC_ROUTES: Route[] = ['/verified'];

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

/* ---------- All together ---------- */

export function AppProviders({ api, nav, device, children }: { api: Api; nav: Nav; device: DeviceServices; children: ReactNode }) {
  const navValue = useMemo(() => nav, [nav]);
  return (
    <ApiContext.Provider value={api}>
      <DeviceContext.Provider value={device}>
        <AuthProvider api={api}>
          <NavContext.Provider value={navValue}>{children}</NavContext.Provider>
        </AuthProvider>
      </DeviceContext.Provider>
    </ApiContext.Provider>
  );
}
