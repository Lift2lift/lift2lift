// Sends ride reminders as push notifications. Runs every minute (see the
// cron setup in the README). claim_due_notifications() returns each reminder
// once and records it as sent, so overlapping runs never double-send.
//
//   2 hours before each leg   everyone on it: "Leaving in 2 hours"
//   5 minutes before          passengers: "Confirm your ride"; driver: "Confirm your passengers"
//
// Pushes go through Expo's push service, which delivers to Apple (APNs).

import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';
const EXPO_ACCESS_TOKEN = Deno.env.get('EXPO_ACCESS_TOKEN') ?? ''; // optional, for Expo's enhanced push security

type Due = { user_id: string; kind: string; ride_id: string; leg: string; leg_at: string; title: string; body: string; tokens: string[] };

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get('Authorization') !== `Bearer ${CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data, error } = await admin.rpc('claim_due_notifications');
  if (error) {
    console.error('claim_due_notifications', error);
    return new Response('failed', { status: 500 });
  }

  const due = (data ?? []) as Due[];
  const messages = due.flatMap((d) =>
    d.tokens.map((to) => ({
      to,
      title: d.title,
      body: d.body,
      sound: 'default',
      // Time-sensitive breaks through Focus modes on iOS.
      interruptionLevel: d.kind === 'two_hours' ? 'active' : 'time-sensitive',
      data: { url: `lift2lift:///rides?ride=${d.ride_id}&leg=${d.leg}`, rideId: d.ride_id, leg: d.leg, kind: d.kind, legAt: d.leg_at },
    })),
  );

  // Expo accepts up to 100 messages per request.
  let sent = 0;
  const dead: string[] = [];
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${EXPO_ACCESS_TOKEN}` } : {}),
      },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      console.error('expo push', res.status, await res.text());
      continue;
    }
    const json = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
    (json.data ?? []).forEach((ticket, j) => {
      if (ticket.status === 'ok') sent += 1;
      else if (ticket.details?.error === 'DeviceNotRegistered') dead.push(batch[j].to);
    });
  }

  // Forget phones that uninstalled the app.
  if (dead.length) await admin.from('push_tokens').delete().in('token', dead);

  return new Response(JSON.stringify({ reminders: due.length, pushes: sent, removed: dead.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
