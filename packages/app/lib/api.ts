import type { Session as SupabaseSession, SupabaseClient } from '@supabase/supabase-js';
import { friendlyError } from './errors';
import { fetchForecast } from './forecast';
import type { Api, BoardRide, ChatMessage, DriverVerification, FriendPerson, FriendState, Gender, PendingReview, PickedPhoto, ProfileFields, ProfilePage, RatingSummary, Review, SeatLegs, Session, Trip, TripType } from './types';

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
  driver_driving_avg: number | null;
  driver_experience_avg: number | null;
  driver_review_count: number;
  trip_type: TripType;
  return_at: string | null;
  return_meet: string;
  seats_taken_to: number;
  seats_taken_from: number;
  rider_legs: SeatLegs[];
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
  insurance_status: DriverVerification['insuranceStatus'];
  insurance_error: string | null;
  insurer: string | null;
  insurance_expires: string | null;
  review_note: string | null;
};

const DOCS_BUCKET = 'driver-docs';

const BOARD_COLUMNS =
  'id, driver_id, driver_name, resort_id, depart_at, leave_from, seats_total, gas_per_rider, gear, notes, seats_taken, rider_ids, rider_names, ride_date, gas_cap, driver_verified, driver_avatar_path, driver_gender, rider_avatar_paths, rider_genders, driver_driving_avg, driver_experience_avg, driver_review_count, trip_type, return_at, return_meet, seats_taken_to, seats_taken_from, rider_legs';

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
    driverDrivingAvg: r.driver_driving_avg == null ? null : Number(r.driver_driving_avg),
    driverExperienceAvg: r.driver_experience_avg == null ? null : Number(r.driver_experience_avg),
    driverReviewCount: r.driver_review_count ?? 0,
    tripType: r.trip_type ?? 'round_trip',
    returnAt: r.return_at,
    returnMeet: r.return_meet ?? '',
    seatsTakenTo: r.seats_taken_to ?? 0,
    seatsTakenFrom: r.seats_taken_from ?? 0,
    riderLegs: r.rider_legs ?? [],
  };
}

type MessageRow = { id: string; ride_id: string; sender_id: string; body: string; created_at: string; kind?: 'chat' | 'update' };
function toMessage(m: MessageRow): ChatMessage {
  return { id: m.id, rideId: m.ride_id, senderId: m.sender_id, body: m.body, createdAt: m.created_at, kind: m.kind === 'update' ? 'update' : 'chat' };
}

type FriendRow = { id: string; name: string; avatar_path: string | null; gender: Gender | null; home_resort_id?: string | null; school_year?: string | null; mutual?: boolean };
function toFriend(p: FriendRow, urls: Record<string, string>): FriendPerson {
  return {
    id: p.id,
    name: p.name,
    gender: p.gender,
    avatarUrl: p.avatar_path ? urls[p.avatar_path] ?? null : null,
    homeResortId: p.home_resort_id ?? null,
    schoolYear: p.school_year ?? null,
    mutual: !!p.mutual,
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
          trip_type: ride.tripType,
          depart_at: ride.departAt,
          return_at: ride.tripType === 'round_trip' ? ride.returnAt : null,
          return_meet: ride.tripType === 'round_trip' ? ride.returnMeet : '',
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
    async claimSeat(rideId, legs = 'both') {
      check(await supabase.rpc('claim_seat', { p_ride_id: rideId, p_legs: legs }));
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
    async rideForEdit(rideId) {
      const { data } = check(await supabase.rpc('ride_for_edit', { p_ride_id: rideId }));
      const r = data as Record<string, unknown> | null;
      if (!r) return null;
      return {
        id: String(r.id),
        resortId: String(r.resort_id),
        tripType: r.trip_type as TripType,
        departAt: String(r.depart_at),
        returnAt: (r.return_at as string | null) ?? null,
        returnMeet: String(r.return_meet ?? ''),
        leaveFrom: String(r.leave_from ?? ''),
        seatsTotal: Number(r.seats_total),
        gasPerRider: Number(r.gas_per_rider),
        gear: String(r.gear ?? ''),
        notes: String(r.notes ?? ''),
        contact: String(r.contact ?? ''),
        rideDate: String(r.ride_date),
        riders: Number(r.riders),
        seatsTakenTo: Number(r.seats_taken_to),
        seatsTakenFrom: Number(r.seats_taken_from),
      };
    },
    async updateRide(rideId, ride) {
      const { data } = check(
        await supabase
          .from('rides')
          .update({
            resort_id: ride.resortId,
            trip_type: ride.tripType,
            depart_at: ride.departAt,
            return_at: ride.tripType === 'round_trip' ? ride.returnAt : null,
            return_meet: ride.tripType === 'round_trip' ? ride.returnMeet : '',
            leave_from: ride.leaveFrom,
            seats_total: ride.seatsTotal,
            gas_per_rider: ride.gasPerRider,
            gear: ride.gear,
            notes: ride.notes,
            contact: ride.contact,
          })
          .eq('id', rideId)
          .select('id'),
      );
      if (!data?.length) throw new Error("That ride isn't yours to edit, or it was cancelled.");
    },

    async myFriends() {
      const { data } = check(await supabase.rpc('my_friends'));
      const d = (data ?? { friends: [], incoming: [], outgoing: [] }) as Record<'friends' | 'incoming' | 'outgoing', FriendRow[]>;
      const urls = await signAvatars([...d.friends, ...d.incoming, ...d.outgoing].map((p) => p.avatar_path));
      return { friends: d.friends.map((p) => toFriend(p, urls)), incoming: d.incoming.map((p) => toFriend(p, urls)), outgoing: d.outgoing.map((p) => toFriend(p, urls)) };
    },
    async profileFriends(userId) {
      const { data } = check(await supabase.rpc('profile_friends', { p_user_id: userId }));
      const d = (data ?? { count: 0, mutual: 0, state: 'none', friends: [] }) as { count: number; mutual: number; state: FriendState; friends: FriendRow[] };
      const urls = await signAvatars(d.friends.map((p) => p.avatar_path));
      return { count: d.count, mutual: d.mutual, state: d.state, friends: d.friends.map((p) => toFriend(p, urls)) };
    },
    async friendRequest(userId) {
      const { data } = check(await supabase.rpc('friend_request', { p_user_id: userId }));
      return data === 'friends' ? 'friends' : 'sent';
    },
    async respondFriend(userId, accept) {
      check(await supabase.rpc('friend_respond', { p_user_id: userId, p_accept: accept }));
    },
    async removeFriend(userId) {
      check(await supabase.rpc('friend_remove', { p_user_id: userId }));
    },
    async searchPeople(query) {
      if (query.trim().length < 2) return [];
      const { data } = check(await supabase.rpc('search_people', { p_query: query.trim().slice(0, 60) }));
      const rows = (data ?? []) as FriendRow[];
      const urls = await signAvatars(rows.map((p) => p.avatar_path));
      return rows.map((p) => toFriend(p, urls));
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
    async getReviews(userId) {
      const [sumRes, listRes] = await Promise.all([
        supabase.rpc('rating_summary', { p_user_id: userId }),
        supabase.rpc('reviews_for', { p_user_id: userId, p_limit: 50 }),
      ]);
      check(sumRes);
      check(listRes);
      const sRow = sumRes.data as Record<string, number | null>;
      const num = (v: unknown) => (v == null ? null : Number(v));
      const summary: RatingSummary = {
        drivingAvg: num(sRow.driving_avg),
        driverExperienceAvg: num(sRow.driver_experience_avg),
        driverCount: Number(sRow.driver_count ?? 0),
        passengerAvg: num(sRow.passenger_avg),
        passengerCount: Number(sRow.passenger_count ?? 0),
      };
      const rows = (listRes.data ?? []) as Record<string, string | number | null>[];
      const urls = await signAvatars(rows.map((r) => r.reviewer_avatar_path as string | null));
      const reviews: Review[] = rows.map((r) => ({
        id: String(r.id),
        role: r.role as Review['role'],
        driving: num(r.driving),
        experience: Number(r.experience),
        body: String(r.body ?? ''),
        createdAt: String(r.created_at),
        resortId: String(r.resort_id),
        reviewerId: String(r.reviewer_id),
        reviewerName: String(r.reviewer_name ?? ''),
        reviewerAvatarUrl: r.reviewer_avatar_path ? urls[String(r.reviewer_avatar_path)] ?? null : null,
        reviewerGender: (r.reviewer_gender as Gender | null) ?? null,
      }));
      return { summary, reviews };
    },
    async reviewsToWrite() {
      const { data } = check(await supabase.rpc('reviews_to_write'));
      type Row = { ride_id: string; resort_id: string; depart_at: string; closes_at: string; people: { id: string; role: 'driver' | 'passenger'; name: string; avatar_path: string | null; gender: Gender | null }[] };
      const rows = (data ?? []) as Row[];
      const urls = await signAvatars(rows.flatMap((r) => r.people.map((p) => p.avatar_path)));
      return rows.map(
        (r): PendingReview => ({
          rideId: r.ride_id,
          resortId: r.resort_id,
          departAt: r.depart_at,
          closesAt: r.closes_at,
          people: r.people.map((p) => ({ id: p.id, role: p.role, name: p.name, gender: p.gender, avatarUrl: p.avatar_path ? urls[p.avatar_path] ?? null : null })),
        }),
      );
    },
    async submitReview(r) {
      check(
        await supabase.rpc('submit_review', {
          p_ride_id: r.rideId,
          p_reviewee_id: r.revieweeId,
          p_experience: r.experience,
          p_driving: r.driving ?? null,
          p_body: r.body ?? '',
        }),
      );
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
      return {
        status: v.status,
        identity: v.identity_status,
        identityError: v.identity_error,
        idName: v.id_name,
        consented: v.consented,
        hasInsurance: v.has_insurance,
        insuranceStatus: v.insurance_status,
        insuranceError: v.insurance_error,
        insurer: v.insurer,
        insuranceExpires: v.insurance_expires,
        reviewNote: v.review_note,
      };
    },
    async giveBiometricConsent() {
      check(await supabase.rpc('give_biometric_consent'));
    },
    async checkLicense(license, selfie) {
      const { data, error } = await supabase.functions.invoke('license-check', {
        body: { license: await photoBase64(license), selfie: await photoBase64(selfie) },
      });
      if (error) {
        let message = "Couldn't check your license. Try again in a minute.";
        try {
          const body = await (error as { context?: Response }).context?.json();
          if (body?.error) message = body.error;
        } catch {
          // keep the default message
        }
        throw new Error(message);
      }
      return data as { status: 'verified' | 'requires_input'; error?: string };
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
    async checkInsurance(card) {
      const { error } = await supabase.functions.invoke('insurance-check', { body: { card: await photoBase64(card) } });
      if (error) {
        let message = "Couldn't check your insurance card. Try again in a minute.";
        try {
          const body = await (error as { context?: Response }).context?.json();
          if (body?.error) message = body.error;
        } catch {
          // keep the default message
        }
        throw new Error(message);
      }
      return api.getDriverVerification();
    },


    getForecast: fetchForecast,

    async myTrips() {
      const { data } = check(await supabase.rpc('my_trips'));
      type P = { id: string; name: string; avatar_path: string | null; gender: Gender | null; legs?: SeatLegs };
      type Row = {
        id: string; role: Trip['role']; my_legs: SeatLegs | null; resort_id: string; trip_type: TripType; depart_at: string; return_at: string | null;
        leave_from: string; return_meet: string; seats_total: number; gas_per_rider: number; contact: string; driver: P; passengers: P[];
        checkins: { leg: 'to' | 'from'; rider_id: string; rider_confirmed_at: string | null; driver_status: 'picked_up' | 'no_show' | null }[];
      };
      const rows = (data ?? []) as Row[];
      const urls = await signAvatars(rows.flatMap((r) => [r.driver.avatar_path, ...r.passengers.map((p) => p.avatar_path)]));
      const person = (p: P) => ({ id: p.id, name: p.name, gender: p.gender, avatarUrl: p.avatar_path ? urls[p.avatar_path] ?? null : null });
      return rows.map(
        (r): Trip => ({
          id: r.id,
          role: r.role,
          myLegs: r.my_legs,
          resortId: r.resort_id,
          tripType: r.trip_type,
          departAt: r.depart_at,
          returnAt: r.return_at,
          leaveFrom: r.leave_from,
          returnMeet: r.return_meet,
          seatsTotal: r.seats_total,
          gasPerRider: r.gas_per_rider,
          contact: r.contact,
          driver: person(r.driver),
          passengers: r.passengers.map((p) => ({ ...person(p), legs: p.legs ?? 'both' })),
          checkins: r.checkins.map((c) => ({ leg: c.leg, riderId: c.rider_id, riderConfirmedAt: c.rider_confirmed_at, driverStatus: c.driver_status })),
        }),
      );
    },
    async listMessages(rideId) {
      const { data } = check(
        await supabase.from('ride_messages').select('id, ride_id, sender_id, body, created_at, kind').eq('ride_id', rideId).order('created_at').limit(500),
      );
      return ((data ?? []) as MessageRow[]).map(toMessage);
    },
    async sendMessage(rideId, body) {
      check(await supabase.from('ride_messages').insert({ ride_id: rideId, body: body.trim().slice(0, 1000) }));
    },
    subscribeMessages(rideId, onMessage) {
      const channel = supabase
        .channel(`ride-chat-${rideId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ride_messages', filter: `ride_id=eq.${rideId}` }, (payload) =>
          onMessage(toMessage(payload.new as MessageRow)),
        )
        .subscribe();
      return () => {
        supabase.removeChannel(channel);
      };
    },
    async confirmMySeat(rideId, leg) {
      check(await supabase.rpc('confirm_my_seat', { p_ride_id: rideId, p_leg: leg }));
    },
    async confirmPassenger(rideId, leg, riderId, status) {
      check(await supabase.rpc('confirm_passenger', { p_ride_id: rideId, p_leg: leg, p_rider_id: riderId, p_status: status }));
    },
    async registerPushToken(token, platform) {
      check(await supabase.rpc('register_push_token', { p_token: token, p_platform: platform }));
    },

  };
  return api;
}

async function photoBase64(photo: PickedPhoto) {
  const buffer = photo.body instanceof ArrayBuffer ? photo.body : await photo.body.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
