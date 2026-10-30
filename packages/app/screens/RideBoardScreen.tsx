import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { AppHeader } from '../components/AppHeader';
import { RideCard } from '../components/RideCard';
import { SetupModal } from '../components/SetupModal';
import { Button, Chip, ChipRow, Loading, Notice } from '../components/ui';
import { dayLabel, driveText, isoDay, longDay, nextDays } from '../lib/dates';
import { RESORT_BY_ID, RESORTS } from '../lib/resorts';
import { CARPOOL_DISCLAIMER } from '../lib/rules';
import { useTheme } from '../lib/theme';
import type { BoardRide, PendingReview } from '../lib/types';
import { useForecast } from '../lib/useForecast';
import { useApi, useAuth, useNav } from '../providers';

/** One mountain in the list: name, drive, snow, and how many rides and seats. */
function MountainRow({ name, sub, rides, seats, snow, onPress }: { name: string; sub: string; rides: number; seats: number; snow: number; onPress: () => void }) {
  const t = useTheme();
  const has = rides > 0;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${rides} ride${rides === 1 ? '' : 's'}, ${seats} open seat${seats === 1 ? '' : 's'}`}
      style={({ pressed }) => ({
        backgroundColor: t.surface,
        borderColor: t.line,
        borderWidth: 1,
        borderRadius: 14,
        padding: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        opacity: pressed ? 0.85 : has ? 1 : 0.75,
      })}
    >
      <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
        <Text style={{ color: t.ink, fontSize: 19, fontWeight: '900', textTransform: 'uppercase' }}>{name}</Text>
        <Text style={{ color: t.muted, fontSize: 13 }}>
          {sub}
          {snow >= 0.5 ? <Text style={{ color: t.snow, fontWeight: '700' }}>{`  ❄ ${snow}"`}</Text> : null}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        {has ? (
          <>
            <View style={{ backgroundColor: t.accent, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
              <Text style={{ color: t.accentInk, fontSize: 14, fontWeight: '900' }}>
                {rides} ride{rides === 1 ? '' : 's'}
              </Text>
            </View>
            <Text style={{ color: seats ? t.muted : t.danger, fontSize: 12, fontWeight: '700' }}>{seats ? `${seats} seat${seats === 1 ? '' : 's'} open` : 'All full'}</Text>
          </>
        ) : (
          <Text style={{ color: t.muted, fontSize: 13, fontWeight: '600' }}>No rides</Text>
        )}
      </View>
      <Text style={{ color: t.muted, fontSize: 22 }}>›</Text>
    </Pressable>
  );
}

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
  const [profileReady, setProfileReady] = useState(true);
  const [toReview, setToReview] = useState<PendingReview[]>([]);
  useEffect(() => {
    api.reviewsToWrite().then(setToReview).catch(() => {});
  }, [api]);
  const [setupOpen, setSetupOpen] = useState(false);
  useEffect(() => {
    if (!session) return;
    api.getProfile(session.userId).then((p) => setProfileReady(!!p?.profileComplete)).catch(() => {});
  }, [api, session]);
  // No mountain picked = the mountain list. A mountain = that mountain's rides.
  const resort = initialResort && RESORT_BY_ID[initialResort] ? initialResort : null;
  const [openOnly, setOpenOnly] = useState(false);
  const [showEmpty, setShowEmpty] = useState(false);

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
  const all = rides ?? [];
  const onDay = (r: BoardRide) => day === 'all' || isoDay(new Date(r.departAt)) === day;
  const isMine = (r: BoardRide) => r.driverId === me || (!!me && r.riderIds.includes(me));
  const busyDays = useMemo(() => new Set(all.filter(isMine).map((r) => r.rideDate)), [rides, me]);
  const seatsLeft = (rs: BoardRide[]) => rs.reduce((n, r) => n + Math.max(0, r.seatsTotal - r.seatsTaken), 0);

  // Mountain view
  const inResort = resort ? all.filter((r) => r.resortId === resort) : all;
  const shown = inResort.filter((r) => onDay(r) && (!openOnly || r.seatsTaken < r.seatsTotal || isMine(r)));

  // Mountain list: counts for the selected day
  const byResort = RESORTS.map((m) => {
    const rs = all.filter((r) => r.resortId === m.id && onDay(r));
    return { resort: m, rides: rs.length, seats: seatsLeft(rs) };
  });
  const withRides = byResort.filter((x) => x.rides > 0).sort((a, b) => a.resort.driveMinutes - b.resort.driveMinutes);
  const withoutRides = byResort.filter((x) => x.rides === 0);
  const myRides = all.filter((r) => isMine(r) && onDay(r));
  const dayRides = all.filter(onDay);

  // Snow for a mountain: that day's, or the biggest upcoming day when "All upcoming".
  const snowFor = (id: string) => {
    const f = forecast?.byResort[id];
    if (!f) return null;
    const today = isoDay(new Date());
    if (day !== 'all') return f.find((d) => d.date === day) ?? null;
    return f.filter((d) => d.date >= today).reduce<(typeof f)[number] | null>((best, d) => (!best || d.snowIn > best.snowIn ? d : best), null);
  };

  const openResort = (id: string) => nav.push('/', { resort: id, ...(day !== 'all' ? { day } : {}) });

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <AppHeader />
      <SetupModal visible={setupOpen} role="rider" profileReady={profileReady} onClose={() => setSetupOpen(false)} />
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
          {resort ? (
            <View style={{ gap: 6 }}>
              <Pressable onPress={() => nav.replace('/', day !== 'all' ? { day } : undefined)} accessibilityRole="button" style={{ alignSelf: 'flex-start', paddingVertical: 4 }}>
                <Text style={{ color: t.link, fontSize: 15, fontWeight: '700' }}>‹ All mountains</Text>
              </Pressable>
              <Text style={{ color: t.ink, fontSize: 30, fontWeight: '900', textTransform: 'uppercase' }}>{RESORT_BY_ID[resort].name}</Text>
              <Text style={{ color: t.muted, fontSize: 14 }}>
                {RESORT_BY_ID[resort].region} · {driveText(RESORT_BY_ID[resort].driveMinutes)} from Boulder
              </Text>
            </View>
          ) : (
            <Text style={{ color: t.ink, fontSize: 26, fontWeight: '900', textTransform: 'uppercase' }}>Where are you headed?</Text>
          )}

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

          <Text style={{ color: t.muted, fontSize: 12, lineHeight: 17 }}>
            Carpool apps aren't regulated by the state of Colorado. Drivers might not be background-checked, and vehicles and insurance
            aren't state-verified. Full notice at the bottom.
          </Text>

          {(resort ? [] : toReview).map((r) => {
            const driver = r.people.find((p) => p.role === 'driver');
            const others = r.people.filter((p) => p.role === 'passenger').length;
            const who = [driver ? driver.name.split(' ')[0] : null, others ? `${others} passenger${others > 1 ? 's' : ''}` : null].filter(Boolean).join(' and ');
            return (
              <Pressable
                key={r.rideId}
                onPress={() => nav.push('/review', { ride: r.rideId })}
                accessibilityRole="button"
                style={({ pressed }) => ({ backgroundColor: t.surface, borderColor: t.accent, borderWidth: 2, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, opacity: pressed ? 0.85 : 1 })}
              >
                <Text style={{ color: t.accent, fontSize: 26 }}>★</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.ink, fontSize: 16, fontWeight: '800' }}>How was {RESORT_BY_ID[r.resortId]?.name ?? 'your ride'}?</Text>
                  <Text style={{ color: t.muted, fontSize: 13 }}>Rate {who}. Takes 30 seconds.</Text>
                </View>
                <Text style={{ color: t.muted, fontSize: 20 }}>›</Text>
              </Pressable>
            );
          })}

          {message ? <Notice kind={message.kind}>{message.text}</Notice> : null}

          {loadError ? (
            <View style={{ gap: 10 }}>
              <Notice kind="error">{loadError}</Notice>
              <Button variant="ghost" title="Try again" onPress={load} />
            </View>
          ) : rides === null ? (
            <Loading label="Loading the ride board…" />
          ) : !resort ? (
            /* ---------------- Mountain list ---------------- */
            <View style={{ gap: 14 }}>
              {myRides.length ? (
                <View style={{ gap: 8 }}>
                  <Text style={{ color: t.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.8 }}>YOUR RIDES</Text>
                  {myRides.map((r) => {
                    const d = new Date(r.departAt);
                    return (
                      <Pressable
                        key={r.id}
                        onPress={() => openResort(r.resortId)}
                        accessibilityRole="button"
                        style={({ pressed }) => ({ backgroundColor: t.surface, borderColor: t.accent, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10, opacity: pressed ? 0.85 : 1 })}
                      >
                        <Text style={{ color: t.ink, fontSize: 15, fontWeight: '800', flex: 1 }}>
                          {RESORT_BY_ID[r.resortId]?.name}
                          <Text style={{ color: t.muted, fontWeight: '500' }}>{`  ${dayLabel(isoDay(d))} · ${r.driverId === me ? "you're driving" : 'you have a seat'}`}</Text>
                        </Text>
                        <Text style={{ color: t.muted, fontSize: 20 }}>›</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
                <Text style={{ color: t.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.8 }}>
                  {day === 'all' ? 'MOUNTAINS WITH RIDES' : `MOUNTAINS WITH RIDES ${dayLabel(day).toUpperCase()}`}
                </Text>
                <Text style={{ color: t.muted, fontSize: 13 }}>
                  {dayRides.length} ride{dayRides.length === 1 ? '' : 's'} · {seatsLeft(dayRides)} open seat{seatsLeft(dayRides) === 1 ? '' : 's'}
                </Text>
              </View>

              {withRides.length === 0 ? (
                <View style={{ borderWidth: 2, borderStyle: 'dashed', borderColor: t.line, borderRadius: 16, padding: 28, alignItems: 'center', gap: 10 }}>
                  <Text style={{ color: t.ink, fontSize: 22, fontWeight: '900', textTransform: 'uppercase' }}>{all.length ? 'No rides that day' : 'The board is empty'}</Text>
                  <Text style={{ color: t.muted, textAlign: 'center', maxWidth: 420, lineHeight: 21 }}>
                    {all.length ? 'Try another day, or post the ride yourself.' : "No one has posted a ride yet. If you're driving up, post your open seats and riders will reach out."}
                  </Text>
                  <Button title="+ Post a ride" onPress={() => nav.push('/post')} />
                </View>
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  {withRides.map((x) => (
                    <View key={x.resort.id} style={{ flexGrow: 1, flexBasis: 300, maxWidth: '100%' }}>
                      <MountainRow name={x.resort.name} sub={`${x.resort.region} · ${driveText(x.resort.driveMinutes)}`} rides={x.rides} seats={x.seats} snow={snowFor(x.resort.id)?.snowIn ?? 0} onPress={() => openResort(x.resort.id)} />
                    </View>
                  ))}
                </View>
              )}

              {withoutRides.length ? (
                <View style={{ gap: 10 }}>
                  <Pressable onPress={() => setShowEmpty((v) => !v)} accessibilityRole="button" style={{ alignSelf: 'flex-start', paddingVertical: 4 }}>
                    <Text style={{ color: t.link, fontSize: 14, fontWeight: '700' }}>
                      {showEmpty ? 'Hide' : 'Show'} {withoutRides.length} mountains with no rides yet
                    </Text>
                  </Pressable>
                  {showEmpty ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                      {withoutRides.map((x) => (
                        <View key={x.resort.id} style={{ flexGrow: 1, flexBasis: 300, maxWidth: '100%' }}>
                          <MountainRow name={x.resort.name} sub={`${x.resort.region} · ${driveText(x.resort.driveMinutes)}`} rides={0} seats={0} snow={snowFor(x.resort.id)?.snowIn ?? 0} onPress={() => openResort(x.resort.id)} />
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : (
            /* ---------------- One mountain's rides ---------------- */
            <View style={{ gap: 14 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <Text style={{ color: t.muted, fontSize: 13 }}>
                  {shown.length} ride{shown.length === 1 ? '' : 's'} · {seatsLeft(shown)} open seat{seatsLeft(shown) === 1 ? '' : 's'}
                  {day === 'all' ? '' : ` ${dayLabel(day).toLowerCase() === 'today' || dayLabel(day).toLowerCase() === 'tomorrow' ? dayLabel(day).toLowerCase() : `on ${longDay(day)}`}`}
                </Text>
                <Chip label="Open seats only" selected={openOnly} onPress={() => setOpenOnly((o) => !o)} />
              </View>

              {shown.length === 0 ? (
                <View style={{ borderWidth: 2, borderStyle: 'dashed', borderColor: t.line, borderRadius: 16, padding: 28, alignItems: 'center', gap: 10 }}>
                  <Text style={{ color: t.ink, fontSize: 22, fontWeight: '900', textTransform: 'uppercase' }}>No rides here yet</Text>
                  <Text style={{ color: t.muted, textAlign: 'center', maxWidth: 420, lineHeight: 21 }}>
                    {inResort.length ? 'Try another day, or post the ride yourself.' : `Nobody's posted a ride to ${RESORT_BY_ID[resort].name} yet. Driving up? Post your open seats.`}
                  </Text>
                  <Button title="+ Post a ride" onPress={() => nav.push('/post', { resort })} />
                </View>
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
                  {shown.map((r) => (
                    <View key={r.id} style={{ flexGrow: 1, flexBasis: 420, maxWidth: '100%' }}>
                      <RideCard ride={r} hideResort forecast={forecast} busyDays={busyDays} profileReady={profileReady} onNeedsSetup={() => setSetupOpen(true)} onChanged={load} onMessage={(text, kind = 'success') => setMessage({ text, kind })} />
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          <View style={{ borderTopWidth: 1, borderTopColor: t.line, paddingTop: 14, marginTop: 6, gap: 6 }}>
            <Text style={{ color: t.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.8 }}>COLORADO CARPOOL NOTICE</Text>
            <Text style={{ color: t.muted, fontSize: 13, lineHeight: 19 }}>{CARPOOL_DISCLAIMER}</Text>
            <Text style={{ color: t.muted, fontSize: 13, lineHeight: 19 }}>
              Lift2Lift follows Colorado's carpool app rules: gas money is capped at the driver's real cost, up to 6 riders per car, one
              ride per person per day, and seats are booked at least 2 hours ahead.
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
