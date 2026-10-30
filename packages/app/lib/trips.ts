import { useEffect, useState } from 'react';
import type { BoardRide, Leg, SeatLegs, Trip, TripType } from './types';

/** Lock into the Your Ride screen from 30 minutes before a leg… */
export const LOCK_BEFORE_MIN = 30;
/** …until 15 minutes after it leaves (or check-in is done). */
export const LOCK_AFTER_MIN = 15;
/** Confirm prompts start 5 minutes before departure. */
export const CONFIRM_BEFORE_MIN = 5;

export function legAt(r: { tripType: TripType; departAt: string; returnAt: string | null }, leg: Leg): string | null {
  if (leg === 'to') return r.tripType === 'from_mountain' ? null : r.departAt;
  if (r.tripType === 'round_trip') return r.returnAt;
  if (r.tripType === 'from_mountain') return r.departAt;
  return null;
}

export function seatLegs(tripType: TripType, legs: SeatLegs): Leg[] {
  if (tripType === 'to_mountain') return ['to'];
  if (tripType === 'from_mountain') return ['from'];
  return legs === 'both' ? ['to', 'from'] : [legs];
}

export function tripLegs(tripType: TripType): Leg[] {
  return tripType === 'round_trip' ? ['to', 'from'] : tripType === 'to_mountain' ? ['to'] : ['from'];
}

/** The legs I'm on: all of them if I'm driving (and someone booked that leg). */
export function myLegs(t: Trip): Leg[] {
  if (t.role === 'passenger') return seatLegs(t.tripType, t.myLegs ?? 'both');
  return tripLegs(t.tripType);
}

export function passengersOn(t: Trip, leg: Leg) {
  return t.passengers.filter((p) => seatLegs(t.tripType, p.legs).includes(leg));
}

export type LegEvent = { trip: Trip; leg: Leg; at: string; meet: string };

/** Every leg I'm on, soonest first, skipping ones that left over 15 minutes ago. */
export function upcomingLegs(trips: Trip[], now = Date.now()): LegEvent[] {
  return trips
    .flatMap((trip) =>
      myLegs(trip)
        .map((leg) => {
          const at = legAt(trip, leg);
          if (!at) return null;
          if (trip.role === 'driver' && passengersOn(trip, leg).length === 0) return null;
          const meet = leg === 'from' && trip.tripType === 'round_trip' && trip.returnMeet ? trip.returnMeet : trip.leaveFrom;
          return { trip, leg, at, meet } as LegEvent;
        })
        .filter((e): e is LegEvent => !!e),
    )
    .filter((e) => new Date(e.at).getTime() > now - LOCK_AFTER_MIN * 60000)
    .sort((a, b) => a.at.localeCompare(b.at));
}

/** Is my check-in for this leg finished? (Passenger: the driver marked me. Driver: everyone's marked.) */
export function checkinDone(e: LegEvent, meId: string) {
  const c = e.trip.checkins.filter((x) => x.leg === e.leg);
  if (e.trip.role === 'driver') return passengersOn(e.trip, e.leg).every((p) => c.some((x) => x.riderId === p.id && x.driverStatus));
  return c.some((x) => x.riderId === meId && x.driverStatus);
}

/** The leg that should take over the app right now, if any. */
export function lockedLeg(trips: Trip[], meId: string, now = Date.now()): LegEvent | null {
  for (const e of upcomingLegs(trips, now)) {
    const t = new Date(e.at).getTime();
    if (now >= t - LOCK_BEFORE_MIN * 60000 && now <= t + LOCK_AFTER_MIN * 60000 && !checkinDone(e, meId)) return e;
  }
  return null;
}

/** Re-renders every `ms` so countdowns tick. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** "1:59:42", "24:05", or "2d 4h" for far-off trips. */
export function countdown(ms: number) {
  if (ms <= 0) return 'Leaving now';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}:${p(m)}:${p(sec)}`;
  return `${m}:${p(sec)}`;
}

/** Board helpers for round trips. */
export function seatsOpen(r: BoardRide, leg: Leg) {
  return Math.max(0, r.seatsTotal - (leg === 'to' ? r.seatsTakenTo : r.seatsTakenFrom));
}

/** One-way seat on a round trip pays half (rounded down, so the trip stays under the legal cap). */
export function oneWayShare(gasPerRider: number) {
  return Math.floor(gasPerRider / 2);
}

export const TRIP_LABEL: Record<TripType, string> = {
  round_trip: 'Round trip',
  to_mountain: 'One way up',
  from_mountain: 'One way down',
};
