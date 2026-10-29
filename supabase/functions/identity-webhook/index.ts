// Receives Stripe Identity results and saves them. Stripe calls this, not the
// app, so JWT verification is off for this function (see config.toml); the
// Stripe signature is checked instead.
//
// On success it keeps only: verified yes/no, the name on the license, the
// date. Then it asks Stripe to redact the session, which deletes the license
// images and the selfie. Set REDACT_AFTER_CHECK=false to keep them at Stripe.

import { adminClient, cryptoProvider, stripe } from '../_shared/stripe.ts';

const WEBHOOK_SECRET = Deno.env.get('STRIPE_IDENTITY_WEBHOOK_SECRET') ?? '';
const REDACT = (Deno.env.get('REDACT_AFTER_CHECK') ?? 'true') !== 'false';

const STATUS_FOR_EVENT: Record<string, string> = {
  'identity.verification_session.verified': 'verified',
  'identity.verification_session.requires_input': 'requires_input',
  'identity.verification_session.processing': 'processing',
  'identity.verification_session.canceled': 'canceled',
};

Deno.serve(async (req) => {
  const signature = req.headers.get('Stripe-Signature');
  const body = await req.text();
  if (!signature) return new Response('Missing signature', { status: 400 });

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, WEBHOOK_SECRET, undefined, cryptoProvider);
  } catch (e) {
    console.error('identity-webhook signature', e);
    return new Response('Bad signature', { status: 400 });
  }

  const status = STATUS_FOR_EVENT[event.type];
  if (!status) return new Response('ignored', { status: 200 });

  const session = event.data.object as { id: string; metadata?: Record<string, string>; last_error?: { code?: string } | null };
  const userId = session.metadata?.user_id;
  if (!userId) return new Response('no user', { status: 200 });

  let firstName: string | null = null;
  let lastName: string | null = null;
  if (status === 'verified') {
    try {
      const full = await stripe.identity.verificationSessions.retrieve(session.id, { expand: ['verified_outputs'] });
      firstName = full.verified_outputs?.first_name ?? null;
      lastName = full.verified_outputs?.last_name ?? null;
    } catch (e) {
      console.error('identity-webhook outputs', e); // the result still counts without the name
    }
  }

  const { error } = await adminClient().rpc('apply_identity_result', {
    p_user_id: userId,
    p_session_id: session.id,
    p_status: status,
    p_error: status === 'requires_input' ? session.last_error?.code ?? 'unknown' : null,
    p_first_name: firstName,
    p_last_name: lastName,
  });
  if (error) {
    console.error('identity-webhook save', error);
    return new Response('save failed', { status: 500 }); // Stripe retries
  }

  if (REDACT && status === 'verified') {
    try {
      await stripe.identity.verificationSessions.redact(session.id);
    } catch (e) {
      console.error('identity-webhook redact', e);
    }
  }

  return new Response('ok', { status: 200 });
});
