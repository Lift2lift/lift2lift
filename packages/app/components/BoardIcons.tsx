import { View } from 'react-native';

/**
 * Icons for the Mountains tab controls, drawn with plain views so they match
 * on web and iPhone. `color` is the stroke; `cutout` is the color behind.
 */
type P = { color: string; cutout?: string };

/** Magnifying glass. */
export function SearchIcon({ color }: P) {
  return (
    <View style={{ width: 18, height: 18 }}>
      <View style={{ position: 'absolute', left: 1, top: 1, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: color }} />
      <View style={{ position: 'absolute', left: 11.5, top: 10, width: 2.2, height: 7, borderRadius: 1.1, backgroundColor: color, transform: [{ rotate: '-45deg' }] }} />
    </View>
  );
}

/** Three lines, longest on top: "sort". */
export function FilterIcon({ color }: P) {
  return (
    <View style={{ width: 18, height: 14, justifyContent: 'space-between' }}>
      {[18, 12, 6].map((w) => (
        <View key={w} style={{ width: w, height: 2.2, borderRadius: 1.1, backgroundColor: color }} />
      ))}
    </View>
  );
}

/** Calendar page with two binder rings. */
export function CalendarIcon({ color, cutout = 'transparent' }: P) {
  return (
    <View style={{ width: 20, height: 20 }}>
      <View style={{ position: 'absolute', left: 1, top: 3, width: 18, height: 16, borderRadius: 3, borderWidth: 2, borderColor: color }} />
      <View style={{ position: 'absolute', left: 1, top: 3, width: 18, height: 6, borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: color }} />
      {[5, 13].map((left) => (
        <View key={left} style={{ position: 'absolute', left, top: 0, width: 2.4, height: 6, borderRadius: 1.2, backgroundColor: color, borderWidth: 0.5, borderColor: cutout }} />
      ))}
      {[[5, 12], [9, 12], [13, 12]].map(([left, top]) => (
        <View key={left} style={{ position: 'absolute', left, top, width: 2.5, height: 2.5, borderRadius: 0.6, backgroundColor: color }} />
      ))}
    </View>
  );
}

/** Ski pass card on a lanyard clip. */
export function PassIcon({ color, cutout = 'transparent' }: P) {
  return (
    <View style={{ width: 22, height: 20 }}>
      <View style={{ position: 'absolute', left: 8, top: 0, width: 6, height: 5, borderTopLeftRadius: 3, borderTopRightRadius: 3, borderWidth: 2, borderBottomWidth: 0, borderColor: color }} />
      <View style={{ position: 'absolute', left: 1, top: 4, width: 20, height: 15, borderRadius: 3, backgroundColor: color }} />
      {/* photo square and two text lines */}
      <View style={{ position: 'absolute', left: 4, top: 7.5, width: 5.5, height: 6.5, borderRadius: 1, backgroundColor: cutout }} />
      <View style={{ position: 'absolute', left: 11.5, top: 8.5, width: 7, height: 1.8, borderRadius: 1, backgroundColor: cutout }} />
      <View style={{ position: 'absolute', left: 11.5, top: 12, width: 5, height: 1.8, borderRadius: 1, backgroundColor: cutout }} />
    </View>
  );
}
