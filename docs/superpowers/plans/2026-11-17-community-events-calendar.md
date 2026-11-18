# Community Events Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the community page into a calendar of club events (manual or imported from a Google/Outlook/iCloud ICS link) with RSVPs and members-only rides attached.

**Architecture:** Events, RSVPs and the ride-to-event link live in Postgres behind `security definer` RPCs, like communities do today. The shared React Native package gets a pure calendar-math module, three presentational components and a rebuilt `CommunityScreen`. Phase 2 adds an admin-only calendar link and a cron-driven edge function that parses the ICS feed and upserts events.

**Tech Stack:** Supabase Postgres (RLS, plpgsql, pg_cron + pg_net), Deno edge functions, `ical.js`, React Native + react-native-web (Next.js and Expo), TypeScript, `node --test`, `psql`.

**Spec:** `docs/superpowers/specs/2026-11-17-community-events-calendar-design.md`. Mockup source: `docs/superpowers/specs/2026-11-17-community-events-calendar-mockup.html` (layout, sizes, colors, copy; the script block shows the calendar logic).

## Global Constraints

- All UI lives in `packages/app` and must work on web and iOS. React Native primitives only; no DOM elements, no new UI library.
- Styling is inline styles using `useTheme()` tokens from `packages/app/lib/theme.ts`. No hard-coded colors except where the codebase already does (white on `CommunityBadge`). Light and dark both work.
- Every RPC is `security definer`, `set search_path = ''`, schema-qualifies everything, and ends with `revoke execute ... from public, anon; grant execute ... to authenticated;` as in `supabase/migrations/20261114000013_communities.sql`.
- New tables: RLS on, `revoke all ... from anon, authenticated`, then grant only what is needed. All writes go through RPCs.
- Event day math in SQL uses `at time zone 'America/Denver'`, as `rides.ride_date` does. Client day math uses `isoDay` / `parseDay` from `packages/app/lib/dates.ts`.
- User-entered text (title, description, location) passes `public.has_blocked_term`. Error text is plain and user-facing, raised with `errcode = 'P0001'`; permission failures use `'42501'`.
- Limits, verbatim from the spec: title 2 to 80 chars, description up to 1000, location up to 120; sync window yesterday to 180 days ahead; sync every 15 minutes; fetch timeout 10 seconds, 2 MB cap, at most 3 redirects; allowed hosts `calendar.google.com`, `outlook.office365.com`, `outlook.office.com`, `outlook.live.com`, `*.icloud.com`.
- Copy follows the mockup. Sentence case, no exclamation marks.
- Booking, seat requests and Colorado carpool rules are not changed.
- Not in this build: Fri/Sat/Sun plan boxes, "spots taken", event notifications, OAuth, export feeds.
- SQL tests run with the `psql` command in the README ("To run them against plain Postgres"); add each new test file to that command. Local DB: `postgres://postgres:postgres@127.0.0.1:54322/postgres` after `npm run db:start`, or any scratch Postgres.
- Typecheck: `npm run typecheck -w @lift2lift/web` and `npm run typecheck -w @lift2lift/mobile` pass after every client task.

## Review Focus

1. **Event crossing a month boundary** (Nov 30 to Dec 2): it shows in both months, the bar continues, and selecting it in either month selects it. Test in Task 4.
2. **Multi-day event crossing a week row** (Fri to Mon): the bar ends at Saturday and resumes on Sunday's row with square inner ends. Test in Task 4, rendering in Task 5.
3. **Community with no events and no rides**: page opens on today with the empty state; no crash, no blank panel. Test in Task 4 (`initialDay`), checked on localhost in Task 8.
4. **Calendar link returns HTML, garbage or more than 2 MB**: events already stored stay, `last_error` is set, the admin sees one plain line. Tests in Tasks 10 and 11.
5. **All-day event and time zones**: an all-day Dec 5 event shows on Dec 5 only (ICS end date is exclusive), and a timed event at 11 PM Mountain shows on its Mountain day. Tests in Tasks 1 and 10.

---

## File map

| File | Responsibility |
| --- | --- |
| `supabase/migrations/20261117000016_community_events.sql` | events, RSVPs, their RPCs, `my_communities.next_event` |
| `supabase/migrations/20261117000017_ride_events.sql` | `rides.event_id`, link rules, `ride_board` columns |
| `supabase/migrations/20261117000018_community_calendars.sql` | calendar link table, admin RPCs, `apply_calendar_sync` |
| `supabase/tests/community_events_test.sql`, `community_calendars_test.sql` | SQL rules tests |
| `supabase/functions/sync-community-calendars/{logic.ts,logic.test.ts,index.ts}` | URL checks, ICS parsing, fetch and upsert |
| `packages/app/lib/events.ts`, `events.test.ts` | pure calendar math |
| `packages/app/components/EventCalendar.tsx` | month grid |
| `packages/app/components/EventHero.tsx` | event hero and its rides |
| `packages/app/components/MountainRides.tsx` | mountain tiles plus ride cards |
| `packages/app/components/EventForm.tsx` | add/edit event modal |
| `packages/app/components/CommunityMembers.tsx` | members list, admin tools, leave (moved out of the screen) |
| `packages/app/components/ClubCalendarCard.tsx` | paste link, sync status |
| `packages/app/screens/CommunityScreen.tsx` | page composition and state |

---

# Phase 1: events and calendar

### Task 1: Events and RSVPs in the database

**Files:**
- Create: `supabase/migrations/20261117000016_community_events.sql`
- Create: `supabase/tests/community_events_test.sql`
- Modify: `README.md` (test command and its description paragraph)

**Interfaces:**
- Produces tables `public.community_events (id, community_id, title, description, location, resort_id, starts_at, ends_at, all_day, source, ics_uid, created_by, created_at, updated_at, cancelled_at)` and `public.community_event_rsvps (event_id, user_id, created_at)`. `source` is `'manual'` or `'ics'`; unique `(community_id, ics_uid)`; check `ends_at >= starts_at`.
- Produces RPCs:
  - `community_events(p_community_id uuid, p_from date, p_to date) returns jsonb`: array ordered by `starts_at`, non-cancelled events whose Denver day range overlaps `[p_from, p_to]`. Each: `{id, community_id, title, description, location, resort_id, starts_at, ends_at, all_day, source, going, i_am_in, going_people: [{id, full_name, avatar_path, gender}] (first 4 by RSVP time, blocked users left out), ride_count}`. `ride_count` is `0` in this task; Task 2 replaces the function to count rides.
  - `set_event_rsvp(p_event_id uuid, p_going boolean) returns void`
  - `create_community_event(p_community_id uuid, p_title text, p_description text, p_location text, p_resort_id text, p_starts_at timestamptz, p_ends_at timestamptz, p_all_day boolean) returns uuid`
  - `update_community_event(p_event_id uuid, p_title text, p_description text, p_location text, p_resort_id text, p_starts_at timestamptz, p_ends_at timestamptz, p_all_day boolean) returns void`
  - `cancel_community_event(p_event_id uuid) returns void`
  - helper `event_days(p_starts timestamptz, p_ends timestamptz, p_all_day boolean) returns daterange` (immutable; Denver days, inclusive).
- `my_communities()` rows gain `next_event`: `{id, title, starts_at}` or null.

- [ ] **Step 1: Write the failing test** `supabase/tests/community_events_test.sql`, in the style of `communities_test.sql` (same four users: Ava admin, Ben member, Cal driver, Dee outsider; `do $$ ... assert ... end $$` blocks; `set_config('request.jwt.claim.sub', ...)` to switch user). Assertions:
  - Ava creates "Dawn patrol" for a day 5 days out; returns an id. Ben (member) calling `create_community_event` fails with `42501`.
  - Title of 1 char fails; title containing a blocked term fails; `p_ends_at < p_starts_at` fails.
  - `community_events(club, today, today+30)` as Ben returns 1 row with `going = 0`, `i_am_in = false`. As Dee it raises (not a member). `select count(*) from public.community_events` as Dee is 0 (RLS).
  - Direct `insert into public.community_events` as Ava fails (no table privilege).
  - Ben `set_event_rsvp(id, true)` twice: `going = 1`, `i_am_in = true`. Dee RSVP fails. `set_event_rsvp(id, false)`: `going = 0`.
  - RSVP to an event that ended yesterday fails with "This event is over."
  - Ben RSVPs, then `leave_community`: `community_event_rsvps` has no row for Ben.
  - An event inserted (as table owner) with `source = 'ics'`: Ava's `update_community_event` and `cancel_community_event` fail with "This event comes from the club calendar. Change it there."
  - Ava cancels the manual event: `community_events(...)` no longer returns it.
  - **Review Focus 5:** an event at `'2026-12-05 23:00 America/Denver'` to `'2026-12-05 23:30 America/Denver'` is returned for `p_from = p_to = '2026-12-05'` and not for `'2026-12-06'`. An all-day event with `starts_at = ends_at = '2026-12-05 00:00 America/Denver'` is returned for Dec 5 only.
  - Multi-day event Dec 4 to Dec 6 is returned for `p_from = p_to = '2026-12-05'`.
  - `my_communities()` as Ava has `next_event.title = 'Dawn patrol'` before the cancel and null after (when no other future event exists).

- [ ] **Step 2: Run it and see it fail**

Run the README psql command with `-f supabase/tests/community_events_test.sql` appended.
Expected: FAIL, `function public.create_community_event(...) does not exist`.

- [ ] **Step 3: Write the migration.** Tables, indexes on `(community_id, starts_at)`, RLS select policies `using (public.is_community_member(community_id))` (RSVPs via their event's community), the RPCs above, a trigger on `community_members` after delete that removes that user's RSVPs for that community's events, and `create or replace function public.my_communities()` copied from `20261114000014_community_requests.sql` with `next_event` added. Admin checks use `public.is_community_admin`. `update_community_event` sets `updated_at = now()`.

- [ ] **Step 4: Run the full SQL suite**

Expected: every test file passes, including the existing ones.

- [ ] **Step 5: Update the README** test command (add the new file) and add one sentence to the paragraph that describes each test file.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261117000016_community_events.sql supabase/tests/community_events_test.sql README.md
git commit -m "Add community events and RSVPs"
```

### Task 2: Rides linked to events

**Files:**
- Create: `supabase/migrations/20261117000017_ride_events.sql`
- Modify: `supabase/tests/community_events_test.sql` (append a section)

**Interfaces:**
- Consumes: Task 1 tables and `event_days`.
- Produces: `rides.event_id uuid null references community_events(id) on delete set null`, with the same column grants `community_id` has. `ride_board` gains `event_id` and `event_title` (appended as the last two columns; copy the view from `20261116000015_ride_requests.sql:700`). `ride_for_edit` gains `'event_id'`. `community_events(...)` now returns the real `ride_count` (non-cancelled, not yet departed rides with that `event_id`). Helper `release_event_rides(p_event_id uuid) returns void` sets `event_id = null` on rides whose `ride_date` is outside the event's days or whose event is cancelled.

- [ ] **Step 1: Append failing tests.** Cal is a verified driver and a member; create event E for day D (5 days out) and multi-day event M for D+7 to D+9.
  - Cal posts a community ride on D with `event_id = E`: succeeds; `ride_board.event_title = 'Dawn patrol'`; `community_events` shows `ride_count = 1`.
  - Posting a ride on D+1 with `event_id = E` fails with "That event isn't on this ride's day."
  - Posting an open ride (`community_id` null) with `event_id = E` fails with "Only community rides can be for an event."
  - Posting a ride for a second community with `event_id = E` fails with "Pick an event from this ride's community."
  - A ride on D+8 with `event_id = M` succeeds (inside a multi-day event).
  - Cal edits the linked ride's `depart_at` to D+2 (no riders booked): succeeds and `event_id` is now null.
  - Ava moves E to D+3 with `update_community_event`: a ride still linked on D is unlinked.
  - Ava cancels M: the D+8 ride still exists, is not cancelled, and `event_id` is null.

- [ ] **Step 2: Run and see it fail** (`column "event_id" of relation "rides" does not exist`).

- [ ] **Step 3: Write the migration.** New trigger function `enforce_ride_event()` on `rides`, `before insert or update of event_id, depart_at, community_id`. Compute the ride day from `new.depart_at at time zone 'America/Denver'` (do not rely on `ride_date` trigger order). When `event_id` is newly set (insert, or changed), violations raise the messages above. When `event_id` is unchanged but the row no longer fits, set `new.event_id := null`. Call `release_event_rides` from `update_community_event` and `cancel_community_event` (replace both functions here).

- [ ] **Step 4: Run the full SQL suite.** Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261117000017_ride_events.sql supabase/tests/community_events_test.sql
git commit -m "Let community rides be posted to an event"
```

### Task 3: Client types and API

**Files:**
- Modify: `packages/app/lib/types.ts`, `packages/app/lib/api.ts`, `packages/app/index.ts` (if types are re-exported there)

**Interfaces:**
- Consumes: Task 1 and 2 RPCs and `ride_board` columns.
- Produces, in `types.ts`:

```ts
export type CommunityEvent = {
  id: string;
  communityId: string;
  title: string;
  description: string;
  location: string;
  resortId: string | null;
  startsAt: string; // ISO
  endsAt: string; // ISO
  allDay: boolean;
  source: 'manual' | 'ics';
  going: number;
  iAmIn: boolean;
  goingPeople: Person[];
  rideCount: number;
};
export type NewCommunityEvent = Pick<CommunityEvent, 'title' | 'description' | 'location' | 'resortId' | 'startsAt' | 'endsAt' | 'allDay'>;
```

  `BoardRide` gains `eventId: string | null; eventTitle: string | null`. `NewRide` gains `eventId: string | null`. `Community` gains `nextEvent: { id: string; title: string; startsAt: string } | null`.
- Produces, on `Api`:

```ts
communityEvents(communityId: string, fromDay: string, toDay: string): Promise<CommunityEvent[]>; // YYYY-MM-DD
setEventRsvp(eventId: string, going: boolean): Promise<void>;
createCommunityEvent(communityId: string, event: NewCommunityEvent): Promise<string>;
updateCommunityEvent(eventId: string, event: NewCommunityEvent): Promise<void>;
cancelCommunityEvent(eventId: string): Promise<void>;
```

- [ ] **Step 1: Add the types and `Api` members.**
- [ ] **Step 2: Implement in `api.ts`** following `communityPage` for row mapping (avatar URLs are built the way `communityPage` builds member avatars). Add `event_id, event_title` to the `ride_board` column list at `api.ts:85` and to the row mapper; send `event_id` in `postRide` and `updateRide`; read it in the edit loader near `api.ts:320`.
- [ ] **Step 3: Fix every `NewRide` construction** (`PostRideScreen.tsx:177` area) by passing `eventId: null` for now.
- [ ] **Step 4: Typecheck**

Run: `npm run typecheck -w @lift2lift/web && npm run typecheck -w @lift2lift/mobile`
Expected: no errors.

- [ ] **Step 5: Commit** `git commit -am "Add community events to the client API"`

### Task 4: Calendar math

**Files:**
- Create: `packages/app/lib/events.ts`, `packages/app/lib/events.test.ts`

**Interfaces:**
- Consumes: `CommunityEvent`, `BoardRide`, and `isoDay`, `parseDay`, `addDays` from `lib/dates.ts`. Imports must be type-only or from `./dates.ts` with the `.ts` extension pattern that `node --test` accepts (see `supabase/functions/license-check/logic.test.ts`); if `dates.ts` cannot be imported that way, copy nothing: re-export what is needed through a relative import that works in both.
- Produces:

```ts
/** Every local day the event touches, YYYY-MM-DD. An all-day event never spills into the next day. */
export function eventDays(e: CommunityEvent): string[];
export function isMultiDay(e: CommunityEvent): boolean;
export function eventOn(events: CommunityEvent[], day: string): CommunityEvent | null; // earliest start wins
/** First event that has not ended at `now`. */
export function nextEvent(events: CommunityEvent[], now: Date): CommunityEvent | null;
/** Day the page opens on: the next event's first day (or today if it is under way), else today. */
export function initialDay(events: CommunityEvent[], now: Date): string;
/** Whole days from `today` to the event's first day; 0 if under way. */
export function daysAway(e: CommunityEvent, today: string): number;
/** "Next up · in 4 days", "Club event · in 17 days", "Next up · today", "Club event · tomorrow". */
export function kicker(e: CommunityEvent, next: CommunityEvent | null, today: string): string;
/** Leading nulls for the weekday offset, then each day of the month. Length is a multiple of 7. */
export function monthCells(month: Date): (string | null)[];
export type DayMark = { event: CommunityEvent | null; span: 'none' | 'single' | 'start' | 'middle' | 'end'; rowStart: boolean; rowEnd: boolean; rides: number };
/** One mark per non-null cell of `monthCells(month)`, keyed by day. `rides` counts community rides leaving that day. */
export function dayMarks(month: Date, events: CommunityEvent[], rides: BoardRide[]): Record<string, DayMark>;
export type MountainGroup = { resortId: string; rides: BoardRide[]; seatsOpen: number };
/** Rides with no event on `day`, grouped by mountain, most rides first, then most open seats. */
export function memberRidesByMountain(rides: BoardRide[], day: string): MountainGroup[];
export function ridesForEvent(rides: BoardRide[], eventId: string): BoardRide[]; // by departAt
```

- [ ] **Step 1: Write failing tests** with `node:test` and `node:assert/strict`. Build events with a small `ev(overrides)` factory. Cases:
  - `eventDays` for a timed event on one day returns that day; for Dec 4 4 PM to Dec 6 2 PM returns three days; for an all-day event stored as local Dec 5 00:00 to Dec 5 00:00 returns `['2026-12-05']`.
  - `monthCells(new Date(2026, 10, 1))` has 0 leading nulls and 30 days; December 2026 has 2 leading nulls and length 35.
  - `kicker`: next event 4 days out is `'Next up · in 4 days'`; a later event 17 days out is `'Club event · in 17 days'`; 1 day is `'... · tomorrow'`; 0 is `'... · today'`.
  - `initialDay` with no events returns today (**Review Focus 3**); with one future event returns its first day; with only past events returns today.
  - `nextEvent` skips an event that ended an hour ago and returns one that started yesterday and ends tomorrow.
  - **Review Focus 1:** event Nov 30 to Dec 2: `dayMarks(November)` marks Nov 30 as `span: 'start'`; `dayMarks(December)` marks Dec 1 `'middle'` and Dec 2 `'end'`; `eventOn(events, '2026-12-01')` returns it.
  - **Review Focus 2:** event Fri Dec 4 to Mon Dec 7: Dec 5 (Saturday) has `rowEnd: true`, Dec 6 (Sunday) has `rowStart: true`, both `'middle'`.
  - `dayMarks` ride counts: two community rides on a day give `rides: 2`; cancelled or other-community rides are the caller's job to filter (document it) and are not counted when absent.
  - `memberRidesByMountain`: rides with an `eventId` are left out; three rides across two mountains return the two-ride mountain first; `seatsOpen` sums `seatsTotal - seatsTaken`.

- [ ] **Step 2: Run and see them fail**

Run: `node --test packages/app/lib/events.test.ts`
Expected: FAIL, cannot find `./events.ts` exports.

- [ ] **Step 3: Implement `events.ts`.** Pure functions, no React, no `Date.now()` inside (callers pass `now` or `today`).

- [ ] **Step 4: Run tests and typecheck.** Expected: all pass, no type errors.

- [ ] **Step 5: Commit** `git add packages/app/lib/events.ts packages/app/lib/events.test.ts && git commit -m "Add calendar math for community events"`

### Task 5: Calendar, hero and mountain rides components

**Files:**
- Create: `packages/app/components/EventCalendar.tsx`, `packages/app/components/EventHero.tsx`, `packages/app/components/MountainRides.tsx`
- Modify: `packages/app/components/MountainsHome.tsx` (export `Tile`'s visual as a reusable piece only if it can be reused without changing its behavior; otherwise leave it and match its styles)

**Interfaces:**
- Consumes: Task 4 functions, `RideCard`, `Card`, `Button`, `Label`, `Avatar`, `useTheme`, `clock`, `longDay`, `RESORT_BY_ID`, `passesFor`, `PASS_LABEL`.
- Produces:

```tsx
export function EventCalendar(props: {
  month: Date; // first of month
  onMonth: (month: Date) => void;
  minMonth: Date;
  maxMonth: Date;
  marks: Record<string, DayMark>;
  selectedDays: Set<string>; // every day of the selected event, or the one selected day
  today: string;
  onPick: (day: string) => void;
}): JSX.Element;

export function EventHero(props: {
  event: CommunityEvent;
  kicker: string;
  rides: BoardRide[]; // rides to this event
  busy: boolean;
  canEdit: boolean; // admin and source === 'manual'
  onToggleIn: () => void;
  onOfferRide: () => void;
  onEdit: () => void;
  onCancel: () => void;
  renderRide: (ride: BoardRide) => ReactNode; // the screen supplies a RideCard
}): JSX.Element;

export function MountainRides(props: {
  title: string; // "Member rides" or "Other member rides"
  note: string; // "by mountain · Sat, Nov 21"
  groups: MountainGroup[];
  renderRide: (ride: BoardRide) => ReactNode;
}): JSX.Element | null; // null when groups is empty
```

- [ ] **Step 1: Build `EventCalendar`.** Layout and sizes from the mockup's Calendar section and `DayPicker` in `components/Pickers.tsx:255`: weekday header, 7 equal columns, cells 52 high, day number, a 12×5 bar for a single-day event, the yellow ride-count pill, and for multi-day events a 5-high bar along the cell bottom whose outer ends are inset 8 and rounded only at `start`/`end` or at `rowStart`/`rowEnd` (**Review Focus 2**). Selected cells fill with `t.ink`, text `t.bg`; a multi-day selection squares the inner corners. Today gets a 1.5 border. Days before today are 0.3 opacity and disabled. Month arrows disable at `minMonth`/`maxMonth`. Legend row: "Club event", "Multi-day", "Member rides". Each cell is a `Pressable` with `accessibilityRole="button"`, `accessibilityState={{ selected, disabled }}` and a label like `"November 21, Copper dawn patrol, 4 rides"`.

- [ ] **Step 2: Build `EventHero`.** Background `t.header`, text `t.headerInk`, kicker in `t.accent`. Rows: kicker and date (range for multi-day: `"Fri, Dec 4 to Sun, Dec 6"`), title (30, weight 900, uppercase), a line with time and place (all-day events show no time), up to 4 `Avatar`s plus `"18 going"` or `"19 going, including you"`, then buttons: **I am in** (primary; when in, outlined in accent and titled `"You are in ✓"`), **Find a ride · N** (shown only when `rides.length > 0`; toggles the list; title becomes `"Hide rides · N"`), **Offer a ride** (ghost). Rides are hidden until toggled. When shown, a card under the hero titled `"N rides to this event"` renders `renderRide` for each. `source === 'ics'` shows the muted note "From club calendar"; `canEdit` shows Edit and Cancel event as small ghost/danger buttons with the same confirm-in-place pattern `RideCard` uses for "Cancel ride".

- [ ] **Step 3: Build `MountainRides`.** Header like `Rail` in `MountainsHome.tsx:105`. A horizontal `ScrollView` of tiles styled like `Tile` (`MountainsHome.tsx:57`): rank, yellow `"2 rides"` pill, uppercase name, pass line, big seats-open number, `"seats open"`. Selected tile has a 2 px `t.ink` border; first tile selected by default; selection resets when `groups` changes identity by resort list. Below, `renderRide` for the selected group's rides.

- [ ] **Step 4: Typecheck** both apps. Expected: no errors.

- [ ] **Step 5: Commit** `git add packages/app/components && git commit -m "Add event calendar, hero and mountain rides components"`

### Task 6: Event form and members view

**Files:**
- Create: `packages/app/components/EventForm.tsx`, `packages/app/components/CommunityMembers.tsx`

**Interfaces:**
- Consumes: `PickerSheet`, `DayPicker`, `OptionPicker` from `components/Pickers.tsx`; the time picker `PostRideScreen` uses; `Field`, `Button`, `Notice`; Task 3 API methods.
- Produces:

```tsx
export function EventForm(props: {
  visible: boolean;
  initial?: CommunityEvent; // edit when set
  defaultDay: string; // YYYY-MM-DD for a new event
  onClose: () => void;
  onSave: (event: NewCommunityEvent) => Promise<void>; // rejects with a user-facing message
}): JSX.Element;

export function CommunityMembers(props: {
  page: CommunityPage;
  me: string | undefined;
  onChanged: () => Promise<void>; // reload the page
  onMessage: (text: string, kind: 'success' | 'error') => void;
  children?: ReactNode; // extra admin cards (Task 12 passes the Club calendar card)
}): JSX.Element;
```

- [ ] **Step 1: Move, do not rewrite.** Cut the invite-code card, members list, admin tools and Leave community from `CommunityScreen.tsx` (lines 131-152 and 232-408) into `CommunityMembers` with their state (`editing`, `name`, `description`, `confirm`, `busy`, `run`). Behavior and copy stay identical. `children` renders inside the Admin section, above the existing buttons.
- [ ] **Step 2: Build `EventForm`** in a `PickerSheet`. Fields: Title, All day (toggle), Starts (day + time), Ends (day + time, defaults to start + 2 hours; day-only when all day), Place, Mountain (optional `OptionPicker` over `RESORTS` with "No mountain" first), Description (multiline). Client checks before calling `onSave`: title at least 2 chars ("Give the event a name."), end not before start ("The end has to be after the start."). An all-day event is saved as local 00:00 on the first day to local 00:00 on the last day. Save errors show in a `Notice` inside the sheet.
- [ ] **Step 3: Typecheck.** The app still builds; `CommunityScreen` now renders `<CommunityMembers>` where the moved blocks were, so the page looks the same as before this task.
- [ ] **Step 4: Commit** `git commit -am "Extract community members view and add the event form"`

### Task 7: The new community page

**Files:**
- Modify: `packages/app/screens/CommunityScreen.tsx`, `apps/web/app/community/page.tsx`, `apps/mobile/app/community.tsx`

**Interfaces:**
- Consumes: everything from Tasks 3 to 6.
- Produces: `CommunityScreen({ communityId, welcome, view }: { communityId?: string; welcome?: string; view?: string })`. `view === 'members'` shows the members view. Both route files pass `view` from the query string.

- [ ] **Step 1: Load data.** Alongside `communityPage` and `listRides`, load `communityEvents(communityId, firstOfThisMonth, today + 180 days)` once. Derive `communityRides` as today (same filter as `CommunityScreen.tsx:60`). State: `day` (starts at `initialDay(events, new Date())`), `month` (first of `day`'s month), `formFor` (`null | 'new' | CommunityEvent`).
- [ ] **Step 2: Compose the events view** per the spec's "Community page" and the mockup:
  1. `BackLink`, header row with `CommunityBadge`, name, member line, and buttons **Members** (`nav.push('/community', { id, view: 'members' })`) and, for admins, **+ Add event**.
  2. `message` notice; the join-requests card for admins with pending requests (unchanged, stays on this view).
  3. A row that wraps: day panel (`flexGrow: 1`, `flexBasis: 420`) then `EventCalendar` (`flexBasis: 340`, `maxWidth: 380`). Under `useCompact()` it is a single column with the day panel first.
  4. Day panel: `EventHero` when `eventOn(events, day)`; else a `Label` with the long day. Then `MountainRides` with `memberRidesByMountain(communityRides, day)`, titled "Other member rides" under an event and "Member rides" otherwise. When there is neither, the dashed empty state from the mockup with **+ Post a ride for <day>**.
  - `selectedDays` is the event's `eventDays` or `{day}`. Picking a day inside a multi-day event sets `day` to that event's first day.
  - `renderRide` returns the existing `<RideCard>` with the props `CommunityScreen` passes today.
  - I am in: optimistic toggle, call `setEventRsvp`, reload events, show errors via `message`.
  - Offer a ride and the empty-state button: `nav.push('/post', { community: id, day, event: event?.id })` (omit `event` when none; `resort` when the event has a `resortId`).
  - The page's main column widens from `FormScreen`'s 480 to 960 for this screen only: add an optional `wide?: boolean` prop to `FormScreen` in `components/ui.tsx` that sets `maxWidth: 960`.
- [ ] **Step 3: Compose the members view:** `BackLink` to the events view (`‹ CU Freeride`), then `<CommunityMembers>`.
- [ ] **Step 4: Wire the form.** `EventForm` `onSave` calls `createCommunityEvent` or `updateCommunityEvent`, reloads events, selects the event's first day, and shows "Event added." or "Saved.". Cancel event calls `cancelCommunityEvent` and shows "Event cancelled. Rides to it stay up as member rides."
- [ ] **Step 5: Typecheck** both apps. Expected: no errors.
- [ ] **Step 6: Commit** `git commit -am "Rebuild the community page around the events calendar"`

### Task 8: Post a ride to an event, tags, next event, seed, and a localhost check

**Files:**
- Modify: `packages/app/screens/PostRideScreen.tsx`, `apps/web/app/post/page.tsx`, `apps/mobile/app/post.tsx`, `packages/app/components/RideCard.tsx`, `packages/app/screens/CommunitiesScreen.tsx`, `supabase/seed.sql`, `README.md`

**Interfaces:**
- Consumes: `Api.communityEvents`, `eventDays`, `NewRide.eventId`, `BoardRide.eventTitle`, `Community.nextEvent`.
- Produces: `PostRideScreen` accepts `initialEvent?: string` and `initialDay?: string`; the route files pass `event` and `day` query params.

- [ ] **Step 1: Post a ride.** When `communityId` is set, load that community's events for the chosen day (`communityEvents(communityId, day, day)`). If there are any, show a "For event" chip row under the community picker: "No event" first, then one chip per event. `initialEvent` preselects it. Changing the community or moving the day off the event clears the selection. Send `eventId` in `postRide`/`updateRide`; the edit loader restores it. Helper line under the chips: "Shows under the event so members can find a ride to it."
- [ ] **Step 2: Ride card.** After the members-only tag (`RideCard.tsx:299`), when `ride.eventTitle` is set, add a tag in `t.chip` with `ride.eventTitle`, `numberOfLines={1}`.
- [ ] **Step 3: Communities tab.** In the "Your communities" card (`CommunitiesScreen.tsx:237`), when `c.nextEvent` is set add a third line: `Next: {title} · {dayLabel(isoDay(new Date(startsAt)))}` in `t.ink`, weight 700, size 13.
- [ ] **Step 4: Seed.** In `supabase/seed.sql`, put the two demo accounts in one named community (driver as admin) and add three events relative to `now()`: one in 4 days at a mountain, one weeknight off-mountain in 7 days, one three-day event in 17 days. Link one of the driver's sample rides to the first event if its day allows; otherwise add a ride for that day. Check what the seed already creates before adding.
- [ ] **Step 5: README.** Add a "Community events" bullet beside the existing feature bullets describing the page, RSVPs and rides to events.
- [ ] **Step 6: Run it on localhost.**

```bash
npm run db:reset
npm run web
```

Open `http://localhost:3000`, sign in as `driver@lift2lift.test`, open Communities, open the seeded community. Check, in light and dark, at desktop width and at 375 wide:
  - the page opens on the next event with the hero; the calendar shows three events, one as a continuous bar;
  - I am in toggles and the count changes; Find a ride reveals rides; Offer a ride opens Post with community, day and event preselected, and the posted ride appears under the event;
  - a ride-only day shows mountain tiles and ride cards; an empty day shows the empty state;
  - + Add event creates an event that appears on the calendar; Edit and Cancel work; Members opens the members view with every old control present;
  - sign in as `rider@lift2lift.test`: no + Add event, no Edit/Cancel;
  - **Review Focus 3:** a community with no events and no rides opens on today with the empty state.

Fix what fails before committing.

- [ ] **Step 7: Run all tests** (SQL suite, `node --test packages/app/lib/events.test.ts`, both typechecks). Expected: all pass.
- [ ] **Step 8: Commit** `git commit -am "Post rides to events and show events across the app"`

---

# Phase 2: calendar import

### Task 9: Calendar link and sync in the database

**Files:**
- Create: `supabase/migrations/20261117000018_community_calendars.sql`, `supabase/tests/community_calendars_test.sql`
- Modify: `README.md` (test command and description)

**Interfaces:**
- Consumes: Task 1 tables, `release_event_rides`.
- Produces table `public.community_calendars (community_id pk, ics_url text not null, last_synced_at timestamptz, last_error text, set_by uuid, set_at timestamptz)`; no grants to `authenticated`.
- Produces RPCs:
  - `community_calendar(p_community_id uuid) returns jsonb`: `{ics_url, last_synced_at, last_error}` or null. Admins only.
  - `set_community_calendar(p_community_id uuid, p_url text) returns void`: admins only. Null or empty clears the row and deletes that community's imported events that have not started. Otherwise normalizes `webcal://` to `https://`, then requires `calendar_url_ok(p_url)`, else raises "Use a Google, Outlook or iCloud calendar link."
  - `calendar_url_ok(p_url text) returns boolean` (immutable): `https` scheme, no userinfo, no explicit port, host exactly one of `calendar.google.com`, `outlook.office365.com`, `outlook.office.com`, `outlook.live.com`, or ending in `.icloud.com`.
  - `calendars_to_sync() returns table (community_id uuid, ics_url text)`: service role only.
  - `apply_calendar_sync(p_community_id uuid, p_events jsonb, p_error text) returns void`: service role only (`revoke ... from public, anon, authenticated; grant ... to service_role`). When `p_error` is not null: set `last_error`, leave events alone, return. Otherwise for each element `{uid, title, description, location, resort_id, starts_at, ends_at, all_day}`: upsert on `(community_id, ics_uid)` with `source = 'ics'`, clearing `cancelled_at`; then set `cancelled_at = now()` on imported events of that community with `ends_at > now() - interval '1 day'` and `starts_at < now() + interval '180 days'` whose `ics_uid` is not in the payload; call `release_event_rides` for every event touched; set `last_synced_at = now()`, `last_error = null`. An element whose title or description fails `has_blocked_term` is skipped.

- [ ] **Step 1: Write the failing test.** Assertions:
  - `calendar_url_ok` is true for `https://calendar.google.com/calendar/ical/x/basic.ics`, `https://outlook.office365.com/owa/calendar/a/b/calendar.ics`, `https://p12-caldav.icloud.com/published/2/abc`; false for `http://calendar.google.com/x`, `https://calendar.google.com.evil.test/x`, `https://evilicloud.com/x`, `https://user:pw@calendar.google.com/x`, `https://calendar.google.com:8443/x`, `https://169.254.169.254/latest`, `https://localhost/x`, and null.
  - Ben (member) calling `set_community_calendar` or `community_calendar` fails with `42501`. `select * from public.community_calendars` as Ava (admin) fails or returns nothing (no table grant).
  - Ava sets a `webcal://calendar.google.com/...` link: stored as `https://...`.
  - `apply_calendar_sync` called as `authenticated` fails; as table owner with two events creates two rows with `source = 'ics'`.
  - Second sync with one changed title and one event missing: the title updates in place (same `id`, so Ben's RSVP on it survives) and the missing one is cancelled.
  - Third sync where the missing event returns: it is un-cancelled and its RSVP is still there.
  - A ride linked to an imported event is unlinked when a sync moves the event to another day.
  - `apply_calendar_sync(club, null, 'Could not read that calendar link')` leaves events untouched and sets `last_error` (**Review Focus 4**).
  - An element with a blocked term in the title is not stored.
  - Clearing the link deletes future imported events and keeps manual ones.

- [ ] **Step 2: Run and see it fail.**
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4: Run the full SQL suite.** Expected: all pass.
- [ ] **Step 5: README:** add the test file to the command and a sentence to the description.
- [ ] **Step 6: Commit** `git commit -am "Add community calendar links and sync storage"`

### Task 10: ICS parsing and URL checks

**Files:**
- Create: `supabase/functions/sync-community-calendars/logic.ts`, `supabase/functions/sync-community-calendars/logic.test.ts`
- Create or modify: `supabase/functions/deno.json` (import map entry `"ical.js": "npm:ical.js@2"`), root `package.json` (`ical.js` in `devDependencies` so `node --test` resolves the same bare import)

**Interfaces:**
- Produces:

```ts
export const ALLOWED_HOSTS: string[]; // the four exact hosts; '.icloud.com' handled as a suffix
export function calendarUrlProblem(url: string): string | null; // null when allowed; mirrors calendar_url_ok
export type SyncEvent = { uid: string; title: string; description: string; location: string; resort_id: string | null; starts_at: string; ends_at: string; all_day: boolean };
export type Resort = { id: string; name: string };
/** Throws Error('not a calendar') when the text is not an ICS calendar. */
export function eventsFromIcs(ics: string, now: Date, resorts: Resort[]): SyncEvent[];
export function guessResort(text: string, resorts: Resort[]): string | null;
```

  Rules for `eventsFromIcs`: window is `now - 1 day` to `now + 180 days`; expand `RRULE` with `EXDATE` and `RECURRENCE-ID` overrides inside the window; `uid` is `"<UID>|<YYYY-MM-DD>"` using the occurrence's `America/Denver` date, with `|2`, `|3` appended for further occurrences of one series on the same day; `STATUS:CANCELLED` events are left out; all-day events (`VALUE=DATE`) get `all_day: true`, `starts_at` at Denver midnight of the first day and `ends_at` at Denver midnight of the last day (ICS end is exclusive, so subtract a day); timed events with no end use start + 1 hour; `title` is trimmed `SUMMARY`, `"Club event"` when empty or one character, cut to 80; `description` cut to 1000; `location` cut to 120; at most 500 events, earliest first.

- [ ] **Step 1: Write failing tests** with inline ICS strings:
  - `calendarUrlProblem`: the same true/false list as Task 9 Step 1.
  - one timed event with `TZID=America/Denver` at 08:30 maps to the right UTC instant; a `Z` time and a floating time are handled (floating is read as Denver).
  - **Review Focus 5:** `DTSTART;VALUE=DATE:20261205` / `DTEND;VALUE=DATE:20261206` gives `all_day: true` and start and end both on Dec 5 Denver. A three-day all-day event (`20261204` to `20261207`) ends on Dec 6.
  - weekly `RRULE` with `COUNT=4` gives 4 events with distinct uids ending in their dates; one `EXDATE` removes one; a `RECURRENCE-ID` override moved by 30 minutes keeps the same uid as the plain occurrence would have had.
  - an event 200 days out and one 3 days ago are left out.
  - `STATUS:CANCELLED` is left out. Empty `SUMMARY` becomes `"Club event"`. A 300-character summary is cut to 80.
  - `guessResort('Dawn patrol at Copper Mountain', resorts)` returns Copper's id; `'Wax night, Rec Center'` returns null; a name inside another word does not match.
  - **Review Focus 4:** `eventsFromIcs('<html><body>Sign in</body></html>', now, [])` throws `not a calendar`; so does an empty string.
- [ ] **Step 2: Run and see them fail.** `node --test supabase/functions/sync-community-calendars/logic.test.ts`
- [ ] **Step 3: Implement** with `ical.js` (`ICAL.parse`, `ICAL.Component`, `ICAL.Event`, its recurrence iterator). Read the library's README for the exact iterator API before writing; do not hand-roll `RRULE`. Add the first line comment `// Run with: node --test supabase/functions/sync-community-calendars/logic.test.ts`.
- [ ] **Step 4: Run tests.** Expected: all pass.
- [ ] **Step 5: Commit** `git add supabase/functions package.json package-lock.json && git commit -m "Parse club calendar feeds"`

### Task 11: The sync function

**Files:**
- Create: `supabase/functions/sync-community-calendars/index.ts`
- Modify: `supabase/functions/sync-community-calendars/logic.ts` and `logic.test.ts` (the fetch helper), `supabase/config.toml`, `README.md`

**Interfaces:**
- Consumes: Task 9 RPCs, Task 10 functions, `adminClient`, `userClient`, `json`, `corsHeaders` from `_shared/http.ts`.
- Produces, in `logic.ts`:

```ts
/** Fetches a calendar with every guard. Rejects with Error('Could not read that calendar link') on any failure. */
export async function fetchCalendar(url: string, fetchFn?: typeof fetch): Promise<string>;
```

  `redirect: 'manual'`; up to 3 redirects, each `Location` passed through `calendarUrlProblem`; `AbortSignal.timeout(10_000)`; read the body as a stream and stop at 2 MB (2 * 1024 * 1024 bytes); non-200 final status fails.
- Produces the HTTP function `sync-community-calendars`, `verify_jwt = false`, two modes:
  - **Cron:** `Authorization: Bearer <CRON_SECRET>`. Syncs every row from `calendars_to_sync()`, one at a time; one failure does not stop the rest. Responds `{ synced, failed }`.
  - **Sync now:** `POST` with a user JWT and body `{ community_id }`. Uses `userClient(req).rpc('community_calendar', ...)` to prove the caller is an admin of that community and to get the link, then syncs that one. Responds `{ ok: true }` or `{ ok: false, error: 'Could not read that calendar link' }`. Handles `OPTIONS` with `corsHeaders`.
  - Per community: `fetchCalendar`, `eventsFromIcs(text, new Date(), RESORTS)`, then `apply_calendar_sync(id, events, null)`; on any thrown error, `apply_calendar_sync(id, null, 'Could not read that calendar link')` and log the real error with `console.error`. The resort list is a small `{id, name}[]` constant in `index.ts` copied from `packages/app/lib/resorts.ts`, with a comment naming the source.

- [ ] **Step 1: Write failing tests for `fetchCalendar`** using a stub `fetchFn`:
  - 200 with ICS text returns the text.
  - a redirect to `https://example.com/x` rejects; a redirect to another allowed host is followed; 4 redirects reject.
  - a body of 3 MB rejects (**Review Focus 4**); a 500 rejects; a stub that rejects (timeout) rejects with the same message.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement `fetchCalendar` and `index.ts`.** Add to `supabase/config.toml`:

```toml
# Called every 15 minutes by pg_cron with CRON_SECRET, and by admins for "Sync now". Checks its own auth.
[functions.sync-community-calendars]
verify_jwt = false
```

- [ ] **Step 4: README.** Under the existing cron section add the deploy command (`npx supabase functions deploy sync-community-calendars --no-verify-jwt`) and:

```sql
select cron.schedule('sync-community-calendars', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://vpkxesucfaofwazqgpni.supabase.co/functions/v1/sync-community-calendars',
    headers := jsonb_build_object('Authorization', 'Bearer <your CRON_SECRET>')
  );
$$);
```

  Add a short "Club calendars" paragraph: what admins paste, the allowed hosts, and why other hosts are refused.
- [ ] **Step 5: Run tests.** `node --test supabase/functions/sync-community-calendars/logic.test.ts`. Expected: all pass.
- [ ] **Step 6: Commit** `git commit -am "Sync club calendars on a schedule and on demand"`

### Task 12: Club calendar card

**Files:**
- Create: `packages/app/components/ClubCalendarCard.tsx`
- Modify: `packages/app/lib/types.ts`, `packages/app/lib/api.ts`, `packages/app/screens/CommunityScreen.tsx`

**Interfaces:**
- Consumes: Task 9 RPCs, the Task 11 function, `CommunityMembers` `children`.
- Produces:

```ts
export type CommunityCalendar = { icsUrl: string; lastSyncedAt: string | null; lastError: string | null };
// on Api:
communityCalendar(communityId: string): Promise<CommunityCalendar | null>;
setCommunityCalendar(communityId: string, url: string | null): Promise<void>;
syncCommunityCalendar(communityId: string): Promise<void>; // rejects with the function's error text
```

```tsx
export function ClubCalendarCard(props: { communityId: string; onSynced: () => void }): JSX.Element;
```

- [ ] **Step 1: API.** `syncCommunityCalendar` uses `supabase.functions.invoke('sync-community-calendars', { body: { community_id } })`, as other functions are invoked in `api.ts`, and throws when `ok` is false.
- [ ] **Step 2: Build the card.** `Label` "Club calendar". No link yet: a `Field` "Calendar link", placeholder `https://calendar.google.com/calendar/ical/…/basic.ics`, **Connect calendar** button, and two muted lines: "Google Calendar: Settings, your calendar, Integrate calendar, Secret address in iCal format." and "Outlook: Settings, Calendar, Shared calendars, Publish a calendar, ICS link." Connect saves, then syncs, then calls `onSynced`. With a link: the host only (never the full link), "Last synced 5 minutes ago" or "Not synced yet", `last_error` in an error `Notice` when set, **Sync now** and **Remove** (confirm in place: "Remove the club calendar? Imported events that haven't started are removed. Events you added here stay."). Add one muted line: "Events from the calendar can't be edited here. Change them in the calendar."
- [ ] **Step 3: Mount it** for admins as `children` of `CommunityMembers` in the members view; `onSynced` reloads events.
- [ ] **Step 4: Typecheck** both apps.
- [ ] **Step 5: Check on localhost.** `npm run db:reset`, `npx supabase functions serve`, `npm run web`. As the admin: paste a real public Google Calendar ICS link, see events appear on the calendar with "From club calendar"; paste `https://example.com/a.ics` and see "Use a Google, Outlook or iCloud calendar link."; Remove clears imported events and keeps manual ones. As a member: no card.
- [ ] **Step 6: Run everything** (SQL suite, both `node --test` files, both typechecks). Expected: all pass.
- [ ] **Step 7: Commit** `git commit -am "Let admins connect a club calendar"`
