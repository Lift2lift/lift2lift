import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { clock, dayLabel, driveText, isoDay } from '../lib/dates';
import { useCompact } from '../lib/layout';
import { PASS_FILTERS, PASS_LABEL, passesFor, passMatches, type PassFilter } from '../lib/passes';
import { RESORTS } from '../lib/resorts';
import { useTheme } from '../lib/theme';
import type { BoardRide, Resort } from '../lib/types';

export type MountainStat = { resort: Resort; rides: number; seats: number; next: BoardRide | null };

/** Upcoming rides, open seats and the next departure for every mountain. */
export function mountainStats(rides: BoardRide[]): MountainStat[] {
  const now = Date.now();
  return RESORTS.map((resort) => {
    const rs = rides.filter((r) => r.resortId === resort.id && new Date(r.returnAt ?? r.departAt).getTime() > now);
    const next = rs.filter((r) => new Date(r.departAt).getTime() > now).reduce<BoardRide | null>((a, r) => (!a || r.departAt < a.departAt ? r : a), null);
    return { resort, rides: rs.length, seats: rs.reduce((n, r) => n + Math.max(0, r.seatsTotal - r.seatsTaken), 0), next };
  });
}

const nextText = (r: BoardRide) => `${dayLabel(isoDay(new Date(r.departAt)))}, ${clock(r.departAt)}`;

/** The big, obvious "Choose a mountain" button at the top of the Rides tab. */
export function MountainSelectButton({ rides, mountains, onPress }: { rides: number; mountains: number; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Choose a mountain"
      accessibilityHint="Opens the list of mountains"
      style={({ pressed }) => ({
        backgroundColor: t.accent,
        borderRadius: 16,
        paddingHorizontal: 18,
        paddingVertical: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        opacity: pressed ? 0.9 : 1,
        transform: [{ scale: pressed ? 0.99 : 1 }],
      })}
    >
      <MountainGlyph color={t.accentInk} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.accentInk, fontSize: 21, fontWeight: '900', textTransform: 'uppercase' }}>Choose a mountain</Text>
        <Text style={{ color: t.accentInk, fontSize: 14, fontWeight: '600', opacity: 0.8 }}>
          {rides ? `${rides} ride${rides === 1 ? '' : 's'} going to ${mountains} mountain${mountains === 1 ? '' : 's'}` : 'See every mountain in Colorado'}
        </Text>
      </View>
      <Text style={{ color: t.accentInk, fontSize: 18 }}>▼</Text>
    </Pressable>
  );
}

/** Two peaks, drawn with borders so it works everywhere without an icon font. */
function MountainGlyph({ color }: { color: string }) {
  return (
    <View style={{ width: 34, height: 24 }} accessibilityElementsHidden importantForAccessibility="no">
      <View style={{ position: 'absolute', left: 0, bottom: 0, width: 0, height: 0, borderLeftWidth: 11, borderRightWidth: 11, borderBottomWidth: 17, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: color, opacity: 0.55 }} />
      <View style={{ position: 'absolute', right: 0, bottom: 0, width: 0, height: 0, borderLeftWidth: 13, borderRightWidth: 13, borderBottomWidth: 24, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: color }} />
    </View>
  );
}

/** Quick picks: the mountains with the most upcoming rides, as big tiles. */
export function PopularMountains({ stats, onSelect }: { stats: MountainStat[]; onSelect: (id: string) => void }) {
  const t = useTheme();
  const compact = useCompact(); // two tiles across on a phone, three on a wide screen
  const top = stats.filter((s) => s.rides > 0).sort((a, b) => b.rides - a.rides || a.resort.driveMinutes - b.resort.driveMinutes).slice(0, 6);
  if (!top.length) return null;
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: t.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.8 }}>MOST RIDES RIGHT NOW</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {top.map((s) => (
          <Pressable
            key={s.resort.id}
            onPress={() => onSelect(s.resort.id)}
            accessibilityRole="button"
            accessibilityLabel={`${s.resort.name}, ${s.rides} rides`}
            style={({ pressed }) => ({
              flexGrow: 1,
              flexBasis: compact ? 150 : 260,
              backgroundColor: t.surface,
              borderWidth: 1,
              borderColor: t.line,
              borderRadius: 14,
              padding: 14,
              gap: 4,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text numberOfLines={1} style={{ color: t.ink, fontSize: 16, fontWeight: '900', textTransform: 'uppercase' }}>{s.resort.name}</Text>
            <Text style={{ color: t.ink, fontSize: 14, fontWeight: '700' }}>
              {s.rides} ride{s.rides === 1 ? '' : 's'}
              <Text style={{ color: t.muted, fontWeight: '500' }}>{` · ${s.seats} seat${s.seats === 1 ? '' : 's'}`}</Text>
            </Text>
            {s.next ? <Text numberOfLines={1} style={{ color: t.muted, fontSize: 12 }}>Next: {nextText(s.next)}</Text> : null}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const TABS: { id: PassFilter; label: string }[] = PASS_FILTERS.map((f) => ({ id: f.id, label: f.id === 'any' ? 'All' : f.id === 'none' ? 'Other' : f.label }));

/**
 * Full list of mountains to pick from: search, pass tabs, and how many rides
 * each one has. Mountains with rides come first, busiest first.
 */
export function MountainPicker({
  visible,
  onClose,
  onSelect,
  stats,
  initialPass = 'any',
  current,
  snow,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  stats: MountainStat[];
  initialPass?: PassFilter;
  current?: string | null;
  /** Biggest upcoming snowfall at each mountain, in inches. */
  snow?: Record<string, number>;
}) {
  const t = useTheme();
  const compact = useCompact();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [pass, setPass] = useState<PassFilter>(initialPass);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return stats
      .filter((s) => passMatches(s.resort.id, pass))
      .filter((s) => !q || s.resort.name.toLowerCase().includes(q) || s.resort.region.toLowerCase().includes(q))
      .sort((a, b) => (b.rides > 0 ? 1 : 0) - (a.rides > 0 ? 1 : 0) || b.rides - a.rides || a.resort.driveMinutes - b.resort.driveMinutes);
  }, [stats, pass, query]);
  const withRides = list.filter((s) => s.rides > 0);
  const without = list.filter((s) => s.rides === 0);

  const pick = (id: string) => {
    setQuery('');
    onSelect(id);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType={compact ? 'slide' : 'fade'} onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: compact ? 'flex-end' : 'center', alignItems: 'center', padding: compact ? 0 : 20 }}>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(7,13,24,0.55)' }}
        />
        <View
          accessibilityViewIsModal
          style={{
            width: '100%',
            maxWidth: compact ? undefined : 520,
            height: compact ? Math.round(height * 0.88) : Math.min(720, Math.round(height * 0.85)),
            backgroundColor: t.bg,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            borderBottomLeftRadius: compact ? 0 : 20,
            borderBottomRightRadius: compact ? 0 : 20,
            overflow: 'hidden',
          }}
        >
          <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 10, gap: 12, backgroundColor: t.surface, borderBottomWidth: 1, borderBottomColor: t.line }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: t.ink, fontSize: 22, fontWeight: '900', textTransform: 'uppercase' }} accessibilityRole="header">
                Choose a mountain
              </Text>
              <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} style={{ padding: 4 }}>
                <Text style={{ color: t.muted, fontSize: 26, lineHeight: 26 }}>×</Text>
              </Pressable>
            </View>
            <View style={{ borderWidth: 1.5, borderColor: t.line, borderRadius: 12, paddingHorizontal: 14, backgroundColor: t.bg }}>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search mountains"
                placeholderTextColor={t.muted}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
                accessibilityLabel="Search mountains"
                style={{ color: t.ink, fontSize: 16, paddingVertical: 11 }}
              />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} accessibilityRole="tablist">
              {TABS.map((tab) => {
                const sel = pass === tab.id;
                return (
                  <Pressable
                    key={tab.id}
                    onPress={() => setPass(tab.id)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: sel }}
                    style={{ borderRadius: 999, borderWidth: 1.5, borderColor: sel ? t.ink : t.line, backgroundColor: sel ? t.ink : t.surface, paddingHorizontal: 14, paddingVertical: 7 }}
                  >
                    <Text style={{ color: sel ? t.bg : t.ink, fontSize: 14, fontWeight: '700' }}>{tab.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 24 + insets.bottom, gap: 8 }} keyboardShouldPersistTaps="handled">
            {withRides.map((s) => (
              <PickerRow key={s.resort.id} s={s} snow={snow?.[s.resort.id] ?? 0} current={s.resort.id === current} onPress={() => pick(s.resort.id)} />
            ))}
            {without.length ? (
              <Text style={{ color: t.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.8, marginTop: withRides.length ? 10 : 0, marginLeft: 4 }}>
                NO RIDES YET
              </Text>
            ) : null}
            {without.map((s) => (
              <PickerRow key={s.resort.id} s={s} snow={snow?.[s.resort.id] ?? 0} current={s.resort.id === current} onPress={() => pick(s.resort.id)} />
            ))}
            {!list.length ? <Text style={{ color: t.muted, fontSize: 15, textAlign: 'center', marginTop: 24 }}>No mountains match "{query}".</Text> : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function PickerRow({ s, snow, current, onPress }: { s: MountainStat; snow: number; current: boolean; onPress: () => void }) {
  const t = useTheme();
  const passes = passesFor(s.resort.id);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: current }}
      accessibilityLabel={`${s.resort.name}, ${s.rides ? `${s.rides} rides` : 'no rides yet'}`}
      style={({ pressed }) => ({
        backgroundColor: t.surface,
        borderWidth: current ? 2 : 1,
        borderColor: current ? t.ink : t.line,
        borderRadius: 14,
        paddingHorizontal: 14,
        paddingVertical: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Text style={{ color: t.ink, fontSize: 17, fontWeight: '900', textTransform: 'uppercase' }}>{s.resort.name}</Text>
          {passes.map((p) => (
            <View key={p} style={{ borderWidth: 1, borderColor: t.muted, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1 }}>
              <Text style={{ color: t.muted, fontSize: 10, fontWeight: '800', letterSpacing: 0.6 }}>{PASS_LABEL[p].toUpperCase()}</Text>
            </View>
          ))}
        </View>
        <Text style={{ color: t.muted, fontSize: 13 }}>
          {s.resort.region} · {driveText(s.resort.driveMinutes)}
          {snow >= 0.5 ? <Text style={{ color: t.snow, fontWeight: '700' }}>{`  ❄ ${snow}"`}</Text> : null}
        </Text>
        {s.next ? <Text style={{ color: t.ink, fontSize: 13, fontWeight: '600' }}>Next ride: {nextText(s.next)}</Text> : null}
      </View>
      {s.rides ? (
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <View style={{ backgroundColor: t.accent, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
            <Text style={{ color: t.accentInk, fontSize: 13, fontWeight: '900' }}>
              {s.rides} ride{s.rides === 1 ? '' : 's'}
            </Text>
          </View>
          <Text style={{ color: s.seats ? t.muted : t.danger, fontSize: 12, fontWeight: '700' }}>{s.seats ? `${s.seats} open` : 'All full'}</Text>
        </View>
      ) : (
        <Text style={{ color: t.muted, fontSize: 13, fontWeight: '600' }}>No rides</Text>
      )}
      <Text style={{ color: t.muted, fontSize: 20 }}>›</Text>
    </Pressable>
  );
}
