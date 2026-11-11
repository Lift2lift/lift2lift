/**
 * Privacy policy and terms of use, shown in the app (Account → Privacy policy,
 * Terms) and on the website at /privacy and /terms. Written to match what the
 * code does today. Have a lawyer review before launch, and bump the date and
 * TERMS_VERSION whenever either changes.
 */
import { SCHOOL_NAME, SITE_URL, SUPPORT_EMAIL } from './config';
import { CARPOOL_DISCLAIMER } from './rules';

export const LEGAL_UPDATED = 'November 10, 2026';
/** Saved on the account at sign-up (auth user metadata terms_version). */
export const TERMS_VERSION = '2026-11-10';

export type LegalSection = { heading: string; body: string[] };
export type LegalDoc = { title: string; intro: string; sections: LegalSection[] };

export const PRIVACY_POLICY: LegalDoc = {
  title: 'Privacy policy',
  intro: `Lift2Lift helps ${SCHOOL_NAME} students share rides to Colorado ski areas. This policy explains what we collect, why, who we share it with, and how to delete it. Questions: ${SUPPORT_EMAIL}.`,
  sections: [
    {
      heading: 'What we collect',
      body: [
        `Account: your name, your ${SCHOOL_NAME} email address and a password (stored only as a secure hash by our database provider).`,
        'Profile: what you choose to add, such as gender, ski or snowboard, home mountain, year and major, hometown, bio, Instagram handle, quick answers and interests.',
        'Verification: to post rides or call shotgun you verify once. You add a photo of your driver\'s license and a selfie. Drivers also add a photo of their insurance card. See "Photos, ID and biometric data" below.',
        'Rides: rides you post or book, pickup spots and times, contact details you give riders, check-ins, and ride chat messages.',
        'Community: reviews you write and receive, friends, people you block, and reports you send.',
        'Device: a push notification token so we can send ride reminders, if you allow notifications.',
        'We do not collect your location, contacts, browsing history or advertising identifiers.',
      ],
    },
    {
      heading: 'Photos, ID and biometric data',
      body: [
        'We send your license photo and selfie to Amazon Web Services (Textract and Rekognition), which reads the license (name, expiry date, age) and compares the two faces. This comparison creates a face scan, which Colorado law treats as biometric data. We ask for your consent before the check starts and record when you gave it.',
        'We keep only the result, the name on the license, and your selfie, which becomes your profile photo that other signed-in members can see. We do not store your license photo or the face scan, and we never use face data for anything other than this one check.',
        'Insurance card photos are read by Amazon Textract for the insurer name and expiry date. We keep those details, not the card photo.',
        'We never sell, rent or trade biometric data. Your profile photo is deleted when you delete your account or verify again with a new selfie.',
      ],
    },
    {
      heading: 'How we use it',
      body: [
        `To run Lift2Lift: confirm you're a ${SCHOOL_NAME} student, show rides, book seats, send ride reminders, run ride chat, and show profiles and reviews.`,
        'To keep people safe: verify drivers, enforce Colorado carpool rules, filter abusive language, and review reports.',
        'We do not show ads, we do not sell your data, and we do not track you across other apps or websites.',
      ],
    },
    {
      heading: 'Who can see what',
      body: [
        'Other signed-in members see your profile, photo, rides, reviews and friends. A driver\'s phone number or handle is shown only to riders who booked a seat. Ride chat is visible only to the driver and riders on that ride.',
        'People you block can\'t see your rides, profile, messages or reviews, and you can\'t see theirs.',
      ],
    },
    {
      heading: 'Service providers',
      body: [
        'Supabase (database, sign-in, file storage), Amazon Web Services (license, selfie and insurance checks), Expo and Apple (push notifications), and Vercel (website hosting). They process data only to provide their service to us.',
        'We share information with law enforcement only when the law requires it or someone\'s safety is at risk.',
      ],
    },
    {
      heading: 'How long we keep it',
      body: [
        'We keep your account data while your account is open. When you delete your account we delete your profile, photos, rides, seats, messages, reviews, friends, blocks, devices and verification results.',
        'Reports you sent are kept, without your name, for up to two years so we can act on repeat abuse.',
      ],
    },
    {
      heading: 'Deleting your account',
      body: [
        'In the app go to Account → Delete account. Deletion is immediate and permanent. You can also email us to ask.',
      ],
    },
    {
      heading: 'Your rights',
      body: [
        `Colorado residents (and everyone else) can ask what we hold about them, ask us to correct or delete it, and ask for a copy. Email ${SUPPORT_EMAIL}. We'll answer within 45 days.`,
        'If a security incident affects your data, we will notify you and the Colorado Attorney General as the law requires.',
      ],
    },
    {
      heading: 'Age',
      body: ['Lift2Lift is for college students 18 and older. We don\'t knowingly collect data from anyone under 18.'],
    },
    {
      heading: 'Changes',
      body: [`We'll post changes here and in the app, with a new date. Last updated ${LEGAL_UPDATED}. ${SITE_URL}/privacy`],
    },
  ],
};

export const TERMS: LegalDoc = {
  title: 'Terms of use and community guidelines',
  intro: `By creating an account you agree to these terms. If you don't agree, don't use Lift2Lift. Questions: ${SUPPORT_EMAIL}.`,
  sections: [
    {
      heading: 'Who can use Lift2Lift',
      body: [
        `You must be at least 18, a current ${SCHOOL_NAME} student with a working school email, and use your real name and your own photo. One account per person.`,
      ],
    },
    {
      heading: 'What Lift2Lift is',
      body: [
        CARPOOL_DISCLAIMER,
        'Lift2Lift is a place for students to find each other. We are not a transportation company, we do not employ drivers, and we do not provide rides. Drivers and riders arrange and take trips at their own risk.',
      ],
    },
    {
      heading: 'Drivers',
      body: [
        'You must hold a valid driver\'s license and the auto insurance Colorado requires, drive a safe and legal vehicle, and follow traffic laws and conditions (including traction laws on I-70).',
        'Gas money may only cover your costs: one equal share per rider, no more than the cap the app shows. No profit, tips or extra fees.',
      ],
    },
    {
      heading: 'Zero tolerance for abuse',
      body: [
        'There is no tolerance for objectionable content or abusive users. Don\'t post or send anything that harasses, bullies, threatens or demeans anyone; hate speech or slurs; sexual content or unwanted advances; spam or scams; or anything illegal.',
        'Don\'t impersonate anyone, share someone else\'s contact details, or use Lift2Lift for anything other than sharing ski rides.',
        'Messages, reviews and profiles that contain banned words are blocked automatically.',
      ],
    },
    {
      heading: 'Reporting and blocking',
      body: [
        'You can report any profile, chat message or review, and block anyone. Blocking hides each of you from the other and stops you from booking a ride together.',
        'We review every report within 24 hours. We remove content that breaks these terms and suspend or delete the accounts that posted it.',
      ],
    },
    {
      heading: 'Your content',
      body: [
        'You own what you post. You give Lift2Lift permission to show it to other members to run the service. You are responsible for what you post.',
      ],
    },
    {
      heading: 'Ending your account',
      body: [
        'You can delete your account any time in Account → Delete account. We may suspend or delete accounts that break these terms, put others at risk, or are no longer tied to a student email.',
      ],
    },
    {
      heading: 'No warranty, limited liability',
      body: [
        'Lift2Lift is provided "as is". Forecasts, drive times and mileage are estimates. To the extent the law allows, Lift2Lift and its team are not liable for any trip, accident, injury, loss or dispute between members, and our total liability is limited to $50.',
      ],
    },
    {
      heading: 'Apple',
      body: [
        'If you use the iPhone app: these terms are between you and Lift2Lift, not Apple. Apple has no duty to provide support or maintenance and is not responsible for claims about the app. Apple and its subsidiaries are third-party beneficiaries of these terms and may enforce them.',
      ],
    },
    {
      heading: 'Law',
      body: [`These terms are governed by Colorado law. Last updated ${LEGAL_UPDATED}. ${SITE_URL}/terms`],
    },
  ],
};
