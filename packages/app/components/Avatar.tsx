import { Image, Text, View } from 'react-native';
import { useTheme } from '../lib/theme';
import type { Gender } from '../lib/types';

/** Ring color around profile photos: blue for men, pink for women, neutral otherwise. */
export const RING = { man: '#2F80ED', woman: '#E8559A' } as const;

export function ringColor(gender: Gender | null | undefined, neutral: string) {
  if (gender === 'man') return RING.man;
  if (gender === 'woman') return RING.woman;
  return neutral;
}

function initials(name: string) {
  const parts = name.replace(/\([^)]*\)/g, '').trim().split(/\s+/).filter((w) => /^\p{L}/u.test(w));
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

/** Round profile photo with a gender ring. Falls back to initials. */
export function Avatar({
  uri,
  name,
  gender,
  size = 40,
}: {
  uri: string | null | undefined;
  name: string;
  gender: Gender | null | undefined;
  size?: number;
}) {
  const t = useTheme();
  const ring = Math.max(2, Math.round(size / 18));
  const gap = Math.max(1.5, Math.round(size / 28));
  const inner = size - 2 * (ring + gap);
  return (
    <View
      accessibilityLabel={`${name || 'Profile'} photo`}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: ring,
        borderColor: ringColor(gender, t.line),
        padding: gap,
        backgroundColor: t.surface,
      }}
    >
      {uri ? (
        <Image source={{ uri }} style={{ width: inner, height: inner, borderRadius: inner / 2 }} resizeMode="cover" />
      ) : (
        <View style={{ width: inner, height: inner, borderRadius: inner / 2, backgroundColor: t.chip, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: t.muted, fontWeight: '800', fontSize: Math.max(10, inner * 0.36) }}>{initials(name)}</Text>
        </View>
      )}
    </View>
  );
}
