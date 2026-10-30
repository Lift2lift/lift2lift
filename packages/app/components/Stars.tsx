import { Platform, Text, View } from 'react-native';
import { useTheme } from '../lib/theme';

const GOLD = '#F5B800';

/** One star, filled from 0 to 1 (0.5 = half). */
function Star({ fill, size, empty }: { fill: number; size: number; empty: string }) {
  const glyph = { fontSize: size * 0.92, lineHeight: size, width: size, textAlign: 'center' as const };
  return (
    <View pointerEvents="none" style={{ width: size, height: size }}>
      <Text style={[glyph, { color: empty }]}>★</Text>
      {fill > 0 ? (
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, height: size, width: size * Math.min(1, fill), overflow: 'hidden' }}>
          <Text style={[glyph, { color: GOLD }]}>★</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Read-only stars, rounded to the nearest half. */
export function Stars({ value, size = 16 }: { value: number; size?: number }) {
  const t = useTheme();
  const v = Math.round(value * 2) / 2;
  return (
    <View
      accessible
      accessibilityLabel={`${v} out of 5 stars`}
      style={{ flexDirection: 'row' }}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <Star key={i} size={size} fill={Math.max(0, Math.min(1, v - i))} empty={t.line} />
      ))}
    </View>
  );
}

/** "★ 4.8 · 12 reviews" */
export function RatingBadge({ value, count, label }: { value: number | null; count: number; label?: string }) {
  const t = useTheme();
  if (!count || value == null) return <Text style={{ color: t.muted, fontSize: 12, fontWeight: '600' }}>New · no reviews yet</Text>;
  return (
    <Text style={{ color: t.ink, fontSize: 12, fontWeight: '700' }}>
      <Text style={{ color: GOLD }}>★</Text> {value.toFixed(1)}
      {label ? ` ${label}` : ''}
      <Text style={{ color: t.muted, fontWeight: '500' }}>{` · ${count} review${count === 1 ? '' : 's'}`}</Text>
    </Text>
  );
}

const STEP = 0.5;
const clamp = (v: number) => Math.max(STEP, Math.min(5, v));

/**
 * Star rating input with half stars. Tap a star (left half = half star) or
 * slide a finger / the mouse across the row. Arrow keys and screen-reader
 * swipe up/down change it by half a star.
 */
export function StarInput({
  value,
  onChange,
  label,
  size = 38,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  size?: number;
}) {
  const t = useTheme();
  const width = size * 5;
  const fromX = (x: number) => clamp(Math.ceil(((Math.max(0, Math.min(width, x)) / width) * 5) / STEP) * STEP);
  const pick = (e: { nativeEvent: { locationX: number } }) => onChange(fromX(e.nativeEvent.locationX));
  const step = (dir: 1 | -1) => onChange(clamp((value || (dir > 0 ? 0 : STEP)) + dir * STEP));

  const webKeys =
    Platform.OS === 'web'
      ? ({
          onKeyDown: (e: { key: string; preventDefault: () => void }) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
              e.preventDefault();
              step(1);
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
              e.preventDefault();
              step(-1);
            }
          },
          focusable: true,
        } as object)
      : {};

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min: 0, max: 5, now: value, text: value ? `${value} out of 5 stars` : 'Not rated' }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => step(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={pick}
        onResponderMove={pick}
        {...webKeys}
        style={{ flexDirection: 'row', width, height: size, cursor: 'pointer' } as object}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <Star key={i} size={size} fill={Math.max(0, Math.min(1, value - i))} empty={t.line} />
        ))}
      </View>
      <Text style={{ color: value ? t.ink : t.muted, fontSize: 15, fontWeight: '800', minWidth: 34 }}>{value ? value.toFixed(1) : '–'}</Text>
    </View>
  );
}
