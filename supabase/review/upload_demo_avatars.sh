#!/usr/bin/env bash
# Uploads the profile photo for the two App Review demo accounts. Run it right
# after demo_accounts.sql. Without it the demo profiles point at a missing photo
# and Edit profile sits on "Checking your ID and saving your photo…".
#
#   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<key> supabase/review/upload_demo_avatars.sh
#
# The service role key bypasses all security: pass it in the environment for this
# one command, and never commit it or put it in the app.
set -euo pipefail

: "${SUPABASE_URL:?Set SUPABASE_URL}"
: "${SUPABASE_SERVICE_ROLE_KEY:?Set SUPABASE_SERVICE_ROLE_KEY}"

dir="$(cd "$(dirname "$0")" && pwd)"
for id in a0000000-0000-4000-8000-00000000a99e a0000000-0000-4000-8000-00000000d71e; do
  curl -fsS -X POST "$SUPABASE_URL/storage/v1/object/avatars/$id/demo.jpg" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "x-upsert: true" \
    -H "Content-Type: image/jpeg" \
    --data-binary @"$dir/demo-avatar.jpg" >/dev/null
  echo "Uploaded photo for $id"
done
