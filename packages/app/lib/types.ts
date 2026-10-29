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
  driverVerified: boolean; // license + insurance photos on file
};

/** Documents drivers upload themselves. (The license is scanned in the ID check.) */
export type DriverDoc = 'insurance';

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
  /** Short-lived link to the person's own insurance photo, for the thumbnail. */
  insuranceUrl: string | null;
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
}

export type NewRide = {
  resortId: string;
  departAt: string; // ISO timestamp
  leaveFrom: string;
  seatsTotal: number;
  gasPerRider: number;
  gear: string;
  notes: string;
  contact: string;
};

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
  claimSeat(rideId: string): Promise<void>;
  leaveSeat(rideId: string): Promise<void>;
  removeRider(rideId: string, riderId: string): Promise<void>;
  rideContact(rideId: string): Promise<string | null>;

  getDriverVerification(options?: { withPhotos?: boolean }): Promise<DriverVerification>;
  uploadDriverDoc(doc: DriverDoc, photo: PickedPhoto): Promise<DriverVerification>;
  giveBiometricConsent(): Promise<void>;
  /** Starts or resumes the Stripe ID check. Returns the hosted page to open, unless it's already processing or done. */
  startIdentityCheck(platform: DeviceServices['platform']): Promise<{ url?: string; status: 'pending' | 'processing' | 'verified' }>;

  getForecast(): Promise<Forecast>;
}
