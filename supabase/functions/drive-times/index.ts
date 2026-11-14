// Live drive times, with current traffic, from the caller's location to every
// mountain. Powers the "Least traffic" row on the Mountains tab.
//
// Body: { lat: number, lon: number }  →  { minutes: { [resortId]: number } }
//
// Uses Mapbox's Matrix API with the driving-traffic profile. Set MAPBOX_TOKEN
// (a public or secret token from account.mapbox.com) with
//   npx supabase secrets set MAPBOX_TOKEN=pk....
// driving-traffic allows 10 coordinates per request, so the 26 mountains go in
// 3 requests of 1 origin + up to 9 mountains. Mapbox bills per element (one
// origin-to-mountain pair): 26 per call, with 100,000 free each month.
//
// Privacy: the location is rounded to about 1 km and is never stored or logged.

import { corsHeaders, json, userClient } from '../_shared/http.ts';

// Same ids and coordinates as packages/app/lib/resorts.ts.
const RESORTS: [string, number, number][] = [
  ['eldora', 39.937, -105.583], ['echo', 39.685, -105.519], ['loveland', 39.68, -105.898],
  ['abasin', 39.642, -105.872], ['keystone', 39.605, -105.954], ['wp', 39.887, -105.763],
  ['copper', 39.502, -106.151], ['breck', 39.48, -106.067], ['granby', 40.044, -105.906],
  ['vail', 39.606, -106.355], ['cooper', 39.362, -106.301], ['bc', 39.604, -106.517],
  ['steamboat', 40.457, -106.804], ['howelsen', 40.483, -106.838], ['monarch', 38.512, -106.332],
  ['sunlight', 39.399, -107.338], ['snowmass', 39.209, -106.95], ['ajax', 39.186, -106.818],
  ['highlands', 39.182, -106.856], ['buttermilk', 39.206, -106.861], ['powderhorn', 39.069, -108.15],
  ['cb', 38.899, -106.965], ['wolf', 37.475, -106.793], ['telluride', 37.937, -107.812],
  ['purg', 37.63, -107.814], ['silverton', 37.885, -107.666],
];
const PER_REQUEST = 9;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Use POST.' }, 405);

  const { data: auth } = await userClient(req).auth.getUser();
  if (!auth.user) return json(req, { error: 'Sign in first.' }, 401);

  const token = Deno.env.get('MAPBOX_TOKEN');
  if (!token) return json(req, { error: 'Live drive times are not set up yet.' }, 503);

  const body = (await req.json().catch(() => ({}))) as { lat?: unknown; lon?: unknown };
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return json(req, { error: 'Send lat and lon.' }, 400);
  }
  const origin = `${lon.toFixed(2)},${lat.toFixed(2)}`;

  const chunks: [string, number, number][][] = [];
  for (let i = 0; i < RESORTS.length; i += PER_REQUEST) chunks.push(RESORTS.slice(i, i + PER_REQUEST));

  try {
    const results = await Promise.all(
      chunks.map(async (chunk) => {
        const coords = [origin, ...chunk.map(([, la, lo]) => `${lo},${la}`)].join(';');
        const url =
          `https://api.mapbox.com/directions-matrix/v1/mapbox/driving-traffic/${coords}` +
          `?sources=0&annotations=duration&access_token=${token}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Mapbox ${res.status}`);
        const data = (await res.json()) as { code: string; durations?: (number | null)[][] };
        if (data.code !== 'Ok' || !data.durations) throw new Error(`Mapbox ${data.code}`);
        // durations[0][0] is origin to itself; mountains start at index 1.
        return chunk.map(([id], i) => [id, data.durations![0][i + 1]] as const);
      }),
    );
    const minutes: Record<string, number> = {};
    for (const [id, seconds] of results.flat()) {
      if (seconds != null) minutes[id] = Math.round(seconds / 60);
    }
    return json(req, { minutes });
  } catch (e) {
    console.error('drive-times', (e as Error).message);
    return json(req, { error: "Couldn't get live drive times." }, 502);
  }
});
