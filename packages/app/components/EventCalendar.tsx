import { Pressable, Text, View } from 'react-native';
import { useTheme } from '../lib/theme';
import { parseDay } from '../lib/dates';
import { monthCells, type DayMark } from '../lib/events';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Month calendar for the community page: club events as bars, member rides as yellow counts. */
export function EventCalendar({
  month,
  onMonth,
  minMonth,
  maxMonth,
  marks,
  selectedDays,
  focusDay,
  today,
  onPick,
}: {
  month: Date; // first of month
  onMonth: (month: Date) => void;
  minMonth: Date;
  maxMonth: Date;
  marks: Record<string, DayMark>;
  selectedDays: Set<string>; // every day of the selected event, or the one selected day
  focusDay?: string; // the tapped day: outlined when it sits inside a multi-day selection
  today: string;
  onPick: (day: string) => void;
}) {
  const t = useTheme();
  const key = (d: Date) => d.getFullYear() * 12 + d.getMonth();
  const canPrev = key(month) > key(minMonth);
  const canNext = key(month) < key(maxMonth);
  const shift = (n: number) => onMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  const cells = monthCells(month);
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
  const monthName = MONTHS[month.getMonth()];

  const arrow = (label: string, glyph: string, enabled: boolean, onPress: () => void) => (
    <Pressable
      onPress={onPress}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: enabled ? 1 : 0.25 }}
    >
      <Text style={{ color: t.ink, fontSize: 20, fontWeight: '800' }}>{glyph}</Text>
    </Pressable>
  );

  return (
    <View style={{ backgroundColor: t.surface, borderColor: t.line, borderWidth: 1, borderRadius: 14, padding: 16, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        {arrow('Previous month', '‹', canPrev, () => shift(-1))}
        <Text accessibilityRole="header" style={{ color: t.ink, fontSize: 16, fontWeight: '900' }}>
          {monthName} {month.getFullYear()}
        </Text>
        {arrow('Next month', '›', canNext, () => shift(1))}
      </View>

      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: 'row', marginBottom: 0 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {WEEKDAYS.map((w, i) => (
            <Text key={i} style={{ flex: 1, textAlign: 'center', color: t.muted, fontSize: 12, fontWeight: '800' }}>
              {w}
            </Text>
          ))}
        </View>
        {weeks.map((row, w) => (
          <View key={w} style={{ flexDirection: 'row' }}>
            {row.map((day, i) => {
              if (!day) return <View key={i} style={{ flex: 1 }} />;
              const mark = marks[day];
              const ev = mark?.event ?? null;
              const span = mark?.span ?? 'none';
              const rides = mark?.rides ?? 0;
              const multi = span === 'start' || span === 'middle' || span === 'end';
              const sel = selectedDays.has(day);
              const focused = day === focusDay && selectedDays.size > 1;
              const past = day < today;
              const isToday = day === today;
              // Outer ends of a multi-day bar: the event's first/last day, or the week's edge.
              const leftEnd = multi && (span === 'start' || !!mark?.rowStart);
              const rightEnd = multi && (span === 'end' || !!mark?.rowEnd);
              // A multi-day selection squares the corners that join the next day.
              const rl = sel && multi ? (leftEnd ? 10 : 0) : 10;
              const rr = sel && multi ? (rightEnd ? 10 : 0) : 10;
              const d = parseDay(day);
              const single = !!mark?.single || span === 'single';
              const label = `${MONTHS[d.getMonth()]} ${d.getDate()}${ev ? `, ${ev.title}` : ''}${rides ? `, ${rides} ride${rides === 1 ? '' : 's'}` : ''}`;
              return (
                <Pressable
                  key={day}
                  onPress={() => onPick(day)}
                  disabled={past}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  accessibilityState={{ selected: focusDay ? day === focusDay : sel, disabled: past }}
                  style={({ pressed }) => ({
                    flex: 1,
                    height: 52,
                    paddingBottom: 8,
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 1,
                    borderTopLeftRadius: rl,
                    borderBottomLeftRadius: rl,
                    borderTopRightRadius: rr,
                    borderBottomRightRadius: rr,
                    backgroundColor: sel ? t.ink : pressed && !past ? t.chip : 'transparent',
                    borderWidth: focused ? 2 : isToday && !sel ? 1.5 : 0,
                    borderColor: focused ? t.accent : t.ink,
                    opacity: past ? 0.3 : 1,
                  })}
                >
                  <Text style={{ color: sel ? t.bg : t.ink, fontSize: 15, fontWeight: ev || rides ? '900' : '600', fontVariant: ['tabular-nums'] }}>{d.getDate()}</Text>
                  <View style={{ height: 13, flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                    {single ? <View style={{ width: 12, height: 5, borderRadius: 3, backgroundColor: sel ? t.bg : t.ink }} /> : null}
                    {rides ? (
                      <View style={{ minWidth: 16, paddingHorizontal: 4, borderRadius: 999, backgroundColor: t.accent }}>
                        <Text style={{ color: t.accentInk, fontSize: 11, fontWeight: '900', lineHeight: 13, textAlign: 'center', fontVariant: ['tabular-nums'] }}>{rides}</Text>
                      </View>
                    ) : null}
                  </View>
                  {multi ? (
                    <View
                      style={{
                        position: 'absolute',
                        bottom: 5,
                        height: 5,
                        left: leftEnd ? 8 : 0,
                        right: rightEnd ? 8 : 0,
                        backgroundColor: sel ? t.accent : t.ink,
                        borderTopLeftRadius: leftEnd ? 3 : 0,
                        borderBottomLeftRadius: leftEnd ? 3 : 0,
                        borderTopRightRadius: rightEnd ? 3 : 0,
                        borderBottomRightRadius: rightEnd ? 3 : 0,
                      }}
                    />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 14, height: 5, borderRadius: 3, backgroundColor: t.ink }} />
          <Text style={{ color: t.muted, fontSize: 12 }}>Club event</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 30, height: 5, borderRadius: 3, backgroundColor: t.ink }} />
          <Text style={{ color: t.muted, fontSize: 12 }}>Multi-day</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ minWidth: 16, paddingHorizontal: 4, borderRadius: 999, backgroundColor: t.accent }}>
            <Text style={{ color: t.accentInk, fontSize: 11, fontWeight: '900', lineHeight: 13, textAlign: 'center' }}>2</Text>
          </View>
          <Text style={{ color: t.muted, fontSize: 12 }}>Member rides</Text>
        </View>
      </View>
    </View>
  );
}
