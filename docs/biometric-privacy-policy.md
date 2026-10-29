# Lift2Lift Biometric Data Policy

> **DRAFT. Have a lawyer review before publishing.** Colorado's Privacy Act, as amended by HB24-1130 (in effect since July 1, 2025), requires anyone who collects biometric identifiers to have a public written policy with a retention schedule, deletion guidelines and a security incident protocol. This draft describes how the Lift2Lift code works today. Fill in the bracketed parts, then post it on the website and link it from the ID check screen.

_Last updated: [date]_

## What we collect and why

Drivers who want to host rides on Lift2Lift verify their identity once. They scan their driver's license and take a live selfie, and our identity verification provider, **Stripe, Inc.** ("Stripe Identity"), compares the selfie with the photo on the license. This comparison creates a face geometry scan, which is biometric data.

We use this check only to confirm that a driver's license is genuine and belongs to the person driving. We don't use it for anything else, and riders never go through it.

## Who has the biometric data

- **Stripe** captures the license images and selfie, creates the face scan and runs the comparison, acting as our service provider. See Stripe's privacy policy at stripe.com/privacy.
- **Lift2Lift never receives the selfie, the face scan or the license images.** We receive only the result (verified or not), the reason if a check fails, and the first and last name on the license.
- We never sell, lease or trade biometric data, and we don't disclose it to anyone else except as required by law.

## Consent

We ask for consent in the app before the check starts and record when it was given. The check is required only to host rides. Anyone can sign up, find rides and ride without it.

## Retention and deletion

- **Right after a successful check**, we ask Stripe to delete ("redact") the license images, selfie and face scan for that check.
- If a check is started but never finished, [we ask Stripe to delete it after 30 days / Stripe's default retention applies: describe].
- We keep the result, the name on the license and the date for as long as the account is open. When an account is deleted, we delete these too.
- You can ask us to delete your verification data at any time at [contact email]. Deleting it means you can't host until you verify again.

## Security

- Results are stored in our database with access limited to the driver and the Lift2Lift team. Team accounts use two-factor sign-in.
- Insurance card photos (not biometric data) are stored privately and visible only to the driver and the team.
- **If a security incident affects verification data**, we will [contain it, investigate, and notify affected people and the Colorado Attorney General as Colorado law requires (generally within 30 days of determining a breach occurred)]. Contact: [name, email].

## Your rights

Colorado residents can ask what biometric data we or our service providers hold about them, where it came from, why it's used and who has access, and can ask for it to be deleted. Email [contact email].

## Contact

[Name] · [email] · Lift2Lift, Boulder, Colorado
