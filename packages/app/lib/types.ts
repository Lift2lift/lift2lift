export type Session = {
  userId: string;
  email: string;
  name: string;
};

export type Resort = {
  id: string;
  name: string;
  region: string;
  driveMinutes: number;
  roundTripMiles: number;
  lat: number;
  lon: number;
};

/** A ride as it appears on the board (from the `ride_board` view). */
/** round_trip: up at departAt, back at returnAt · to_mountain / from_mountain: one way at departAt */
export type TripType = 'round_trip' | 'to_mountain' | 'from_mountain';
/** A leg of a trip: up to the mountain or back down. */
export type Leg = 'to' | 'from';
/** What a passenger booked on a round trip. One-way rides are always 'both'. */
export type SeatLegs = 'both' | 'to' | 'from';

export type BoardRide = {
  id: string;
  driverId: string;
  driverName: string;
  resortId: string;
  departAt: string; // ISO timestamp
  leaveFrom: string;
  seatsTotal: number;
  gasPerRider: number;
  gear: string;
  notes: string;
  seatsTaken: number;
  riderIds: string[];
  riderNames: string[];
  rideDate: string; // YYYY-MM-DD, Mountain Time
  gasCap: number; // legal max for the whole trip, dollars
  driverVerified: boolean; // ID verified + insurance on file
  driverAvatarUrl: string | null;
  driverGender: Gender | null;
  riderAvatarUrls: (string | null)[];
  riderGenders: (Gender | null)[];
  driverDrivingAvg: number | null;
  driverExperienceAvg: number | null;
  driverReviewCount: number;
  tripType: TripType;
  returnAt: string | null;
  /** Where to meet at the mountain for the ride back (round trips). */
  returnMeet: string;
  seatsTakenTo: number;
  seatsTakenFrom: number;
  riderLegs: SeatLegs[];
};

export type Person = { id: string; name: string; avatarUrl: string | null; gender: Gender | null };

/** A trip in Your Rides: one I'm driving or have a seat on. */
export type Trip = {
  id: string;
  role: 'driver' | 'passenger';
  myLegs: SeatLegs | null;
  resortId: string;
  tripType: TripType;
  departAt: string;
  returnAt: string | null;
  leaveFrom: string;
  returnMeet: string;
  seatsTotal: number;
  gasPerRider: number;
  contact: string;
  driver: Person;
  passengers: (Person & { legs: SeatLegs })[];
  checkins: { leg: Leg; riderId: string; riderConfirmedAt: string | null; driverStatus: 'picked_up' | 'no_show' | null }[];
};

/** kind 'update' is a line the app posts when the driver changes or cancels the ride. */
export type ChatMessage = { id: string; rideId: string; senderId: string; body: string; createdAt: string; kind: 'chat' | 'update' };

/* ---------- Friends ---------- */

export type FriendPerson = Person & { homeResortId?: string | null; schoolYear?: string | null; mutual?: boolean };
/** Where you stand with someone. */
export type FriendState = 'self' | 'friends' | 'sent' | 'received' | 'none';
export type MyFriends = { friends: FriendPerson[]; incoming: FriendPerson[]; outgoing: FriendPerson[] };
/** The friends shown on a profile, mutual ones first. */
export type ProfileFriends = { count: number; mutual: number; state: FriendState; friends: FriendPerson[] };

/** Averages about one person, split by role. */
export type RatingSummary = {
  drivingAvg: number | null;
  driverExperienceAvg: number | null;
  driverCount: number;
  passengerAvg: number | null;
  passengerCount: number;
};

export type Review = {
  id: string;
  /** What the person being reviewed was on that ride. */
  role: 'driver' | 'passenger';
  driving: number | null;
  experience: number;
  body: string;
  createdAt: string;
  resortId: string;
  reviewerId: string;
  reviewerName: string;
  reviewerAvatarUrl: string | null;
  reviewerGender: Gender | null;
};

/** A past ride the signed-in passenger can still review. */
export type PendingReview = {
  rideId: string;
  resortId: string;
  departAt: string;
  closesAt: string;
  people: { id: string; role: 'driver' | 'passenger'; name: string; avatarUrl: string | null; gender: Gender | null }[];
};

export type Gender = 'man' | 'woman' | 'nonbinary' | 'unspecified';
export type PromptKey = 'go_to_run' | 'aux' | 'apres_spot' | 'off_mountain';

/** Fields a person edits in profile setup. */
export type ProfileFields = {
  fullName: string;
  gender: Gender | null;
  discipline: 'ski' | 'snowboard' | 'both' | null;
  homeResortId: string | null;
  schoolYear: string;
  hometown: string;
  bio: string;
  instagram: string;
  interests: string[];
  prompts: Partial<Record<PromptKey, string>>;
};

/** A profile page: fields plus the photo, badges, stats and upcoming rides. */
export type ProfilePage = ProfileFields & {
  id: string;
  avatarUrl: string | null;
  memberSince: string;
  idVerified: boolean;
  driverVerified: boolean;
  profileComplete: boolean;
  ridesDriven: number;
  ridesTaken: number;
  upcoming: { id: string; resortId: string; departAt: string; seatsTotal: number; seatsTaken: number }[];
  /** You blocked this person. The profile shows only their name and an Unblock button. */
  blockedByMe: boolean;
};

/* ---------- Safety: reports and blocks ---------- */

export type ReportKind = 'profile' | 'message' | 'review' | 'ride';
export type ReportReason = 'harassment' | 'hate' | 'sexual' | 'spam' | 'unsafe_driving' | 'fake_profile' | 'other';
export const REPORT_REASONS: { id: ReportReason; label: string }[] = [
  { id: 'harassment', label: 'Harassment or bullying' },
  { id: 'hate', label: 'Hate speech or slurs' },
  { id: 'sexual', label: 'Sexual content or unwanted advances' },
  { id: 'unsafe_driving', label: 'Unsafe driving' },
  { id: 'fake_profile', label: 'Fake profile or not a student' },
  { id: 'spam', label: 'Spam or scam' },
  { id: 'other', label: 'Something else' },
];
export type BlockedPerson = Person & { blockedAt: string };

/** Documents drivers upload themselves. (The license is scanned in the ID check.) */
/** Stripe Identity: license scan + live selfie matched to the license photo. */
export type IdentityStatus = 'none' | 'pending' | 'processing' | 'verified' | 'requires_input' | 'canceled';

/** Where a driver is in verification: ID check + insurance photo. */
export type DriverVerification = {
  /** incomplete: a step is missing · submitted: can host · approved: checked by the team · rejected: needs fixing */
  status: 'incomplete' | 'submitted' | 'approved' | 'rejected';
  identity: IdentityStatus;
  /** Stripe's reason when the check needs another try, e.g. selfie_face_mismatch. */
  identityError: string | null;
  /** Name on the license, from the ID check. Shown only to the driver. */
  idName: string | null;
  /** Agreed to the selfie check (Colorado biometric consent). */
  consented: boolean;
  hasInsurance: boolean;
  insuranceStatus: 'none' | 'verified' | 'review' | 'requires_input';
  insuranceError: string | null;
  insurer: string | null;
  insuranceExpires: string | null;
  reviewNote: string | null;
};

export function canHost(v: DriverVerification | null) {
  return !!v && (v.status === 'submitted' || v.status === 'approved');
}

/** A photo picked on the device, ready to upload. */
export type PickedPhoto = {
  body: Blob | ArrayBuffer;
  contentType: string;
  ext: 'jpg' | 'png' | 'heic' | 'webp';
  previewUri: string;
};

/** Device features each app supplies: photo picking and opening Stripe's ID check. */
export interface DeviceServices {
  platform: 'web' | 'ios';
  /** File chooser on web, camera or library on iOS. Null if cancelled. */
  pickPhoto(): Promise<PickedPhoto | null>;
  /** Opens Stripe's hosted ID check. On web this leaves the page; on iOS it resolves when the browser closes. */
  openIdentityCheck(url: string): Promise<void>;
  /** Asks to allow notifications and returns this phone's push token, or null (web, or declined). */
  registerForPush(): Promise<{ token: string; platform: 'ios' | 'android' | 'web' } | null>;
  /** The app icon for the opening screen: require('../assets/icon.png') on iOS, { uri: '/logo.png' } on the web. */
  logo?: number | { uri: string };
}

export type NewRide = {
  resortId: string;
  tripType: TripType;
  departAt: string; // ISO timestamp
  returnAt: string | null; // round trips
  returnMeet: string;
  leaveFrom: string;
  seatsTotal: number;
  gasPerRider: number;
  gear: string;
  notes: string;
  contact: string;
};

/** A ride as the driver edits it, plus what's already booked. */
export type EditableRide = NewRide & { id: string; rideDate: string; riders: number; seatsTakenTo: number; seatsTakenFrom: number };

export type DayForecast = {
  date: string; // YYYY-MM-DD, Mountain Time
  hi: number; // °F
  lo: number; // °F
  snowIn: number; // inches of new snow
  precipPct: number; // max chance of precipitation that day
};

export type Forecast = {
  updatedAt: string;
  days: string[];
  byResort: Record<string, DayForecast[]>;
};

/** Everything the screens need from the backend. Supabase implements it in api.ts. */
export interface Api {
  getSession(): Promise<Session | null>;
  onAuthChange(listener: (session: Session | null) => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  /** Web only: redirects the page to Google, then back here signed in. */
  signInWithGoogle(): Promise<void>;
  signUp(name: string, email: string, password: string): Promise<{ needsVerification: boolean }>;
  verifySignup(email: string, code: string): Promise<void>;
  resendSignup(email: string): Promise<void>;
  sendPasswordReset(email: string): Promise<void>;
  resetPassword(email: string, code: string, newPassword: string): Promise<void>;
  signOut(): Promise<void>;

  listRides(): Promise<BoardRide[]>;
  postRide(ride: NewRide): Promise<void>;
  cancelRide(rideId: string): Promise<void>;
  claimSeat(rideId: string, legs?: SeatLegs): Promise<void>;
  leaveSeat(rideId: string): Promise<void>;
  removeRider(rideId: string, riderId: string): Promise<void>;
  rideContact(rideId: string): Promise<string | null>;
  /** Driver only: the ride as posted, for the edit form. Null if it's not yours or was cancelled. */
  rideForEdit(rideId: string): Promise<EditableRide | null>;
  /** Driver only. Riders on the ride get an update in the chat and a push. */
  updateRide(rideId: string, ride: NewRide): Promise<void>;

  myFriends(): Promise<MyFriends>;
  profileFriends(userId: string): Promise<ProfileFriends>;
  /** Sends a request, or accepts theirs if they already asked. */
  friendRequest(userId: string): Promise<'sent' | 'friends'>;
  respondFriend(userId: string, accept: boolean): Promise<void>;
  /** Unfriend, or cancel a request you sent. */
  removeFriend(userId: string): Promise<void>;
  searchPeople(query: string): Promise<FriendPerson[]>;

  getProfile(userId: string): Promise<ProfilePage | null>;

  getReviews(userId: string): Promise<{ summary: RatingSummary; reviews: Review[] }>;
  reviewsToWrite(): Promise<PendingReview[]>;
  submitReview(r: { rideId: string; revieweeId: string; experience: number; driving?: number | null; body?: string }): Promise<void>;
  updateProfile(fields: Partial<ProfileFields>): Promise<void>;
  /** Marks setup finished. Returns what's still missing: 'photo' | 'name' | 'gender' | 'interests'. */
  completeProfile(): Promise<string[]>;

  getDriverVerification(options?: { withPhotos?: boolean }): Promise<DriverVerification>;
  /** Reads the insurance card. The photo is never stored. */
  checkInsurance(card: PickedPhoto): Promise<DriverVerification>;
  giveBiometricConsent(): Promise<void>;
  /** Reads the license and matches the selfie to its photo. The result arrives in the response. */
  checkLicense(license: PickedPhoto, selfie: PickedPhoto): Promise<{ status: 'verified' | 'requires_input'; error?: string }>;
  /** Starts or resumes the Stripe ID check. Returns the hosted page to open, unless it's already processing or done. */
  startIdentityCheck(platform: DeviceServices['platform']): Promise<{ url?: string; status: 'pending' | 'processing' | 'verified' }>;

  getForecast(): Promise<Forecast>;

  /** Your Rides: trips I'm driving or riding, upcoming and in progress. */
  myTrips(): Promise<Trip[]>;
  listMessages(rideId: string): Promise<ChatMessage[]>;
  sendMessage(rideId: string, body: string): Promise<void>;
  /** Live chat updates. Returns a function that stops listening. */
  subscribeMessages(rideId: string, onMessage: (m: ChatMessage) => void): () => void;
  /** Passenger: confirm you're in for this leg. */
  confirmMySeat(rideId: string, leg: Leg): Promise<void>;
  /** Driver: mark a passenger picked up or a no-show. */
  confirmPassenger(rideId: string, leg: Leg, riderId: string, status: 'picked_up' | 'no_show'): Promise<void>;
  registerPushToken(token: string, platform: 'ios' | 'android' | 'web'): Promise<void>;

  /** Report a person, or one of their chat messages, reviews or rides. Moderators review reports within 24 hours. */
  report(r: { userId: string; kind: ReportKind; targetId?: string | null; reason: ReportReason; details?: string }): Promise<void>;
  /** Hides each person from the other: rides, chat, reviews, search, friends. Ends any friendship. */
  blockUser(userId: string): Promise<void>;
  unblockUser(userId: string): Promise<void>;
  myBlocks(): Promise<BlockedPerson[]>;
  /** Permanently deletes the account, photos and everything linked to it, then signs out. */
  deleteAccount(): Promise<void>;
}
