import { useMemo, useState, type ReactNode } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { addDays, dayLabel, isoDay, nextSaturday, parseDay } from '../lib/dates';
import { useCompact } from '../lib/layout';
import { useTheme } from '../lib/theme';

/**
 * A pop-over sheet: a bottom sheet on phones, a small dialog on wider screens.
 * It floats over the page, so opening it never moves anything underneath.
 */
export function PickerSheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const t = useTheme();
  const compact = useCompact();
  const insets = useSafeAreaInsets();
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
            maxWidth: compact ? undefined : 400,
            backgroundColor: t.surface,
            borderRadius: 18,
            borderBottomLeftRadius: compact ? 0 : 18,
            borderBottomRightRadius: compact ? 0 : 18,
            paddingHorizontal: 18,
            paddingTop: 16,
            paddingBottom: 18 + (compact ? insets.bottom : 0),
            gap: 14,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: t.ink, fontSize: 18, fontWeight: '900' }}>{title}</Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} style={{ padding: 4 }}>
              <Text style={{ color: t.muted, fontSize: 22, lineHeight: 22 }}>×</Text>
            </Pressable>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

/** The button that opens a picker: "Sat Nov 7 ▾". */
export function DropdownButton({
  label,
  value,
  onPress,
  accessibilityLabel,
  fill,
}: {
  label?: string;
  value: string;
  onPress: () => void;
  accessibilityLabel?: string;
  /** Equal-width box for a row of filters: small label on top, value below. */
  fill?: boolean;
}) {
  const t = useTheme();
  if (fill) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? `${label ? `${label}: ` : ''}${value}`}
        style={({ pressed }) => ({
          flex: 1,
          flexBasis: 0,
          minWidth: 0,
          gap: 2,
          borderWidth: 1.5,
          borderColor: t.ink,
          backgroundColor: t.surface,
          borderRadius: 10,
          paddingHorizontal: 8,
          paddingVertical: 8,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        {label ? (
          <Text numberOfLines={1} style={{ color: t.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' }}>
            {label}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ color: t.ink, fontSize: 14, fontWeight: '800', flex: 1 }}>
            {value}
          </Text>
          <Text style={{ color: t.ink, fontSize: 10 }}>▼</Text>
        </View>
      </Pressable>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `${label ? `${label}: ` : ''}${value}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderWidth: 1.5,
        borderColor: t.ink,
        backgroundColor: t.surface,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 8,
        opacity: pressed ? 0.85 : 1,
        flexShrink: 1,
      })}
    >
      <Text numberOfLines={1} style={{ color: t.ink, fontSize: 14, fontWeight: '800', flexShrink: 1 }}>
        {label ? <Text style={{ color: t.muted, fontWeight: '700' }}>{`${label} `}</Text> : null}
        {value}
      </Text>
      <Text style={{ color: t.ink, fontSize: 11 }}>▼</Text>
    </Pressable>
  );
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * Day picker as a calendar dropdown. Days with rides show how many; days
 * outside [minDay, maxDay] or in `disabled` can't be picked.
 * `value` is a YYYY-MM-DD day, or 'all' when `allowAll` is set.
 */
export function DayPicker({
  value,
  onChange,
  minDay,
  maxDay,
  counts,
  allowAll,
  disabled,
  disabledNote,
  label,
  fill,
  trigger,
}: {
  value: string;
  onChange: (day: string) => void;
  minDay: string;
  maxDay: string;
  counts?: Record<string, number>;
  allowAll?: boolean;
  /** Days that can't be picked, e.g. days you already have a ride. */
  disabled?: Set<string>;
  /** Shown under the calendar when some days are disabled. */
  disabledNote?: string;
  label?: string;
  fill?: boolean;
  /** Custom button in place of the dropdown, e.g. a calendar icon. Call `open` to show the calendar. */
  trigger?: (open: () => void, shown: string) => ReactNode;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const today = isoDay(new Date());
  const start = value !== 'all' ? parseDay(value) : parseDay(minDay);
  const [month, setMonth] = useState(() => new Date(start.getFullYear(), start.getMonth(), 1));

  const firstMonth = new Date(parseDay(minDay).getFullYear(), parseDay(minDay).getMonth(), 1);
  const lastMonth = new Date(parseDay(maxDay).getFullYear(), parseDay(maxDay).getMonth(), 1);
  const canPrev = month > firstMonth;
  const canNext = month < lastMonth;

  // 6 weeks, starting on the Sunday on or before the 1st.
  const cells = useMemo(() => {
    const first = addDays(month, -month.getDay());
    return Array.from({ length: 42 }, (_, i) => addDays(first, i));
  }, [month]);
  const weeks = [0, 1, 2, 3, 4, 5].filter((w) => w < 5 || cells[w * 7].getMonth() === month.getMonth());

  const ok = (d: string) => d >= minDay && d <= maxDay && !disabled?.has(d);
  const pick = (d: string) => {
    onChange(d);
    setOpen(false);
  };
  const shown = value === 'all' ? 'All upcoming' : dayLabel(value);
  const sat = nextSaturday(addDays(parseDay(today), -1)); // this Saturday, or today if it's Saturday
  const quick = [
    ...(allowAll ? [{ id: 'all', label: 'All upcoming' }] : []),
    { id: today, label: 'Today' },
    { id: isoDay(addDays(parseDay(today), 1)), label: 'Tomorrow' },
    ...(sat !== today && sat !== isoDay(addDays(parseDay(today), 1)) ? [{ id: sat, label: 'Saturday' }] : []),
  ].filter((q) => q.id === 'all' || ok(q.id));

  return (
    <>
      {(() => {
        const show = () => {
          setMonth(new Date(start.getFullYear(), start.getMonth(), 1));
          setOpen(true);
        };
        return trigger ? trigger(show, shown) : <DropdownButton label={label} value={shown} onPress={show} accessibilityLabel={`${label ?? 'Day'}: ${shown}. Change day`} fill={fill} />;
      })()}
      <PickerSheet visible={open} title={label ?? 'Pick a day'} onClose={() => setOpen(false)}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {quick.map((q) => {
            const sel = value === q.id;
            const n = q.id === 'all' ? null : counts?.[q.id];
            return (
              <Pressable
                key={q.id}
                onPress={() => pick(q.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: sel }}
                style={{ borderRadius: 999, borderWidth: 1, borderColor: sel ? t.ink : t.line, backgroundColor: sel ? t.ink : t.surface, paddingHorizontal: 12, paddingVertical: 6 }}
              >
                <Text style={{ color: sel ? t.bg : t.ink, fontSize: 13, fontWeight: '700' }}>
                  {q.label}
                  {n ? <Text style={{ opacity: 0.65 }}>{`  ${n}`}</Text> : null}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Pressable
            onPress={() => canPrev && setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            disabled={!canPrev}
            accessibilityRole="button"
            accessibilityLabel="Previous month"
            hitSlop={8}
            style={{ padding: 6, opacity: canPrev ? 1 : 0.25 }}
          >
            <Text style={{ color: t.ink, fontSize: 20, fontWeight: '800' }}>‹</Text>
          </Pressable>
          <Text style={{ color: t.ink, fontSize: 16, fontWeight: '900' }} accessibilityRole="header">
            {MONTH_NAMES[month.getMonth()]} {month.getFullYear()}
          </Text>
          <Pressable
            onPress={() => canNext && setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            disabled={!canNext}
            accessibilityRole="button"
            accessibilityLabel="Next month"
            hitSlop={8}
            style={{ padding: 6, opacity: canNext ? 1 : 0.25 }}
          >
            <Text style={{ color: t.ink, fontSize: 20, fontWeight: '800' }}>›</Text>
          </Pressable>
        </View>

        <View style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row' }}>
            {WEEKDAYS.map((w, i) => (
              <Text key={i} style={{ flex: 1, textAlign: 'center', color: t.muted, fontSize: 12, fontWeight: '800' }}>
                {w}
              </Text>
            ))}
          </View>
          {weeks.map((w) => (
            <View key={w} style={{ flexDirection: 'row' }}>
              {cells.slice(w * 7, w * 7 + 7).map((d) => {
                const id = isoDay(d);
                const inMonth = d.getMonth() === month.getMonth();
                const can = ok(id);
                const sel = value === id;
                const n = counts?.[id] ?? 0;
                const isToday = id === today;
                return (
                  <View key={id} style={{ flex: 1, alignItems: 'center', paddingVertical: 2 }}>
                    <Pressable
                      onPress={() => pick(id)}
                      disabled={!can}
                      accessibilityRole="button"
                      accessibilityState={{ selected: sel, disabled: !can }}
                      accessibilityLabel={`${dayLabel(id)}${n ? `, ${n} ride${n === 1 ? '' : 's'}` : ''}`}
                      style={({ pressed }) => ({
                        width: 42,
                        height: 46,
                        borderRadius: 10,
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 1,
                        backgroundColor: sel ? t.ink : pressed ? t.chip : 'transparent',
                        borderWidth: isToday && !sel ? 1.5 : 0,
                        borderColor: t.ink,
                        opacity: !inMonth ? 0 : can ? 1 : 0.3,
                      })}
                    >
                      <Text style={{ color: sel ? t.bg : t.ink, fontSize: 15, fontWeight: n ? '900' : '600', fontVariant: ['tabular-nums'] }}>{d.getDate()}</Text>
                      {n ? (
                        <View style={{ minWidth: 18, paddingHorizontal: 4, borderRadius: 999, backgroundColor: t.accent }}>
                          <Text style={{ color: t.accentInk, fontSize: 10, fontWeight: '900', textAlign: 'center', fontVariant: ['tabular-nums'] }}>{n > 99 ? '99+' : n}</Text>
                        </View>
                      ) : (
                        <View style={{ height: 13 }} />
                      )}
                    </Pressable>
                  </View>
                );
              })}
            </View>
          ))}
        </View>
        {counts ? <Text style={{ color: t.muted, fontSize: 12 }}>Yellow numbers are how many rides leave that day.</Text> : null}
        {disabledNote && disabled?.size ? <Text style={{ color: t.muted, fontSize: 12 }}>{disabledNote}</Text> : null}
      </PickerSheet>
    </>
  );
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A dropdown with a short list of choices, e.g. sort order. */
export function OptionPicker<T extends string>({
  label,
  title,
  value,
  options,
  onChange,
  fill,
  trigger,
  footer,
}: {
  label: string;
  title: string;
  value: T;
  options: { id: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
  fill?: boolean;
  /** Custom button in place of the dropdown, e.g. an icon. Call `open` to show the choices. */
  trigger?: (open: () => void, current: { id: T; label: string }) => ReactNode;
  /** Small print under the choices. */
  footer?: string;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.id === value) ?? options[0];
  return (
    <>
      {trigger ? trigger(() => setOpen(true), current) : <DropdownButton label={label} value={current.label} onPress={() => setOpen(true)} fill={fill} />}
      <PickerSheet visible={open} title={title} onClose={() => setOpen(false)}>
        <View style={{ gap: 4 }} accessibilityRole="radiogroup">
          {options.map((o) => {
            const sel = o.id === value;
            return (
              <Pressable
                key={o.id}
                onPress={() => {
                  onChange(o.id);
                  setOpen(false);
                }}
                accessibilityRole="radio"
                accessibilityState={{ checked: sel }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingVertical: 12,
                  paddingHorizontal: 12,
                  borderRadius: 12,
                  backgroundColor: sel ? t.chip : pressed ? t.chip : 'transparent',
                })}
              >
                <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: sel ? t.ink : t.line, alignItems: 'center', justifyContent: 'center' }}>
                  {sel ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.ink }} /> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.ink, fontSize: 15, fontWeight: '700' }}>{o.label}</Text>
                  {o.hint ? <Text style={{ color: t.muted, fontSize: 13 }}>{o.hint}</Text> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
        {footer ? <Text style={{ color: t.muted, fontSize: 12, lineHeight: 17 }}>{footer}</Text> : null}
      </PickerSheet>
    </>
  );
}

