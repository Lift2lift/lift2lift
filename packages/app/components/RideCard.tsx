import { useState } from 'react';
import { Modal, Platform, Pressable, Text, View } from 'react-native';
import { clock, driveText, DOW, isoDay, MON } from '../lib/dates';
import { forecastFor } from '../lib/forecast';
import { RESORT_BY_ID } from '../lib/resorts';
import { bookingClosed } from '../lib/rules';
import { legAt, oneWayShare, seatLegs, seatsOpen, TRIP_LABEL, tripLegs } from '../lib/trips';
import { Avatar } from './Avatar';
import { PersonChip } from './People';
import { RatingBadge } from './Stars';
import { useTheme } from '../lib/theme';
import type { BoardRide, Forecast, Leg, SeatLegs } from '../lib/types';
import { useApi, useAuth, useMyRides, useNav } from '../providers';
import { Button, Card, TextLink } from './ui';

export function RideCard({
  ride,
  forecast,
  onChanged,
  onMessage,
  busyDays,
  hideResort,
  profileReady,
  onNeedsSetup,
  friendIds,
}: {
  ride: BoardRide;
  /** The viewer's friends, to flag rides they're driving or riding in. */
  friendIds?: Set<string>;
  /** On a mountain's own page, the card doesn't repeat the mountain name. */
  hideResort?: boolean;
  /** Viewer has finished their profile (needed to call shotgun). */
  profileReady: boolean;
  onNeedsSetup: () => void;
  /** Legs the viewer already has, by day (YYYY-MM-DD): no two seats on one leg in a day, and drivers take the whole day. */
  busyDays: Map<string, Set<Leg>>;
  forecast: Forecast | null;
  onChanged: () => void;
  onMessage: (text: string, kind?: 'error' | 'success') => void;
}) {
  const t = useTheme();
  const api = useApi();
  const nav = useNav();
  const { refresh: refreshMyRides } = useMyRides();
  const { session } = useAuth();
  const me = session?.userId;
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [contact, setContact] = useState<string | null>(null);

  const d = new Date(ride.departAt);
  const day = isoDay(d);
  const resort = RESORT_BY_ID[ride.resortId];
  const mine = ride.driverId === me;
  const riding = !!me && ride.riderIds.includes(me);
  const left = Math.max(0, ride.seatsTotal - ride.seatsTaken);
  const wx = forecastFor(forecast, ride.resortId, day);
  const legs = tripLegs(ride.tripType);
  const taken = busyDays.get(ride.rideDate) ?? new Set<Leg>();
  const legOk = (leg: Leg) => {
    const at = legAt(ride, leg);
    return !!at && !taken.has(leg) && seatsOpen(ride, leg) > 0 && !bookingClosed(at);
  };
  const bookable = legs.filter(legOk);
  const closed = legs.every((leg) => bookingClosed(legAt(ride, leg) ?? ride.departAt));
  const busyThatDay = !mine && !riding && legs.every((leg) => taken.has(leg));
  const allFull = legs.every((leg) => seatsOpen(ride, leg) === 0);
  const myLegs = riding ? ride.riderLegs[ride.riderIds.indexOf(me!)] ?? 'both' : null;
  const firstName = ride.driverName.split(' ')[0] || 'the driver';
  const friendsRiding = friendIds ? ride.riderIds.filter((id) => friendIds.has(id)).length : 0;
  // Booking: pick legs (round trips), then confirm one way if it's one way.
  const [sheet, setSheet] = useState<null | 'legs' | { oneWay: SeatLegs; leg: Leg }>(null);
  const book = (l: SeatLegs) => {
    setSheet(null);
    run(() => api.claimSeat(ride.id, l), `Seat saved. It's in Your Rides, and ${firstName} is in your ride chat.`);
  };
  const choose = (l: SeatLegs) => {
    const covered = seatLegs(ride.tripType, l);
    if (covered.length === 1) setSheet({ oneWay: l, leg: covered[0] });
    else book(l);
  };

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    try {
      await action();
      onMessage(success, 'success');
      onChanged();
      refreshMyRides(); // so Your Rides shows it right away
    } catch (e) {
      onMessage((e as Error).message, 'error');
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function showContact() {
    try {
      const c = await api.rideContact(ride.id);
      setContact(c ?? 'Hidden until you have a seat.');
    } catch (e) {
      onMessage((e as Error).message, 'error');
    }
  }

  let action = null;
  if (mine) {
    action = confirmCancel ? (
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button small variant="ghost" title="Keep it" onPress={() => setConfirmCancel(false)} />
        <Button
          small
          variant="danger"
          title="Yes, cancel"
          loading={busy}
          onPress={() => run(() => api.cancelRide(ride.id), 'Ride cancelled. Anyone booked gets a notification.')}
        />
      </View>
    ) : (
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button small variant="ghost" title="Edit" onPress={() => nav.push('/post', { edit: ride.id })} />
        <Button small variant="danger" title="Cancel ride" onPress={() => setConfirmCancel(true)} />
      </View>
    );
  } else if (riding) {
    action = (
      <Button
        small
        variant="ghost"
        title="Bail on seat"
        loading={busy}
        onPress={() => run(() => api.leaveSeat(ride.id), 'Seat released. Give the driver a heads-up.')}
      />
    );
  } else {
    const blocked = bookable.length === 0;
    action = (
      <Button
        small
        title={allFull ? 'Full' : closed ? 'Booking closed' : busyThatDay ? 'Booked that day' : blocked ? 'Not available' : 'Call shotgun'}
        disabled={blocked}
        loading={busy}
        onPress={() => (!profileReady ? onNeedsSetup() : ride.tripType === 'round_trip' ? setSheet('legs') : choose('both'))}
      />
    );
  }

  return (
    <Card highlight={mine} style={{ flexDirection: 'row', overflow: 'hidden' }}>
      <Modal visible={!!sheet} transparent animationType="fade" onRequestClose={() => setSheet(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(7,13,24,0.6)', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <View accessibilityViewIsModal style={{ width: '100%', maxWidth: 420, backgroundColor: t.surface, borderRadius: 18, padding: 22, gap: 12 }}>
            {sheet === 'legs' ? (
              <>
                <Text style={{ color: t.ink, fontSize: 24, fontWeight: '900' }}>Call shotgun</Text>
                <Text style={{ color: t.muted, fontSize: 15, lineHeight: 21 }}>
                  {firstName} is driving up at {clock(ride.departAt)} and back down at {ride.returnAt ? clock(ride.returnAt) : '—'}. Which seats do you want?
                </Text>
                {(
                  [
                    ['both', 'Round trip', `Up and back · $${ride.gasPerRider}`],
                    ['to', 'Just the ride up', `${clock(ride.departAt)} from ${ride.leaveFrom} · $${oneWayShare(ride.gasPerRider)}`],
                    ['from', 'Just the ride down', `${ride.returnAt ? clock(ride.returnAt) : ''} from ${ride.returnMeet || 'the mountain'} · $${oneWayShare(ride.gasPerRider)}`],
                  ] as [SeatLegs, string, string][]
                ).map(([l, title, sub]) => {
                  const ok = seatLegs(ride.tripType, l).every(legOk);
                  return (
                    <Pressable
                      key={l}
                      disabled={!ok}
                      onPress={() => choose(l)}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: !ok }}
                      style={({ pressed }) => ({ borderWidth: 1.5, borderColor: l === 'both' && ok ? t.accent : t.line, borderRadius: 12, padding: 12, opacity: !ok ? 0.45 : pressed ? 0.85 : 1 })}
                    >
                      <Text style={{ color: t.ink, fontSize: 16, fontWeight: '800' }}>{title}</Text>
                      <Text style={{ color: t.muted, fontSize: 13 }}>{ok ? sub : 'Not available'}</Text>
                    </Pressable>
                  );
                })}
                <Button variant="ghost" title="Cancel" onPress={() => setSheet(null)} />
              </>
            ) : sheet ? (
              <>
                <Text style={{ color: t.ink, fontSize: 24, fontWeight: '900' }}>
                  {sheet.leg === 'to' ? 'Have a ride back from the mountain?' : 'Have a ride up to the mountain?'}
                </Text>
                <Text style={{ color: t.muted, fontSize: 15, lineHeight: 21 }}>
                  {sheet.leg === 'to'
                    ? `This seat only gets you up to ${resort?.name ?? 'the mountain'}. Make sure you have a way home before you go.`
                    : `This seat only gets you back from ${resort?.name ?? 'the mountain'}. Make sure you have a way up.`}
                </Text>
                <Button title="Confirm one way" loading={busy} onPress={() => book(sheet.oneWay)} />
                {ride.tripType === 'round_trip' && legs.every(legOk) ? (
                  <Button variant="ghost" title={`Make it a round trip ($${ride.gasPerRider})`} onPress={() => book('both')} />
                ) : null}
                <Button
                  variant="ghost"
                  title={sheet.leg === 'to' ? 'Find a ride back' : 'Find a ride up'}
                  onPress={() => {
                    setSheet(null);
                    nav.push('/', { resort: ride.resortId, day: ride.rideDate, leg: sheet.leg === 'to' ? 'from' : 'to' });
                  }}
                />
                <Text style={{ textAlign: 'center' }}>
                  <Text onPress={() => setSheet(null)} accessibilityRole="button" style={{ color: t.muted, fontSize: 14 }}>
                    Cancel
                  </Text>
                </Text>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
      {/* Ticket stub */}
      <View
        style={{
          width: 72,
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: 14,
          borderRightWidth: 2,
          borderRightColor: t.line,
          borderStyle: 'dashed',
        }}
        accessibilityLabel={`${DOW[d.getDay()]} ${MON[d.getMonth()]} ${d.getDate()}`}
      >
        <Text style={{ color: t.muted, fontSize: 11, fontWeight: '800', letterSpacing: 1 }}>{DOW[d.getDay()].toUpperCase()}</Text>
        <Text style={{ color: t.ink, fontSize: 36, fontWeight: '900', lineHeight: 40 }}>{d.getDate()}</Text>
        <Text style={{ color: t.ink, fontSize: 11, fontWeight: '800', letterSpacing: 1 }}>{MON[d.getMonth()].toUpperCase()}</Text>
      </View>

      <View style={{ flex: 1, padding: 14, gap: 8, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
          {hideResort ? (
            <Text style={{ color: t.ink, fontSize: 18, fontWeight: '900', flexShrink: 1 }}>{ride.tripType === 'from_mountain' ? 'Down at' : 'Leaves'} {clock(ride.departAt)}</Text>
          ) : (
            <Text style={{ color: t.ink, fontSize: 22, fontWeight: '900', textTransform: 'uppercase', flexShrink: 1 }}>
            {resort?.name ?? ride.resortId}
          </Text>
          )}
          <View style={{ backgroundColor: t.chip, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, alignItems: 'flex-end' }}>
            <Text style={{ color: t.ink, fontSize: 13, fontWeight: '800' }}>
              {ride.gasPerRider > 0 ? `$${ride.gasPerRider} gas` : 'Free ride'}
            </Text>
            {ride.tripType === 'round_trip' && ride.gasPerRider > 0 ? (
              <Text style={{ color: t.muted, fontSize: 11, fontWeight: '700' }}>${oneWayShare(ride.gasPerRider)} one way</Text>
            ) : null}
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <View style={{ borderWidth: 1.5, borderColor: t.ink, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
            <Text style={{ color: t.ink, fontSize: 12, fontWeight: '800' }}>
              {ride.tripType === 'round_trip' ? '⇅ ' : ride.tripType === 'to_mountain' ? '↑ ' : '↓ '}
              {TRIP_LABEL[ride.tripType]}
            </Text>
          </View>
          {friendIds?.has(ride.driverId) ? (
            <View style={{ backgroundColor: t.accent, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
              <Text style={{ color: t.accentInk, fontSize: 12, fontWeight: '800' }}>Your friend is driving</Text>
            </View>
          ) : null}
          {friendsRiding ? (
            <Text style={{ color: t.ink, fontSize: 12, fontWeight: '800' }}>
              {friendsRiding === 1 ? `${firstOf(ride.riderNames[ride.riderIds.findIndex((id) => friendIds!.has(id))])} is riding` : `${friendsRiding} friends riding`}
            </Text>
          ) : null}
          {myLegs ? (
            <Text style={{ color: t.ok, fontSize: 12, fontWeight: '800' }}>
              ✓ You're booked{ride.tripType === 'round_trip' ? (myLegs === 'both' ? ' both ways' : myLegs === 'to' ? ' for the ride up' : ' for the ride down') : ''}
            </Text>
          ) : null}
        </View>

        {ride.tripType === 'from_mountain' ? (
          <Text style={{ color: t.muted, fontSize: 14 }}>
            Leaves the mountain {hideResort ? '' : <Text style={{ color: t.ink, fontWeight: '700' }}>{clock(ride.departAt)} </Text>}from{' '}
            <Text style={{ color: t.ink, fontWeight: '700' }}>{ride.leaveFrom}</Text>
          </Text>
        ) : hideResort ? (
          <Text style={{ color: t.muted, fontSize: 14 }}>
            From <Text style={{ color: t.ink, fontWeight: '700' }}>{ride.leaveFrom}</Text>
          </Text>
        ) : (
          <Text style={{ color: t.muted, fontSize: 14 }}>
          Leaves <Text style={{ color: t.ink, fontWeight: '700' }}>{clock(ride.departAt)}</Text> from{' '}
          <Text style={{ color: t.ink, fontWeight: '700' }}>{ride.leaveFrom}</Text>
          {resort ? ` · ${driveText(resort.driveMinutes)} drive` : ''}
        </Text>
        )}

        {ride.tripType === 'round_trip' && ride.returnAt ? (
          <Text style={{ color: t.muted, fontSize: 14 }}>
            Back down <Text style={{ color: t.ink, fontWeight: '700' }}>{clock(ride.returnAt)}</Text>
            {ride.returnMeet ? (
              <>
                {' '}from <Text style={{ color: t.ink, fontWeight: '700' }}>{ride.returnMeet}</Text>
              </>
            ) : null}
          </Text>
        ) : null}

        <WeatherChip wx={wx} />

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <View style={{ flexDirection: 'row', gap: 4 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {Array.from({ length: ride.seatsTotal }, (_, i) => {
              const rid = ride.riderIds[i];
              const fill = rid ? (rid === me ? t.accent : t.ink) : 'transparent';
              return (
                <View
                  key={i}
                  style={{
                    width: 15,
                    height: 17,
                    borderRadius: 4,
                    borderBottomLeftRadius: 6,
                    borderBottomRightRadius: 6,
                    borderWidth: 2,
                    borderColor: rid === me ? t.accent : t.ink,
                    backgroundColor: fill,
                  }}
                />
              );
            })}
          </View>
          <Text style={{ color: allFull ? t.danger : t.ink, fontSize: 13, fontWeight: '700' }}>
            {ride.tripType === 'round_trip' && ride.seatsTakenTo !== ride.seatsTakenFrom
              ? `Up: ${seatsOpen(ride, 'to')} open · Down: ${seatsOpen(ride, 'from')} open`
              : left === 0
                ? 'Full'
                : `${left} of ${ride.seatsTotal} seat${ride.seatsTotal > 1 ? 's' : ''} open`}
          </Text>
          <Text style={{ color: t.muted, fontSize: 13 }}>· {ride.gear}</Text>
        </View>

        {busyThatDay && !allFull && !closed ? (
          <Text style={{ color: t.muted, fontSize: 13 }}>You already have a ride that day. It's one ride per person per day.</Text>
        ) : null}
        {closed && !mine && !riding && left > 0 ? (
          <Text style={{ color: t.muted, fontSize: 13 }}>Seats close 2 hours before departure.</Text>
        ) : null}

        {ride.notes ? <Text style={{ color: t.ink, fontSize: 14, lineHeight: 20 }}>{ride.notes}</Text> : null}

        {/* Who's in the car: every rider on this ride, for everyone looking at the board. Tap a name for their profile. */}
        {ride.riderIds.length ? (
          <View style={{ gap: 6 }}>
            <Text style={{ color: t.ink, fontSize: 13, fontWeight: '700' }}>{mine ? 'Riding with you:' : `In the car with ${firstName}:`}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {ride.riderIds.map((id, i) => {
                const person = { id, name: ride.riderNames[i] ?? '', avatarUrl: ride.riderAvatarUrls[i] ?? null, gender: ride.riderGenders[i] ?? null };
                const legs = ride.riderLegs[i];
                const note = id === me ? 'you' : ride.tripType === 'round_trip' && legs && legs !== 'both' ? (legs === 'to' ? 'up only' : 'down only') : undefined;
                return (
                  <PersonChip
                    key={id}
                    person={person}
                    note={note}
                    after={
                      mine ? (
                        <Text
                          onPress={() => run(() => api.removeRider(ride.id, id), `${person.name || 'Rider'} removed from your ride.`)}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${person.name}`}
                          style={{ color: t.muted, fontSize: 13, paddingHorizontal: 8, paddingVertical: 6 }}
                        >
                          ✕
                        </Text>
                      ) : undefined
                    }
                  />
                );
              })}
            </View>
          </View>
        ) : (
          <Text style={{ color: t.muted, fontSize: 13 }}>{mine ? 'No riders yet.' : `No one's riding with ${firstName} yet.`}</Text>
        )}

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            flexWrap: 'wrap',
            borderTopWidth: 1,
            borderTopColor: t.line,
            paddingTop: 10,
            marginTop: 2,
          }}
        >
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', flexShrink: 1 }}>
          <Pressable onPress={() => nav.push('/u', { id: ride.driverId })} accessibilityRole="link" accessibilityLabel={`${ride.driverName}'s profile`}>
            <Avatar uri={ride.driverAvatarUrl} name={ride.driverName} gender={ride.driverGender} size={44} />
          </Pressable>
          <View style={{ gap: 4, flexShrink: 1 }}>
            <Text style={{ color: t.muted, fontSize: 13 }}>
              {mine ? "You're driving" : 'Driver: '}
              {mine ? null : (
                <Text onPress={() => nav.push('/u', { id: ride.driverId })} accessibilityRole="link" style={{ color: t.ink, fontWeight: '700' }}>
                  {ride.driverName || 'A student'}
                </Text>
              )}
            </Text>
            <RatingBadge value={ride.driverDrivingAvg} count={ride.driverReviewCount} label="driving" />
            {ride.driverVerified ? (
              <Text style={{ color: t.ok, fontSize: 12, fontWeight: '700' }}>✓ ID verified · insurance on file</Text>
            ) : null}
            {(mine || riding) &&
              (contact ? (
                <Text selectable style={{ color: t.ink, fontSize: 14, fontWeight: '700', fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) }}>
                  {contact}
                </Text>
              ) : (
                <TextLink onPress={showContact}>{mine ? 'Show my contact' : "Show driver's contact"}</TextLink>
              ))}
          </View>
          </View>
          {action}
        </View>
      </View>
    </Card>
  );
}

function WeatherChip({ wx }: { wx: ReturnType<typeof forecastFor> }) {
  const t = useTheme();
  if (!wx) {
    return (
      <View style={{ alignSelf: 'flex-start', backgroundColor: t.chip, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
        <Text style={{ color: t.muted, fontSize: 13, fontWeight: '600' }}>Forecast not out yet</Text>
      </View>
    );
  }
  const snowy = wx.snowIn >= 0.5;
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        backgroundColor: snowy ? t.snow + '22' : t.chip,
        borderRadius: 8,
        paddingHorizontal: 8,
        paddingVertical: 4,
      }}
    >
      <Text style={{ color: snowy ? t.snow : t.muted, fontSize: 13, fontWeight: '700' }}>
        {snowy ? `❄ ${wx.snowIn}" new snow` : wx.precipPct >= 30 ? `${wx.precipPct}% chance of precip` : 'Dry'} · {wx.hi}° / {wx.lo}°
      </Text>
    </View>
  );
}

const firstOf = (name: string | undefined) => (name ?? '').split(' ')[0] || 'A friend';
