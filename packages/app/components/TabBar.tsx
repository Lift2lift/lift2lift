import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCompact } from '../lib/layout';
import { useTheme } from '../lib/theme';
import { upcomingLegs } from '../lib/trips';
import { useAuth, useMyRides, useNav, type Route } from '../providers';

/** Bottom tab bar for the phone layout: Rides, Snow, Post, Profile. */
export function TabBar() {
  const t = useTheme();
  const nav = useNav();
  const compact = useCompact();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { trips, locked } = useMyRides();
  if (!compact || locked) return null; // ride mode hides the tabs
  const soon = (trips ? upcomingLegs(trips) : []).some((e) => new Date(e.at).getTime() - Date.now() < 24 * 3600 * 1000);

  const initial = ((session?.name || session?.email || '?')[0] || '?').toUpperCase();
  const tabs: { route: Route; label: string; icon: (active: boolean) => ReactNode; match: Route[] }[] = [
    { route: '/', label: 'Rides', match: ['/'], icon: (a) => <Text style={{ fontSize: 20, color: a ? t.ink : t.muted }}>▲</Text> },
    {
      route: '/rides',
      label: 'Your Rides',
      match: ['/rides'],
      icon: (a) => (
        <View>
          <View style={{ width: 24, height: 17, borderRadius: 4, borderWidth: 2, borderColor: a ? t.ink : t.muted, borderStyle: 'solid', justifyContent: 'center' }}>
            <View style={{ position: 'absolute', left: 7, top: 1, bottom: 1, borderLeftWidth: 1.5, borderColor: a ? t.ink : t.muted, borderStyle: 'dashed' }} />
          </View>
          {soon ? <View style={{ position: 'absolute', right: -4, top: -4, width: 10, height: 10, borderRadius: 5, backgroundColor: t.danger, borderWidth: 1.5, borderColor: t.surface }} /> : null}
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
            accessibilityLabel={tab.label}
            style={({ pressed }) => ({ flex: 1, alignItems: 'center', gap: 2, paddingVertical: 2, opacity: pressed ? 0.7 : 1 })}
          >
            <View style={{ height: 28, alignItems: 'center', justifyContent: 'center' }}>{tab.icon(active)}</View>
            <Text style={{ color: active ? t.ink : t.muted, fontSize: 11, fontWeight: active ? '800' : '600' }}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
