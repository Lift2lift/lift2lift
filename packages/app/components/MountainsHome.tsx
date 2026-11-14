import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { clock, dayLabel, driveText, isoDay, longDay } from '../lib/dates';
import { PASS_FILTERS, PASS_LABEL, passesFor, passMatches, type PassFilter } from '../lib/passes';
import { useTheme } from '../lib/theme';
import type { BoardRide, Forecast } from '../lib/types';
import { useDriveTimes } from '../lib/useDriveTimes';
import { useDevice } from '../providers';
import { CalendarIcon, FilterIcon, PassIcon, SearchIcon } from './BoardIcons';
import { mountainStats, type MountainStat } from './MountainPicker';
import { DayPicker, OptionPicker } from './Pickers';

type MountainSort = 'none' | 'shortest' | 'soonest' | 'most';
const SORTS: { id: MountainSort; label: string; hint?: string }[] = [
  { id: 'none', label: 'No sort', hint: 'Just the three rows' },
  { id: 'shortest', label: 'Shortest ride', hint: 'Closest mountains first, by miles from Boulder' },
  { id: 'soonest', label: 'Soonest ride', hint: 'Mountains with the next ride leaving first' },
  { id: 'most', label: 'Most rides', hint: 'Mountains with the most rides first' },
];
const PASS_KEY = 'lift2lift.pass';

/** One mountain on the chosen day, plus its snow and drive time. */
type Stat = MountainStat & {
  /** New snow in inches: that day's, or the next 7 days' total for any day. Null before the forecast loads. */
  snow: number | null;
  minutes: number;
};

/* ---------- Pieces ---------- */

/** Square icon button next to the search bar. Filled when a choice is active. */
function IconButton({ label, active, onPress, children }: { label: string; active: boolean; onPress: () => void; children: (color: string, bg: string) => ReactNode }) {
  const t = useTheme();
  const bg = active ? t.ink : t.surface;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        width: 48,
        height: 48,
        borderRadius: 14,
        borderWidth: 1.5,
        borderColor: active ? t.ink : t.line,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.8 : 1,
      })}
    >
      {children(active ? t.surface : t.ink, bg)}
    </Pressable>
  );
}

function Tile({ stat, rank, metric, sub, onPress }: { stat: Stat; rank: number; metric: string; sub: string; onPress: () => void }) {
  const t = useTheme();
  const has = stat.rides > 0;
  const passes = passesFor(stat.resort.id);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${stat.resort.name}, ${metric}, ${sub}${has ? '' : ', no rides yet'}`}
      style={({ pressed }) => ({
        width: 158,
        minHeight: 156,
        backgroundColor: has ? t.surface : t.chip,
        borderColor: t.line,
        borderWidth: 1,
        borderRadius: 16,
        padding: 13,
        gap: 4,
        opacity: pressed ? 0.85 : has ? 1 : 0.55,
      })}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: t.muted, fontSize: 12, fontWeight: '900' }}>#{rank}</Text>
        {has ? (
          <View style={{ backgroundColor: t.accent, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
            <Text style={{ color: t.accentInk, fontSize: 11, fontWeight: '900' }}>
              {stat.rides} ride{stat.rides === 1 ? '' : 's'}
            </Text>
          </View>
        ) : (
          <Text style={{ color: t.muted, fontSize: 11, fontWeight: '700' }}>No rides</Text>
        )}
      </View>
      <Text numberOfLines={2} style={{ color: t.ink, fontSize: 16, fontWeight: '900', textTransform: 'uppercase', marginTop: 2 }}>
        {stat.resort.name}
      </Text>
      <Text numberOfLines={1} style={{ color: t.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.4 }}>
        {passes.length ? passes.map((p) => PASS_LABEL[p].toUpperCase()).join(' · ') : stat.resort.region}
      </Text>
      <View style={{ flex: 1 }} />
      <Text style={{ color: t.ink, fontSize: 22, fontWeight: '900' }}>{metric}</Text>
      <Text numberOfLines={1} style={{ color: t.muted, fontSize: 12 }}>
        {sub}
      </Text>
    </Pressable>
  );
}

function Rail({ title, note, stats, metric, onOpen }: { title: string; note: string; stats: Stat[]; metric: (s: Stat) => { value: string; sub: string }; onOpen: (id: string) => void }) {
  const t = useTheme();
  if (!stats.length) return null;
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <Text accessibilityRole="header" style={{ color: t.ink, fontSize: 19, fontWeight: '900' }}>
          {title}
        </Text>
        <Text style={{ color: t.muted, fontSize: 13 }}>{note}</Text>
      </View>
      {/* Bleeds to the screen edge so the row reads as swipeable. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16 }} contentContainerStyle={{ gap: 10, paddingHorizontal: 16 }}>
        {stats.map((s, i) => {
          const m = metric(s);
          return <Tile key={s.resort.id} stat={s} rank={i + 1} metric={m.value} sub={m.sub} onPress={() => onOpen(s.resort.id)} />;
        })}
      </ScrollView>
    </View>
  );
}

/* ---------- The Mountains tab ---------- */

/**
 * Mountains tab home: a search bar with a sort button, a calendar for the day
 * and a ski pass picker, then swipeable rows ranking every mountain: most
 * popular, most snow and least traffic. Mountains with no rides that day stay
 * in the rows, greyed out.
 */
export function MountainsHome({
  rides,
  day,
  setDay,
  minDay,
  maxDay,
  dayCounts,
  forecast,
  onOpen,
  initialPass,
  children,
}: {
  rides: BoardRide[];
  /** 'all' or YYYY-MM-DD */
  day: string;
  setDay: (day: string) => void;
  minDay: string;
  maxDay: string;
  /** Rides leaving each day, for the calendar. */
  dayCounts: Record<string, number>;
  forecast: Forecast | null;
  onOpen: (resortId: string) => void;
  /** Start on this pass (from a link), instead of the one saved on the device. */
  initialPass?: PassFilter;
  /** Shown between the controls and the rows (review prompts, messages). */
  children?: ReactNode;
}) {
  const t = useTheme();
  const device = useDevice();
  const drive = useDriveTimes();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<MountainSort>('none');
  const [pass, setPassState] = useState<PassFilter>(initialPass ?? 'any');

  // Remember the pass on this device.
  useEffect(() => {
    if (initialPass) return;
    device
      .getPref(PASS_KEY)
      .then((v) => PASS_FILTERS.some((f) => f.id === v) && setPassState(v as PassFilter))
      .catch(() => {});
  }, [device, initialPass]);
  const setPass = (p: PassFilter) => {
    setPassState(p);
    device.setPref(PASS_KEY, p).catch(() => {});
  };

  const today = isoDay(new Date());
  const q = query.trim().toLowerCase();
  const onDay = (r: BoardRide) => day === 'all' || isoDay(new Date(r.departAt)) === day;

  const stats: Stat[] = useMemo(
    () =>
      mountainStats(rides.filter(onDay))
        .filter((s) => passMatches(s.resort.id, pass) && (!q || s.resort.name.toLowerCase().includes(q) || s.resort.region.toLowerCase().includes(q)))
        .map((s) => {
          const f = forecast?.byResort[s.resort.id];
          const snow = !f
            ? null
            : day === 'all'
              ? f.filter((d) => d.date >= today).slice(0, 7).reduce((n, d) => n + d.snowIn, 0)
              : (f.find((d) => d.date === day)?.snowIn ?? 0);
          return { ...s, snow: snow == null ? null : Math.round(snow * 10) / 10, minutes: drive.minutes[s.resort.id] ?? s.resort.driveMinutes };
        }),
    [rides, day, pass, q, forecast, drive],
  );

  const byMinutes = (a: Stat, b: Stat) => a.minutes - b.minutes;
  const popular = [...stats].sort((a, b) => b.rides - a.rides || b.seats - a.seats || byMinutes(a, b));
  const snowiest = [...stats].sort((a, b) => (b.snow ?? 0) - (a.snow ?? 0) || byMinutes(a, b));
  const quickest = [...stats].sort(byMinutes);
  const sorted =
    sort === 'shortest'
      ? [...stats].sort((a, b) => a.resort.roundTripMiles - b.resort.roundTripMiles)
      : sort === 'soonest'
        ? [...stats].sort((a, b) => (a.next && b.next ? a.next.departAt.localeCompare(b.next.departAt) : a.next ? -1 : b.next ? 1 : byMinutes(a, b)))
        : popular;

  const dayWord = day === 'all' ? 'coming up' : dayLabel(day).toLowerCase();
  const ridesMetric = (s: Stat) => ({ value: `${s.rides}`, sub: s.rides ? `${s.seats} seat${s.seats === 1 ? '' : 's'} open` : 'rides so far' });
  const snowMetric = (s: Stat) => ({ value: s.snow == null ? '–' : `${s.snow}"`, sub: day === 'all' ? 'new snow, next 7 days' : `new snow ${dayWord}` });
  const driveMetric = (s: Stat) => ({ value: driveText(s.minutes), sub: drive.live ? 'drive with traffic' : 'typical from Boulder' });
  const sortMetric =
    sort === 'shortest'
      ? (s: Stat) => ({ value: `${Math.round(s.resort.roundTripMiles / 2)} mi`, sub: 'one way from Boulder' })
      : sort === 'soonest'
        ? (s: Stat) => (s.next ? { value: clock(s.next.departAt), sub: dayLabel(isoDay(new Date(s.next.departAt))) } : { value: '–', sub: 'no rides yet' })
        : ridesMetric;
  const sortInfo = SORTS.find((s) => s.id === sort)!;
  const passLabel = PASS_FILTERS.find((f) => f.id === pass)?.label ?? 'Any pass';
  const dayRides = stats.reduce((n, s) => n + s.rides, 0);

  return (
    <View style={{ gap: 18 }}>
      {/* Search (with sort), calendar, pass */}
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <View
          style={{
            flex: 1,
            height: 48,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingLeft: 14,
            paddingRight: 6,
            borderRadius: 14,
            borderWidth: 1.5,
            borderColor: t.line,
            backgroundColor: t.surface,
          }}
        >
          <SearchIcon color={t.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search mountains"
            placeholderTextColor={t.muted}
            accessibilityLabel="Search mountains"
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            style={[{ flex: 1, minWidth: 0, color: t.ink, fontSize: 16, paddingVertical: 10 }, Platform.OS === 'web' && ({ outlineStyle: 'none' } as object)]}
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={8} style={{ paddingHorizontal: 4 }}>
              <Text style={{ color: t.muted, fontSize: 18, fontWeight: '700' }}>×</Text>
            </Pressable>
          ) : null}
          <OptionPicker
            label="Sort"
            title="Sort mountains"
            value={sort}
            onChange={setSort}
            options={SORTS}
            trigger={(open) => (
              <Pressable
                onPress={open}
                accessibilityRole="button"
                accessibilityLabel={sort === 'none' ? 'Sort mountains' : `Sort: ${sortInfo.label}`}
                style={({ pressed }) => ({
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: sort !== 'none' ? t.ink : t.chip,
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <FilterIcon color={sort !== 'none' ? t.surface : t.ink} />
              </Pressable>
            )}
          />
        </View>
        <DayPicker
          label="When are you going up?"
          value={day}
          onChange={setDay}
          allowAll
          minDay={minDay}
          maxDay={maxDay}
          counts={dayCounts}
          trigger={(open, shown) => (
            <IconButton label={`Day: ${shown}. Change day`} active={day !== 'all'} onPress={open}>
              {(c, bg) => <CalendarIcon color={c} cutout={bg} />}
            </IconButton>
          )}
        />
        <OptionPicker
          label="Pass"
          title="Which pass do you have?"
          value={pass}
          onChange={setPass}
          options={PASS_FILTERS}
          footer="Saved on this device. Day limits and blackouts depend on your pass tier."
          trigger={(open) => (
            <IconButton label={`Ski pass: ${passLabel}`} active={pass !== 'any'} onPress={open}>
              {(c, bg) => <PassIcon color={c} cutout={bg} />}
            </IconButton>
          )}
        />
      </View>

      {/* What's applied */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: -8, alignItems: 'center' }}>
        {[day === 'all' ? 'Any day' : longDay(day), passLabel, ...(sort !== 'none' ? [`Sorted: ${sortInfo.label.toLowerCase()}`] : [])].map((label) => (
          <View key={label} style={{ backgroundColor: t.chip, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text style={{ color: t.ink, fontSize: 12, fontWeight: '700' }}>{label}</Text>
          </View>
        ))}
        <Text style={{ color: t.muted, fontSize: 12, marginLeft: 2 }}>
          {dayRides} ride{dayRides === 1 ? '' : 's'}
        </Text>
      </View>

      {children}

      {stats.length === 0 ? (
        <View style={{ borderWidth: 2, borderStyle: 'dashed', borderColor: t.line, borderRadius: 16, padding: 24, alignItems: 'center', gap: 8 }}>
          <Text style={{ color: t.ink, fontSize: 18, fontWeight: '900' }}>No mountains match</Text>
          <Text style={{ color: t.muted, textAlign: 'center' }}>
            {q ? `Nothing called "${query.trim()}"` : 'No mountains'}
            {pass !== 'any' ? ` for ${passLabel}` : ''}. Try another search{pass !== 'any' ? ' or pass' : ''}.
          </Text>
        </View>
      ) : (
        <>
          {sort !== 'none' ? <Rail title={sortInfo.label} note={sortInfo.hint ?? ''} stats={sorted} metric={sortMetric} onOpen={onOpen} /> : null}
          <Rail title="Most popular" note={`most rides ${dayWord}`} stats={popular} metric={ridesMetric} onOpen={onOpen} />
          <Rail title="Most snow" note={day === 'all' ? 'next 7 days' : `forecast ${dayWord}`} stats={snowiest} metric={snowMetric} onOpen={onOpen} />
          <Rail title="Least traffic" note={drive.live ? 'live drive time from you' : 'typical drive from Boulder'} stats={quickest} metric={driveMetric} onOpen={onOpen} />
        </>
      )}
    </View>
  );
}
