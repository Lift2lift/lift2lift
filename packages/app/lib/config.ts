/**
 * Only allow sign-ups with a college (.edu) email. This check runs in the app;
 * to enforce it on the server, add a "Before User Created" auth hook (README).
 */
export const REQUIRE_EDU_EMAIL = false;

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
