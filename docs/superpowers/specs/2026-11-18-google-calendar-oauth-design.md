# Connect a club's Google Calendar with Google sign-in

Date: 2026-11-18. Builds on `2026-11-17-community-events-calendar-design.md`, which listed OAuth as a non-goal and kept the door open: imported events are stored the same way whatever fetched them.

## Goal

A club admin taps **Connect Google Calendar**, signs in with Google, picks one of their calendars, and its events sync into the community the same way pasted ICS links do today. No hunting for the "secret address in iCal format".

The pasted ICS link stays as the second option (Outlook, iCloud, or a Google admin who prefers it). A club has one calendar at a time, from either source.

## Non-goals

- Writing to Google Calendar (adding Lift2Lift events or RSVPs to anyone's calendar).
- Members connecting their own calendars.
- Push notifications from Google (`events.watch`). The 15-minute cron and **Sync now** are enough.
- Microsoft Graph sign-in for Outlook.

## Google setup (outside the repo)

- A Google Cloud project with the **Google Calendar API** enabled.
- An OAuth client of type **Web application**. Authorized redirect URI: the `google-calendar` edge function URL, e.g. `https://<project>.supabase.co/functions/v1/google-calendar`, and `http://127.0.0.1:54321/functions/v1/google-calendar` for local work.
- Scopes: `openid`, `email`, `https://www.googleapis.com/auth/calendar.calendarlist.readonly`, `https://www.googleapis.com/auth/calendar.events.readonly`. The two calendar scopes are sensitive: while the consent screen is in **Testing**, only listed test users can connect and Google expires their refresh tokens after 7 days. Publishing for everyone needs Google's verification (privacy policy link, demo video, a few days to weeks).
- Edge function secrets: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (the exact registered URI).

## Flow

```
Card ── POST start ──▶ google-calendar ──▶ { url }            (admin check, one-time state + PKCE saved)
App opens url ──▶ Google consent ──▶ GET google-calendar?code&state
google-calendar: check state, swap code for tokens, keep refresh token in Vault ──▶ 302 back to the app
Card sees "signed in, no calendar yet" ──▶ POST calendars ──▶ list ──▶ POST choose { calendar_id } ──▶ sync
```

- **Start** (`POST { action: 'start', community_id, return_to }`, signed-in admin). `return_to` is where the browser goes afterwards: on the web, the current page URL, accepted only when its origin is in `ALLOWED_ORIGINS`; on iOS, `lift2lift://google-calendar` (or an `exp://…/--/google-calendar` URL in Expo Go). Anything else is refused. The function saves a one-time state row (SHA-256 of a random 32-byte state, community, user, `return_to`, PKCE verifier, 10 minute expiry) and returns Google's consent URL with `access_type=offline`, `prompt=consent`, `code_challenge_method=S256`.
- **Callback** (`GET ?code&state` or `?error&state`, from Google; no user token). Looks up and deletes the state row in one statement. Expired, unknown or reused state: a plain error page, no redirect. Otherwise it swaps the code for tokens, checks both calendar scopes were granted (a person can untick them), checks the state's user is still an admin, reads the Google account email from the ID token, stores the refresh token, and redirects to `return_to` with `?google_calendar=connected` or `?google_calendar=error` (`denied` when the person cancelled). Nothing secret is put in the redirect.
- **Calendars** (`POST { action: 'calendars', community_id }`, admin). Lists the connected account's calendars (`calendarList.list`, `minAccessRole=reader`): id, name, primary flag. Never returns tokens.
- **Choose** (`POST { action: 'choose', community_id, calendar_id }`, admin). Checks the id is in that account's list, saves it as the club calendar (replacing any ICS link and cleaning up what that one imported, same rules as changing the link), then runs one sync and returns its outcome.
- **Disconnect** (`POST { action: 'disconnect', community_id }`, admin). Revokes the token at Google (best effort), deletes the secret and the account row, and cleans up imported events the same way removing a link does.

On iOS the app uses `WebBrowser.openAuthSessionAsync(url, return_to)`, which closes itself on the redirect. On the web the page leaves for Google and comes back to the same URL.

## Data

- `community_google_accounts`: `community_id pk`, `email`, `token_secret_id uuid` (a Vault secret holding the refresh token), `connected_by`, `connected_at`. No grants for app users. Deleting the row (or the community) deletes the Vault secret, by trigger.
- `google_oauth_states`: `state_hash text pk`, `community_id`, `user_id`, `return_to`, `code_verifier`, `expires_at`. Service role only. Old rows are deleted whenever a new one is made.
- `community_calendars` gains `source` (`ics` or `google`), `google_calendar_id`, `google_calendar_name`; `ics_url` becomes nullable; a check keeps exactly one of `ics_url` / `google_calendar_id` filled to match `source`.
- `community_calendar(id)` (admin) returns `source`, `ics_url`, `google_calendar_name`, `google_email`, and `google_pending` (signed in, no calendar chosen). It still never returns the token.
- `set_community_calendar(id, url)` refuses while Google is connected ("Disconnect Google Calendar first"), so a token is never left behind un-revoked.
- `claim_calendars_to_sync` returns `source`, `sync_key` (the ICS link, or `google:<calendar id>`) and, for Google, the calendar id. `apply_calendar_sync`'s `p_url` is compared with the same `sync_key`, so a sync of a calendar the admin has since switched away from is ignored, as today.
- Service-role helpers: `save_google_account`, `google_refresh_token`, `set_google_calendar`, `remove_google_calendar`.

Imported Google events use `source = 'ics'` in `community_events`: they behave exactly like feed events (read-only here, upserted by uid, cancelled when gone). Their uid uses the same key as ICS occurrences, `iCalUID|<Denver date of the original start>`, plus a counter for two on one day.

## Sync

Each run refreshes an access token with the stored refresh token, then reads `events.list` with `singleEvents=true` (Google expands recurrence and applies exceptions), `timeMin = now − 1 day`, `timeMax = now + 180 days`, 250 per page, at most 10 pages; more than that is "This calendar is too large to import". Cancelled instances and non-default event types (out of office, focus time, working location) are skipped. Descriptions come as HTML from Google and are turned into plain text. All-day events convert the exclusive end date the same way ICS does.

Errors stored as `last_error`: Google says the grant is gone (`invalid_grant`, revoked, or the 7-day Testing expiry) → "Google Calendar access ended. Connect it again."; the calendar is gone or no longer shared (404/403) → "That Google calendar can't be read anymore"; anything else → the existing "Could not read that calendar link". Token text, Google error bodies and calendar ids are never logged.

## Card

- Nothing connected: **Connect Google Calendar** (primary), and **Use an Outlook or iCloud link instead ▸**, which shows today's paste field and help lines.
- Signed in, no calendar: "Signed in as jane@gmail.com", a list of their calendars (primary first) to pick from, **Use this calendar**, and **Cancel** (disconnects).
- Google connected: calendar name and "Google · jane@gmail.com", last synced, last error, **Sync now**, **Disconnect** (with the same confirm as Remove today).
- ICS connected: unchanged.

Messages: after coming back with `google_calendar=denied`: "Google sign-in was cancelled."; `error`: "Couldn't connect Google Calendar. Try again."
