import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { AppHeader } from '../components/AppHeader';
import { Avatar } from '../components/Avatar';
import { PersonAvatar, WhosInTheCar } from '../components/People';
import { ReportSheet } from '../components/Safety';
import { RatingBadge } from '../components/Stars';
import { Button, Card, FormScreen, Heading, Loading, Muted, Notice } from '../components/ui';
import { clock, dayLabel, isoDay, longDay } from '../lib/dates';
import { RESORT_BY_ID } from '../lib/resorts';
import { useTheme } from '../lib/theme';
import {
  CONFIRM_BEFORE_MIN,
  countdown,
  legAt,
  LOCK_BEFORE_MIN,
  myPendingRequests,
  passengersOn,
  requestsWaiting,
  seatAsk,
  seatLegs,
  TRIP_LABEL,
  upcomingLegs,
  useNow,
  type LegEvent,
} from '../lib/trips';
import type { ChatMessage, Leg, SeatLegs, SeatRequest, Trip } from '../lib/types';
import { useApi, useAuth, useMyRides, useNav } from '../providers';

const legTitle = (leg: Leg, resortId: string) => `${leg === 'to' ? 'Up to' : 'Back from'} ${RESORT_BY_ID[resortId]?.name ?? resortId}`;

/** Your Rides tab: the list, or one ride's day-of view (countdown, check-in, chat). */
export function YourRidesScreen({ rideId, leg, saved }: { rideId?: string; leg?: Leg; saved?: string }) {
  const { trips, locked, refresh } = useMyRides();
  const { session } = useAuth();
  const now = useNow(1000);
  // Fresh on open, so a driver's answer (or a new request) shows right away.
  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!trips || !session) {
    return (
      <FormScreen header={<AppHeader />}>
        <Loading label="Loading your rides…" />
      </FormScreen>
    );
  }

  const legs = upcomingLegs(trips, now);
  const target = locked ?? (rideId ? legs.find((e) => e.trip.id === rideId && (!leg || e.leg === leg)) ?? null : null);
  if (target) return <RideDay event={target} locked={!!locked} />;
  // Every upcoming ride you're driving, booked or not, so you can edit it.
  const driving = trips
    .filter((tr) => tr.role === 'driver' && new Date(tr.returnAt ?? tr.departAt).getTime() > now)
    .sort((a, b) => a.departAt.localeCompare(b.departAt));
  return (
    <RidesList legs={legs} now={now} driving={driving} saved={!!saved} asks={requestsWaiting(trips, now)} waiting={myPendingRequests(trips, now)} />
  );
}

/** "a round-trip seat to Copper Mountain", "a seat down from Vail". */
function askText(trip: Trip, legs: SeatLegs) {
  const resort = RESORT_BY_ID[trip.resortId]?.name ?? trip.resortId;
  const downOnly = seatLegs(trip.tripType, legs).join() === 'from';
  return `${seatAsk(trip.tripType, legs)} ${downOnly ? 'from' : 'to'} ${resort}`;
}

/** When the seat's first leg leaves, and where to meet for it. */
function firstLeg(trip: Trip, legs: SeatLegs) {
  const leg = seatLegs(trip.tripType, legs)[0];
  const at = legAt(trip, leg) ?? trip.departAt;
  const meet = leg === 'from' && trip.tripType === 'round_trip' && trip.returnMeet ? trip.returnMeet : trip.leaveFrom;
  return { at, meet };
}

/** "Tomorrow at 5:00 AM", or "tomorrow at 5:00 AM" in the middle of a sentence. */
const byWhen = (iso: string, mid = false) => {
  const d = dayLabel(isoDay(new Date(iso)));
  return `${mid && (d === 'Today' || d === 'Tomorrow') ? d.toLowerCase() : d} at ${clock(iso)}`;
};

/* ---------------- List ---------------- */

function RidesList({
  legs,
  now,
  driving,
  saved,
  asks,
  waiting,
}: {
  legs: LegEvent[];
  now: number;
  driving: Trip[];
  saved: boolean;
  asks: { trip: Trip; request: SeatRequest }[];
  waiting: Trip[];
}) {
  const t = useTheme();
  const nav = useNav();
  const [flash, setFlash] = useState<string | null>(null);
  const savedNote = saved ? <Notice kind="success">Ride updated. Anyone booked sees the change in the ride chat and gets a notification.</Notice> : null;
  const flashNote = flash ? <Notice kind="success">{flash}</Notice> : null;
  if (!legs.length && !driving.length && !waiting.length) {
    return (
      <FormScreen header={<AppHeader />}>
        <Heading title="Your rides" subtitle="Rides you're driving, have a seat on, or have asked to join show up here, with a countdown and a group chat." />
        {flashNote}
        <View style={{ borderWidth: 2, borderStyle: 'dashed', borderColor: t.line, borderRadius: 16, padding: 28, alignItems: 'center', gap: 10 }}>
          <Text style={{ color: t.ink, fontSize: 22, fontWeight: '900', textTransform: 'uppercase' }}>Nothing booked</Text>
          <Muted center>Find a ride to the mountain, or post your open seats.</Muted>
          <Button title="Find a ride" onPress={() => nav.replace('/')} />
        </View>
      </FormScreen>
    );
  }
  const [next, ...rest] = legs;
  return (
    <FormScreen header={<AppHeader />}>
      <Heading title="Your rides" />
      {savedNote}
      {flashNote}

      {asks.length ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: t.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.8 }}>
            {asks.length === 1 ? 'A RIDER WANTS IN' : `${asks.length} RIDERS WANT IN`}
          </Text>
          {asks.map(({ trip, request }) => (
            <RequestCard key={`${trip.id}-${request.id}`} trip={trip} request={request} onAnswered={setFlash} showRide />
          ))}
        </View>
      ) : null}

      {waiting.length ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: t.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.8 }}>WAITING ON THE DRIVER</Text>
          {waiting.map((tr) => (
            <PendingCard key={tr.id} trip={tr} now={now} onCancelled={setFlash} />
          ))}
        </View>
      ) : null}

      {next ? <LegCard e={next} now={now} big /> : null}
      {rest.length ? <Text style={{ color: t.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.8 }}>LATER</Text> : null}
      {rest.map((e) => (
        <LegCard key={`${e.trip.id}-${e.leg}`} e={e} now={now} />
      ))}

      {driving.length ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: t.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.8 }}>RIDES YOU'RE DRIVING</Text>
          <Card>
            {driving.map((tr, i) => (
              <DrivingRow key={tr.id} trip={tr} first={i === 0} />
            ))}
          </Card>
        </View>
      ) : null}
      <Muted>
        When you book a seat, the driver confirms it and you get a notification. You'll get another 2 hours before each ride. From {LOCK_BEFORE_MIN}{' '}
        minutes before, the app opens straight to your ride so you can coordinate pickup.
      </Muted>
    </FormScreen>
  );
}

/** A rider asking for a seat on a ride you're driving: who they are, what they want, Confirm or Deny. */
function RequestCard({ trip, request: q, onAnswered, showRide }: { trip: Trip; request: SeatRequest; onAnswered: (msg: string) => void; showRide?: boolean }) {
  const t = useTheme();
  const api = useApi();
  const nav = useNav();
  const { refresh } = useMyRides();
  const [busy, setBusy] = useState<'yes' | 'no' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const first = q.name.split(' ')[0] || 'They';
  const { at } = firstLeg(trip, q.legs);

  async function answer(yes: boolean) {
    setError(null);
    setBusy(yes ? 'yes' : 'no');
    try {
      await api.respondToRequest(trip.id, q.id, yes);
      onAnswered(yes ? `${first} is in. They got a notification with the pickup details.` : `Request declined. ${first} got a notification and the seat is open again.`);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <Card style={{ padding: 14, gap: 10, borderColor: t.accent, borderWidth: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <PersonAvatar person={q} size={48} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text onPress={() => nav.push('/u', { id: q.id })} accessibilityRole="link" style={{ color: t.ink, fontSize: 17, fontWeight: '800' }}>
            {q.name}
          </Text>
          <RatingBadge value={q.rating} count={q.reviewCount} label="as a passenger" />
        </View>
      </View>
      <Text style={{ color: t.ink, fontSize: 15, lineHeight: 21 }}>
        {first} wants {askText(trip, q.legs)}
        {showRide ? `, ${byWhen(at, true)}` : ''}.
      </Text>
      <Text style={{ color: t.muted, fontSize: 13, lineHeight: 18 }}>
        Answer by {byWhen(q.expiresAt, true)}. After that the request expires and the seat opens up again.
      </Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button variant="ghost" title="Deny" loading={busy === 'no'} disabled={!!busy} onPress={() => answer(false)} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Confirm" loading={busy === 'yes'} disabled={!!busy} onPress={() => answer(true)} />
        </View>
      </View>
      {error ? <Notice kind="error">{error}</Notice> : null}
    </Card>
  );
}

/** A seat you asked for that the driver hasn't answered yet. */
function PendingCard({ trip, now, onCancelled }: { trip: Trip; now: number; onCancelled: (msg: string) => void }) {
  const t = useTheme();
  const api = useApi();
  const { refresh } = useMyRides();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const legs = trip.myLegs ?? 'both';
  const { at, meet } = firstLeg(trip, legs);
  const driver = trip.driver.name.split(' ')[0] || 'The driver';
  const left = trip.expiresAt ? new Date(trip.expiresAt).getTime() - now : 0;

  async function cancel() {
    setError(null);
    setBusy(true);
    try {
      await api.leaveSeat(trip.id);
      onCancelled('Request cancelled.');
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Card style={{ padding: 14, gap: 8 }}>
      <Text style={{ color: t.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.8 }}>
        REQUEST SENT · {TRIP_LABEL[trip.tripType].toUpperCase()}
      </Text>
      <Text style={{ color: t.ink, fontSize: 19, fontWeight: '900', textTransform: 'uppercase' }}>{RESORT_BY_ID[trip.resortId]?.name ?? trip.resortId}</Text>
      <Text style={{ color: t.muted, fontSize: 14 }}>
        {byWhen(at)} · from {meet}
        {trip.tripType === 'round_trip' && legs !== 'both' ? (legs === 'to' ? ' · ride up only' : ' · ride down only') : ''}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <PersonAvatar person={trip.driver} size={30} />
        <Text style={{ color: t.ink, fontSize: 14, fontWeight: '700', flex: 1 }}>Waiting on {driver} to confirm</Text>
      </View>
      <Muted>
        Your seat is held until {trip.expiresAt ? byWhen(trip.expiresAt, true) : 'they answer'}
        {left > 0 && left < 6 * 3600 * 1000 ? ` (${countdown(left)} from now)` : ''}. If {driver} doesn't answer by then, the request expires. You'll get
        a notification either way.
      </Muted>
      <View style={{ alignSelf: 'flex-start' }}>
        <Button small variant="ghost" title="Cancel request" loading={busy} onPress={cancel} />
      </View>
      {error ? <Notice kind="error">{error}</Notice> : null}
    </Card>
  );
}

function LegCard({ e, now, big }: { e: LegEvent; now: number; big?: boolean }) {
  const t = useTheme();
  const nav = useNav();
  const ms = new Date(e.at).getTime() - now;
  const people = passengersOn(e.trip, e.leg);
  return (
    <Pressable
      onPress={() => nav.push('/rides', { ride: e.trip.id, leg: e.leg })}
      accessibilityRole="button"
      style={({ pressed }) => ({
        backgroundColor: big ? t.header : t.surface,
        borderRadius: 16,
        borderWidth: big ? 0 : 1,
        borderColor: t.line,
        padding: big ? 18 : 14,
        gap: big ? 10 : 6,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <Text style={{ color: big ? t.accent : t.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.8 }}>
          {e.trip.role === 'driver' ? "YOU'RE DRIVING" : 'YOU HAVE A SEAT'} · {TRIP_LABEL[e.trip.tripType].toUpperCase()}
        </Text>
        <Text style={{ color: big ? t.headerInk : t.muted, fontSize: 20 }}>›</Text>
      </View>
      <Text style={{ color: big ? t.headerInk : t.ink, fontSize: big ? 26 : 19, fontWeight: '900', textTransform: 'uppercase' }}>{legTitle(e.leg, e.trip.resortId)}</Text>
      {big ? (
        <Text style={{ color: t.headerInk, fontSize: 44, fontWeight: '900', fontVariant: ['tabular-nums'] }}>{countdown(ms)}</Text>
      ) : null}
      <Text style={{ color: big ? t.headerInk : t.muted, fontSize: 14, opacity: big ? 0.85 : 1 }}>
        {dayLabel(isoDay(new Date(e.at)))} · {clock(e.at)} · from {e.meet}
        {big ? '' : ` · in ${countdown(ms)}`}
      </Text>
      <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
        <PersonAvatar person={e.trip.driver} size={30} />
        {people.map((p) => (
          <PersonAvatar key={p.id} person={p} size={30} />
        ))}
        <Text style={{ color: big ? t.headerInk : t.muted, fontSize: 13, marginLeft: 6 }}>
          {people.length + 1} in the car
        </Text>
      </View>
    </Pressable>
  );
}

/** One ride you're driving: when, how full, and Edit. */
function DrivingRow({ trip, first }: { trip: Trip; first: boolean }) {
  const t = useTheme();
  const nav = useNav();
  const up = passengersOn(trip, 'to').length;
  const down = passengersOn(trip, 'from').length;
  const d = isoDay(new Date(trip.departAt));
  const seatsText =
    trip.tripType === 'round_trip' && up !== down
      ? `Up: ${up} of ${trip.seatsTotal} · Down: ${down} of ${trip.seatsTotal} booked`
      : `${Math.max(up, down)} of ${trip.seatsTotal} seat${trip.seatsTotal === 1 ? '' : 's'} booked`;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderTopWidth: first ? 0 : 1, borderTopColor: t.line, flexWrap: 'wrap' }}>
      <View style={{ flex: 1, minWidth: 180, gap: 2 }}>
        <Text style={{ color: t.ink, fontSize: 16, fontWeight: '800' }}>
          {RESORT_BY_ID[trip.resortId]?.name ?? trip.resortId}
          <Text style={{ color: t.muted, fontSize: 13, fontWeight: '600' }}>{`  ${TRIP_LABEL[trip.tripType]}`}</Text>
        </Text>
        <Text style={{ color: t.muted, fontSize: 13 }}>
          {dayLabel(d)} · {trip.tripType === 'from_mountain' ? 'leaves the mountain' : 'leaves'} {clock(trip.departAt)}
          {trip.tripType === 'round_trip' && trip.returnAt ? ` · back ${clock(trip.returnAt)}` : ''}
        </Text>
        <Text style={{ color: up || down ? t.ink : t.muted, fontSize: 13, fontWeight: '600' }}>{up || down ? seatsText : 'No riders yet'}</Text>
        {trip.requests.length ? (
          <Text style={{ color: t.danger, fontSize: 13, fontWeight: '800' }}>
            {trip.requests.length === 1 ? '1 request' : `${trip.requests.length} requests`} waiting on you
          </Text>
        ) : null}
      </View>
      <Button small variant="ghost" title="Edit ride" onPress={() => nav.push('/post', { edit: trip.id })} />
    </View>
  );
}

/* ---------------- Ride day ---------------- */

function RideDay({ event: e, locked }: { event: LegEvent; locked: boolean }) {
  const t = useTheme();
  const api = useApi();
  const nav = useNav();
  const { session } = useAuth();
  const { refresh } = useMyRides();
  const now = useNow(1000);
  const me = session!.userId;
  const trip = e.trip;
  const isDriver = trip.role === 'driver';
  const ms = new Date(e.at).getTime() - now;
  const confirmOpen = ms <= CONFIRM_BEFORE_MIN * 60000;
  const people = passengersOn(trip, e.leg);
  const checkin = (id: string) => trip.checkins.find((c) => c.leg === e.leg && c.riderId === id);
  const mine = checkin(me);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmBail, setConfirmBail] = useState(false);

  async function act(key: string, fn: () => Promise<void>) {
    setError(null);
    setBusy(key);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <FormScreen header={<AppHeader />}>
      {locked ? (
        <View style={{ backgroundColor: t.accent, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 }}>
          <Text style={{ color: t.accentInk, fontWeight: '800', fontSize: 14 }}>
            Ride mode: you're locked in until pickup so nobody gets left behind.
          </Text>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Pressable onPress={() => nav.replace('/rides')} accessibilityRole="button" style={{ alignSelf: 'flex-start' }}>
            <Text style={{ color: t.link, fontSize: 15, fontWeight: '700' }}>‹ Your rides</Text>
          </Pressable>
          {isDriver ? (
            <Pressable onPress={() => nav.push('/post', { edit: trip.id })} accessibilityRole="button">
              <Text style={{ color: t.link, fontSize: 15, fontWeight: '700' }}>Edit ride</Text>
            </Pressable>
          ) : null}
        </View>
      )}

      {/* Countdown */}
      <Card style={{ padding: 18, gap: 6, backgroundColor: t.header, borderColor: t.header }}>
        <Text style={{ color: t.accent, fontSize: 12, fontWeight: '800', letterSpacing: 0.8 }}>
          {isDriver ? "YOU'RE DRIVING" : `DRIVER: ${trip.driver.name.toUpperCase()}`}
        </Text>
        <Text style={{ color: t.headerInk, fontSize: 26, fontWeight: '900', textTransform: 'uppercase' }}>{legTitle(e.leg, trip.resortId)}</Text>
        <Text style={{ color: t.headerInk, fontSize: 56, fontWeight: '900', fontVariant: ['tabular-nums'], lineHeight: 62 }}>{countdown(ms)}</Text>
        <Text style={{ color: t.headerInk, opacity: 0.85, fontSize: 15 }}>
          {ms > 0 ? 'Leaves' : 'Left'} {clock(e.at)} · {longDay(isoDay(new Date(e.at)))}
        </Text>
        <Text style={{ color: t.headerInk, fontSize: 15, fontWeight: '700' }}>Meet at {e.meet}</Text>
      </Card>

      {/* Check-in */}
      <Card style={{ padding: 16, gap: 12 }}>
        <Text style={{ color: t.ink, fontSize: 17, fontWeight: '800' }}>{isDriver ? 'Confirm your passengers' : 'Confirm your ride'}</Text>
        {!confirmOpen ? (
          <Muted>
            Check-in opens {CONFIRM_BEFORE_MIN} minutes before departure, at {clock(new Date(new Date(e.at).getTime() - CONFIRM_BEFORE_MIN * 60000).toISOString())}.
            You'll get a notification.
          </Muted>
        ) : null}

        {isDriver ? (
          people.map((p) => {
            const c = checkin(p.id);
            return (
              <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <PersonAvatar person={p} size={40} />
                <View style={{ flex: 1, minWidth: 120 }}>
                  <Text onPress={() => nav.push('/u', { id: p.id })} accessibilityRole="link" style={{ color: t.ink, fontWeight: '700', fontSize: 15 }}>{p.name}</Text>
                  <Text style={{ color: c?.riderConfirmedAt ? t.ok : t.muted, fontSize: 12, fontWeight: '700' }}>
                    {c?.driverStatus === 'picked_up' ? '✓ Picked up' : c?.driverStatus === 'no_show' ? 'No-show' : c?.riderConfirmedAt ? 'Says they’re here' : 'Not checked in yet'}
                  </Text>
                </View>
                {confirmOpen && !c?.driverStatus ? (
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <Button small variant="ghost" title="No-show" loading={busy === `n-${p.id}`} onPress={() => act(`n-${p.id}`, () => api.confirmPassenger(trip.id, e.leg, p.id, 'no_show'))} />
                    <Button small title="Picked up" loading={busy === `p-${p.id}`} onPress={() => act(`p-${p.id}`, () => api.confirmPassenger(trip.id, e.leg, p.id, 'picked_up'))} />
                  </View>
                ) : null}
              </View>
            );
          })
        ) : mine?.driverStatus ? (
          <Notice kind={mine.driverStatus === 'picked_up' ? 'success' : 'error'}>
            {mine.driverStatus === 'picked_up' ? `${trip.driver.name.split(' ')[0]} confirmed you're in. Enjoy the ride!` : `${trip.driver.name.split(' ')[0]} marked you as a no-show. Message them if that's wrong.`}
          </Notice>
        ) : mine?.riderConfirmedAt ? (
          <Notice kind="success">{`You're confirmed. Waiting for ${trip.driver.name.split(' ')[0]} to check you off.`}</Notice>
        ) : confirmOpen ? (
          <Button title="I'm here, confirm my seat" loading={busy === 'me'} onPress={() => act('me', () => api.confirmMySeat(trip.id, e.leg))} />
        ) : null}

        {error ? <Notice kind="error">{error}</Notice> : null}
      </Card>

      {/* Requests for this ride still waiting on the driver */}
      {isDriver && trip.requests.length ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: t.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.8 }}>
            {trip.requests.length === 1 ? 'A RIDER WANTS IN' : `${trip.requests.length} RIDERS WANT IN`}
          </Text>
          {trip.requests.map((q) => (
            <RequestCard key={q.id} trip={trip} request={q} onAnswered={() => {}} />
          ))}
        </View>
      ) : null}

      {/* Everyone on this leg; tap anyone to see their profile */}
      <Card style={{ padding: 16 }}>
        <WhosInTheCar driver={trip.driver} riders={people} meId={me} roundTrip={trip.tripType === 'round_trip'} />
      </Card>

      <Chat trip={trip} meId={me} />

      <Text selectable style={{ color: t.muted, fontSize: 13 }}>
        {isDriver ? 'Your contact' : `${trip.driver.name.split(' ')[0]}'s contact`}: {trip.contact}
      </Text>

      {/* Escape hatch */}
      {confirmBail ? (
        <View style={{ gap: 8 }}>
          <Notice kind="error">
            {isDriver ? 'Cancel this ride for everyone? Your passengers will need another way up.' : `Give up your seat? ${trip.driver.name.split(' ')[0]} will see it right away.`}
          </Notice>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button small variant="ghost" title="Keep it" onPress={() => setConfirmBail(false)} />
            <Button
              small
              variant="danger"
              title={isDriver ? 'Cancel ride' : 'Give up seat'}
              loading={busy === 'bail'}
              onPress={() =>
                act('bail', async () => {
                  if (isDriver) await api.cancelRide(trip.id);
                  else await api.leaveSeat(trip.id);
                  nav.replace('/rides');
                })
              }
            />
          </View>
        </View>
      ) : (
        <Text style={{ textAlign: 'center' }}>
          <Text onPress={() => setConfirmBail(true)} accessibilityRole="button" style={{ color: t.muted, fontSize: 14, textDecorationLine: 'underline' }}>
            {isDriver ? "Can't drive anymore?" : "Can't make it?"}
          </Text>
        </Text>
      )}
    </FormScreen>
  );
}

/* ---------------- Chat ---------------- */

const QUICK = ['On my way', "I'm here", 'Running 5 min late', 'Where are you parked?'];

function Chat({ trip, meId }: { trip: Trip; meId: string }) {
  const t = useTheme();
  const api = useApi();
  const nav = useNav();
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);
  const [reporting, setReporting] = useState<ChatMessage | null>(null);
  const people = useMemo(() => Object.fromEntries([trip.driver, ...trip.passengers].map((p) => [p.id, p])), [trip]);

  useEffect(() => {
    let alive = true;
    api
      .listMessages(trip.id)
      .then((m) => alive && setMessages(m))
      .catch(() => alive && setMessages([]));
    const off = api.subscribeMessages(trip.id, (m) =>
      setMessages((prev) => (prev && !prev.some((x) => x.id === m.id) ? [...prev, m] : prev ?? [m])),
    );
    return () => {
      alive = false;
      off();
    };
  }, [api, trip.id]);

  async function send(body: string) {
    const b = body.trim();
    if (!b) return;
    setError(null);
    setSending(true);
    try {
      await api.sendMessage(trip.id, b);
      setText('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <Card style={{ padding: 14, gap: 10 }}>
      <Text style={{ color: t.ink, fontSize: 17, fontWeight: '800' }}>Ride chat</Text>
      {messages === null ? (
        <Loading label="Loading chat…" />
      ) : messages.length === 0 ? (
        <Muted>Say hi and sort out pickup. Everyone on this ride can see this chat.</Muted>
      ) : (
        <View style={{ gap: 8 }}>
          {messages.slice(-30).map((m) => {
            if (m.kind === 'update') {
              return (
                <View key={m.id} style={{ alignSelf: 'center', maxWidth: '92%', backgroundColor: t.chip, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, gap: 2 }}>
                  <Text style={{ color: t.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.6, textAlign: 'center' }}>RIDE UPDATED · {clock(m.createdAt)}</Text>
                  <Text style={{ color: t.ink, fontSize: 14, lineHeight: 19, textAlign: 'center' }}>{m.body}</Text>
                </View>
              );
            }
            const mine = m.senderId === meId;
            const p = people[m.senderId];
            return (
              <View key={m.id} style={{ flexDirection: mine ? 'row-reverse' : 'row', gap: 8, alignItems: 'flex-end' }}>
                {!mine ? p ? <PersonAvatar person={p} size={28} /> : <Avatar uri={null} name="" gender={null} size={28} /> : null}
                <Pressable
                  onLongPress={mine ? undefined : () => setReporting(m)}
                  accessibilityHint={mine ? undefined : 'Long press to report this message'}
                  style={{ maxWidth: '78%', gap: 2, alignItems: mine ? 'flex-end' : 'flex-start' }}
                >
                  {!mine ? <Text onPress={p ? () => nav.push('/u', { id: p.id }) : undefined} style={{ color: t.muted, fontSize: 11, fontWeight: '700' }}>{p?.name.split(' ')[0] ?? 'Someone'}{m.senderId === trip.driver.id ? ' · driver' : ''}</Text> : null}
                  <View
                    style={{
                      backgroundColor: mine ? t.accent : t.chip,
                      borderRadius: 16,
                      borderBottomRightRadius: mine ? 4 : 16,
                      borderBottomLeftRadius: mine ? 16 : 4,
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                    }}
                  >
                    <Text style={{ color: mine ? t.accentInk : t.ink, fontSize: 15, lineHeight: 20 }}>{m.body}</Text>
                  </View>
                  <Text style={{ color: t.muted, fontSize: 10 }}>
                    {clock(m.createdAt)}
                    {!mine ? (
                      <Text onPress={() => setReporting(m)} accessibilityRole="button" accessibilityLabel="Report message" style={{ fontWeight: '700' }}>
                        {'  ·  Report'}
                      </Text>
                    ) : null}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      )}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {QUICK.map((q) => (
          <Pressable key={q} onPress={() => send(q)} accessibilityRole="button" style={{ borderWidth: 1, borderColor: t.line, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
            <Text style={{ color: t.ink, fontSize: 13, fontWeight: '600' }}>{q}</Text>
          </Pressable>
        ))}
      </View>

      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <View style={{ flex: 1, borderWidth: 1.5, borderColor: t.line, borderRadius: 20, paddingHorizontal: 14, backgroundColor: t.bg }}>
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={setText}
            placeholder="Message the car"
            placeholderTextColor={t.muted}
            onSubmitEditing={() => send(text)}
            returnKeyType="send"
            maxLength={1000}
            accessibilityLabel="Message"
            style={{ color: t.ink, fontSize: 15, paddingVertical: 10 }}
          />
        </View>
        <Button small title="Send" loading={sending} disabled={!text.trim()} onPress={() => send(text)} />
      </View>
      {error ? <Notice kind="error">{error}</Notice> : null}
      {reporting ? (
        <ReportSheet
          visible
          onClose={() => setReporting(null)}
          userId={reporting.senderId}
          name={people[reporting.senderId]?.name ?? ''}
          kind="message"
          targetId={reporting.id}
          onBlocked={() => {
            const gone = reporting.senderId;
            setMessages((prev) => (prev ?? []).filter((x) => x.senderId !== gone));
          }}
        />
      ) : null}
    </Card>
  );
}
