# App Store submission

Everything App Review needs, in order. Items marked **(you)** need your accounts or decisions and can't be done from the code.

## 1. Before the first build

- [ ] **(you) Support email.** Replace `SUPPORT_EMAIL` in `packages/app/lib/config.ts`. It appears in the privacy policy, terms and Account → Help. Use an inbox someone reads daily, because reports must be handled within 24 hours.
- [ ] **(you) Legal review.** `packages/app/lib/legal.ts` holds the privacy policy and terms, written to match the code. Have a lawyer read them, then publish.
- [ ] **(you) EAS project.** In `apps/mobile` run `npx eas-cli login`, then `npx eas-cli init`. This adds `extra.eas.projectId` to `app.json`. Push reminders need it: without it, `getExpoPushTokenAsync` fails in a store build.
- [ ] **(you) Build secrets.** Run `npx eas-cli env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon key> --environment production`. The URL is already in `eas.json`.
- [ ] **(you) Push credentials.** The first `eas build` offers to create the APNs key. Then upload it to Expo so `send-ride-reminders` can deliver.
- [ ] **App icon.** `apps/mobile/assets/icon.png` (1024×1024, no transparency) is a placeholder chairlift-and-peaks icon. Replace it with a designed one if you have it.

## 2. Backend (hosted project)

```bash
npm run db:link
npm run db:push
npx supabase functions deploy delete-account
npx supabase functions deploy license-check
npx supabase functions deploy insurance-check
npx supabase functions deploy send-ride-reminders
```

- [ ] **Deploy the website** (Vercel). Check that `https://lift2lift.vercel.app/privacy` and `/terms` load while signed out. App Store Connect needs the privacy URL.
- [ ] **Report alerts.** In Supabase go to Database → Webhooks → Create. Pick table `public.reports`, event `INSERT`, and point it at Slack, Zapier or email so new reports reach a person. Act on each one within 24 hours: delete the content or account in the dashboard, then set `resolved_at` and `resolution` on the report.
- [ ] **Demo accounts.** Run `psql "$PROD_DB_URL" -v password="'<strong password>'" -f supabase/review/demo_accounts.sql`. Run it again before each new submission so the demo rides are in the future.
- [ ] **Live keys.** Check that the AWS keys used by `license-check` and `insurance-check` are set on the hosted project (`npx supabase secrets list`).

## 3. Build and upload

```bash
cd apps/mobile
npx eas-cli build --platform ios --profile production
npx eas-cli submit --platform ios --latest
```

## 4. App Store Connect

**App information**
- Name: Lift2Lift. Subtitle: Ski carpools for CU Boulder.
- Category: Travel (secondary: Sports).
- Privacy policy URL: `https://lift2lift.vercel.app/privacy`
- Support URL: `https://lift2lift.vercel.app/terms` (or a support page), plus the support email.
- **Content rights:** the app shows user content (profiles, chat, reviews). Answer accordingly.

**Age rating questionnaire.** Answer *Yes* to "unrestricted web access" only if you add it; the app has none. Answer *Yes* to user-generated content and to messaging/chat. The result is usually 17+. That's fine, because members must be 18+ college students.

**App Privacy ("nutrition label").** Tracking: **No** (no ads, no cross-app tracking). Data collected, all *linked to the user* and *not used for tracking*:

| Data type | Used for |
| --- | --- |
| Name, email address | App functionality, account |
| Phone number (drivers' contact, optional) | App functionality |
| Photos (selfie / profile photo, license and insurance photos) | App functionality, fraud prevention |
| Biometric data? Apple has no "biometric" type; disclose under *Sensitive info* | Identity verification, with consent |
| Other user content (chat, reviews, bio) | App functionality |
| User ID, device ID (push token) | App functionality |
| Gender (optional) | App functionality (*Sensitive info*) |

No location, contacts, browsing, purchases or diagnostics are collected.

**Screenshots.** Required for 6.9" iPhone (1320×2868). Take them in the Simulator with the demo account: ride board, mountain page, Your Rides with chat, profile, post a ride.

## 5. Review notes (paste into "Notes for App Review")

> Lift2Lift is a ski carpool board for University of Colorado Boulder students. New accounts need a @colorado.edu email confirmed by a 6-digit code, and hosting or booking a ride requires a one-time driver's license + selfie check (age 18+) and, for drivers, an insurance card. Please use this demo account, which is already verified:
>
> Email: appreview@lift2lift.test
> Password: (the one you set in demo_accounts.sql)
>
> Things to try:
> - Rides tab: pick a day, then a mountain. "Dana Demo" has rides every day for the next 10 days. Tap "Call shotgun" to book.
> - Your Rides tab: the booked ride and its group chat. Every message from someone else has "Report".
> - Tap Dana's photo to open her profile. There you'll find **Report** and **Block** (blocking hides each person from the other everywhere and stops booking together). Reviews also have "Report review".
> - Account (top-right avatar → Account settings): Blocked people, Terms, Privacy policy, Contact support, and **Delete account** at the bottom.
>
> Moderation: users agree to the Terms (zero tolerance for objectionable content) at sign-up. Chat, reviews and profiles are filtered for banned words. Reports reach our team and are acted on within 24 hours.
>
> Payments: riders split gas money with the driver directly, outside the app, for a physical carpool (C.R.S. 43-1-127 carpool, capped at the IRS mileage rate). There are no in-app purchases or digital goods.
>
> Location: not used. Camera/photos: used only for the license, selfie and insurance card.

## 6. What changed for review (for reference)

| Guideline | Where |
| --- | --- |
| 5.1.1(v) account deletion | Account → Delete account (`supabase/functions/delete-account`) |
| 1.2 user content: terms, filter, report, block, 24h action | Sign-up agreement, `20261110000011_safety_and_account_deletion.sql`, `components/Safety.tsx` |
| 5.1.1(i) privacy policy | `/privacy` on web and in the app, linked from sign-up and Account |
| 2.1 demo account | `supabase/review/demo_accounts.sql` |
| 5.1.1 purpose strings | Camera and photos strings in `apps/mobile/app.json` |
| Export compliance | `ITSAppUsesNonExemptEncryption: false` |
