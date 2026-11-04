// Reads an insurance card with AWS Textract and saves the result. The card image
// is never stored; only the insurer, expiry and last 4 of the policy number are.
//
// This shows the card looks current and carries the driver's last name. It can't
// show the policy is active: a fake or cancelled card can pass.
//
// Body: { card: base64 } (JPEG or PNG, 5 MB max)

import { callAws, decodeBase64 } from '../_shared/aws.ts';
import { adminClient, corsHeaders, json, userClient } from '../_shared/http.ts';
import { imageType } from '../license-check/logic.ts';
import { answers, decide, lastFour, QUERIES } from './logic.ts';

const MAX_BYTES = 5 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Use POST.' }, 405);

  const { data: auth } = await userClient(req).auth.getUser();
  const user = auth.user;
  if (!user) return json(req, { error: 'Sign in first.' }, 401);

  const body = (await req.json().catch(() => ({}))) as { card?: string };
  const card = decodeBase64(body.card);
  if (!card) return json(req, { error: 'Add a photo of your card.' }, 400);
  if (card.length > MAX_BYTES) return json(req, { error: 'That photo is too large. Use a smaller one.' }, 400);
  if (!imageType(card)) return json(req, { error: 'Use a JPEG or PNG photo.' }, 400);

  const admin = adminClient();
  const { data: row, error: rowError } = await admin
    .from('driver_verifications')
    .select('identity_status, id_last_name')
    .eq('user_id', user.id)
    .maybeSingle();
  if (rowError) return json(req, { error: 'Could not load your verification. Try again.' }, 500);
  if (row?.identity_status !== 'verified') return json(req, { error: 'Finish your license check first.' }, 400);

  const { data: allowed, error: limitError } = await admin.rpc('claim_insurance_attempt', { p_user_id: user.id });
  if (limitError) return json(req, { error: 'Could not start the check. Try again.' }, 500);
  if (!allowed) return json(req, { error: "That's 5 tries today. Try again tomorrow." }, 429);

  try {
    const read = await callAws<{ Blocks?: [] }>('textract', 'textract', 'Textract.AnalyzeDocument', {
      Document: { Bytes: body.card },
      FeatureTypes: ['QUERIES'],
      QueriesConfig: { Queries: QUERIES },
    });
    const found = answers(read.Blocks ?? []);
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' });
    const result = decide(found, row.id_last_name, today);
    const passed = result.status !== 'requires_input';

    const { error } = await admin.rpc('set_insurance_result', {
      p_user_id: user.id,
      p_status: result.status,
      p_error: result.error,
      p_insurer: passed ? found.INSURER ?? null : null,
      p_expires: result.expires,
      p_policy_last4: passed ? lastFour(found.POLICY) : null,
      p_named_insured: result.status === 'review' ? found.NAMED_INSURED : null,
    });
    if (error) throw error;

    // Remove any card photo saved before scanning replaced uploads.
    const old = await admin.storage.from('driver-docs').list(user.id);
    const stale = (old.data ?? []).map((f) => `${user.id}/${f.name}`);
    if (stale.length) await admin.storage.from('driver-docs').remove(stale);

    return json(req, { status: result.status, error: result.error });
  } catch (e) {
    console.error('insurance-check', e instanceof Error ? e.message : 'unknown error'); // never log images
    return json(req, { error: "Couldn't check your card. Try again in a minute." }, 502);
  }
});
