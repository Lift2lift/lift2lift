/**
 * Colorado carpooling-app rules (C.R.S. 43-1-127). The database enforces all
 * of these (supabase/migrations/…_colorado_carpool_rules.sql); the app uses
 * the same numbers to guide people before they hit an error.
 */
import { RESORT_BY_ID } from './resorts';

/** No more than 6 passengers per car, not counting the driver. */
export const MAX_PASSENGERS = 6;

/** Seats must be reserved at least this far ahead of departure. */
export const BOOKING_LEAD_HOURS = 2;

/** IRS business standard mileage rate, cents per mile. Add each new year in January (also in the mileage_rates table). */
export const MILEAGE_CENTS: Record<number, number> = { 2025: 70, 2026: 72.5 };

/** Disclaimer the law requires carpool apps to display prominently. */
export const CARPOOL_DISCLAIMER =
  'Be advised that carpooling service companies are not regulated by the state of Colorado. Background checks might not be performed on drivers, drivers are not subject to medical examination and certification, vehicles are not subject to inspection by the state, and state insurance verification is not performed.';

export function mileageCents(year: number) {
  const years = Object.keys(MILEAGE_CENTS).map(Number).sort((a, b) => b - a);
  const y = years.find((x) => x <= year) ?? years[0];
  return MILEAGE_CENTS[y];
}

/** Most a driver can collect for the whole trip: round-trip miles × IRS rate, in whole dollars. */
export function gasCapDollars(resortId: string, departAt: string | Date) {
  const resort = RESORT_BY_ID[resortId];
  if (!resort) return 0;
  const year = new Date(departAt).getFullYear();
  return Math.floor((resort.roundTripMiles * mileageCents(year)) / 100);
}

/** Cap for a trip type: a one-way trip drives half the round-trip miles. */
export function tripGasCap(resortId: string, departAt: string | Date, tripType: 'round_trip' | 'to_mountain' | 'from_mountain' = 'round_trip') {
  const cap = gasCapDollars(resortId, departAt);
  return tripType === 'round_trip' ? cap : Math.floor(cap / 2);
}

/** Highest per-rider ask so that a full car stays under the cap. */
export function maxGasPerRider(resortId: string, departAt: string | Date, seats: number, tripType: 'round_trip' | 'to_mountain' | 'from_mountain' = 'round_trip') {
  return Math.floor(tripGasCap(resortId, departAt, tripType) / Math.max(1, seats));
}

export function bookingClosed(departAt: string, now = Date.now()) {
  return new Date(departAt).getTime() - now < BOOKING_LEAD_HOURS * 3600 * 1000;
}

/** Earliest departure someone can post right now. */
export function earliestDeparture(now = Date.now()) {
  return new Date(now + BOOKING_LEAD_HOURS * 3600 * 1000);
}
