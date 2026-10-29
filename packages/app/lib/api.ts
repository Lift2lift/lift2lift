import type { Session as SupabaseSession, SupabaseClient } from '@supabase/supabase-js';
import { friendlyError } from './errors';
import { fetchForecast } from './forecast';
import type { Api, BoardRide, DriverVerification, Session } from './types';

type BoardRow = {
  id: string;
  driver_id: string;
  driver_name: string;
  resort_id: string;
  depart_at: string;
  leave_from: string;
  seats_total: number;
  gas_per_rider: number;
  gear: string;
  notes: string;
  seats_taken: number;
  rider_ids: string[];
  rider_names: string[];
  ride_date: string;
  gas_cap: number;
  driver_verified: boolean;
};

type VerificationRow = {
  status: DriverVerification['status'];
  has_license: boolean;
  has_insurance: boolean;
  license_path: string | null;
  insurance_path: string | null;
  review_note: string | null;
};

const DOCS_BUCKET = 'driver-docs';

const BOARD_COLUMNS =
  'id, driver_id, driver_name, resort_id, depart_at, leave_from, seats_total, gas_per_rider, gear, notes, seats_taken, rider_ids, rider_names, ride_date, gas_cap, driver_verified';

function toSession(s: SupabaseSession | null): Session | null {
  if (!s) return null;
  return {
    userId: s.user.id,
    email: s.user.email ?? '',
    name: (s.user.user_metadata?.full_name as string | undefined) ?? '',
  };
}

function toRide(r: BoardRow): BoardRide {
  return {
    id: r.id,
    driverId: r.driver_id,
    driverName: r.driver_name,
    resortId: r.resort_id,
    departAt: r.depart_at,
    leaveFrom: r.leave_from,
    seatsTotal: r.seats_total,
    gasPerRider: r.gas_per_rider,
    gear: r.gear,
    notes: r.notes,
    seatsTaken: r.seats_taken,
    riderIds: r.rider_ids ?? [],
    riderNames: r.rider_names ?? [],
    rideDate: r.ride_date,
    gasCap: r.gas_cap,
    driverVerified: !!r.driver_verified,
  };
}

/** Throw a readable error for any Supabase failure. */
function check<T extends { error: unknown }>(result: T): T {
  if (result.error) throw new Error(friendlyError(result.error));
  return result;
}

/** The Supabase-backed implementation of everything the screens call. */
export function createApi(supabase: SupabaseClient): Api {
  const listeners = new Set<(s: Session | null) => void>();
  let holdEvents = false; // true while a password reset is mid-flight
  const emit = (s: Session | null) => listeners.forEach((l) => l(s));

  supabase.auth.onAuthStateChange((_event, session) => {
    if (!holdEvents) emit(toSession(session));
  });

  const api: Api = {
    async getSession() {
      const { data } = await supabase.auth.getSession();
      return toSession(data.session);
    },
    onAuthChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async signIn(email, password) {
      check(await supabase.auth.signInWithPassword({ email, password }));
    },
    async signInWithGoogle() {
      const redirectTo = typeof window !== 'undefined' ? window.location.origin : undefined;
      check(await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } }));
    },
    async signUp(name, email, password) {
      const { data } = check(await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } }));
      return { needsVerification: !data.session };
    },
    async verifySignup(email, code) {
      check(await supabase.auth.verifyOtp({ email, token: code, type: 'email' }));
    },
    async resendSignup(email) {
      check(await supabase.auth.resend({ type: 'signup', email }));
    },
    async sendPasswordReset(email) {
      check(await supabase.auth.resetPasswordForEmail(email));
    },
    async resetPassword(email, code, newPassword) {
      // Verifying the recovery code signs the person in. Hold the sign-in
      // event until the new password is saved, so the app doesn't jump away.
      holdEvents = true;
      try {
        check(await supabase.auth.verifyOtp({ email, token: code, type: 'recovery' }));
        const update = await supabase.auth.updateUser({ password: newPassword });
        if (update.error) {
          await supabase.auth.signOut();
          throw new Error(friendlyError(update.error));
        }
      } finally {
        holdEvents = false;
        const { data } = await supabase.auth.getSession();
        emit(toSession(data.session));
      }
    },
    async signOut() {
      check(await supabase.auth.signOut());
    },

    async listRides() {
      const { data } = check(
        await supabase.from('ride_board').select(BOARD_COLUMNS).order('depart_at', { ascending: true }).limit(500),
      );
      return ((data ?? []) as BoardRow[]).map(toRide);
    },
    async postRide(ride) {
      check(
        await supabase.from('rides').insert({
          resort_id: ride.resortId,
          depart_at: ride.departAt,
          leave_from: ride.leaveFrom,
          seats_total: ride.seatsTotal,
          gas_per_rider: ride.gasPerRider,
          gear: ride.gear,
          notes: ride.notes,
          contact: ride.contact,
        }),
      );
    },
    async cancelRide(rideId) {
      check(await supabase.from('rides').update({ cancelled_at: new Date().toISOString() }).eq('id', rideId));
    },
    async claimSeat(rideId) {
      check(await supabase.rpc('claim_seat', { p_ride_id: rideId }));
    },
    async leaveSeat(rideId) {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid) throw new Error('Sign in first.');
      check(await supabase.from('ride_seats').delete().eq('ride_id', rideId).eq('rider_id', uid));
    },
    async removeRider(rideId, riderId) {
      check(await supabase.from('ride_seats').delete().eq('ride_id', rideId).eq('rider_id', riderId));
    },
    async rideContact(rideId) {
      const { data } = check(await supabase.rpc('ride_contact', { p_ride_id: rideId }));
      return (data as string | null) ?? null;
    },

    async getDriverVerification(options) {
      const { data } = check(await supabase.rpc('driver_verification_status'));
      const v = data as VerificationRow;
      const signed = async (path: string | null) => {
        if (!path || !options?.withPhotos) return null;
        const res = await supabase.storage.from(DOCS_BUCKET).createSignedUrl(path, 600);
        return res.data?.signedUrl ?? null;
      };
      return {
        status: v.status,
        hasLicense: v.has_license,
        hasInsurance: v.has_insurance,
        licenseUrl: await signed(v.license_path),
        insuranceUrl: await signed(v.insurance_path),
        reviewNote: v.review_note,
      };
    },
    async uploadDriverDoc(doc, photo) {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid) throw new Error('Sign in first.');
      const bucket = supabase.storage.from(DOCS_BUCKET);
      // Replacing a photo with a different file type: remove the old one.
      const existing = await bucket.list(uid);
      const stale = (existing.data ?? []).filter((f) => f.name.startsWith(`${doc}.`) && f.name !== `${doc}.${photo.ext}`).map((f) => `${uid}/${f.name}`);
      if (stale.length) await bucket.remove(stale);
      const up = await bucket.upload(`${uid}/${doc}.${photo.ext}`, photo.body, { contentType: photo.contentType, upsert: true });
      if (up.error) {
        const m = up.error.message.toLowerCase();
        if (m.includes('size') || m.includes('too large')) throw new Error('That photo is too big. Try again with a smaller one (under 10 MB).');
        if (m.includes('mime') || m.includes('type')) throw new Error('Use a JPG, PNG or HEIC photo.');
        throw new Error(friendlyError(up.error));
      }
      return api.getDriverVerification({ withPhotos: true });
    },

    getForecast: fetchForecast,
  };
  return api;
}
