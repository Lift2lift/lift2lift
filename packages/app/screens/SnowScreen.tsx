import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { AppHeader } from '../components/AppHeader';
import { Card, Chip, Loading, Notice } from '../components/ui';
import { DOW, driveText, isoDay, longDay, parseDay } from '../lib/dates';
import { RESORTS } from '../lib/resorts';
import { mix, useTheme } from '../lib/theme';
import { useForecast } from '../lib/useForecast';
import { useNav } from '../providers';

const NAME_COL = 160;
const DAY_COL = 70;

export function SnowScreen() {
  const t = useTheme();
  const nav = useNav();
  const { forecast, error } = useForecast();
  const [sort, setSort] = useState<'drive' | 'snow'>('drive');
  const today = isoDay(new Date());

  const days = useMemo(() => (forecast?.days ?? []).filter((d) => d >= today), [forecast, today]);
  const totals = useMemo(() => {
    const out: Record<string, number> = {};
    for (const r of RESORTS) {
      out[r.id] = (forecast?.byResort[r.id] ?? []).filter((d) => d.date >= today).reduce((n, d) => n + d.snowIn, 0);
    }
    return out;
  }, [forecast, today]);

  const rows = [...RESORTS].sort((a, b) =>
    sort === 'snow' ? totals[b.id] - totals[a.id] || a.driveMinutes - b.driveMinutes : a.driveMinutes - b.driveMinutes,
  );

  // Biggest single-day totals this week, one per mountain.
  const picks = useMemo(() => {
    const all: { id: string; name: string; drive: number; date: string; snowIn: number; hi: number; lo: number }[] = [];
    for (const r of RESORTS)
      for (const d of forecast?.byResort[r.id] ?? [])
        if (d.date >= today && d.snowIn > 0) all.push({ id: r.id, name: r.name, drive: r.driveMinutes, ...d });
    all.sort((a, b) => b.snowIn - a.snowIn || a.drive - b.drive);
    const seen = new Set<string>();
    return all.filter((p) => !seen.has(p.id) && seen.add(p.id)).slice(0, 4);
  }, [forecast, today]);

  const cellColor = (inches: number) => (inches <= 0 ? 'transparent' : mix(t.surface, t.snow, Math.min(0.95, 0.18 + inches / 10)));

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <AppHeader />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 18, paddingBottom: 60 }}>
        <View style={{ width: '100%', maxWidth: 960, alignSelf: 'center', gap: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
            <Text style={{ color: t.ink, fontSize: 24, fontWeight: '900', textTransform: 'uppercase' }}>Where it's snowing</Text>
            {forecast ? (
              <Text style={{ color: t.muted, fontSize: 13 }}>
                7-day forecast · updated {new Date(forecast.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </Text>
            ) : null}
          </View>

          {error ? <Notice kind="error">{error}</Notice> : null}
          {!forecast && !error ? <Loading label="Loading forecasts for 26 mountains…" /> : null}

          {forecast ? (
            <>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                {picks.length === 0 ? (
                  <Notice kind="info">No new snow in the forecast this week. Time to wax.</Notice>
                ) : (
                  picks.map((p) => (
                    <Pressable
                      key={p.id}
                      onPress={() => nav.replace('/', { resort: p.id, day: p.date })}
                      style={{ flexGrow: 1, flexBasis: 200 }}
                      accessibilityRole="button"
                      accessibilityLabel={`${p.name}, ${p.snowIn} inches on ${longDay(p.date)}. See rides.`}
                    >
                      <Card style={{ padding: 14, gap: 2 }}>
                        <Text style={{ color: t.snow, fontSize: 40, fontWeight: '900' }}>
                          {p.snowIn}
                          <Text style={{ fontSize: 18 }}>"</Text>
                        </Text>
                        <Text style={{ color: t.ink, fontSize: 16, fontWeight: '800' }}>{p.name}</Text>
                        <Text style={{ color: t.muted, fontSize: 12 }}>
                          {longDay(p.date)} · {p.hi}°/{p.lo}° · {driveText(p.drive)} away
                        </Text>
                      </Card>
                    </Pressable>
                  ))
                )}
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <Text style={{ color: t.muted, fontSize: 13 }}>Sort by</Text>
                <Chip label="Drive from Boulder" selected={sort === 'drive'} onPress={() => setSort('drive')} />
                <Chip label="Most snow this week" selected={sort === 'snow'} onPress={() => setSort('snow')} />
              </View>

              <Card style={{ overflow: 'hidden' }}>
                <ScrollView horizontal contentContainerStyle={{ minWidth: '100%' }}>
                  <View style={{ flexGrow: 1 }}>
                    <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: t.line }}>
                      <Text style={{ width: NAME_COL, padding: 10, color: t.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 }}>MOUNTAIN</Text>
                      {days.map((d) => {
                        const dt = parseDay(d);
                        const weekend = dt.getDay() === 0 || dt.getDay() === 6;
                        return (
                          <Text
                            key={d}
                            style={{ flexGrow: 1, flexBasis: DAY_COL, minWidth: DAY_COL, padding: 10, textAlign: 'center', color: weekend ? t.ink : t.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 }}
                          >
                            {d === today ? 'TODAY' : `${DOW[dt.getDay()].toUpperCase()} ${dt.getDate()}`}
                          </Text>
                        );
                      })}
                      <Text style={{ flexGrow: 1, flexBasis: DAY_COL, minWidth: DAY_COL, padding: 10, textAlign: 'center', color: t.ink, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 }}>
                        WEEK
                      </Text>
                    </View>
                    {rows.map((r, i) => (
                      <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: i === rows.length - 1 ? 0 : 1, borderBottomColor: t.line }}>
                        <Pressable onPress={() => nav.replace('/', { resort: r.id })} style={{ width: NAME_COL, paddingHorizontal: 10, paddingVertical: 8 }} accessibilityRole="link">
                          <Text style={{ color: t.ink, fontSize: 14, fontWeight: '700' }}>{r.name}</Text>
                          <Text style={{ color: t.muted, fontSize: 11 }}>
                            {driveText(r.driveMinutes)} · {r.region}
                          </Text>
                        </Pressable>
                        {days.map((d) => {
                          const wx = forecast.byResort[r.id]?.find((x) => x.date === d);
                          const deep = (wx?.snowIn ?? 0) >= 5;
                          return (
                            <View key={d} style={{ flexGrow: 1, flexBasis: DAY_COL, minWidth: DAY_COL, padding: 3 }}>
                              <View style={{ backgroundColor: cellColor(wx?.snowIn ?? 0), borderRadius: 8, paddingVertical: 6, alignItems: 'center', minHeight: 46, justifyContent: 'center' }}>
                                <Text style={{ color: deep ? '#FFFFFF' : t.ink, fontSize: 13, fontWeight: '800' }}>
                                  {wx ? (wx.snowIn > 0 ? `${wx.snowIn}"` : '–') : ''}
                                </Text>
                                <Text style={{ color: deep ? '#FFFFFF' : t.muted, fontSize: 10.5 }}>{wx ? `${wx.hi}°/${wx.lo}°` : ''}</Text>
                              </View>
                            </View>
                          );
                        })}
                        <Text style={{ flexGrow: 1, flexBasis: DAY_COL, minWidth: DAY_COL, textAlign: 'center', color: t.ink, fontSize: 14, fontWeight: '900' }}>
                          {totals[r.id] > 0 ? `${Math.round(totals[r.id] * 10) / 10}"` : '–'}
                        </Text>
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </Card>
              <Text style={{ color: t.muted, fontSize: 12 }}>
                New snow in inches and high / low °F at each base area, from Open-Meteo. Tap a mountain to see rides there.
              </Text>
            </>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}
