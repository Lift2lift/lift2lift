'use client';

import { createApi, type Api } from '@lift2lift/app';
import { createClient } from '@supabase/supabase-js';

let api: Api | null = null;

/** One Supabase client per browser tab. The session lives in localStorage. */
export function getApi(): Api {
  if (api) return api;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Copy apps/web/.env.local.example to apps/web/.env.local.');
  }
  api = createApi(
    createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    }),
  );
  return api;
}
