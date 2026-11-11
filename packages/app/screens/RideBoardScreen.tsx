import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { AppHeader } from '../components/AppHeader';
import { TabBar } from '../components/TabBar';
import { RideCard } from '../components/RideCard';
import { SetupModal } from '../components/SetupModal';
import { DayPicker, OptionPicker } from '../components/Pickers';
import { Button, Chip, Loading, Notice } from '../components/ui';
import { addDays, clock, dayLabel, driveText, isoDay, longDay } from '../lib/dates';
import { isPassFilter, PASS_FILTERS, PASS_LABEL, PASS_NOTES, PASS_SEASON, passesFor, passMatches, type PassFilter } from '../lib/passes';
import { RESORT_BY_ID, RESORTS } from '../lib/resorts';
import { CARPOOL_DISCLAIMER } from '../lib/rules';
import { useTheme } from '../lib/theme';
import { seatLegs, seatsOpen, tripLegs } from '../lib/trips';
import type { BoardRide, Leg, PendingReview } from '../lib/types';
import { useForecast } from '../lib/useForecast';
import { useApi, useAuth, useNav } from '../providers';

/** One mountain in the list: name, drive, snow, and how many rides and seats. */
function MountainRow({ name, sub, rides, seats, snow, next, passes, onPress }: { name: string; sub: string; rides: number; seats: number; snow: number; next?: string; passes: string[]; onPress: () => void }) {
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Text style={{ color: t.ink, fontSize: 19, fontWeight: '900', textTransform: 'uppercase' }}>{name}</Text>
          {passes.map((p) => (
            <PassTag key={p} label={p} />
          ))}
        </View>
        <Text style={{ color: t.muted, fontSize: 13 }}>
          {sub}
          {snow >= 0.5 ? <Text style={{ color: t.snow, fontWeight: '700' }}>{`  ❄ ${snow}"`}</Text> : null}
        </Text>
        {next ? <Text style={{ color: t.ink, fontSize: 13, fontWeight: '600' }}>Next ride: {next}</Text> : null}
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

/** Small outlined tag with a pass name. */
function PassTag({ label }: { label: string }) {
  const t = useTheme();
  return (
    <View style={{ borderWidth: 1, borderColor: t.muted, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1 }}>
      <Text style={{ color: t.muted, fontSize: 10, fontWeight: '800', letterSpacing: 0.6 }}>{label.toUpperCase()}</Text>
    </View>
  );
}

export function RideBoardScreen({
  initialResort,
  initialDay,
  initialLeg,
  initialPass,
}: {
  initialResort?: string;
  initialDay?: string;
  initialLeg?: string;
  /** Ski pass filter: ikon, epic, indy, mc or none. */
  initialPass?: string;
}) {
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
  // Looking for just the ride up or the ride down (e.g. after booking one way).
  const [legFilter, setLegFilter] = useState<Leg | null>(initialLeg === 'to' || initialLeg === 'from' ? initialLeg : null);
  const [showEmpty, setShowEmpty] = useState(false);
  const [sort, setSort] = useState<RideSort>('soonest');
  const [pass, setPass] = useState<PassFilter>(isPassFilter(initialPass) ? initialPass : 'any');
  const [mountainSort, setMountainSort] = useState<MountainSort>('drive');
  // Long lists load in pages so a busy weekend stays quick to scroll.
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [day, sort, legFilter, openOnly, resort]);
  const [friendIds, setFriendIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    api.myFriends().then((f) => setFriendIds(new Set(f.friends.map((p) => p.id)))).catch(() => {});
  }, [api]);

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
  const all = rides ?? [];
  const today = isoDay(new Date());
  const lastDay = all.reduce((m, r) => (r.rideDate > m ? r.rideDate : m), isoDay(addDays(new Date(), 30)));
  const onDay = (r: BoardRide) => day === 'all' || isoDay(new Date(r.departAt)) === day;
  const isMine = (r: BoardRide) => r.driverId === me || (!!me && r.riderIds.includes(me));
  // Legs already covered each day. Driving takes the whole day; a seat takes the legs it covers.
  const busyDays = useMemo(() => {
    const m = new Map<string, Set<Leg>>();
    for (const r of all) {
      if (!me) continue;
      let legs: Leg[] = [];
      if (r.driverId === me) legs = ['to', 'from'];
      else if (r.riderIds.includes(me)) legs = seatLegs(r.tripType, r.riderLegs[r.riderIds.indexOf(me)] ?? 'both');
      if (!legs.length) continue;
      const set = m.get(r.rideDate) ?? new Set<Leg>();
      legs.forEach((l) => set.add(l));
      m.set(r.rideDate, set);
    }
    return m;
  }, [rides, me]);
  const seatsLeft = (rs: BoardRide[]) => rs.reduce((n, r) => n + Math.max(0, r.seatsTotal - r.seatsTaken), 0);

  // Mountain view
  const inResort = resort ? all.filter((r) => r.resortId === resort) : all;
  const dayCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of inResort) {
      if (!resort && !passMatches(r.resortId, pass)) continue;
      const d = isoDay(new Date(r.departAt));
      c[d] = (c[d] ?? 0) + 1;
    }
    return c;
  }, [rides, resort, pass]);
  const shown = sortRides(
    inResort.filter(
      (r) =>
        onDay(r) &&
        (!legFilter || tripLegs(r.tripType).includes(legFilter)) &&
        (!openOnly || isMine(r) || (legFilter ? seatsOpen(r, legFilter) > 0 : r.seatsTaken < r.seatsTotal)),
    ),
    sort,
  );
  const page = shown.slice(0, limit);
  // Day headings when the list spans several days and runs in time order.
  const grouped = day === 'all' && (sort === 'soonest' || sort === 'latest');

  // Mountain list: counts for the selected day
  const byResort = RESORTS.filter((m) => passMatches(m.id, pass)).map((m) => {
    const rs = all.filter((r) => r.resortId === m.id && onDay(r));
    return { resort: m, rides: rs.length, seats: seatsLeft(rs) };
  });
  const nextFor = (id: string) => all.filter((r) => r.resortId === id && onDay(r) && new Date(r.departAt).getTime() > Date.now()).reduce<BoardRide | null>((a, r) => (!a || r.departAt < a.departAt ? r : a), null);
  const withRides = byResort
    .filter((x) => x.rides > 0)
    .map((x) => ({ ...x, next: nextFor(x.resort.id) }))
    .sort((a, b) =>
      mountainSort === 'next'
        ? (a.next?.departAt ?? '9').localeCompare(b.next?.departAt ?? '9')
        : mountainSort === 'rides'
          ? b.rides - a.rides || a.resort.driveMinutes - b.resort.driveMinutes
          : a.resort.driveMinutes - b.resort.driveMinutes,
    );
  const withoutRides = byResort.filter((x) => x.rides === 0);
  const myRides = all.filter((r) => isMine(r) && onDay(r));
  const dayRides = all.filter((r) => onDay(r) && passMatches(r.resortId, pass));

  // Snow for a mountain: that day's, or the biggest upcoming day when "All upcoming".
  const snowFor = (id: string) => {
    const f = forecast?.byResort[id];
    if (!f) return null;
    const today = isoDay(new Date());
    if (day !== 'all') return f.find((d) => d.date === day) ?? null;
    return f.filter((d) => d.date >= today).reduce<(typeof f)[number] | null>((best, d) => (!best || d.snowIn > best.snowIn ? d : best), null);
  };

  const keep = () => ({ ...(day !== 'all' ? { day } : {}), ...(pass !== 'any' ? { pass } : {}) });
  const openResort = (id: string) => nav.push('/', { resort: id, ...keep() });

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
              <Pressable onPress={() => nav.replace('/', keep())} accessibilityRole="button" style={{ alignSelf: 'flex-start', paddingVertical: 4 }}>
                <Text style={{ color: t.link, fontSize: 15, fontWeight: '700' }}>‹ All mountains</Text>
              </Pressable>
              <Text style={{ color: t.ink, fontSize: 30, fontWeight: '900', textTransform: 'uppercase' }}>{RESORT_BY_ID[resort].name}</Text>
              <Text style={{ color: t.muted, fontSize: 14 }}>
                {RESORT_BY_ID[resort].region} · {driveText(RESORT_BY_ID[resort].driveMinutes)} from Boulder
              </Text>
              <Text style={{ color: t.ink, fontSize: 14, fontWeight: '700' }}>
                {passesFor(resort).length
                  ? `On ${passesFor(resort).map((p) => PASS_LABEL[p]).join(' and ')} for ${PASS_SEASON}`
                  : `Not on Ikon, Epic, Indy or Mountain Collective for ${PASS_SEASON}`}
                {PASS_NOTES[resort] ? <Text style={{ color: t.muted, fontWeight: '400' }}>{`. ${PASS_NOTES[resort]}`}</Text> : null}
              </Text>
            </View>
          ) : (
            <Text style={{ color: t.ink, fontSize: 26, fontWeight: '900', textTransform: 'uppercase' }}>Where are you headed?</Text>
          )}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <DayPicker value={day} onChange={setDay} allowAll minDay={today} maxDay={lastDay} counts={dayCounts} label="Day" />
            {resort ? (
              <OptionPicker label="Sort" title="Sort rides" value={sort} onChange={setSort} options={RIDE_SORTS} />
            ) : (
              <>
                <OptionPicker label="Pass" title={`Your ski pass (${PASS_SEASON})`} value={pass} onChange={setPass} options={PASS_FILTERS} />
                <OptionPicker label="Sort" title="Sort mountains" value={mountainSort} onChange={setMountainSort} options={MOUNTAIN_SORTS} />
              </>
            )}
          </View>

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
                  {myRides.slice(0, 3).map((r) => {
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
                  {myRides.length > 3 ? (
                    <Pressable onPress={() => nav.replace('/rides')} accessibilityRole="link" style={{ alignSelf: 'flex-start', paddingVertical: 2 }}>
                      <Text style={{ color: t.link, fontSize: 14, fontWeight: '700' }}>See all {myRides.length} in Your Rides</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
                <Text style={{ color: t.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.8 }}>
                  {`${pass === 'any' ? '' : pass === 'none' ? 'INDEPENDENT ' : `${PASS_LABEL[pass].toUpperCase()} `}MOUNTAINS WITH RIDES${day === 'all' ? '' : ` ${dayLabel(day).toUpperCase()}`}`}
                </Text>
                <Text style={{ color: t.muted, fontSize: 13 }}>
                  {dayRides.length} ride{dayRides.length === 1 ? '' : 's'} · {seatsLeft(dayRides)} open seat{seatsLeft(dayRides) === 1 ? '' : 's'}
                </Text>
              </View>

              {withRides.length === 0 ? (
                <View style={{ borderWidth: 2, borderStyle: 'dashed', borderColor: t.line, borderRadius: 16, padding: 28, alignItems: 'center', gap: 10 }}>
                  <Text style={{ color: t.ink, fontSize: 22, fontWeight: '900', textTransform: 'uppercase' }}>{!all.length ? 'The board is empty' : pass !== 'any' ? 'No rides on your pass' : 'No rides that day'}</Text>
                  <Text style={{ color: t.muted, textAlign: 'center', maxWidth: 420, lineHeight: 21 }}>
                    {all.length && pass !== 'any'
                      ? `Nothing to ${pass === 'none' ? 'mountains off the big passes' : `${PASS_LABEL[pass]} mountains`}${day === 'all' ? ' yet' : ' that day'}. Try another day or Any pass, or post the ride yourself.`
                      : all.length ? 'Try another day, or post the ride yourself.' : "No one has posted a ride yet. If you're driving up, post your open seats and riders will reach out."}
                  </Text>
                  <Button title="+ Post a ride" onPress={() => nav.push('/post')} />
                </View>
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  {withRides.map((x) => (
                    <View key={x.resort.id} style={{ flexGrow: 1, flexBasis: 300, maxWidth: '100%' }}>
                      <MountainRow
                        name={x.resort.name}
                        passes={passesFor(x.resort.id).map((p) => PASS_LABEL[p])}
                        sub={`${x.resort.region} · ${driveText(x.resort.driveMinutes)}`}
                        rides={x.rides}
                        seats={x.seats}
                        snow={snowFor(x.resort.id)?.snowIn ?? 0}
                        next={x.next ? `${day === 'all' ? `${dayLabel(isoDay(new Date(x.next.departAt)))}, ` : ''}${clock(x.next.departAt)}` : undefined}
                        onPress={() => openResort(x.resort.id)}
                      />
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
                          <MountainRow name={x.resort.name} passes={passesFor(x.resort.id).map((p) => PASS_LABEL[p])} sub={`${x.resort.region} · ${driveText(x.resort.driveMinutes)}`} rides={0} seats={0} snow={snowFor(x.resort.id)?.snowIn ?? 0} onPress={() => openResort(x.resort.id)} />
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
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                  <Chip label="↑ Rides up" selected={legFilter === 'to'} onPress={() => setLegFilter((l) => (l === 'to' ? null : 'to'))} />
                  <Chip label="↓ Rides down" selected={legFilter === 'from'} onPress={() => setLegFilter((l) => (l === 'from' ? null : 'from'))} />
                  <Chip label="Open seats only" selected={openOnly} onPress={() => setOpenOnly((o) => !o)} />
                </View>
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
                <View style={{ gap: 14 }}>
                  {page.map((r, i) => {
                    const d = isoDay(new Date(r.departAt));
                    const heading = grouped && (i === 0 || isoDay(new Date(page[i - 1].departAt)) !== d);
                    return (
                      <View key={r.id} style={{ gap: 10 }}>
                        {heading ? (
                          <Text style={{ color: t.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.8, marginTop: i === 0 ? 0 : 6 }}>
                            {`${dayLabel(d) === 'Today' || dayLabel(d) === 'Tomorrow' ? `${dayLabel(d)} · ` : ''}${longDay(d)}`.toUpperCase()} · {dayCounts[d] ?? 0} RIDE{(dayCounts[d] ?? 0) === 1 ? '' : 'S'}
                          </Text>
                        ) : null}
                        <RideCard ride={r} hideResort forecast={forecast} busyDays={busyDays} friendIds={friendIds} profileReady={profileReady} onNeedsSetup={() => setSetupOpen(true)} onChanged={load} onMessage={(text, kind = 'success') => setMessage({ text, kind })} />
                      </View>
                    );
                  })}
                  {shown.length > page.length ? (
                    <View style={{ alignItems: 'center', gap: 6 }}>
                      <Text style={{ color: t.muted, fontSize: 13 }}>
                        Showing {page.length} of {shown.length} rides
                      </Text>
                      <Button variant="ghost" title={`Show ${Math.min(PAGE, shown.length - page.length)} more`} onPress={() => setLimit((n) => n + PAGE)} />
                    </View>
                  ) : null}
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
      <TabBar />
    </View>
  );
}

const PAGE = 20;

type RideSort = 'soonest' | 'latest' | 'seats' | 'gas';
type MountainSort = 'drive' | 'next' | 'rides';

const RIDE_SORTS: { id: RideSort; label: string; hint?: string }[] = [
  { id: 'soonest', label: 'Departure time', hint: 'Earliest first' },
  { id: 'latest', label: 'Departure time, latest first' },
  { id: 'seats', label: 'Most open seats' },
  { id: 'gas', label: 'Lowest gas money' },
];

const MOUNTAIN_SORTS: { id: MountainSort; label: string; hint?: string }[] = [
  { id: 'drive', label: 'Shortest drive', hint: 'From Boulder' },
  { id: 'next', label: 'Next departure', hint: 'The mountain with the soonest ride first' },
  { id: 'rides', label: 'Most rides' },
];

function sortRides(rides: BoardRide[], sort: RideSort) {
  const open = (r: BoardRide) => r.seatsTotal - r.seatsTaken;
  const byTime = (a: BoardRide, b: BoardRide) => a.departAt.localeCompare(b.departAt);
  const list = [...rides];
  if (sort === 'latest') return list.sort((a, b) => byTime(b, a));
  if (sort === 'seats') return list.sort((a, b) => open(b) - open(a) || byTime(a, b));
  if (sort === 'gas') return list.sort((a, b) => a.gasPerRider - b.gasPerRider || byTime(a, b));
  return list.sort(byTime);
}
