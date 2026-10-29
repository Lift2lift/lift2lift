import { AppProviders, Loading, useAuth, useTheme, withQuery, type Nav, type Route } from '@lift2lift/app';
import { router, Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api, isConfigured } from '../lib/api';

function RootStack() {
  const { session, loading } = useAuth();
  const t = useTheme();
  if (loading) return <Loading label="Loading…" />;
  const signedIn = !!session;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg }, animation: 'fade' }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="index" />
        <Stack.Screen name="snow" />
        <Stack.Screen name="post" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="sign-up" />
        <Stack.Screen name="verify" />
        <Stack.Screen name="forgot-password" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const pathname = usePathname() as Route;
  const nav = useMemo<Nav>(
    () => ({
      push: (route, params) => router.push(withQuery(route, params) as never),
      replace: (route, params) => router.replace(withQuery(route, params) as never),
      back: () => (router.canGoBack() ? router.back() : router.replace('/')),
      current: pathname,
    }),
    [pathname],
  );

  if (!isConfigured) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ textAlign: 'center', fontSize: 16 }}>
          Supabase isn't connected. Copy apps/mobile/.env.example to apps/mobile/.env, add the anon key, then run
          "npx expo start -c".
        </Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <AppProviders api={api} nav={nav}>
        <StatusBar style="light" />
        <RootStack />
      </AppProviders>
    </SafeAreaProvider>
  );
}
