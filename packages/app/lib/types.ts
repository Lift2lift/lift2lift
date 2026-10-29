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

export type DriverDoc = 'license' | 'insurance';

/** Where a driver is in license + insurance verification. */
export type DriverVerification = {
  /** incomplete: photos missing · submitted: can host · approved: checked by the team · rejected: needs a new photo */
  status: 'incomplete' | 'submitted' | 'approved' | 'rejected';
  hasLicense: boolean;
  hasInsurance: boolean;
  /** Short-lived links to the person's own photos, for thumbnails. */
  licenseUrl: string | null;
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

/** Each app supplies its own photo picker (file input on web, camera/library on iOS). */
export interface PhotoPicker {
  pick(): Promise<PickedPhoto | null>;
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

  getForecast(): Promise<Forecast>;
}
