import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from '../lib/theme';
import type { Gender, SeatLegs } from '../lib/types';
import { useNav } from '../providers';
import { Avatar } from './Avatar';

type P = { id: string; name: string; avatarUrl: string | null; gender: Gender | null };

/** A profile photo you can tap to open that person's profile. */
export function PersonAvatar({ person, size = 32 }: { person: P; size?: number }) {
  const nav = useNav();
  return (
    <Pressable
      onPress={() => nav.push('/u', { id: person.id })}
      accessibilityRole="link"
      accessibilityLabel={`${person.name || 'Rider'}'s profile`}
      hitSlop={4}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <Avatar uri={person.avatarUrl} name={person.name} gender={person.gender} size={size} />
    </Pressable>
  );
}

/** Photo + first name in a pill; the whole pill opens the profile. `after` sits inside the pill (e.g. a remove button). */
export function PersonChip({ person, note, after }: { person: P; note?: string; after?: ReactNode }) {
  const t = useTheme();
  const nav = useNav();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.chip, borderRadius: 999, paddingRight: after ? 2 : 10 }}>
      <Pressable
        onPress={() => nav.push('/u', { id: person.id })}
        accessibilityRole="link"
        accessibilityLabel={`${person.name || 'Rider'}'s profile`}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 3, paddingVertical: 3, opacity: pressed ? 0.7 : 1 })}
      >
        <Avatar uri={person.avatarUrl} name={person.name} gender={person.gender} size={26} />
        <Text style={{ color: t.ink, fontSize: 13, fontWeight: '600' }}>
          {person.name.split(' ')[0] || 'Rider'}
          {note ? <Text style={{ color: t.muted, fontWeight: '500' }}>{` · ${note}`}</Text> : null}
        </Text>
      </Pressable>
      {after}
    </View>
  );
}

const LEG_NOTE: Record<SeatLegs, string> = { both: 'Both ways', to: 'Ride up only', from: 'Ride down only' };

/**
 * Everyone in the car on a ride: driver first, then riders. Each row opens
 * that person's profile, so riders can see exactly who they're riding with.
 */
export function WhosInTheCar({
  driver,
  riders,
  meId,
  roundTrip,
  title = "Who's in the car",
}: {
  driver: P;
  riders: (P & { legs?: SeatLegs })[];
  meId: string;
  roundTrip?: boolean;
  title?: string;
}) {
  const t = useTheme();
  const nav = useNav();
  const rows: { p: P; role: string }[] = [
    { p: driver, role: 'Driver' },
    ...riders.map((r) => ({ p: r as P, role: roundTrip && r.legs ? LEG_NOTE[r.legs] : 'Rider' })),
  ];
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: t.ink, fontSize: 17, fontWeight: '800' }}>
        {title} <Text style={{ color: t.muted, fontWeight: '600', fontSize: 15 }}>· {rows.length}</Text>
      </Text>
      {rows.map(({ p, role }, i) => (
        <Pressable
          key={p.id}
          onPress={() => nav.push('/u', { id: p.id })}
          accessibilityRole="link"
          accessibilityLabel={`${p.name || 'Rider'}, ${role}. Open profile`}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingVertical: 8,
            borderTopWidth: i === 0 ? 0 : 1,
            borderTopColor: t.line,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Avatar uri={p.avatarUrl} name={p.name} gender={p.gender} size={44} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ color: t.ink, fontSize: 16, fontWeight: '700' }}>
              {p.name || 'Lift2Lift member'}
              {p.id === meId ? <Text style={{ color: t.muted, fontWeight: '500' }}> (you)</Text> : null}
            </Text>
            <Text style={{ color: role === 'Driver' ? t.ink : t.muted, fontSize: 13, fontWeight: role === 'Driver' ? '700' : '500' }}>{role}</Text>
          </View>
          <Text style={{ color: t.muted, fontSize: 20 }}>›</Text>
        </Pressable>
      ))}
    </View>
  );
}
