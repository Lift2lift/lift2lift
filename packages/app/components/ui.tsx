import { forwardRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../lib/theme';

/** Centered, keyboard-aware column for forms (sign-in, post a ride). */
export function FormScreen({ children, header }: { children: ReactNode; header?: ReactNode }) {
  const t = useTheme();
  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: t.bg }]} edges={header ? ['bottom', 'left', 'right'] : undefined}>
      {header}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={[styles.scroll, !header && styles.centered]} keyboardShouldPersistTaps="handled">
          <View style={styles.column}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Brand({ size = 44, tagline }: { size?: number; tagline?: string }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: 2 }}>
      <Text style={[styles.wordmark, { color: t.ink, fontSize: size }]}>
        LIFT<Text style={{ color: t.accent }}>2</Text>LIFT
      </Text>
      {tagline ? <Text style={{ color: t.muted, fontSize: 14 }}>{tagline}</Text> : null}
    </View>
  );
}

export function Heading({ title, subtitle }: { title: string; subtitle?: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.h1, { color: t.ink }]}>{title}</Text>
      {subtitle ? <Text style={[styles.body, { color: t.muted }]}>{subtitle}</Text> : null}
    </View>
  );
}

export function Label({ children }: { children: string }) {
  const t = useTheme();
  return <Text style={[styles.label, { color: t.muted }]}>{children.toUpperCase()}</Text>;
}

type FieldProps = TextInputProps & { label: string; hint?: string; secure?: boolean };

export const Field = forwardRef<TextInput, FieldProps>(function Field(
  { label, hint, secure, style, onFocus, onBlur, multiline, ...rest },
  ref,
) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  const [shown, setShown] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Label>{label}</Label>
      <View style={[styles.inputWrap, { backgroundColor: t.surface, borderColor: focused ? t.link : t.line }]}>
        <TextInput
          ref={ref}
          placeholderTextColor={t.muted}
          multiline={multiline}
          {...rest}
          secureTextEntry={secure && !shown}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[
            styles.input,
            { color: t.ink },
            multiline && { minHeight: 80, textAlignVertical: 'top' },
            Platform.OS === 'web' && ({ outlineStyle: 'none' } as object),
            style,
          ]}
        />
        {secure ? (
          <Pressable
            onPress={() => setShown((s) => !s)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={shown ? 'Hide password' : 'Show password'}
          >
            <Text style={{ color: t.link, fontSize: 14, fontWeight: '600', paddingLeft: 10 }}>{shown ? 'Hide' : 'Show'}</Text>
          </Pressable>
        ) : null}
      </View>
      {hint ? <Text style={{ color: t.muted, fontSize: 13 }}>{hint}</Text> : null}
    </View>
  );
});

export function Button({
  title,
  onPress,
  loading,
  disabled,
  variant = 'primary',
  small,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'ghost' | 'danger';
  small?: boolean;
}) {
  const t = useTheme();
  const off = disabled || loading;
  const bg = variant === 'primary' ? t.accent : 'transparent';
  const fg = variant === 'primary' ? t.accentInk : variant === 'danger' ? t.danger : t.ink;
  const border = variant === 'primary' ? t.accent : variant === 'danger' ? t.danger : t.line;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: bg, borderColor: border, opacity: off ? 0.5 : pressed ? 0.85 : 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.buttonText, small && { fontSize: 14 }, { color: fg }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  count,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  count?: number;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? t.ink : t.surface,
          borderColor: selected ? t.ink : t.line,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <Text style={{ color: selected ? t.bg : t.ink, fontSize: 13, fontWeight: '600' }}>
        {label}
        {count != null ? <Text style={{ opacity: 0.65, fontWeight: '500' }}>{`  ${count}`}</Text> : null}
      </Text>
    </Pressable>
  );
}

export function ChipRow({ children, wrap }: { children: ReactNode; wrap?: boolean }) {
  if (wrap) return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{children}</View>;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingRight: 8 }}>
      {children}
    </ScrollView>
  );
}

export function TextLink({ children, onPress }: { children: ReactNode; onPress: () => void }) {
  const t = useTheme();
  return (
    <Text onPress={onPress} accessibilityRole="link" style={{ color: t.link, fontSize: 15, fontWeight: '600' }}>
      {children}
    </Text>
  );
}

export function Notice({ kind, children }: { kind: 'error' | 'success' | 'info'; children: ReactNode }) {
  const t = useTheme();
  const bg = kind === 'error' ? t.dangerBg : kind === 'success' ? t.okBg : t.chip;
  const fg = kind === 'error' ? t.danger : kind === 'success' ? t.ok : t.muted;
  return (
    <View style={[styles.notice, { backgroundColor: bg }]}>
      <Text style={{ color: fg, fontSize: 14, lineHeight: 20 }}>{children}</Text>
    </View>
  );
}

export function Card({ children, style, highlight }: { children: ReactNode; style?: StyleProp<ViewStyle>; highlight?: boolean }) {
  const t = useTheme();
  return (
    <View
      style={[
        { backgroundColor: t.surface, borderColor: highlight ? t.accent : t.line, borderWidth: highlight ? 2 : 1, borderRadius: 14 },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Muted({ children, center }: { children: ReactNode; center?: boolean }) {
  const t = useTheme();
  return <Text style={[styles.body, { color: t.muted, textAlign: center ? 'center' : 'left' }]}>{children}</Text>;
}

export function Loading({ label }: { label: string }) {
  const t = useTheme();
  return (
    <View style={{ padding: 32, alignItems: 'center', gap: 10 }}>
      <ActivityIndicator color={t.ink} />
      <Text style={{ color: t.muted }}>{label}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: 16, paddingVertical: 24 },
  centered: { justifyContent: 'center' },
  column: { width: '100%', maxWidth: 480, alignSelf: 'center', gap: 18 },
  wordmark: { fontWeight: '900', fontStyle: 'italic', letterSpacing: 1 },
  h1: { fontSize: 26, fontWeight: '800' },
  body: { fontSize: 15, lineHeight: 21 },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14 },
  input: { flex: 1, fontSize: 16, paddingVertical: 12 },
  button: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  buttonSmall: { minHeight: 38, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10 },
  buttonText: { fontSize: 16, fontWeight: '800' },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  notice: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
});
