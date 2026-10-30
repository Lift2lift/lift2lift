// Receives Stripe Identity results and saves them. Stripe calls this, not the
// app, so JWT verification is off for this function (see config.toml); the
// Stripe signature is checked instead.
//
// On success it keeps: verified yes/no, the name on the license, the date,
// and the live selfie as the person's profile photo (so every profile photo
// has been matched to a real license). Then it asks Stripe to redact the
// session, which deletes the license images, the selfie and the face scan at
// Stripe. Set REDACT_AFTER_CHECK=false to keep them at Stripe.

import { adminClient, cryptoProvider, stripe } from '../_shared/stripe.ts';

const WEBHOOK_SECRET = Deno.env.get('STRIPE_IDENTITY_WEBHOOK_SECRET') ?? '';
const REDACT = (Deno.env.get('REDACT_AFTER_CHECK') ?? 'true') !== 'false';
// Restricted key with "Identity verification reports & selfie files: read". Stripe
// only lets restricted keys download the selfie image.
const FILES_KEY = Deno.env.get('STRIPE_IDENTITY_FILES_KEY') ?? '';

/** Downloads the verified selfie from Stripe and stores it as the profile photo. */
async function saveVerifiedSelfie(sessionId: string, userId: string) {
  const full = await stripe.identity.verificationSessions.retrieve(sessionId, { expand: ['last_verification_report'] });
  const report = full.last_verification_report as { selfie?: { selfie?: string | null } | null } | string | null;
  const fileId = typeof report === 'object' ? report?.selfie?.selfie : null;
  if (!fileId || !FILES_KEY) {
    console.error('identity-webhook selfie: no file id or STRIPE_IDENTITY_FILES_KEY not set');
    return false;
  }
  const res = await fetch(`https://files.stripe.com/v1/files/${fileId}/contents`, {
    headers: { Authorization: `Bearer ${FILES_KEY}` },
  });
  if (!res.ok) {
    console.error('identity-webhook selfie download', res.status, await res.text());
    return false;
  }
  const type = res.headers.get('Content-Type') ?? 'image/jpeg';
  const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
  // New random name each time, so an old cached photo never shows.
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const admin = adminClient();
  const up = await admin.storage.from('avatars').upload(path, await res.arrayBuffer(), { contentType: type });
  if (up.error) {
    console.error('identity-webhook selfie upload', up.error);
    return false;
  }
  const { data: result } = await admin.rpc('set_verified_avatar', { p_user_id: userId, p_session_id: sessionId, p_avatar_path: path });
  // Remove older photos for this person.
  const old = await admin.storage.from('avatars').list(userId);
  const stale = (old.data ?? []).map((f) => `${userId}/${f.name}`).filter((p) => p !== path);
  if (result === 'updated' && stale.length) await admin.storage.from('avatars').remove(stale);
  return result === 'updated';
}

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

  // Save the selfie before redaction deletes it. If it fails, keep the images so it can be retried.
  let selfieSaved = false;
  if (status === 'verified') {
    try {
      selfieSaved = await saveVerifiedSelfie(session.id, userId);
    } catch (e) {
      console.error('identity-webhook selfie', e);
    }
  }

  if (REDACT && status === 'verified' && selfieSaved) {
    try {
      await stripe.identity.verificationSessions.redact(session.id);
    } catch (e) {
      console.error('identity-webhook redact', e);
    }
  }

  return new Response('ok', { status: 200 });
});
