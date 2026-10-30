import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApi, useAuth, useMyRides, useNav, type Route } from '../providers';
import { useCompact } from '../lib/layout';
import { useTheme } from '../lib/theme';

const TABS: { route: Route; label: string }[] = [
  { route: '/', label: 'Rides' },
  { route: '/rides', label: 'Your Rides' },
  { route: '/snow', label: 'Snow' },
];

export function AppHeader() {
  const t = useTheme();
  const nav = useNav();
  const api = useApi();
  const { session } = useAuth();
  const insets = useSafeAreaInsets();
  const [menuOpen, setMenuOpen] = useState(false);
  const { locked } = useMyRides();
  // Phone layout moves tabs and Post to the bottom tab bar; ride mode hides them.
  const compact = useCompact() || !!locked;
  const first = (session?.name || session?.email || '').split(/[ @]/)[0];

  return (
    <View style={{ backgroundColor: t.header, paddingTop: insets.top }}>
      <View
        style={{
          width: '100%',
          maxWidth: 960,
          alignSelf: 'center',
          paddingHorizontal: 16,
          paddingVertical: 10,
          flexDirection: 'row',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <Pressable onPress={() => nav.replace('/')} accessibilityRole="link" accessibilityLabel="Lift2Lift home">
          <Text style={{ color: t.headerInk, fontSize: compact ? 24 : 28, fontWeight: '900', fontStyle: 'italic', letterSpacing: 1 }}>
            LIFT<Text style={{ color: t.accent }}>2</Text>LIFT
          </Text>
        </Pressable>

        {compact ? null : (
        <View style={{ flexDirection: 'row', gap: 4, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12, padding: 4 }}>
          {TABS.map((tab) => {
            const active = nav.current === tab.route;
            return (
              <Pressable
                key={tab.route}
                onPress={() => nav.replace(tab.route)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 9, backgroundColor: active ? t.bg : 'transparent' }}
              >
                <Text style={{ color: active ? t.ink : t.headerInk, fontWeight: '700', fontSize: 14 }}>{tab.label}</Text>
              </Pressable>
            );
          })}
        </View>
        )}

        <View style={{ flex: 1 }} />

        {compact ? null : (
        <Pressable
          onPress={() => nav.push('/post')}
          accessibilityRole="button"
          style={({ pressed }) => ({
            backgroundColor: t.accent,
            borderRadius: 10,
            paddingHorizontal: 14,
            paddingVertical: 8,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text style={{ color: t.accentInk, fontWeight: '800', fontSize: 14 }}>+ Post a ride</Text>
        </Pressable>
        )}

        <Pressable
          onPress={() => setMenuOpen((o) => !o)}
          accessibilityRole="button"
          accessibilityLabel="Account"
          style={{
            width: 34,
            height: 34,
            borderRadius: 17,
            backgroundColor: 'rgba(255,255,255,0.14)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: t.headerInk, fontWeight: '800' }}>{(first[0] || '?').toUpperCase()}</Text>
        </Pressable>
      </View>

      {menuOpen ? (
        <View style={{ width: '100%', maxWidth: 960, alignSelf: 'center', paddingHorizontal: 16, paddingBottom: 12 }}>
          <View
            style={{
              alignSelf: 'flex-end',
              backgroundColor: t.surface,
              borderRadius: 12,
              padding: 14,
              gap: 10,
              minWidth: 220,
              borderWidth: 1,
              borderColor: t.line,
            }}
          >
            <Text style={{ color: t.ink, fontWeight: '700' }}>{session?.name || 'Signed in'}</Text>
            <Text style={{ color: t.muted, fontSize: 13 }}>{session?.email}</Text>
            <Pressable
              onPress={() => {
                setMenuOpen(false);
                nav.push('/profile');
              }}
              accessibilityRole="button"
            >
              <Text style={{ color: t.ink, fontWeight: '700' }}>My profile</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setMenuOpen(false);
                nav.push('/account');
              }}
              accessibilityRole="button"
            >
              <Text style={{ color: t.ink, fontWeight: '700' }}>Account settings</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setMenuOpen(false);
                nav.push('/account/driver');
              }}
              accessibilityRole="button"
            >
              <Text style={{ color: t.ink, fontWeight: '700' }}>Driver verification</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setMenuOpen(false);
                api.signOut();
              }}
              accessibilityRole="button"
            >
              <Text style={{ color: t.danger, fontWeight: '700' }}>Sign out</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}
