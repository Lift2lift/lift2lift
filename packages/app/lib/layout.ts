import { Platform, useWindowDimensions } from 'react-native';

/** Phone layout: compact top bar + bottom tab bar. Always on iOS; on the web below 640px. */
export function useCompact() {
  const { width } = useWindowDimensions();
  return Platform.OS !== 'web' || width < 640;
}
