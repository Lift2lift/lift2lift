// Deletes the signed-in person's account (App Review 5.1.1(v)).
//
// 1. Removes their files: profile photo (avatars/<id>/…) and driver documents
//    such as the insurance card (driver-docs/<id>/…).
// 2. Deletes the auth user. Every table hangs off profiles with
//    "on delete cascade", so rides they drive, seats, chat messages, reviews,
//    friendships, blocks, push tokens and verification rows go with it.
//    Reports they filed stay for moderators, without their name.
//
// Body: { confirm: "DELETE" }

import { adminClient, corsHeaders, json, userClient } from '../_shared/http.ts';

const BUCKETS = ['avatars', 'driver-docs'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Use POST.' }, 405);

  const { data: auth } = await userClient(req).auth.getUser();
  const user = auth.user;
  if (!user) return json(req, { error: 'Sign in first.' }, 401);

  const body = (await req.json().catch(() => ({}))) as { confirm?: string };
  if (body.confirm !== 'DELETE') return json(req, { error: 'Confirm that you want to delete your account.' }, 400);

  const admin = adminClient();

  for (const bucket of BUCKETS) {
    // Folders are one level deep (<user id>/<file>), 1000 is far more than anyone has.
    const { data: files, error } = await admin.storage.from(bucket).list(user.id, { limit: 1000 });
    if (error) return json(req, { error: 'Could not delete your files. Try again.' }, 500);
    const paths = (files ?? []).map((f) => `${user.id}/${f.name}`);
    if (paths.length) {
      const { error: removeError } = await admin.storage.from(bucket).remove(paths);
      if (removeError) return json(req, { error: 'Could not delete your files. Try again.' }, 500);
    }
  }

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return json(req, { error: 'Could not delete your account. Try again, or email support.' }, 500);

  return json(req, { deleted: true });
});
