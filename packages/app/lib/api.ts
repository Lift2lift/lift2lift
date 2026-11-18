import { TERMS_VERSION } from './legal';
import type { Session as SupabaseSession, SupabaseClient } from '@supabase/supabase-js';
import { friendlyError } from './errors';
import { fetchForecast } from './forecast';
import type { Api, BoardRide, SeatRequest, SeatStatus, ChatMessage, Community, CommunityEvent, CommunityPage, CommunityRole, GoogleCalendarChoice, JoinCommunityResult, PopularCommunity, DriverVerification, FriendPerson, FriendState, Gender, PendingReview, PickedPhoto, ProfileFields, ProfilePage, RatingSummary, Review, SeatLegs, Session, Trip, TripType } from './types';

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
  community_id: string | null;
  community_name: string | null;
  seats_pending?: number;
  event_id?: string | null;
  event_title?: string | null;
  my_seat_status?: SeatStatus | null;
  my_seat_legs?: SeatLegs | null;
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
const COMMUNITY_PHOTOS_BUCKET = 'community-photos';

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
  'id, driver_id, driver_name, resort_id, depart_at, leave_from, seats_total, gas_per_rider, gear, notes, seats_taken, rider_ids, rider_names, ride_date, gas_cap, driver_verified, driver_avatar_path, driver_gender, rider_avatar_paths, rider_genders, driver_driving_avg, driver_experience_avg, driver_review_count, trip_type, return_at, return_meet, seats_taken_to, seats_taken_from, rider_legs, community_id, community_name, seats_pending, event_id, event_title, my_seat_status, my_seat_legs';

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
    communityId: r.community_id ?? null,
    communityName: r.community_name ?? null,
    seatsPending: r.seats_pending ?? 0,
    eventId: r.event_id ?? null,
    eventTitle: r.event_title ?? null,
    myStatus: r.my_seat_status ?? null,
    myLegs: r.my_seat_legs ?? null,
  };
}

/** Community codes are 9 characters; spaces and dashes are ignored. */
export function normalizeCommunityCode(code: string) {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
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

  /** Calls the google-calendar function. Rejects with the function's own message (they are written to show). */
  async function googleCalendarCall<T = unknown>(body: Record<string, string>): Promise<T | null> {
    let message = "Couldn't reach Google. Try again.";
    try {
      const { data, error } = await supabase.functions.invoke('google-calendar', { body });
      if (!error) return data as T | null;
      try {
        const b = await (error as { context?: Response }).context?.json();
        if (typeof b?.error === 'string' && b.error) message = b.error;
      } catch {
        // keep the default message
      }
    } catch {
      // keep the default message
    }
    throw new Error(message);
  }

  // People hidden from me (I blocked them, or they blocked me). Cached briefly, cleared on block changes.
  let hiddenCache: { ids: Promise<Set<string>>; until: number } | null = null;
  function hidden() {
    if (!hiddenCache || hiddenCache.until < Date.now()) {
      const ids = (async () => {
        const { data, error } = await supabase.rpc('hidden_people');
        return new Set<string>(error ? [] : ((data ?? []) as string[]));
      })();
      hiddenCache = { ids, until: Date.now() + 60_000 };
    }
    return hiddenCache.ids;
  }

  supabase.auth.onAuthStateChange((_event, session) => {
    hiddenCache = null;
    if (!holdEvents) emit(toSession(session));
  });

  // Profile photos are private: signed links, cached until shortly before they expire.
  const urlCache = new Map<string, { url: string; until: number }>();
  async function signFrom(bucket: string, paths: (string | null | undefined)[]) {
    const now = Date.now();
    const key = (p: string) => `${bucket}:${p}`;
    const need = [...new Set(paths.filter((p): p is string => !!p))].filter((p) => (urlCache.get(key(p))?.until ?? 0) < now);
    if (need.length) {
      const { data } = await supabase.storage.from(bucket).createSignedUrls(need, 3600);
      for (const item of data ?? []) {
        if (item.path && item.signedUrl) urlCache.set(key(item.path), { url: item.signedUrl, until: now + 50 * 60 * 1000 });
      }
    }
    const out: Record<string, string> = {};
    for (const p of paths) if (p && urlCache.has(key(p))) out[p] = urlCache.get(key(p))!.url;
    return out;
  }
  const signAvatars = (paths: (string | null | undefined)[]) => signFrom(AVATARS_BUCKET, paths);
  /** Community profile pictures: path to signed link, or null. */
  async function communityPhotos(paths: (string | null | undefined)[]) {
    const urls = await signFrom(COMMUNITY_PHOTOS_BUCKET, paths);
    return (p: string | null | undefined) => (p ? urls[p] ?? null : null);
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
      const { data } = check(await supabase.auth.signUp({ email, password, options: { data: { full_name: name, terms_version: TERMS_VERSION, terms_accepted_at: new Date().toISOString() } } }));
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
      const hide = await hidden();
      const rows = ((data ?? []) as BoardRow[]).filter((r) => !hide.has(r.driver_id) && !(r.rider_ids ?? []).some((id) => hide.has(id)));
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
          community_id: ride.communityId,
          event_id: ride.eventId,
        }),
      );
    },
    async cancelRide(rideId) {
      check(await supabase.from('rides').update({ cancelled_at: new Date().toISOString() }).eq('id', rideId));
    },
    async claimSeat(rideId, legs, acknowledgedNotice) {
      check(await supabase.rpc('claim_seat', { p_ride_id: rideId, p_legs: legs, p_notice_ack: acknowledgedNotice }));
    },
    async leaveSeat(rideId) {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid) throw new Error('Sign in first.');
      check(await supabase.from('ride_seats').delete().eq('ride_id', rideId).eq('rider_id', uid));
    },
    async respondToRequest(rideId, riderId, confirm) {
      check(await supabase.rpc('respond_seat_request', { p_ride_id: rideId, p_rider_id: riderId, p_confirm: confirm }));
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
        communityId: (r.community_id as string | null) ?? null,
        eventId: (r.event_id as string | null) ?? null,
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
            community_id: ride.communityId,
            event_id: ride.eventId,
          })
          .eq('id', rideId)
          .select('id'),
      );
      if (!data?.length) throw new Error("That ride isn't yours to edit, or it was cancelled.");
    },

    async myCommunities() {
      const { data } = check(await supabase.rpc('my_communities'));
      type Row = { id: string; name: string; description: string; photo_path: string | null; code: string | null; role: CommunityRole; listed: boolean; member_count: number; upcoming_rides: number; pending_requests: number; next_event: { id: string; title: string; starts_at: string; all_day: boolean } | null };
      const rows = (data ?? []) as Row[];
      const photo = await communityPhotos(rows.map((c) => c.photo_path));
      return rows.map(
        (c): Community => ({
          id: c.id,
          name: c.name,
          description: c.description ?? '',
          photoUrl: photo(c.photo_path),
          code: c.code,
          role: c.role,
          listed: c.listed !== false,
          memberCount: Number(c.member_count),
          upcomingRides: Number(c.upcoming_rides),
          pendingRequests: Number(c.pending_requests ?? 0),
          nextEvent: c.next_event ? { id: c.next_event.id, title: c.next_event.title, startsAt: c.next_event.starts_at, allDay: !!c.next_event.all_day } : null,
        }),
      );
    },
    async joinCommunity(code) {
      const { data } = check(await supabase.rpc('join_community', { p_code: normalizeCommunityCode(code) }));
      return data as JoinCommunityResult;
    },
    async setupCommunity(code, name, description) {
      const { data } = check(
        await supabase.rpc('setup_community', { p_code: normalizeCommunityCode(code), p_name: name, p_description: description }),
      );
      return data as JoinCommunityResult;
    },
    async communityPage(communityId) {
      const { data } = check(await supabase.rpc('community_page', { p_community_id: communityId }));
      type M = { id: string; full_name: string; avatar_path: string | null; gender: Gender | null; role: CommunityRole; joined_at: string };
      type Q = { id: string; full_name: string; avatar_path: string | null; gender: Gender | null; requested_at: string };
      const d = data as { id: string; name: string; description: string; photo_path: string | null; code: string | null; listed: boolean; my_role: CommunityRole; member_count: number; members: M[]; requests: Q[] };
      const [urls, photo] = await Promise.all([
        signAvatars([...d.members, ...(d.requests ?? [])].map((m) => m.avatar_path)),
        communityPhotos([d.photo_path]),
      ]);
      return {
        id: d.id,
        name: d.name,
        description: d.description ?? '',
        photoUrl: photo(d.photo_path),
        code: d.code,
        listed: d.listed !== false,
        myRole: d.my_role,
        memberCount: Number(d.member_count),
        members: d.members.map((m) => ({
          id: m.id,
          name: m.full_name,
          avatarUrl: m.avatar_path ? urls[m.avatar_path] ?? null : null,
          gender: m.gender,
          role: m.role,
          joinedAt: m.joined_at,
        })),
        requests: (d.requests ?? []).map((q) => ({
          id: q.id,
          name: q.full_name,
          avatarUrl: q.avatar_path ? urls[q.avatar_path] ?? null : null,
          gender: q.gender,
          requestedAt: q.requested_at,
        })),
      } satisfies CommunityPage;
    },
    async communityCalendar(communityId) {
      const { data } = check(await supabase.rpc('community_calendar', { p_community_id: communityId }));
      if (!data) return null;
      const d = data as {
        source: 'ics' | 'google' | null;
        ics_url: string | null;
        google_calendar_name: string | null;
        google_email: string | null;
        google_pending: boolean | null;
        last_synced_at: string | null;
        last_error: string | null;
      };
      return {
        source: d.source ?? null,
        icsUrl: d.ics_url ?? null,
        googleCalendarName: d.google_calendar_name ?? null,
        googleEmail: d.google_email ?? null,
        googlePending: d.google_pending === true,
        lastSyncedAt: d.last_synced_at,
        lastError: d.last_error,
      };
    },
    async setCommunityCalendar(communityId, url) {
      check(await supabase.rpc('set_community_calendar', { p_community_id: communityId, p_url: url }));
    },
    async syncCommunityCalendar(communityId) {
      const generic = "Couldn't sync the calendar. Try again.";
      let result: { ok?: boolean; error?: unknown } | null = null;
      try {
        const { data, error } = await supabase.functions.invoke('sync-community-calendars', { body: { community_id: communityId } });
        if (!error) result = data as { ok?: boolean; error?: unknown } | null;
      } catch {
        // fall through to the generic message
      }
      if (result?.ok === true) return;
      throw new Error(result?.ok === false && typeof result.error === 'string' && result.error ? result.error : generic);
    },
    async startGoogleCalendar(communityId, returnTo) {
      const data = await googleCalendarCall<{ url?: string }>({ action: 'start', community_id: communityId, return_to: returnTo });
      if (!data?.url) throw new Error("Couldn't reach Google. Try again.");
      return data.url;
    },
    async googleCalendars(communityId) {
      const data = await googleCalendarCall<{ calendars?: GoogleCalendarChoice[] }>({ action: 'calendars', community_id: communityId });
      return data?.calendars ?? [];
    },
    async chooseGoogleCalendar(communityId, calendarId) {
      await googleCalendarCall({ action: 'choose', community_id: communityId, calendar_id: calendarId });
    },
    async disconnectGoogleCalendar(communityId) {
      await googleCalendarCall({ action: 'disconnect', community_id: communityId });
    },
    async communityEvents(communityId, fromDay, toDay) {
      const { data } = check(await supabase.rpc('community_events', { p_community_id: communityId, p_from: fromDay, p_to: toDay }));
      type P = { id: string; full_name: string; avatar_path: string | null; gender: Gender | null };
      type Row = {
        id: string;
        community_id: string;
        title: string;
        description: string | null;
        location: string | null;
        resort_id: string | null;
        starts_at: string;
        ends_at: string;
        all_day: boolean;
        source: 'manual' | 'ics';
        going: number;
        i_am_in: boolean;
        going_people: P[] | null;
        ride_count: number;
      };
      const rows = (data ?? []) as Row[];
      const urls = await signAvatars(rows.flatMap((e) => (e.going_people ?? []).map((p) => p.avatar_path)));
      return rows.map(
        (e): CommunityEvent => ({
          id: e.id,
          communityId: e.community_id,
          title: e.title,
          description: e.description ?? '',
          location: e.location ?? '',
          resortId: e.resort_id ?? null,
          startsAt: e.starts_at,
          endsAt: e.ends_at,
          allDay: !!e.all_day,
          source: e.source,
          going: Number(e.going),
          iAmIn: !!e.i_am_in,
          goingPeople: (e.going_people ?? []).map((p) => ({
            id: p.id,
            name: p.full_name,
            avatarUrl: p.avatar_path ? urls[p.avatar_path] ?? null : null,
            gender: p.gender,
          })),
          rideCount: Number(e.ride_count ?? 0),
        }),
      );
    },
    async setEventRsvp(eventId, going) {
      check(await supabase.rpc('set_event_rsvp', { p_event_id: eventId, p_going: going }));
    },
    async createCommunityEvent(communityId, event) {
      const { data } = check(
        await supabase.rpc('create_community_event', {
          p_community_id: communityId,
          p_title: event.title,
          p_description: event.description,
          p_location: event.location,
          p_resort_id: event.resortId,
          p_starts_at: event.startsAt,
          p_ends_at: event.endsAt,
          p_all_day: event.allDay,
        }),
      );
      return data as string;
    },
    async updateCommunityEvent(eventId, event) {
      check(
        await supabase.rpc('update_community_event', {
          p_event_id: eventId,
          p_title: event.title,
          p_description: event.description,
          p_location: event.location,
          p_resort_id: event.resortId,
          p_starts_at: event.startsAt,
          p_ends_at: event.endsAt,
          p_all_day: event.allDay,
        }),
      );
    },
    async cancelCommunityEvent(eventId) {
      check(await supabase.rpc('cancel_community_event', { p_event_id: eventId }));
    },
    async leaveCommunity(communityId) {
      check(await supabase.rpc('leave_community', { p_community_id: communityId }));
    },
    async updateCommunity(communityId, name, description) {
      check(await supabase.rpc('update_community', { p_community_id: communityId, p_name: name, p_description: description }));
    },
    async setCommunityPhoto(communityId, photo) {
      const bucket = supabase.storage.from(COMMUNITY_PHOTOS_BUCKET);
      let path: string | null = null;
      if (photo) {
        path = `${communityId}/photo-${Date.now()}.${photo.ext}`;
        const { error } = await bucket.upload(path, photo.body, { contentType: photo.contentType });
        if (error) throw new Error("That photo didn't upload. Try a smaller JPEG or PNG.");
      }
      let old: string | null;
      try {
        const { data } = check(await supabase.rpc('set_community_photo', { p_community_id: communityId, p_path: path }));
        old = (data as string | null) ?? null;
      } catch (e) {
        if (path) await bucket.remove([path]);
        throw e;
      }
      if (old) await bucket.remove([old]);
    },
    async removeCommunityMember(communityId, userId) {
      check(await supabase.rpc('remove_community_member', { p_community_id: communityId, p_user_id: userId }));
    },
    async setCommunityRole(communityId, userId, role) {
      check(await supabase.rpc('set_community_role', { p_community_id: communityId, p_user_id: userId, p_role: role }));
    },
    async resetCommunityCode(communityId) {
      const { data } = check(await supabase.rpc('reset_community_code', { p_community_id: communityId }));
      return String(data);
    },
    async popularCommunities() {
      const { data } = check(await supabase.rpc('popular_communities', { p_limit: 20 }));
      type Row = { id: string; name: string; description: string; photo_path: string | null; member_count: number; upcoming_rides: number; my_status: PopularCommunity['myStatus'] };
      const rows = (data ?? []) as Row[];
      const photo = await communityPhotos(rows.map((c) => c.photo_path));
      return rows.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description ?? '',
        photoUrl: photo(c.photo_path),
        memberCount: Number(c.member_count),
        upcomingRides: Number(c.upcoming_rides),
        myStatus: c.my_status,
      }));
    },
    async requestToJoin(communityId) {
      const { data } = check(await supabase.rpc('request_to_join', { p_community_id: communityId }));
      return data === 'member' ? 'member' : 'requested';
    },
    async cancelJoinRequest(communityId) {
      check(await supabase.rpc('cancel_join_request', { p_community_id: communityId }));
    },
    async respondJoinRequest(communityId, userId, approve) {
      check(await supabase.rpc('respond_join_request', { p_community_id: communityId, p_user_id: userId, p_approve: approve }));
    },
    async setCommunityListed(communityId, listed) {
      check(await supabase.rpc('set_community_listed', { p_community_id: communityId, p_listed: listed }));
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
      const hide = await hidden();
      d.friends = d.friends.filter((p) => !hide.has(p.id));
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

    async myPhoto() {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid) return { avatarUrl: null, gender: null };
      const { data: p } = check(await supabase.from('profiles').select('avatar_path, gender').eq('id', uid).maybeSingle());
      const row = p as { avatar_path: string | null; gender: Gender | null } | null;
      const urls = await signAvatars([row?.avatar_path]);
      return { avatarUrl: row?.avatar_path ? urls[row.avatar_path] ?? null : null, gender: row?.gender ?? null };
    },

    async getProfile(userId) {
      const { data } = check(await supabase.rpc('profile_page', { p_user_id: userId }));
      const p = data as ProfileRow | null;
      if (!p) return null;
      const hide = await hidden();
      let blockedByMe = false;
      if (hide.has(p.id)) {
        const { data: mine } = await supabase.from('user_blocks').select('blocked_id').eq('blocked_id', p.id).maybeSingle();
        // Someone who blocked me looks like a missing profile.
        if (!mine) return null;
        blockedByMe = true;
      }
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
        blockedByMe,
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

    async getDriveTimes(lat, lon) {
      const { data, error } = await supabase.functions.invoke('drive-times', { body: { lat, lon } });
      if (error) throw new Error("Couldn't get live drive times.");
      return (data as { minutes: Record<string, number> }).minutes;
    },

    async myTrips() {
      const { data } = check(await supabase.rpc('my_trips'));
      type P = { id: string; name: string; avatar_path: string | null; gender: Gender | null; legs?: SeatLegs };
      type Q = P & { legs: SeatLegs; requested_at: string; expires_at: string; rating: number | null; review_count: number };
      type Row = {
        id: string; role: Trip['role']; my_legs: SeatLegs | null; my_status: SeatStatus | null; expires_at: string | null;
        resort_id: string; trip_type: TripType; depart_at: string; return_at: string | null;
        leave_from: string; return_meet: string; seats_total: number; gas_per_rider: number; contact: string; driver: P; passengers: P[];
        requests?: Q[];
        checkins: { leg: 'to' | 'from'; rider_id: string; rider_confirmed_at: string | null; driver_status: 'picked_up' | 'no_show' | null }[];
      };
      const rows = (data ?? []) as Row[];
      const urls = await signAvatars(
        rows.flatMap((r) => [r.driver.avatar_path, ...r.passengers.map((p) => p.avatar_path), ...(r.requests ?? []).map((q) => q.avatar_path)]),
      );
      const person = (p: P) => ({ id: p.id, name: p.name, gender: p.gender, avatarUrl: p.avatar_path ? urls[p.avatar_path] ?? null : null });
      return rows.map(
        (r): Trip => ({
          id: r.id,
          role: r.role,
          myLegs: r.my_legs,
          myStatus: r.my_status ?? (r.role === 'passenger' ? 'confirmed' : null),
          expiresAt: r.expires_at ?? null,
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
          requests: (r.requests ?? []).map(
            (q): SeatRequest => ({
              ...person(q),
              legs: q.legs,
              requestedAt: q.requested_at,
              expiresAt: q.expires_at,
              rating: q.rating == null ? null : Number(q.rating),
              reviewCount: q.review_count ?? 0,
            }),
          ),
          checkins: r.checkins.map((c) => ({ leg: c.leg, riderId: c.rider_id, riderConfirmedAt: c.rider_confirmed_at, driverStatus: c.driver_status })),
        }),
      );
    },
    async listMessages(rideId) {
      const { data } = check(
        await supabase.from('ride_messages').select('id, ride_id, sender_id, body, created_at, kind').eq('ride_id', rideId).order('created_at').limit(500),
      );
      const hide = await hidden();
      return ((data ?? []) as MessageRow[]).filter((m) => !hide.has(m.sender_id)).map(toMessage);
    },
    async sendMessage(rideId, body) {
      check(await supabase.from('ride_messages').insert({ ride_id: rideId, body: body.trim().slice(0, 1000) }));
    },
    subscribeMessages(rideId, onMessage) {
      const channel = supabase
        .channel(`ride-chat-${rideId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ride_messages', filter: `ride_id=eq.${rideId}` }, async (payload) => {
          const m = payload.new as MessageRow;
          if (!(await hidden()).has(m.sender_id)) onMessage(toMessage(m));
        })
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

    async report(r) {
      check(
        await supabase.rpc('report_content', {
          p_user_id: r.userId,
          p_kind: r.kind,
          p_target_id: r.targetId ?? null,
          p_reason: r.reason,
          p_details: (r.details ?? '').trim().slice(0, 1000),
        }),
      );
    },
    async blockUser(userId) {
      check(await supabase.rpc('block_user', { p_user_id: userId }));
      hiddenCache = null;
    },
    async unblockUser(userId) {
      check(await supabase.rpc('unblock_user', { p_user_id: userId }));
      hiddenCache = null;
    },
    async myBlocks() {
      const { data } = check(await supabase.rpc('my_blocks'));
      const rows = (data ?? []) as (FriendRow & { blocked_at: string })[];
      const urls = await signAvatars(rows.map((p) => p.avatar_path));
      return rows.map((p) => ({ ...toFriend(p, urls), blockedAt: p.blocked_at }));
    },
    async deleteAccount() {
      const { data, error } = await supabase.functions.invoke('delete-account', { body: { confirm: 'DELETE' } });
      if (error || !(data as { deleted?: boolean } | null)?.deleted) {
        let msg = 'Could not delete your account. Try again.';
        try {
          const body = await (error as { context?: Response } | null)?.context?.json?.();
          if (body?.error) msg = body.error;
        } catch {}
        throw new Error(msg);
      }
      // The user is gone on the server; clear the saved session on this device.
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
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
