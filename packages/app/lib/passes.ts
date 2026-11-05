/**
 * Which multi-mountain ski passes work where, for the 2026–27 season.
 * Pass partnerships change every spring when the new passes go on sale,
 * so check these each year (ikonpass.com, epicpass.com, indyskipass.com,
 * mountaincollective.com). Day limits and blackouts depend on the pass tier.
 */
export type PassType = 'ikon' | 'epic' | 'indy' | 'mc';
/** What the board can filter by: a pass, mountains on none of them, or everything. */
export type PassFilter = 'any' | PassType | 'none';

export const PASS_SEASON = '2026–27';

export const PASS_LABEL: Record<PassType, string> = {
  ikon: 'Ikon',
  epic: 'Epic',
  indy: 'Indy',
  mc: 'Mountain Collective',
};

const ASPEN: PassType[] = ['ikon', 'mc'];

export const RESORT_PASSES: Record<string, PassType[]> = {
  eldora: ['ikon'],
  abasin: ['ikon'],
  wp: ['ikon'],
  copper: ['ikon'],
  steamboat: ['ikon'],
  snowmass: ASPEN,
  ajax: ASPEN,
  highlands: ASPEN,
  buttermilk: ASPEN,
  vail: ['epic'],
  bc: ['epic'],
  breck: ['epic'],
  keystone: ['epic'],
  cb: ['epic'],
  telluride: ['epic'],
  echo: ['indy'],
  granby: ['indy'],
  howelsen: ['indy'],
  loveland: ['indy'],
  powderhorn: ['indy'],
  sunlight: ['indy'],
  // Not on any of these: Ski Cooper, Monarch, Wolf Creek, Purgatory, Silverton.
};

const ASPEN_NOTE = 'Ikon: 7 days shared across the four Aspen mountains. Mountain Collective: 2 days.';

/** Limits worth knowing before you book a seat. */
export const PASS_NOTES: Record<string, string> = {
  abasin: 'Unlimited on Ikon and Ikon Base.',
  snowmass: `${ASPEN_NOTE} Also on Ikon Base, with holiday blackouts.`,
  ajax: ASPEN_NOTE,
  highlands: ASPEN_NOTE,
  buttermilk: ASPEN_NOTE,
  telluride: 'Epic: 7 days. Not on Epic Local.',
  vail: 'Epic Local: 10 days, shared with Beaver Creek.',
  bc: 'Epic Local: 10 days, shared with Vail.',
};

export function passesFor(resortId: string): PassType[] {
  return RESORT_PASSES[resortId] ?? [];
}

export function passMatches(resortId: string, filter: PassFilter) {
  if (filter === 'any') return true;
  const p = passesFor(resortId);
  return filter === 'none' ? p.length === 0 : p.includes(filter);
}

export const PASS_FILTERS: { id: PassFilter; label: string; hint?: string }[] = [
  { id: 'any', label: 'Any pass' },
  { id: 'ikon', label: 'Ikon', hint: 'Eldora, A-Basin, Winter Park, Copper, Steamboat, Aspen' },
  { id: 'epic', label: 'Epic', hint: 'Breck, Keystone, Vail, Beaver Creek, Crested Butte, Telluride' },
  { id: 'indy', label: 'Indy', hint: 'Echo, Loveland, Granby Ranch, Howelsen, Sunlight, Powderhorn' },
  { id: 'mc', label: 'Mountain Collective', hint: 'Aspen Snowmass' },
  { id: 'none', label: 'Not on a big pass', hint: 'Ski Cooper, Monarch, Wolf Creek, Purgatory, Silverton' },
];

export const isPassFilter = (v: string | undefined): v is PassFilter => !!v && PASS_FILTERS.some((f) => f.id === v);
