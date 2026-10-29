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
};

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

  getForecast(): Promise<Forecast>;
}
