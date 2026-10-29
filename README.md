# Lift2Lift

Ski carpools for Colorado college students. Drivers post open seats, riders call shotgun, and every ride shows the snow forecast for that mountain on that day.

- **Web**: Next.js 15 (App Router), rendering React Native screens through react-native-web
- **iOS**: Expo (SDK 54) with Expo Router
- **Shared**: every screen lives once in `packages/app`, written with React Native components
- **Backend**: Supabase, running locally in Docker for development (Postgres, Auth, email inbox). Hosted project: **lift2lift**
- **Forecast**: Open-Meteo, free and keyless, 7 days for 26 Colorado ski areas

```
apps/
  web/        Next.js site        → npm run web
  mobile/     Expo iOS app        → npm run ios
packages/
  app/        Shared screens, components, Supabase API layer, theme, forecast
supabase/
  config.toml            Local Supabase settings (project_id = lift2lift)
  migrations/            Database schema, security rules, seat-claiming function
  seed.sql               Demo accounts and sample rides (local only)
  templates/             Email templates with the 6-digit code
  tests/                 SQL tests for the security rules
```

## What it does

- **CU Boulder only**: every account needs a @colorado.edu email (department subdomains like @cs.colorado.edu work too), confirmed with a 6-digit code sent to that inbox. The database rejects any other address, including on email changes.
- **Accounts**: sign up with name, email and password, confirmed by a 6-digit emailed code. Sign in, sign out, forgot password (code + new password). Sessions persist on web and iPhone.
- **Ride board**: upcoming rides filtered by day, mountain and open seats. Each ride card shows departure time, pickup spot, gas money, gear space, a seat map and that day's forecast for the mountain.
- **Call shotgun**: claim a seat, bail on a seat. Drivers see who's riding, can remove riders and can cancel the ride.
- **Private contact**: a driver's phone number or handle is only visible to the driver and to riders who claimed a seat.
- **Post a ride**: tap-to-pick mountain, day, time, pickup spot, seats, gas and gear, with the forecast for the chosen day.
- **Driver verification**: the first time someone taps **Post a ride**, a pop-up sends them to **Account → Driver verification** for two steps:
  1. **ID check with a selfie** (Stripe Identity): scan the license, take a live selfie, and Stripe confirms the license is real and the face matches its photo. Lift2Lift never receives the selfie or face scan, and the server asks Stripe to delete the images right after a successful check.
  2. **Insurance card photo**, stored privately.

  Once both are done they can host right away, and riders see **“ID verified · insurance on file”**.
- **Account settings**: name, CU email status, driver verification, sign out.
- **Colorado carpool rules**: built in and enforced by the database (see below).
- **Snow**: the biggest snow days this week, plus a 7-day grid for every Colorado ski area, sortable by drive time or total snow. Tap a mountain to see rides there.

## Colorado carpool law

Lift2Lift is built to qualify as a **carpooling service internet application** under [C.R.S. 43-1-127](https://colorado.public.law/statutes/crs_43-1-127). Under that law it isn't a transportation network company (Uber/Lyft), which would need PUC licensing, background checks and medical exams for drivers. These limits are enforced in the database, so no client can get around them, and the app explains them before anyone hits an error:

| Rule (C.R.S. 43-1-127) | How Lift2Lift enforces it |
| --- | --- |
| Driver is paid no more than miles driven × the IRS business rate | Each mountain has a round-trip mileage from Boulder. `gas per rider × seats` can't exceed `round-trip miles × IRS rate` (72.5¢ in 2026). Example: Eldora is 42 mi, so the cap is $30, or $7 each with 4 seats. The post form only offers allowed amounts |
| Each rider pays an equal share | One gas price per ride, the same for every rider |
| No more than 6 passengers | `seats_total` is 1–6 |
| One trip per driver per day | One ride per **person** per day, driving or riding (Mountain Time), with a lock so two requests at once can't both get through |
| Reservations at least 2 hours ahead | Rides must leave 2+ hours after posting, and seats close 2 hours before departure |
| Disclaimer displayed prominently | Shown on sign-up, on the post form, and on the ride board (`packages/app/lib/rules.ts`) |
| Trips 23+ miles, or to or from a ski area | Every destination is a ski area |

### Before launch

- [ ] **Register with CDOT.** The law requires carpool apps to register with the Colorado Department of Transportation every year. Ask CDOT how to register.
- [ ] **Check the mileages.** `round_trip_miles` in `supabase/migrations/…_colorado_carpool_rules.sql` (and `packages/app/lib/resorts.ts`) are conservative estimates from Boulder. Confirm them with a mapping tool.
- [ ] **Confirm the disclaimer wording** in `packages/app/lib/rules.ts` against the official text of C.R.S. 43-1-127(1)(c).
- [ ] **Each January**, add the new IRS rate to the `mileage_rates` table (a new migration) and to `MILEAGE_CENTS` in `rules.ts`.
- [ ] **Talk to a lawyer** about terms of service and keeping Lift2Lift not-for-profit. CU's [Entrepreneurial Law Clinic](https://www.colorado.edu/law/academics/clinics/entrepreneurial-law-clinic) helps student startups for free.

## ID check with a selfie (Stripe Identity)

Each check costs **$1.50**, and **the first 50 are free**. Stripe runs the license scan, the live selfie and the face match on its own hosted page, so it works the same on the website and the iPhone app (no native SDK, and it works in Expo Go).

```
App ── identity-start ──▶ Stripe hosted page (license + selfie) ──▶ identity-webhook ──▶ driver_verifications
```

**Set up (about 15 minutes):**

1. Create a Stripe account and turn on **Identity** (Dashboard → Identity). Use **test mode** while building: test mode never charges, and Stripe's test page lets you pick "verified" or a failure.
2. Copy `supabase/functions/.env.example` to `supabase/functions/.env` and add your `sk_test_…` key.
3. Run the functions locally: `npx supabase functions serve --env-file supabase/functions/.env`
4. Forward Stripe events: `stripe listen --events identity.verification_session.verified,identity.verification_session.requires_input,identity.verification_session.processing,identity.verification_session.canceled --forward-to http://127.0.0.1:54321/functions/v1/identity-webhook`. Put the `whsec_…` it prints in `.env`.

**Going live:**

1. `npx supabase functions deploy identity-start identity-webhook`
2. `npx supabase secrets set --env-file supabase/functions/.env`, using live keys, your real `SITE_URL` and `ALLOWED_ORIGINS`.
3. In Stripe → Developers → Webhooks, add `https://aqoqfsesceiykkoahnej.supabase.co/functions/v1/identity-webhook` with the four `identity.verification_session.*` events, and set its signing secret as `STRIPE_IDENTITY_WEBHOOK_SECRET`.
4. Publish the biometric policy (`docs/biometric-privacy-policy.md`, a draft for a lawyer to review) on the website.

**Privacy by design:** Lift2Lift stores only the result, Stripe's reason code when a check fails, the name on the license and the consent date. With `REDACT_AFTER_CHECK=true` (the default), the webhook asks Stripe to delete the license images and selfie as soon as a check passes.

## Reviewing drivers

A verified ID plus an insurance photo lets a driver host immediately ("submitted"). To spot-check:

1. **Table editor → driver_verifications**: compare `id_first_name` / `id_last_name` (from the license) with the account name in `profiles`.
2. **Storage → driver-docs**: each driver's folder holds `insurance.*`. Check the name and policy dates.
3. Set `status` to `approved`, or to `rejected` with a `review_note` (for example "Insurance card is expired."), and set `reviewed_at` to now. A rejected driver loses the badge and can't post new rides until they upload a new photo or redo the ID check.

## Run it locally

You need Node 20+, Docker Desktop (running), and Xcode for the iOS Simulator.

```bash
npm install
npx expo install --fix --cwd apps/mobile   # lines Expo packages up with SDK 54

npm run db:start          # starts local Supabase in Docker, applies migrations + seed
```

`db:start` prints an **API URL** (`http://127.0.0.1:54321`) and an **anon key**. Put them in the two env files:

```bash
cp apps/web/.env.local.example apps/web/.env.local     # paste the anon key
cp apps/mobile/.env.example     apps/mobile/.env        # paste the anon key
```

Then:

```bash
npm run web      # http://localhost:3000
npm run ios      # opens the iOS Simulator
```

Sign in with a demo account, or create your own with any @colorado.edu address (locally, the code lands in the local inbox, so the address doesn't need to be real). The demo accounts use `@lift2lift.test`, which only the local seed allows:

| Email | Password | Has |
| --- | --- | --- |
| driver@lift2lift.test | password123 | 3 sample rides posted, driver verification approved |
| rider@lift2lift.test | password123 | a seat on the A-Basin ride |

When you sign up locally, the confirmation code goes to the local inbox at **http://127.0.0.1:54324**, not your real email. Supabase Studio, a database browser, runs at **http://127.0.0.1:54323**.

`npm run db:reset` wipes the local database and rebuilds it from the migrations and seed.

### On a real iPhone

Install **Expo Go**, run `npm run mobile` and scan the QR code. Your phone can't reach `127.0.0.1` on your Mac, so in `apps/mobile/.env` set `EXPO_PUBLIC_SUPABASE_URL` to your Mac's Wi-Fi address (for example `http://192.168.1.20:54321`).

## Ship it

**Database → hosted lift2lift project**

```bash
npx supabase login
npm run db:link     # links to project ref vpkxesucfaofwazqgpni
npm run db:push     # applies supabase/migrations to the hosted database
```

`db push` never runs `seed.sql`, so demo accounts stay local. In the Supabase dashboard for lift2lift:

1. **Authentication → Email Templates**: paste `supabase/templates/confirmation.html` into **Confirm signup** and `recovery.html` into **Reset Password**. The app asks for the code (`{{ .Token }}`), not a link.
2. **Authentication → Emails → SMTP**: add a real email provider (Resend, Postmark). The built-in sender only allows a few emails an hour.
3. **Project Settings → API Keys**: copy the anon / publishable key into each app's env, with URL `https://vpkxesucfaofwazqgpni.supabase.co`.

**Website**: deploy `apps/web` to Vercel (root directory `apps/web`) and add the two `NEXT_PUBLIC_` env vars.

**iPhone**: `npm i -g eas-cli`, then from `apps/mobile`: `eas build -p ios` and `eas submit -p ios`. This needs an Apple Developer account ($99/year).

## Database design

| Table / function | Purpose | Who can do what |
| --- | --- | --- |
| `profiles` | Name for each account, created on sign-up by a trigger | Signed-in users read; you edit your own |
| `resorts` | 26 Colorado ski areas with coordinates, drive time and round-trip miles | Anyone reads |
| `mileage_rates` | IRS business mileage rate by year | Anyone reads |
| `gas_cap_dollars(resort, depart_at)` | The legal gas cap for a trip | Anyone |
| `rides` | A posted trip. A trigger enforces the gas cap, 6 seats, 2-hour lead time and one ride per person per day | Signed-in users read (except `contact`); drivers create, edit and cancel their own |
| `ride_seats` | Who has a seat on which ride | Signed-in users read; riders leave, drivers remove riders |
| `claim_seat(ride)` | The only way to take a seat. Locks the ride row, so two people can't grab the last seat. Also enforces the 2-hour booking window and one ride per person per day | Signed-in users |
| `ride_contact(ride)` | Returns the driver's contact to the driver and seated riders only | Signed-in users |
| `ride_board` view | Upcoming rides with driver name, seat count, rider names, gas cap and the driver's verified badge | Signed-in users |
| `allowed_email_domains` | Email domains that can sign up (`colorado.edu`). A trigger on `auth.users` rejects everything else | Anyone reads |
| `driver_verifications` | Per driver: ID check result (from Stripe), name on license, consent date, insurance photo, overall status (incomplete, submitted, approved, rejected) | Drivers read their own; only the team and the webhook write |
| `driver-docs` storage bucket | Private insurance photos at `<user id>/insurance.*` | Each driver uploads and sees only their own |
| `driver_verification_status()` | Checks what's done, updates and returns the status | Signed-in users |
| `give_biometric_consent()` | Records consent before the selfie check | Signed-in users |
| `apply_identity_result()` / `set_identity_session()` | Save Stripe results. Ignores events from old sessions and never downgrades a finished check | Edge functions only (service role) |
| `identity-start` edge function | Starts or resumes a Stripe check (license only, live capture, matching selfie) | Signed-in users |
| `identity-webhook` edge function | Verifies Stripe's signature, saves the result, redacts images | Stripe |

The rules are tested in `supabase/tests/`. `policies_test.sql` covers sign-up, seat limits, contact privacy and blocking edits to other people's rides. `colorado_rules_test.sql` covers gas caps, 6 seats, one ride per person per day, the 2-hour window, and cancelling to free up a day. `verification_test.sql` covers the CU email rule (including look-alike domains), consent, photo privacy, face mismatch then retry, stale Stripe events, no self-approval, rejection and resubmission. To run them against plain Postgres:

```bash
psql "$DB" -f supabase/tests/supabase_stub.sql -f supabase/migrations/20261029000001_init.sql \
  -f supabase/migrations/20261029000002_colorado_carpool_rules.sql \
  -f supabase/migrations/20261029000003_cu_email_and_driver_verification.sql \
  -f supabase/migrations/20261029000004_identity_selfie_check.sql -f supabase/seed.sql \
  -f supabase/tests/policies_test.sql -f supabase/tests/colorado_rules_test.sql -f supabase/tests/verification_test.sql
```

## Options

- **More schools**: add the domain to `allowed_email_domains` (a new migration) and to `SCHOOL_EMAIL_DOMAINS` in `packages/app/lib/config.ts`.
- **Pickup spots, gear options**: `packages/app/lib/config.ts`.
- **Mountains**: `packages/app/lib/resorts.ts`, and the `resorts` insert in the migration (keep both in sync).
