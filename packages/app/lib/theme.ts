import { useColorScheme } from 'react-native';

const light = {
  bg: '#EEF3F7',
  surface: '#FFFFFF',
  ink: '#13213A',
  muted: '#586A82',
  line: '#D3DDE7',
  chip: '#E3EAF1',
  accent: '#F5B800', // chairlift yellow
  accentInk: '#13213A',
  link: '#2C6BDE',
  snow: '#2C6BDE',
  danger: '#B9402C',
  dangerBg: '#FBE9E5',
  ok: '#17855A',
  okBg: '#E2F3EA',
  header: '#13213A',
  headerInk: '#EEF3F7',
};

const dark: typeof light = {
  bg: '#0C1423',
  surface: '#14213A',
  ink: '#E8EEF6',
  muted: '#94A4BA',
  line: '#273857',
  chip: '#1C2C49',
  accent: '#FFC629',
  accentInk: '#13213A',
  link: '#5D95FF',
  snow: '#5D95FF',
  danger: '#F07A63',
  dangerBg: '#3A1E1E',
  ok: '#3DBE86',
  okBg: '#14342A',
  header: '#070D18',
  headerInk: '#E8EEF6',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

/** Blend a hex color toward another by `amount` (0–1). Used for the snow grid. */
export function mix(hexA: string, hexB: string, amount: number) {
  const a = hexA.replace('#', '');
  const b = hexB.replace('#', '');
  const ch = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  const t = Math.max(0, Math.min(1, amount));
  const out = [0, 2, 4].map((i) => Math.round(ch(a, i) * (1 - t) + ch(b, i) * t).toString(16).padStart(2, '0'));
  return `#${out.join('')}`;
}
