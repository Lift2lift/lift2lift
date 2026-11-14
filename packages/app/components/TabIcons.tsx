import { View } from 'react-native';

/**
 * Tab bar icons, drawn with plain views so they look the same on web and
 * iPhone with no icon font. `color` is the icon color; `cutout` is the color
 * behind it (the tab bar), used for the snow cap, window and wheel gaps.
 */
type IconProps = { color: string; cutout: string };

function Triangle({ left, bottom, base, height, color }: { left: number; bottom: number; base: number; height: number; color: string }) {
  return (
    <View
      style={{
        position: 'absolute',
        left,
        bottom,
        width: 0,
        height: 0,
        borderLeftWidth: base / 2,
        borderRightWidth: base / 2,
        borderBottomWidth: height,
        borderLeftColor: 'transparent',
        borderRightColor: 'transparent',
        borderBottomColor: color,
      }}
    />
  );
}

/** Mountains tab: two peaks, the front one snow-capped. */
export function MountainIcon({ color, cutout }: IconProps) {
  return (
    <View style={{ width: 26, height: 20 }}>
      <Triangle left={0} bottom={0} base={15} height={12} color={color} />
      <Triangle left={6} bottom={0} base={20} height={19} color={color} />
      {/* snow cap on the front peak */}
      <Triangle left={12.8} bottom={12.4} base={6.4} height={6.1} color={cutout} />
    </View>
  );
}

/** Rides tab: side view of a car. */
export function CarIcon({ color, cutout }: IconProps) {
  return (
    <View style={{ width: 26, height: 18 }}>
      {/* cabin with a window */}
      <View style={{ position: 'absolute', left: 6, top: 1, width: 13, height: 8, borderTopLeftRadius: 5, borderTopRightRadius: 5, backgroundColor: color }} />
      <View style={{ position: 'absolute', left: 8.5, top: 3, width: 8, height: 4, borderTopLeftRadius: 2.5, borderTopRightRadius: 2.5, backgroundColor: cutout }} />
      {/* body */}
      <View style={{ position: 'absolute', left: 1, top: 7, width: 24, height: 7, borderRadius: 3, backgroundColor: color }} />
      {/* wheels, ringed in the background color so they read as separate */}
      {[4, 15].map((left) => (
        <View
          key={left}
          style={{ position: 'absolute', left, top: 10.5, width: 7.5, height: 7.5, borderRadius: 4, backgroundColor: color, borderWidth: 1.5, borderColor: cutout }}
        />
      ))}
    </View>
  );
}
