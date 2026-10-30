import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCompact } from '../lib/layout';
import { useTheme } from '../lib/theme';
import { useAuth, useNav, type Route } from '../providers';

/** Bottom tab bar for the phone layout: Rides, Snow, Post, Profile. */
export function TabBar() {
  const t = useTheme();
  const nav = useNav();
  const compact = useCompact();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  if (!compact) return null;

  const initial = ((session?.name || session?.email || '?')[0] || '?').toUpperCase();
  const tabs: { route: Route; label: string; icon: (active: boolean) => ReactNode; match: Route[] }[] = [
    { route: '/', label: 'Rides', match: ['/'], icon: (a) => <Text style={{ fontSize: 20, color: a ? t.ink : t.muted }}>▲</Text> },
    { route: '/snow', label: 'Snow', match: ['/snow'], icon: (a) => <Text style={{ fontSize: 21, color: a ? t.snow : t.muted }}>❄</Text> },
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
