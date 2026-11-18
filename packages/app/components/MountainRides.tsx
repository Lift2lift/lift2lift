import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTheme } from '../lib/theme';
import type { MountainGroup } from '../lib/events';
import { PASS_LABEL, passesFor } from '../lib/passes';
import { RESORT_BY_ID } from '../lib/resorts';
import type { BoardRide } from '../lib/types';

/** Member rides that are not tied to an event, one tile per mountain. Rides stay hidden until a tile is tapped; a second tap hides them. */
export function MountainRides({
  title,
  note,
  groups,
  renderRide,
}: {
  title: string; // "Member rides" or "Other member rides"
  note: string; // "by mountain · Sat, Nov 21"
  groups: MountainGroup[];
  renderRide: (ride: BoardRide) => ReactNode;
}) {
  const t = useTheme();
  const [picked, setPicked] = useState<string | null>(null);
  const list = groups.map((g) => g.resortId).join(',');
  // Close the open tile when the set of mountains changes (another day, another month).
  const [seen, setSeen] = useState(list);
  if (seen !== list) {
    setSeen(list);
    setPicked(null);
  }
  if (!groups.length) return null;
  const current = groups.find((g) => g.resortId === picked) ?? null;

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <Text accessibilityRole="header" style={{ color: t.ink, fontSize: 19, fontWeight: '900' }}>
          {title}
        </Text>
        <Text style={{ color: t.muted, fontSize: 13 }}>{note}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingBottom: 2 }}>
        {groups.map((g, i) => {
          const on = g === current;
          const resort = RESORT_BY_ID[g.resortId];
          const name = resort?.name ?? g.resortId;
          const passes = passesFor(g.resortId);
          const pass = passes.length ? passes.map((p) => PASS_LABEL[p].toUpperCase()).join(' · ') : (resort?.region ?? '');
          const pill = `${g.rides.length} ride${g.rides.length === 1 ? '' : 's'}`;
          const sub = g.seatsOpen === 1 ? 'seat open' : 'seats open';
          return (
            <Pressable
              key={g.resortId}
              onPress={() => setPicked(on ? null : g.resortId)}
              accessibilityRole="button"
              accessibilityState={{ selected: on, expanded: on }}
              accessibilityLabel={`${name}, ${pill}, ${g.seatsOpen} ${sub}`}
              style={({ pressed }) => ({
                width: 158,
                minHeight: 156,
                backgroundColor: t.surface,
                borderColor: on ? t.ink : t.line,
                borderWidth: on ? 2 : 1,
                borderRadius: 16,
                padding: on ? 12 : 13,
                gap: 4,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: t.muted, fontSize: 12, fontWeight: '900' }}>#{i + 1}</Text>
                <View style={{ backgroundColor: t.accent, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                  <Text style={{ color: t.accentInk, fontSize: 11, fontWeight: '900' }}>{pill}</Text>
                </View>
              </View>
              <Text numberOfLines={2} style={{ color: t.ink, fontSize: 16, fontWeight: '900', textTransform: 'uppercase', marginTop: 2 }}>
                {name}
              </Text>
              <Text numberOfLines={1} style={{ color: t.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.4 }}>
                {pass}
              </Text>
              <View style={{ flex: 1 }} />
              <Text style={{ color: t.ink, fontSize: 22, fontWeight: '900' }}>{g.seatsOpen}</Text>
              <Text numberOfLines={1} style={{ color: t.muted, fontSize: 12 }}>
                {sub}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {current ? (
        current.rides.map((r) => <View key={r.id}>{renderRide(r)}</View>)
      ) : (
        <Text style={{ color: t.muted, fontSize: 13 }}>Tap a mountain to see its rides.</Text>
      )}
    </View>
  );
}
