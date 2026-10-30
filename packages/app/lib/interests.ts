/**
 * Interest choices, grouped like Instagram's sign-up interest picker.
 * Same ids as the interest_options table (supabase/migrations/…_profiles.sql).
 */
export const INTEREST_GROUPS: { title: string; items: { id: string; label: string }[] }[] = [
  {
    title: 'On the mountain',
    items: [
      { id: 'skiing', label: 'Skiing' },
      { id: 'snowboarding', label: 'Snowboarding' },
      { id: 'backcountry', label: 'Backcountry' },
      { id: 'park', label: 'Park & pipe' },
      { id: 'moguls', label: 'Moguls' },
      { id: 'powder', label: 'Powder days' },
      { id: 'groomers', label: 'Groomers' },
      { id: 'apres', label: 'Après' },
      { id: 'nordic', label: 'Nordic' },
      { id: 'splitboarding', label: 'Splitboarding' },
    ],
  },
  {
    title: 'Outdoors',
    items: [
      { id: 'climbing', label: 'Climbing' },
      { id: 'mtb', label: 'Mountain biking' },
      { id: 'hiking', label: 'Hiking' },
      { id: 'trail-running', label: 'Trail running' },
      { id: 'camping', label: 'Camping' },
      { id: 'surfing', label: 'Surfing' },
      { id: 'fishing', label: 'Fishing' },
      { id: 'skating', label: 'Skateboarding' },
    ],
  },
  {
    title: 'Creative',
    items: [
      { id: 'photography', label: 'Photography' },
      { id: 'film', label: 'Film & video' },
      { id: 'music', label: 'Music' },
      { id: 'art', label: 'Art & design' },
      { id: 'writing', label: 'Writing' },
      { id: 'fashion', label: 'Fashion' },
    ],
  },
  {
    title: 'Lifestyle',
    items: [
      { id: 'concerts', label: 'Concerts' },
      { id: 'travel', label: 'Travel' },
      { id: 'coffee', label: 'Coffee' },
      { id: 'food', label: 'Food & cooking' },
      { id: 'fitness', label: 'Fitness' },
      { id: 'yoga', label: 'Yoga' },
      { id: 'dogs', label: 'Dogs' },
      { id: 'podcasts', label: 'Podcasts' },
      { id: 'gaming', label: 'Gaming' },
      { id: 'sports', label: 'Watching sports' },
      { id: 'tech', label: 'Tech' },
      { id: 'sustainability', label: 'Sustainability' },
    ],
  },
];

export const INTEREST_LABEL: Record<string, string> = Object.fromEntries(
  INTEREST_GROUPS.flatMap((g) => g.items.map((i) => [i.id, i.label])),
);

export const MIN_INTERESTS = 3;
export const MAX_INTERESTS = 12;

/** CorePower-style Q&A prompts on the profile page. */
export const PROFILE_PROMPTS: { key: 'go_to_run' | 'aux' | 'apres_spot' | 'off_mountain'; question: string; placeholder: string }[] = [
  { key: 'go_to_run', question: 'My go-to run', placeholder: 'Pallavicini when it’s filled in' },
  { key: 'aux', question: 'On the aux in my car', placeholder: 'Khruangbin, Zach Bryan, old Phish…' },
  { key: 'apres_spot', question: 'Favorite après spot', placeholder: 'The 6th Alley Bar' },
  { key: 'off_mountain', question: 'Off the mountain you’ll find me', placeholder: 'Climbing on Flagstaff, shooting photos' },
];

export const GENDER_OPTIONS: { id: 'man' | 'woman' | 'nonbinary' | 'unspecified'; label: string }[] = [
  { id: 'man', label: 'Man' },
  { id: 'woman', label: 'Woman' },
  { id: 'nonbinary', label: 'Nonbinary' },
  { id: 'unspecified', label: 'Prefer not to say' },
];

export const DISCIPLINE_LABEL: Record<string, string> = { ski: 'Skier', snowboard: 'Snowboarder', both: 'Skis and rides' };
