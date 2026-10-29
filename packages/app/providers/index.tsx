import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Api, Session } from '../lib/types';

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

export type Route = '/' | '/snow' | '/post' | '/sign-in' | '/sign-up' | '/verify' | '/forgot-password';
export type Nav = {
  push: (route: Route, params?: Record<string, string>) => void;
  replace: (route: Route, params?: Record<string, string>) => void;
  back: () => void;
  current: Route;
};

export const AUTH_ROUTES: Route[] = ['/sign-in', '/sign-up', '/verify', '/forgot-password'];

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

/* ---------- All together ---------- */

export function AppProviders({ api, nav, children }: { api: Api; nav: Nav; children: ReactNode }) {
  const navValue = useMemo(() => nav, [nav]);
  return (
    <ApiContext.Provider value={api}>
      <AuthProvider api={api}>
        <NavContext.Provider value={navValue}>{children}</NavContext.Provider>
      </AuthProvider>
    </ApiContext.Provider>
  );
}
