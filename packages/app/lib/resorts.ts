import type { Resort } from './types';

/**
 * Same list as the `resorts` table (supabase/migrations). Used for names, forecast
 * coordinates and the Colorado gas cap. roundTripMiles are conservative estimates
 * from Boulder; keep them in sync with the migration.
 */
export const RESORTS: Resort[] = [
  { id: 'eldora', name: 'Eldora', region: 'Front Range', roundTripMiles: 42, driveMinutes: 45, lat: 39.937, lon: -105.583 },
  { id: 'echo', name: 'Echo Mountain', region: 'Front Range', roundTripMiles: 90, driveMinutes: 60, lat: 39.685, lon: -105.519 },
  { id: 'loveland', name: 'Loveland', region: 'I-70 · Continental Divide', roundTripMiles: 124, driveMinutes: 75, lat: 39.68, lon: -105.898 },
  { id: 'abasin', name: 'Arapahoe Basin', region: 'Summit County', roundTripMiles: 144, driveMinutes: 90, lat: 39.642, lon: -105.872 },
  { id: 'keystone', name: 'Keystone', region: 'Summit County', roundTripMiles: 148, driveMinutes: 95, lat: 39.605, lon: -105.954 },
  { id: 'wp', name: 'Winter Park', region: 'Grand County', roundTripMiles: 130, driveMinutes: 100, lat: 39.887, lon: -105.763 },
  { id: 'copper', name: 'Copper Mountain', region: 'Summit County', roundTripMiles: 164, driveMinutes: 105, lat: 39.502, lon: -106.151 },
  { id: 'breck', name: 'Breckenridge', region: 'Summit County', roundTripMiles: 168, driveMinutes: 110, lat: 39.48, lon: -106.067 },
  { id: 'granby', name: 'Granby Ranch', region: 'Grand County', roundTripMiles: 160, driveMinutes: 120, lat: 40.044, lon: -105.906 },
  { id: 'vail', name: 'Vail', region: 'Vail Valley', roundTripMiles: 200, driveMinutes: 120, lat: 39.606, lon: -106.355 },
  { id: 'cooper', name: 'Ski Cooper', region: 'Leadville', roundTripMiles: 216, driveMinutes: 135, lat: 39.362, lon: -106.301 },
  { id: 'bc', name: 'Beaver Creek', region: 'Vail Valley', roundTripMiles: 224, driveMinutes: 140, lat: 39.604, lon: -106.517 },
  { id: 'steamboat', name: 'Steamboat', region: 'Routt County', roundTripMiles: 300, driveMinutes: 180, lat: 40.457, lon: -106.804 },
  { id: 'howelsen', name: 'Howelsen Hill', region: 'Routt County', roundTripMiles: 300, driveMinutes: 180, lat: 40.483, lon: -106.838 },
  { id: 'monarch', name: 'Monarch', region: 'Monarch Pass', roundTripMiles: 330, driveMinutes: 195, lat: 38.512, lon: -106.332 },
  { id: 'sunlight', name: 'Sunlight', region: 'Glenwood Springs', roundTripMiles: 330, driveMinutes: 195, lat: 39.399, lon: -107.338 },
  { id: 'snowmass', name: 'Snowmass', region: 'Aspen', roundTripMiles: 390, driveMinutes: 225, lat: 39.209, lon: -106.95 },
  { id: 'ajax', name: 'Aspen Mountain', region: 'Aspen', roundTripMiles: 380, driveMinutes: 225, lat: 39.186, lon: -106.818 },
  { id: 'highlands', name: 'Aspen Highlands', region: 'Aspen', roundTripMiles: 384, driveMinutes: 225, lat: 39.182, lon: -106.856 },
  { id: 'buttermilk', name: 'Buttermilk', region: 'Aspen', roundTripMiles: 384, driveMinutes: 225, lat: 39.206, lon: -106.861 },
  { id: 'powderhorn', name: 'Powderhorn', region: 'Grand Mesa', roundTripMiles: 450, driveMinutes: 255, lat: 39.069, lon: -108.15 },
  { id: 'cb', name: 'Crested Butte', region: 'Gunnison Valley', roundTripMiles: 450, driveMinutes: 270, lat: 38.899, lon: -106.965 },
  { id: 'wolf', name: 'Wolf Creek', region: 'San Juans', roundTripMiles: 540, driveMinutes: 315, lat: 37.475, lon: -106.793 },
  { id: 'telluride', name: 'Telluride', region: 'San Juans', roundTripMiles: 680, driveMinutes: 390, lat: 37.937, lon: -107.812 },
  { id: 'purg', name: 'Purgatory', region: 'San Juans', roundTripMiles: 690, driveMinutes: 390, lat: 37.63, lon: -107.814 },
  { id: 'silverton', name: 'Silverton Mountain', region: 'San Juans', roundTripMiles: 700, driveMinutes: 405, lat: 37.885, lon: -107.666 },
];

export const RESORT_BY_ID: Record<string, Resort> = Object.fromEntries(RESORTS.map((r) => [r.id, r]));

export function resortName(id: string) {
  return RESORT_BY_ID[id]?.name ?? id;
}
