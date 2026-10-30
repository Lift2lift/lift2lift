import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { AppHeader } from '../components/AppHeader';
import { Avatar } from '../components/Avatar';
import { Button, Card, FormScreen, Heading, Loading, Muted, Notice } from '../components/ui';
import { clock, dayLabel, isoDay, longDay } from '../lib/dates';
import { RESORT_BY_ID } from '../lib/resorts';
import { useTheme } from '../lib/theme';
import {
  CONFIRM_BEFORE_MIN,
  countdown,
  LOCK_BEFORE_MIN,
  passengersOn,
  TRIP_LABEL,
  upcomingLegs,
  useNow,
  type LegEvent,
} from '../lib/trips';
import type { ChatMessage, Leg, Trip } from '../lib/types';
import { useApi, useAuth, useMyRides, useNav } from '../providers';

const legTitle = (leg: Leg, resortId: string) => `${leg === 'to' ? 'Up to' : 'Back from'} ${RESORT_BY_ID[resortId]?.name ?? resortId}`;

/** Your Rides tab: the list, or one ride's day-of view (countdown, check-in, chat). */
export function YourRidesScreen({ rideId, leg }: { rideId?: string; leg?: Leg }) {
  const { trips, locked } = useMyRides();
  const { session } = useAuth();
  const now = useNow(1000);

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
  return <RidesList legs={legs} now={now} />;
}

/* ---------------- List ---------------- */

function RidesList({ legs, now }: { legs: LegEvent[]; now: number }) {
  const t = useTheme();
  const nav = useNav();
  if (!legs.length) {
    return (
      <FormScreen header={<AppHeader />}>
        <Heading title="Your rides" subtitle="Rides you're driving or have a seat on show up here, with a countdown and a group chat." />
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
      <LegCard e={next} now={now} big />
      {rest.length ? <Text style={{ color: t.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.8 }}>LATER</Text> : null}
      {rest.map((e) => (
        <LegCard key={`${e.trip.id}-${e.leg}`} e={e} now={now} />
      ))}
      <Muted>
        You'll get a notification 2 hours before each ride. From {LOCK_BEFORE_MIN} minutes before, the app opens straight to your ride so you can
        coordinate pickup.
      </Muted>
    </FormScreen>
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
        <Avatar uri={e.trip.driver.avatarUrl} name={e.trip.driver.name} gender={e.trip.driver.gender} size={30} />
        {people.map((p) => (
          <Avatar key={p.id} uri={p.avatarUrl} name={p.name} gender={p.gender} size={30} />
        ))}
        <Text style={{ color: big ? t.headerInk : t.muted, fontSize: 13, marginLeft: 6 }}>
          {people.length + 1} in the car
        </Text>
      </View>
    </Pressable>
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
        <Pressable onPress={() => nav.replace('/rides')} accessibilityRole="button" style={{ alignSelf: 'flex-start' }}>
          <Text style={{ color: t.link, fontSize: 15, fontWeight: '700' }}>‹ Your rides</Text>
        </Pressable>
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
                <Avatar uri={p.avatarUrl} name={p.name} gender={p.gender} size={40} />
                <View style={{ flex: 1, minWidth: 120 }}>
                  <Text style={{ color: t.ink, fontWeight: '700', fontSize: 15 }}>{p.name}</Text>
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

        {!isDriver ? (
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <Text style={{ color: t.muted, fontSize: 13 }}>In the car:</Text>
            {[trip.driver, ...people].map((p) => (
              <Avatar key={p.id} uri={p.avatarUrl} name={p.name} gender={p.gender} size={28} />
            ))}
          </View>
        ) : null}
        {error ? <Notice kind="error">{error}</Notice> : null}
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
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);
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
            const mine = m.senderId === meId;
            const p = people[m.senderId];
            return (
              <View key={m.id} style={{ flexDirection: mine ? 'row-reverse' : 'row', gap: 8, alignItems: 'flex-end' }}>
                {!mine ? <Avatar uri={p?.avatarUrl} name={p?.name ?? ''} gender={p?.gender} size={28} /> : null}
                <View style={{ maxWidth: '78%', gap: 2, alignItems: mine ? 'flex-end' : 'flex-start' }}>
                  {!mine ? <Text style={{ color: t.muted, fontSize: 11, fontWeight: '700' }}>{p?.name.split(' ')[0] ?? 'Someone'}{m.senderId === trip.driver.id ? ' · driver' : ''}</Text> : null}
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
                  <Text style={{ color: t.muted, fontSize: 10 }}>{clock(m.createdAt)}</Text>
                </View>
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
    </Card>
  );
}
