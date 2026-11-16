import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCompact } from '../lib/layout';
import { useTheme } from '../lib/theme';
import { requestsWaiting, upcomingLegs } from '../lib/trips';
import { useAuth, useMyRides, useNav, type Route } from '../providers';
import { CarIcon, GroupIcon, MountainIcon } from './TabIcons';

/** Bottom tab bar for the phone layout: Mountains, Rides, Post, Communities, Snow, Profile. */
export function TabBar() {
  const t = useTheme();
  const nav = useNav();
  const compact = useCompact();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { trips, locked } = useMyRides();
  if (!compact || locked) return null; // ride mode hides the tabs
  const soon = (trips ? upcomingLegs(trips) : []).some((e) => new Date(e.at).getTime() - Date.now() < 24 * 3600 * 1000);
  const asks = requestsWaiting(trips).length;

  const initial = ((session?.name || session?.email || '?')[0] || '?').toUpperCase();
  const tabs: { route: Route; label: string; a11y?: string; icon: (active: boolean) => ReactNode; match: Route[] }[] = [
    // Home base: pick a mountain, then see its rides.
    { route: '/', label: 'Mountains', match: ['/'], icon: (a) => <MountainIcon color={a ? t.ink : t.muted} cutout={t.surface} /> },
    {
      // The trips you're driving or riding. A count of ride requests waiting on you,
      // or a red dot when a ride leaves within 24 hours.
      route: '/rides',
      label: 'Rides',
      a11y: asks ? `Rides, ${asks} ride request${asks === 1 ? '' : 's'} waiting` : undefined,
      match: ['/rides'],
      icon: (a) => (
        <View>
          <CarIcon color={a ? t.ink : t.muted} cutout={t.surface} />
          {asks ? (
            <View
              style={{
                position: 'absolute',
                right: -9,
                top: -7,
                minWidth: 17,
                height: 17,
                borderRadius: 9,
                paddingHorizontal: 4,
                backgroundColor: t.danger,
                borderWidth: 1.5,
                borderColor: t.surface,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '900', lineHeight: 12 }}>{asks > 9 ? '9+' : asks}</Text>
            </View>
          ) : soon ? (
            <View style={{ position: 'absolute', right: -5, top: -5, width: 10, height: 10, borderRadius: 5, backgroundColor: t.danger, borderWidth: 1.5, borderColor: t.surface }} />
          ) : null}
        </View>
      ),
    },
    {
      route: '/post',
      label: 'Post',
      match: ['/post'],
      icon: () => (
        <View style={{ width: 34, height: 26, borderRadius: 13, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: t.accentInk, fontSize: 20, fontWeight: '900', lineHeight: 22 }}>+</Text>
        </View>
      ),
    },
    // Clubs' private groups, joined with a code.
    {
      route: '/communities',
      label: 'Communities',
      match: ['/communities', '/community'],
      icon: (a) => <GroupIcon color={a ? t.ink : t.muted} cutout={t.surface} />,
    },
    { route: '/snow', label: 'Snow', match: ['/snow'], icon: (a) => <Text style={{ fontSize: 21, color: a ? t.snow : t.muted }}>❄</Text> },
    {
      route: '/profile',
      label: 'Profile',
      match: ['/profile', '/profile/setup', '/account', '/account/driver'],
      icon: (a) => (
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            borderWidth: 2,
            borderColor: a ? t.ink : t.muted,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: a ? t.ink : t.muted, fontSize: 11, fontWeight: '900' }}>{initial}</Text>
        </View>
      ),
    },
  ];

  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        backgroundColor: t.surface,
        borderTopWidth: 1,
        borderTopColor: t.line,
        paddingTop: 6,
        paddingBottom: Math.max(insets.bottom, 8),
      }}
    >
      {tabs.map((tab) => {
        const active = tab.match.includes(nav.current);
        return (
          <Pressable
            key={tab.route}
            onPress={() => (tab.route === '/post' ? nav.push('/post') : nav.replace(tab.route))}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={tab.a11y ?? tab.label}
            style={({ pressed }) => ({ flex: 1, minWidth: 0, alignItems: 'center', gap: 2, paddingVertical: 2, opacity: pressed ? 0.7 : 1 })}
          >
            <View style={{ height: 28, alignItems: 'center', justifyContent: 'center' }}>{tab.icon(active)}</View>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              style={{ color: active ? t.ink : t.muted, fontSize: 10.5, fontWeight: active ? '800' : '600', letterSpacing: -0.1 }}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
