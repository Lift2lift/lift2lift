// Starts (or resumes) a Stripe Identity check for the signed-in driver:
// scan a driver's license + live selfie, matched against the license photo.
// Returns the URL of Stripe's hosted verification page.
//
// Body: { platform: 'web' | 'ios' }

import { adminClient, corsHeaders, isAllowedOrigin, json, stripe, userClient } from '../_shared/stripe.ts';

const SITE_URL = (Deno.env.get('SITE_URL') ?? 'http://localhost:3000').replace(/\/$/, '');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Use POST.' }, 405);

  const { data: auth } = await userClient(req).auth.getUser();
  const user = auth.user;
  if (!user) return json(req, { error: 'Sign in first.' }, 401);

  const body = (await req.json().catch(() => ({}))) as { platform?: string };
  const admin = adminClient();

  const { data: row, error: rowError } = await admin
    .from('driver_verifications')
    .select('identity_session_id, identity_status, biometric_consent_at')
    .eq('user_id', user.id)
    .maybeSingle();
  if (rowError) return json(req, { error: 'Could not load your verification. Try again.' }, 500);
  if (!row?.biometric_consent_at) return json(req, { error: 'Agree to the selfie check first.' }, 400);
  if (row.identity_status === 'verified') return json(req, { status: 'verified' });

  // Resume an open session instead of starting (and paying for) a new one.
  if (row.identity_session_id) {
    try {
      const existing = await stripe.identity.verificationSessions.retrieve(row.identity_session_id);
      if (existing.status === 'processing') return json(req, { status: 'processing' });
      if (existing.status === 'requires_input' && existing.url) return json(req, { url: existing.url, status: 'pending' });
    } catch {
      // fall through and create a fresh session
    }
  }

  // Where Stripe sends people when they finish.
  const origin = req.headers.get('Origin') ?? '';
  const returnUrl =
    body.platform === 'web' && isAllowedOrigin(origin)
      ? `${origin}/profile/setup?verify=done`
      : `${SITE_URL}/verified`; // iOS: a simple "you're done, head back to the app" page

  try {
    const session = await stripe.identity.verificationSessions.create({
      type: 'document',
      metadata: { user_id: user.id },
      return_url: returnUrl,
      options: {
        document: {
          allowed_types: ['driving_license'],
          require_live_capture: true,
          require_matching_selfie: true,
        },
      },
    });

    const { error } = await admin.rpc('set_identity_session', { p_user_id: user.id, p_session_id: session.id });
    if (error) return json(req, { error: 'Could not save your session. Try again.' }, 500);

    return json(req, { url: session.url, status: 'pending' });
  } catch (e) {
    console.error('identity-start', e);
    return json(req, { error: "Couldn't start the ID check. Try again in a minute." }, 502);
  }
});
