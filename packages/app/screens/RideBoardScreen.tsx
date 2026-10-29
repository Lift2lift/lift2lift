import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { AppHeader } from '../components/AppHeader';
import { RideCard } from '../components/RideCard';
import { Button, Chip, ChipRow, Loading, Notice } from '../components/ui';
import { dayLabel, driveText, isoDay, longDay, nextDays } from '../lib/dates';
import { RESORT_BY_ID, RESORTS } from '../lib/resorts';
import { useTheme } from '../lib/theme';
import type { BoardRide } from '../lib/types';
import { useForecast } from '../lib/useForecast';
import { useApi, useAuth, useNav } from '../providers';

export function RideBoardScreen({ initialResort, initialDay }: { initialResort?: string; initialDay?: string }) {
  const t = useTheme();
  const api = useApi();
  const nav = useNav();
  const { session } = useAuth();
  const { forecast } = useForecast();
  const [rides, setRides] = useState<BoardRide[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<{ text: string; kind: 'error' | 'success' } | null>(null);
  const [day, setDay] = useState(initialDay || 'all');
  const [resort, setResort] = useState(initialResort && RESORT_BY_ID[initialResort] ? initialResort : 'all');
  const [openOnly, setOpenOnly] = useState(false);

  const load = useCallback(async () => {
    try {
      setRides(await api.listRides());
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(id);
  }, [message]);

  const me = session?.userId;
  const days = useMemo(() => nextDays(8), []);
  const inResort = (rides ?? []).filter((r) => resort === 'all' || r.resortId === resort);
  const shown = inResort.filter(
    (r) =>
      (day === 'all' || isoDay(new Date(r.departAt)) === day) &&
      (!openOnly || r.seatsTaken < r.seatsTotal || r.driverId === me || (!!me && r.riderIds.includes(me))),
  );
  const resortsWithRides = RESORTS.filter((r) => (rides ?? []).some((x) => x.resortId === r.id));
  const openSeats = shown.reduce((n, r) => n + Math.max(0, r.seatsTotal - r.seatsTaken), 0);

  const heading = `${day === 'all' ? 'Upcoming rides' : `Rides ${longDay(day)}`}${resort === 'all' ? '' : ` to ${RESORT_BY_ID[resort].name}`}`;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <AppHeader />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 18, paddingBottom: 60 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        <View style={{ width: '100%', maxWidth: 960, alignSelf: 'center', gap: 14 }}>
          <ChipRow>
            <Chip label="All upcoming" selected={day === 'all'} onPress={() => setDay('all')} count={inResort.length} />
            {days.map((d) => (
              <Chip
                key={d}
                label={dayLabel(d)}
                selected={day === d}
                onPress={() => setDay(d)}
                count={inResort.filter((r) => isoDay(new Date(r.departAt)) === d).length}
              />
            ))}
          </ChipRow>

          <ChipRow>
            <Chip label="Open seats only" selected={openOnly} onPress={() => setOpenOnly((o) => !o)} />
            <Chip label="All mountains" selected={resort === 'all'} onPress={() => setResort('all')} />
            {resortsWithRides.map((r) => (
              <Chip key={r.id} label={`${r.name} · ${driveText(r.driveMinutes)}`} selected={resort === r.id} onPress={() => setResort(r.id)} />
            ))}
          </ChipRow>

          {message ? <Notice kind={message.kind}>{message.text}</Notice> : null}

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
            <Text style={{ color: t.ink, fontSize: 24, fontWeight: '900', textTransform: 'uppercase' }}>{heading}</Text>
            {shown.length ? (
              <Text style={{ color: t.muted, fontSize: 13 }}>
                {shown.length} ride{shown.length > 1 ? 's' : ''} · {openSeats} open seat{openSeats === 1 ? '' : 's'}
              </Text>
            ) : null}
          </View>

          {loadError ? (
            <View style={{ gap: 10 }}>
              <Notice kind="error">{loadError}</Notice>
              <Button variant="ghost" title="Try again" onPress={load} />
            </View>
          ) : rides === null ? (
            <Loading label="Loading the ride board…" />
          ) : shown.length === 0 ? (
            <View style={{ borderWidth: 2, borderStyle: 'dashed', borderColor: t.line, borderRadius: 16, padding: 28, alignItems: 'center', gap: 10 }}>
              <Text style={{ color: t.ink, fontSize: 22, fontWeight: '900', textTransform: 'uppercase' }}>
                {rides.length ? 'No rides here yet' : 'The board is empty'}
              </Text>
              <Text style={{ color: t.muted, textAlign: 'center', maxWidth: 420, lineHeight: 21 }}>
                {rides.length
                  ? 'Nothing matches those filters. Try another day or mountain, or post the ride yourself.'
                  : "No one has posted a ride yet. If you're driving up, post your open seats and riders will reach out."}
              </Text>
              <Button title="+ Post a ride" onPress={() => nav.push('/post', resort !== 'all' ? { resort } : undefined)} />
            </View>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
              {shown.map((r) => (
                <View key={r.id} style={{ flexGrow: 1, flexBasis: 420, maxWidth: '100%' }}>
                  <RideCard ride={r} forecast={forecast} onChanged={load} onMessage={(text, kind = 'success') => setMessage({ text, kind })} />
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
