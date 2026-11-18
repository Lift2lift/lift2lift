# Community events calendar: design

Date: 2026-11-17
Mockup: https://claude.ai/artifact/LbSr4MbUXnvuRaBEo6UeP3 (two artboards: next event with rides by mountain, and a cabin weekend)
Mockup source, readable offline: `2026-11-17-community-events-calendar-mockup.html` beside this file. Its markup carries the layout, sizes, colors and copy; its script carries sample data and the calendar logic. The second artboard is the same page opened on December with the cabin weekend selected.

## Intent

A community page today is a flat list of upcoming rides plus members and admin tools. Clubs mainly want it to show **club events** (dawn patrols, wax nights, cabin weekends), with the members-only rides attached. The page becomes a calendar of club events, and rides are how members get to them.

Clubs already keep a Google or Outlook calendar. They should not retype it, so events are read in from that calendar.

## Goals

- A community page led by the next club event, with a month calendar beside it.
- Club events are first-class: title, time, place, optional mountain, single or multi-day.
- Members say "I am in" and see how many are going.
- A ride can be posted to an event. The event shows its rides.
- Members-only rides with no event still show for the selected day, grouped by mountain.
- An admin connects a Google or Outlook calendar by pasting its ICS link. Events sync on a schedule.
- Admins can also add, edit and cancel events by hand.
- The page stays sparse. Rides to an event are hidden until asked for. Members and admin tools are behind a button.

## Non-goals

- OAuth sign-in to Google or Microsoft. (Needs Google app verification and campus IT consent.)
- Writing back to the club's calendar.
- An export feed so members can subscribe from their own calendar app.
- Event chat, comments, payments, waitlists or capacity limits.
- Push notifications for events.
- Events on the Mountains tab or outside a community.
- A map view.

## Anti-goals

- A community ride or event becoming visible to a non-member. Events follow the same rule as community rides: members only.
- The server fetching arbitrary URLs an admin types in (see Security).
- A cluttered page. If a section is not needed for the selected day, it is not rendered.
- Changing Colorado carpool rules, booking, or seat requests. Ride behavior is untouched apart from the optional event link.

## Constraints

- One shared React Native codebase in `packages/app` serves web (Next.js) and iOS (Expo). No web-only components.
- Styling is inline styles with `useTheme()` tokens, light and dark. No new UI library.
- Data access goes through `Api` in `packages/app/lib/types.ts` and `lib/api.ts`, backed by Supabase RPCs that are `security definer` with `search_path = ''`, as in `20261114000013_communities.sql`.
- Every new rule gets a SQL test in `supabase/tests/`, run with the `psql` command in the README. Edge-function logic gets a `logic.ts` plus `logic.test.ts`, as in `license-check`.
- Scheduled work uses `pg_cron` + `pg_net` calling an edge function with `CRON_SECRET`, as `send-ride-reminders` does.
- The repo is public. No secrets in migrations.

## Approaches

**Page layout.** Three were mocked: (A) month grid with a day agenda, (B) a schedule list with a week strip, (C) a "next up" hero with an event rail. Chosen: **A and C merged**. One panel shows the selected day and opens on the next event as a hero; the calendar sits beside it. B was dropped because it is weak for planning weeks ahead.

**Calendar source.** (1) ICS link pasted by an admin, fetched on a schedule. (2) OAuth to Google Calendar API and Microsoft Graph. (3) Manual entry only. Chosen: **1, plus manual entry**. ICS needs no app review, covers Google, Outlook and Apple with one code path, and setup is one pasted link. OAuth stays possible later because imported events are stored the same way whatever fetched them.

## Data model

New migration `supabase/migrations/20261117000016_community_events.sql`.

`community_events`
- `id uuid pk`, `community_id uuid` (fk, cascade), `title text` (2 to 80 chars), `description text` (up to 1000), `location text` (up to 120)
- `resort_id text null`: the mountain, when the event is at one. Same ids as `rides.resort_id`.
- `starts_at timestamptz`, `ends_at timestamptz` (`ends_at >= starts_at`), `all_day boolean`
- `source text` in (`manual`, `ics`), `ics_uid text null`, unique on (`community_id`, `ics_uid`)
- `created_by uuid null`, `created_at`, `updated_at`, `cancelled_at timestamptz null`

`community_event_rsvps`: `event_id`, `user_id`, `created_at`, pk (`event_id`, `user_id`), both cascade.

`community_calendars`: one row per community, admin-only. `community_id pk`, `ics_url text`, `last_synced_at`, `last_error text null`, `set_by uuid`. A separate table, not columns on `communities`, because members can select from `communities` and must never read the link.

`rides.event_id uuid null` references `community_events` on delete set null. `ride_board` gains `event_id`.

A multi-day event is one row whose `ends_at` falls on a later day. A recurring event from ICS is expanded into one row per occurrence (see Sync).

## Rules (enforced in the database)

- Members of a community can read its events and RSVPs. Nobody else can. Direct table writes are revoked; all writes go through RPCs.
- Only admins create, edit or cancel events, and only `manual` ones. Imported events are changed in the source calendar.
- Titles, descriptions and locations pass `has_blocked_term`, as community names do.
- Any member can RSVP to a non-cancelled event that has not ended. Leaving or being removed from the community deletes that person's RSVPs there.
- A ride's `event_id` must belong to the ride's own `community_id`, and the ride's `ride_date` must fall within the event's days (Mountain Time). Enforced in the existing `enforce_ride_community` trigger path. An event's link cannot be set on an open (non-community) ride.
- Cancelling an event keeps its rides; they become plain member rides (`event_id` set to null).
- A ride that stops fitting its event is unlinked, never blocked and never left stale. This covers all three paths: the driver moves the ride to a day outside the event, an admin changes a manual event's dates, and a sync moves an imported event. The ride itself is otherwise untouched. The trigger that checks the link therefore also fires on changes to `event_id` and to the ride's date.
- Only admins read or set the calendar link.

## RPCs

- `community_events(p_community_id, p_from date, p_to date)` returns events overlapping the range, each with `going`, `i_am_in`, up to 4 going avatars, and `ride_count`. Members only.
- `set_event_rsvp(p_event_id, p_going boolean)`.
- `create_community_event(...)`, `update_community_event(...)`, `cancel_community_event(p_event_id)`. Admins only.
- `community_calendar(p_community_id)` returns the link, last sync time and last error. Admins only.
- `set_community_calendar(p_community_id, p_url)`; null clears it and deletes that community's future imported events. Admins only. Validates the URL shape (see Security).
- `apply_calendar_sync(p_community_id, p_events jsonb, p_error text)`: service role only. Upserts by `ics_uid`, cancels imported events in the sync window that are no longer in the feed, records sync time and error.

`community_page` is unchanged. Rides still come from `listRides()` filtered by community, as today.

## Sync

New edge function `supabase/functions/sync-community-calendars`, `verify_jwt = false`, guarded by `CRON_SECRET`, scheduled every 15 minutes in the README alongside the existing cron job.

- For each row in `community_calendars`: fetch, parse, map to events, call `apply_calendar_sync`.
- Window: from yesterday to 180 days ahead. Events outside it are ignored.
- Recurring events (`RRULE`, `EXDATE`, overrides) are expanded inside the window. Each occurrence's `ics_uid` is the feed UID plus the occurrence's Mountain Time **date** (plus a counter if one series has two occurrences on one day). Keying on the date, not the time, means moving a weekly series by half an hour updates the same rows, so RSVPs and linked rides survive. Moving an occurrence to another day is treated as a different event.
- An imported event that disappears and later returns with the same key is un-cancelled and keeps its RSVPs. Rides released while it was gone stay released.
- All-day events set `all_day` and span whole Mountain Time days. ICS all-day end dates are exclusive and are converted.
- `STATUS:CANCELLED` and disappearing events are cancelled, which keeps RSVPs out of view and releases linked rides.
- Mapped fields: `SUMMARY` to title, `DESCRIPTION` to description, `LOCATION` to location, start and end. Text is truncated to the column limits. An imported title that fails the word filter is skipped, not stored.
- `resort_id` is guessed by matching the location and title against resort names in `packages/app/lib/resorts.ts`. No match leaves it null.
- A feed that fails keeps the events already stored and records `last_error` for the admin to see.
- A second function path, `sync-community-calendar-now` or a mode of the same function, lets an admin trigger a sync for their own community right after pasting the link. Builder's choice which.

Parsing and mapping live in a pure `logic.ts` with tests. Use an existing ICS library that handles `RRULE` and time zones rather than hand-rolling one.

## Security

The server fetches a URL supplied by a community admin. The function must:

- accept `https` only, default port only, and reject URLs with credentials;
- accept only known calendar hosts: `calendar.google.com`, `outlook.office365.com`, `outlook.office.com`, `outlook.live.com`, and `*.icloud.com`. The list is one constant, checked in both `set_community_calendar` and the function. Resolving the host and checking the address is not enough on its own, because the runtime resolves DNS again when it fetches (DNS rebinding), so the allowlist is the control. Self-hosted feeds are rejected with "Use a Google, Outlook or iCloud calendar link";
- follow at most 3 redirects, by hand, and apply the same host check to each;
- time out at 10 seconds and stop reading at 2 MB;
- never return fetched content or detailed fetch errors to the client, only a short status such as "Could not read that calendar link".

`webcal://` links are accepted on input and stored as `https://`.

## Screens

All in `packages/app`. The mockup is the reference for layout and copy.

**Community page** (`screens/CommunityScreen.tsx`), top to bottom:

1. Back link and community header, as today. Two buttons on the right: **Members**, and for admins **+ Add event**.
2. Notices: welcome and action messages, as today. Admins with pending join requests see the existing requests card here, because it needs action.
3. Two columns on wide screens, one on phones (`useCompact`): the **day panel**, then the **calendar**. On phones the day panel comes first.
4. Leave community link stays at the bottom of the Members view, not this page.

**Day panel** shows the selected day. It opens on the next upcoming event; with no upcoming events it opens on today.

- Event day: a hero in the header colors with a kicker ("Next up · in 4 days" for the next event, otherwise "Club event · in N days", or "Today"), dates, title, time and place, going avatars and count, **I am in** (toggles), and **Find a ride · N** when the event has rides. Tapping it reveals the rides to that event; hidden by default.
- A multi-day event shows its date range, and its rides show their day.
- Below: **Member rides, by mountain** for that day, only when there are rides without an event. Mountain tiles reuse the look of `Tile` in `components/MountainsHome.tsx` (rank, yellow ride pill, seats open). Picking a tile lists that mountain's rides as standard `RideCard`s. The first tile is picked by default.
- A day with nothing shows a dashed empty state with "Post a ride for <day>".
- Imported events show a small "From club calendar" note in place of edit controls. Manual events show Edit and Cancel to admins.

**Calendar**: a month grid in the style of `DayPicker` in `components/Pickers.tsx`, inline rather than in a sheet. A short dark bar marks an event day, a continuous bar spans a multi-day event, and the yellow number counts rides that day. Selecting any day of a multi-day event selects the whole event. Past days are dimmed and not selectable. Month arrows go from the current month to the sync horizon. A legend sits under the grid.

**Members view**: the existing members list, admin tools, invite code and Leave community move behind the Members button. Builder's choice whether this is a section toggled on the same screen or a `view=members` param on the same route; no new route file is required. Admin tools gain a **Club calendar** card: paste field, Save, Sync now, last synced time, last error, Remove, and two lines on where to find the ICS link in Google Calendar and Outlook.

**Add or edit event** (admins): a form in a `PickerSheet`-style modal. Fields: title, start day and time, end day and time, all-day toggle, place, mountain (optional), description. Uses existing `Field`, `DayPicker` and time pickers from `PostRideScreen`.

**Post a ride** (`screens/PostRideScreen.tsx`): accepts an `event` param. When the ride is for a community and that community has events on the chosen day, a "For event" chip row appears, with "No event" first. "Offer a ride" from an event and "Post a ride for <day>" from the empty state prefill community, day, mountain and event.

**Ride card** (`components/RideCard.tsx`): a ride linked to an event shows the event title as a tag beside the members-only tag.

**Communities tab** (`screens/CommunitiesScreen.tsx`): each of your communities shows its next event under the name ("Next: Copper dawn patrol · Sat Nov 21") when there is one. `my_communities` gains `next_event`.

## Client types and API

`types.ts` gains `CommunityEvent`, `CommunityCalendar`, `NewCommunityEvent`; `BoardRide.eventId`; `NewRide.eventId`; `Community.nextEvent`. `Api` gains one method per RPC above plus `syncCommunityCalendar`. `lib/api.ts` implements them in the existing style.

A small pure module (for example `lib/events.ts`) holds calendar math: which events and rides fall on a day, multi-day spans, the next event, and "in N days". It is the natural place for unit-testable logic.

## Testing

- `supabase/tests/community_events_test.sql`: members-only reads, admin-only writes, imported events not editable, RSVP rules, RSVPs removed on leaving, the ride-to-event rule (same community, day in range, not on open rides), cancel releasing rides, calendar link hidden from members, sync upsert and cancel-missing behavior. Added to the README test command and its description.
- `supabase/functions/sync-community-calendars/logic.test.ts`: single, all-day, multi-day, recurring with exceptions, cancelled, time zones, truncation, resort guessing, and the URL and address checks.
- Existing tests keep passing.

## Delivery order

Two phases, each shippable:

1. **Events and calendar**: migration, RPCs, tests, client API, the new community page, manual events, RSVPs, rides linked to events.
2. **Calendar import**: `community_calendars`, the sync function and its tests, the Club calendar card, the README cron step.

## Decisions made by Claude, not yet confirmed by Jacob

- RSVP is a simple in or out, with a count and a few avatars. No "maybe", no capacity.
- Only admins create events.
- Imported events are read-only in Lift2Lift and cannot have a Fri/Sat/Sun plan or "spots taken" as in the cabin mockup. Those two mockup details are **not** in this build; the multi-day bar, date range and rides by day are.
- Recurring events are expanded up to 180 days ahead.
- Sync runs every 15 minutes, plus Sync now.
- The mountain for an imported event is guessed from its text.
- Members and admin tools move behind the Members button.
- Calendar links are accepted only from Google, Outlook and iCloud hosts.
- A ride that no longer fits its event's days is unlinked from it, not blocked.
- A recurring event keeps its RSVPs and rides when its time changes, not when its day changes.
- No event notifications in this build.

## Left to the builder

- Exact RPC signatures, JSON shapes and index choices.
- Which ICS library, and whether Sync now is a second function or a mode.
- Component breakdown and file names for the calendar, hero and tiles.
- Whether the Members view is a toggle or a route param.
- Exact copy beyond what the mockup shows.
