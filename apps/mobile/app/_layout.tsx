import { AppProviders, CarpoolNoticeGate, Loading, useAuth, useTheme, withQuery, type Nav, type Route } from '@lift2lift/app';
import * as Notifications from 'expo-notifications';
import { router, Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api, isConfigured } from '../lib/api';
import { nativeDevice } from '../lib/device';

function RootStack() {
  const { session, loading } = useAuth();
  const t = useTheme();
  if (loading) return <Loading label="Loading…" />;
  const signedIn = !!session;
  return (
    // Quick cross-fade between sections (iOS default is 350ms, which felt sluggish).
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg }, animation: 'fade', animationDuration: 150 }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="index" />
        <Stack.Screen name="snow" />
        <Stack.Screen name="post" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="account/index" />
        <Stack.Screen name="account/driver" />
        <Stack.Screen name="account/blocked" />
        <Stack.Screen name="profile/index" />
        <Stack.Screen name="profile/setup" />
        <Stack.Screen name="u" />
        <Stack.Screen name="review" />
        <Stack.Screen name="friends" />
        <Stack.Screen name="rides" options={{ gestureEnabled: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="sign-up" />
        <Stack.Screen name="verify" />
        <Stack.Screen name="forgot-password" />
      </Stack.Protected>
      {/* Open signed in or out (linked from sign-up and Account). */}
      <Stack.Screen name="privacy" />
      <Stack.Screen name="terms" />
    </Stack>
  );
}

/** Tapping a ride reminder opens that ride in Your Rides (the push carries data.url = lift2lift:///rides?ride=…&leg=…). */
function useReminderTaps() {
  useEffect(() => {
    const open = (n: Notifications.Notification | undefined) => {
      const url = n?.request.content.data?.url;
      if (typeof url === 'string') router.push(url.replace(/^lift2lift:\/\//, '') as never);
    };
    // Cold start from a tapped notification.
    const last = Notifications.getLastNotificationResponse();
    if (last) open(last.notification);
    const sub = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification));
    return () => sub.remove();
  }, []);
}

export default function RootLayout() {
  useReminderTaps();
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
      <AppProviders api={api} nav={nav} device={nativeDevice}>
        <StatusBar style="light" />
        <RootStack />
        <CarpoolNoticeGate />
      </AppProviders>
    </SafeAreaProvider>
  );
}
