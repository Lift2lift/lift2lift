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

- **Accounts**: sign up with name, email and password, confirmed by a 6-digit emailed code. Sign in, sign out, forgot password (code + new password). Sessions persist on web and iPhone.
- **Ride board**: upcoming rides filtered by day, mountain and open seats. Each ride card shows departure time, pickup spot, gas money, gear space, a seat map and that day's forecast for the mountain.
- **Call shotgun**: claim a seat, bail on a seat. Drivers see who's riding, can remove riders and can cancel the ride.
- **Private contact**: a driver's phone number or handle is only visible to the driver and to riders who claimed a seat.
- **Post a ride**: tap-to-pick mountain, day, time, pickup spot, seats, gas and gear, with the forecast for the chosen day.
- **Snow**: the biggest snow days this week, plus a 7-day grid for every Colorado ski area, sortable by drive time or total snow. Tap a mountain to see rides there.

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

Sign in with a demo account, or create your own:

| Email | Password | Has |
| --- | --- | --- |
| driver@lift2lift.test | password123 | 3 sample rides posted |
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
| `resorts` | 26 Colorado ski areas with coordinates and drive time | Anyone reads |
| `rides` | A posted trip | Signed-in users read (except `contact`); drivers create, edit and cancel their own |
| `ride_seats` | Who has a seat on which ride | Signed-in users read; riders leave, drivers remove riders |
| `claim_seat(ride)` | The only way to take a seat. Locks the ride row, so two people can't grab the last seat | Signed-in users |
| `ride_contact(ride)` | Returns the driver's contact to the driver and seated riders only | Signed-in users |
| `ride_board` view | Upcoming rides with driver name, seat count and rider names | Signed-in users |

The security rules are tested in `supabase/tests/policies_test.sql`: sign-up, seat limits, contact privacy, and blocking edits to other people's rides. To run them against plain Postgres:

```bash
psql "$DB" -f supabase/tests/supabase_stub.sql -f supabase/migrations/*.sql -f supabase/seed.sql -f supabase/tests/policies_test.sql
```

## Options

- **College emails only**: set `REQUIRE_EDU_EMAIL = true` in `packages/app/lib/config.ts`. To enforce it on the server too, add a **Before User Created** auth hook that rejects non-`.edu` addresses.
- **Pickup spots, gear options**: `packages/app/lib/config.ts`.
- **Mountains**: `packages/app/lib/resorts.ts`, and the `resorts` insert in the migration (keep both in sync).
