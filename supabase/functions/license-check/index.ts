// Checks a driver's license without Stripe: AWS Textract reads the license and
// its expiry date, and AWS Rekognition compares the selfie with the license photo.
// The license image is never stored. A passing selfie becomes the profile photo.
//
// Not a liveness check, and no DMV lookup: a good fake or a photo of a photo can pass.
//
// Body: { license: base64, selfie: base64 } (JPEG or PNG, 5 MB max each)

import { callAws, decodeBase64 as decode } from '../_shared/aws.ts';
import { adminClient, corsHeaders, json, userClient } from '../_shared/http.ts';
import { field, imageType, licenseProblem, MIN_SIMILARITY, type IdField } from './logic.ts';

const MAX_BYTES = 5 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Use POST.' }, 405);

  const { data: auth } = await userClient(req).auth.getUser();
  const user = auth.user;
  if (!user) return json(req, { error: 'Sign in first.' }, 401);

  const body = (await req.json().catch(() => ({}))) as { license?: string; selfie?: string };
  const license = decode(body.license);
  const selfie = decode(body.selfie);
  if (!license || !selfie) return json(req, { error: 'Add a license photo and a selfie.' }, 400);
  if (license.length > MAX_BYTES || selfie.length > MAX_BYTES) return json(req, { error: 'Those photos are too large. Use smaller ones.' }, 400);
  const selfieType = imageType(selfie);
  if (!selfieType || !imageType(license)) return json(req, { error: 'Use JPEG or PNG photos.' }, 400);

  const admin = adminClient();
  const { data: row, error: rowError } = await admin
    .from('driver_verifications')
    .select('identity_status, biometric_consent_at')
    .eq('user_id', user.id)
    .maybeSingle();
  if (rowError) return json(req, { error: 'Could not load your verification. Try again.' }, 500);
  if (!row?.biometric_consent_at) return json(req, { error: 'Agree to the selfie check first.' }, 400);
  if (row.identity_status === 'verified') return json(req, { status: 'verified' });

  // Each attempt costs money, so limit them.
  const { data: allowed, error: limitError } = await admin.rpc('claim_license_attempt', { p_user_id: user.id });
  if (limitError) return json(req, { error: 'Could not start the check. Try again.' }, 500);
  if (!allowed) return json(req, { error: "That's 5 tries today. Try again tomorrow." }, 429);

  const sessionId = `aws_${crypto.randomUUID()}`;
  const { error: sessionError } = await admin.rpc('set_identity_session', { p_user_id: user.id, p_session_id: sessionId });
  if (sessionError) return json(req, { error: 'Could not start the check. Try again.' }, 500);

  const finish = async (status: 'verified' | 'requires_input', code: string | null, first: string | null = null, last: string | null = null) => {
    const { error } = await admin.rpc('apply_identity_result', {
      p_user_id: user.id, p_session_id: sessionId, p_status: status, p_error: code, p_first_name: first, p_last_name: last,
    });
    if (error) throw error;
    return json(req, { status, ...(code ? { error: code } : {}) });
  };

  try {
    const read = await callAws<{ IdentityDocuments?: { IdentityDocumentFields?: IdField[] }[] }>(
      'textract', 'textract', 'Textract.AnalyzeID', { DocumentPages: [{ Bytes: body.license }] },
    );
    const fields = read.IdentityDocuments?.[0]?.IdentityDocumentFields ?? [];
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' });
    const problem = licenseProblem(fields, today);
    if (problem) return await finish('requires_input', problem);

    let similarity = 0;
    try {
      const match = await callAws<{ FaceMatches?: { Similarity?: number }[] }>(
        'rekognition', 'rekognition', 'RekognitionService.CompareFaces',
        { SourceImage: { Bytes: body.selfie }, TargetImage: { Bytes: body.license }, SimilarityThreshold: MIN_SIMILARITY },
      );
      similarity = Math.max(0, ...(match.FaceMatches ?? []).map((m) => m.Similarity ?? 0));
    } catch (e) {
      // Rekognition returns this when it finds no face in an image.
      if (!String((e as { awsType?: string }).awsType).includes('InvalidParameterException')) throw e;
    }
    if (similarity < MIN_SIMILARITY) return await finish('requires_input', 'selfie_face_mismatch');

    const ext = selfieType === 'image/png' ? 'png' : 'jpg';
    const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
    const upload = await admin.storage.from('avatars').upload(path, selfie, { contentType: selfieType });
    if (upload.error) throw upload.error;

    const done = await finish('verified', null, field(fields, 'FIRST_NAME') || null, field(fields, 'LAST_NAME') || null);
    await admin.rpc('set_verified_avatar', { p_user_id: user.id, p_session_id: sessionId, p_avatar_path: path });
    const old = await admin.storage.from('avatars').list(user.id);
    const stale = (old.data ?? []).map((f) => `${user.id}/${f.name}`).filter((p) => p !== path);
    if (stale.length) await admin.storage.from('avatars').remove(stale);
    return done;
  } catch (e) {
    console.error('license-check', e instanceof Error ? e.message : 'unknown error'); // never log images
    await finish('requires_input', 'check_failed').catch(() => {});
    return json(req, { error: "Couldn't check your license. Try again in a minute." }, 502);
  }
});
