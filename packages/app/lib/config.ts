/**
 * Lift2Lift is for CU Boulder students: every account uses a @colorado.edu
 * email (subdomains like @cs.colorado.edu count). The database enforces this
 * too (allowed_email_domains table); keep the two lists in sync.
 */
export const SCHOOL_NAME = 'CU Boulder';
export const SCHOOL_EMAIL_DOMAINS = ['colorado.edu'];

export function isSchoolEmail(email: string) {
  const domain = email.trim().toLowerCase().split('@')[1] ?? '';
  return SCHOOL_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

export const SCHOOL_EMAIL_ERROR = `Lift2Lift is for ${SCHOOL_NAME} students. Use your @colorado.edu email.`;

export const MIN_PASSWORD_LENGTH = 8;

/** Pickup spots offered as one-tap choices on the post-a-ride form. */
export const PICKUP_SPOTS = [
  'CU Boulder – Kittredge lot',
  'CU Boulder – Folsom Field',
  'CU Boulder – Williams Village',
  'Boulder – The Hill (13th & College)',
  'Boulder – Table Mesa Park-n-Ride',
  'Golden – Mines campus',
  'Denver – Union Station',
];

export const GEAR_OPTIONS = ['Skis and boards fit', 'Roof box / rack', 'Boards only', 'Small bags only'];

/** Public website. The privacy policy and terms live at /privacy and /terms (App Store Connect needs the privacy URL). */
export const SITE_URL = 'https://lift2lift.vercel.app';

/**
 * Where people (and App Review) reach a human. Shown in the privacy policy,
 * terms, and Account → Help. REPLACE before submitting to the App Store.
 */
export const SUPPORT_EMAIL = 'help@lift2lift.net';
