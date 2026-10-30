import type { Session as SupabaseSession, SupabaseClient } from '@supabase/supabase-js';
import { friendlyError } from './errors';
import { fetchForecast } from './forecast';
import type { Api, BoardRide, DriverVerification, Gender, ProfileFields, ProfilePage, Session } from './types';

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
  driver_avatar_path: string | null;
  driver_gender: Gender | null;
  rider_avatar_paths: (string | null)[];
  rider_genders: (Gender | null)[];
};

type ProfileRow = {
  id: string;
  full_name: string;
  avatar_path: string | null;
  gender: Gender | null;
  bio: string;
  instagram: string | null;
  discipline: ProfileFields['discipline'];
  home_resort_id: string | null;
  school_year: string | null;
  hometown: string | null;
  interests: string[];
  prompts: ProfileFields['prompts'];
  member_since: string;
  id_verified: boolean;
  driver_verified: boolean;
  profile_complete: boolean;
  rides_driven: number;
  rides_taken: number;
  upcoming: { id: string; resort_id: string; depart_at: string; seats_total: number; seats_taken: number }[];
};

const AVATARS_BUCKET = 'avatars';

type VerificationRow = {
  status: DriverVerification['status'];
  identity_status: DriverVerification['identity'];
  identity_error: string | null;
  id_name: string | null;
  consented: boolean;
  has_insurance: boolean;
  insurance_path: string | null;
  review_note: string | null;
};

const DOCS_BUCKET = 'driver-docs';

const BOARD_COLUMNS =
  'id, driver_id, driver_name, resort_id, depart_at, leave_from, seats_total, gas_per_rider, gear, notes, seats_taken, rider_ids, rider_names, ride_date, gas_cap, driver_verified, driver_avatar_path, driver_gender, rider_avatar_paths, rider_genders';

function toSession(s: SupabaseSession | null): Session | null {
  if (!s) return null;
  return {
    userId: s.user.id,
    email: s.user.email ?? '',
    name: (s.user.user_metadata?.full_name as string | undefined) ?? '',
  };
}

function toRide(r: BoardRow, urls: Record<string, string>): BoardRide {
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
    driverAvatarUrl: r.driver_avatar_path ? urls[r.driver_avatar_path] ?? null : null,
    driverGender: r.driver_gender,
    riderAvatarUrls: (r.rider_avatar_paths ?? []).map((p) => (p ? urls[p] ?? null : null)),
    riderGenders: r.rider_genders ?? [],
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

  // Profile photos are private: signed links, cached until shortly before they expire.
  const urlCache = new Map<string, { url: string; until: number }>();
  async function signAvatars(paths: (string | null | undefined)[]) {
    const now = Date.now();
    const need = [...new Set(paths.filter((p): p is string => !!p))].filter((p) => (urlCache.get(p)?.until ?? 0) < now);
    if (need.length) {
      const { data } = await supabase.storage.from(AVATARS_BUCKET).createSignedUrls(need, 3600);
      for (const item of data ?? []) {
        if (item.path && item.signedUrl) urlCache.set(item.path, { url: item.signedUrl, until: now + 50 * 60 * 1000 });
      }
    }
    const out: Record<string, string> = {};
    for (const p of paths) if (p && urlCache.has(p)) out[p] = urlCache.get(p)!.url;
    return out;
  }

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
      const rows = (data ?? []) as BoardRow[];
      const urls = await signAvatars(rows.flatMap((r) => [r.driver_avatar_path, ...(r.rider_avatar_paths ?? [])]));
      return rows.map((r) => toRide(r, urls));
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

    async getProfile(userId) {
      const { data } = check(await supabase.rpc('profile_page', { p_user_id: userId }));
      const p = data as ProfileRow | null;
      if (!p) return null;
      const urls = await signAvatars([p.avatar_path]);
      const page: ProfilePage = {
        id: p.id,
        fullName: p.full_name,
        avatarUrl: p.avatar_path ? urls[p.avatar_path] ?? null : null,
        gender: p.gender,
        discipline: p.discipline,
        homeResortId: p.home_resort_id,
        schoolYear: p.school_year ?? '',
        hometown: p.hometown ?? '',
        bio: p.bio ?? '',
        instagram: p.instagram ?? '',
        interests: p.interests ?? [],
        prompts: p.prompts ?? {},
        memberSince: p.member_since,
        idVerified: p.id_verified,
        driverVerified: p.driver_verified,
        profileComplete: p.profile_complete,
        ridesDriven: p.rides_driven,
        ridesTaken: p.rides_taken,
        upcoming: (p.upcoming ?? []).map((u) => ({
          id: u.id,
          resortId: u.resort_id,
          departAt: u.depart_at,
          seatsTotal: u.seats_total,
          seatsTaken: u.seats_taken,
        })),
      };
      return page;
    },
    async updateProfile(f) {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid) throw new Error('Sign in first.');
      const row: Record<string, unknown> = {};
      if (f.fullName !== undefined) row.full_name = f.fullName.trim().slice(0, 80);
      if (f.gender !== undefined) row.gender = f.gender;
      if (f.discipline !== undefined) row.discipline = f.discipline;
      if (f.homeResortId !== undefined) row.home_resort_id = f.homeResortId;
      if (f.schoolYear !== undefined) row.school_year = f.schoolYear.trim().slice(0, 40) || null;
      if (f.hometown !== undefined) row.hometown = f.hometown.trim().slice(0, 60) || null;
      if (f.bio !== undefined) row.bio = f.bio.trim().slice(0, 300);
      if (f.instagram !== undefined) row.instagram = f.instagram.trim().replace(/^@/, '').toLowerCase() || null;
      if (f.interests !== undefined) row.interests = f.interests;
      if (f.prompts !== undefined) {
        row.prompts = Object.fromEntries(
          Object.entries(f.prompts)
            .map(([k, v]) => [k, (v ?? '').trim().slice(0, 140)])
            .filter(([, v]) => v),
        );
      }
      const res = await supabase.from('profiles').update(row).eq('id', uid);
      if (res.error) {
        if (res.error.message.includes('instagram')) throw new Error('That Instagram handle has characters Instagram doesn’t allow. Use letters, numbers, dots and underscores.');
        throw new Error(friendlyError(res.error));
      }
    },
    async completeProfile() {
      const { data } = check(await supabase.rpc('complete_profile'));
      return (data as string[]) ?? [];
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
        identity: v.identity_status,
        identityError: v.identity_error,
        idName: v.id_name,
        consented: v.consented,
        hasInsurance: v.has_insurance,
        insuranceUrl: await signed(v.insurance_path),
        reviewNote: v.review_note,
      };
    },
    async giveBiometricConsent() {
      check(await supabase.rpc('give_biometric_consent'));
    },
    async startIdentityCheck(platform) {
      const { data, error } = await supabase.functions.invoke('identity-start', { body: { platform } });
      if (error) {
        // The function's own message is in the response body.
        let message = "Couldn't start the ID check. Try again in a minute.";
        try {
          const body = await (error as { context?: Response }).context?.json();
          if (body?.error) message = body.error;
        } catch {
          // keep the default message
        }
        throw new Error(message);
      }
      return data as { url?: string; status: 'pending' | 'processing' | 'verified' };
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
