import { useEffect, useState } from 'react';
import { Modal, Pressable, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApi, useAuth, useMyRides, useNav, type Route } from '../providers';
import { useCompact } from '../lib/layout';
import { useTheme } from '../lib/theme';
import { canHost } from '../lib/types';

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
  const [headerHeight, setHeaderHeight] = useState(60);
  const { width } = useWindowDimensions();
  // Driver verification only shows in the menu until you're verified.
  const [needsVerification, setNeedsVerification] = useState(false);
  useEffect(() => {
    if (!menuOpen || !session) return;
    api.getDriverVerification().then((v) => setNeedsVerification(!canHost(v))).catch(() => {});
  }, [menuOpen, api, session]);
  const go = (route: Route, params?: Record<string, string>) => {
    setMenuOpen(false);
    nav.push(route, params);
  };
  const { locked } = useMyRides();
  // Phone layout moves tabs and Post to the bottom tab bar; ride mode hides them.
  const compact = useCompact() || !!locked;
  const first = (session?.name || session?.email || '').split(/[ @]/)[0];

  return (
    <View style={{ backgroundColor: t.header, paddingTop: insets.top }} onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}>
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
          accessibilityLabel="Account menu"
          accessibilityState={{ expanded: menuOpen }}
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

      {/* Floats over the page (no layout shift). Tap outside to close. */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable
          onPress={() => setMenuOpen(false)}
          accessibilityRole="button"
          accessibilityLabel="Close account menu"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(7,13,24,0.25)' }}
        />
        <View
          accessibilityViewIsModal
          style={{
            position: 'absolute',
            top: headerHeight - 4,
            right: Math.max(12, (width - 960) / 2 + 12),
            width: 270,
            maxWidth: width - 24,
            backgroundColor: t.surface,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: t.line,
            paddingVertical: 6,
            shadowColor: '#000',
            shadowOpacity: 0.18,
            shadowRadius: 18,
            shadowOffset: { width: 0, height: 8 },
            elevation: 8,
          }}
        >
          {/* Your profile, with its settings underneath */}
          <Pressable
            onPress={() => go('/profile')}
            accessibilityRole="button"
            accessibilityLabel="View your profile"
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: pressed ? t.chip : 'transparent' })}
          >
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.header, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: t.headerInk, fontWeight: '900', fontSize: 16 }}>{(first[0] || '?').toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: t.ink, fontWeight: '800', fontSize: 15 }}>{session?.name || 'Your profile'}</Text>
              <Text numberOfLines={1} style={{ color: t.muted, fontSize: 12 }}>{session?.email}</Text>
              <Text style={{ color: t.link, fontSize: 13, fontWeight: '700', marginTop: 2 }}>View profile</Text>
            </View>
          </Pressable>
          <View style={{ marginLeft: 66, borderLeftWidth: 2, borderLeftColor: t.line, marginBottom: 4 }}>
            <MenuItem label="Account settings" onPress={() => go('/account')} />
            {needsVerification ? <MenuItem label="Get verified to drive" hint="Needed to post rides" onPress={() => go('/account/driver')} /> : null}
          </View>
          <View style={{ height: 1, backgroundColor: t.line, marginVertical: 4 }} />
          <MenuItem
            label="Sign out"
            danger
            onPress={() => {
              setMenuOpen(false);
              api.signOut();
            }}
          />
        </View>
      </Modal>
    </View>
  );
}

function MenuItem({ label, hint, danger, onPress }: { label: string; hint?: string; danger?: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({ paddingHorizontal: 14, paddingVertical: 9, backgroundColor: pressed ? t.chip : 'transparent' })}
    >
      <Text style={{ color: danger ? t.danger : t.ink, fontWeight: '700', fontSize: 14 }}>{label}</Text>
      {hint ? <Text style={{ color: t.muted, fontSize: 12 }}>{hint}</Text> : null}
    </Pressable>
  );
}
