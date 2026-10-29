'use client';

import { AppProviders, AUTH_ROUTES, Loading, useAuth, withQuery, type Nav, type Route } from '@lift2lift/app';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getApi } from '../lib/api';

/** Sends signed-out people to sign-in, and signed-in people away from it. */
function AuthGate({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const pathname = usePathname() as Route;
  const router = useRouter();
  const onAuthPage = AUTH_ROUTES.includes(pathname);
  const allowed = loading ? false : session ? !onAuthPage : onAuthPage;

  useEffect(() => {
    if (loading) return;
    if (!session && !onAuthPage) router.replace('/sign-in');
    if (session && onAuthPage) router.replace('/');
  }, [loading, session, onAuthPage, router]);

  if (!allowed) return <Loading label="Loading…" />;
  return <>{children}</>;
}

export function Providers({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() as Route;
  // The app runs fully in the browser (the session is in localStorage), so
  // render after mount to avoid server/client mismatches.
  const [mounted, setMounted] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  useEffect(() => {
    try {
      getApi();
    } catch (e) {
      setConfigError((e as Error).message);
    }
    setMounted(true);
  }, []);

  const nav = useMemo<Nav>(
    () => ({
      push: (route, params) => router.push(withQuery(route, params)),
      replace: (route, params) => router.replace(withQuery(route, params)),
      back: () => (window.history.length > 1 ? router.back() : router.replace('/')),
      current: pathname,
    }),
    [router, pathname],
  );

  if (!mounted) return null;
  if (configError) {
    return (
      <View style={{ padding: 24 }}>
        <Loading label={configError} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <AppProviders api={getApi()} nav={nav}>
        <View style={{ flex: 1, minHeight: '100%' as unknown as number }}>
          <AuthGate>{children}</AuthGate>
        </View>
      </AppProviders>
    </SafeAreaProvider>
  );
}
