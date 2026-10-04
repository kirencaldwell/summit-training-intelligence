import type { Activity } from '../types';
import { calculateHRZones, calculateIntensityFactor, calculateNormalizedPower, calculatePowerZones, calculateTSS, calculateVAM } from './trainingMath';
import { dataService } from './supabase';

const DEFAULT_CLIENT_ID = import.meta.env.VITE_STRAVA_CLIENT_ID || '';

export function getStoredStravaClientId(): string {
  return localStorage.getItem('summit_strava_client_id') || DEFAULT_CLIENT_ID;
}

export function setStoredStravaClientId(clientId: string) {
  localStorage.setItem('summit_strava_client_id', clientId);
}

export function getStravaAuthUrl(customClientId?: string): string {
  const clientId = customClientId || getStoredStravaClientId();
  if (!clientId || clientId === '12345') {
    return '';
  }

  const redirectUri = window.location.origin + window.location.pathname;
  const scope = 'read,activity:read_all';
  return `https://www.strava.com/oauth/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(
    redirectUri
  )}&approval_prompt=auto&scope=${scope}`;
}

export function parseStravaAuthCode(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('code');
}

/**
 * Ingestion Pipeline: Processes incoming raw Strava activity JSON stream
 * and calculates all multi-sport training metrics
 */
export async function ingestStravaActivity(rawActivity: any, streamsData?: any): Promise<Activity> {
  const profile = await dataService.getProfile();

  const durationSec = rawActivity.elapsed_time || rawActivity.moving_time || 3600;
  const movingTimeSec = rawActivity.moving_time || durationSec;
  const distanceM = rawActivity.distance || 0;
  const elevM = rawActivity.total_elevation_gain || 0;

  // Extract streams if present
  const wattsArray: number[] = streamsData?.watts?.data || [];
  const hrArray: number[] = streamsData?.heartrate?.data || [];
  const altArray: number[] = streamsData?.altitude?.data || [];
  const latlngArray: number[][] = streamsData?.latlng?.data || [];

  // 1. Calculate NP, IF, TSS
  let np = rawActivity.weighted_average_watts || 0;
  if (wattsArray.length > 0) {
    np = calculateNormalizedPower(wattsArray);
  }
  
  const avgWatts = rawActivity.average_watts || (wattsArray.length > 0 ? Math.round(wattsArray.reduce((a, b) => a + b, 0) / wattsArray.length) : undefined);
  const maxWatts = rawActivity.max_watts || (wattsArray.length > 0 ? Math.max(...wattsArray) : undefined);
  
  const ifScore = calculateIntensityFactor(np, profile.ftp);
  const tss = calculateTSS(movingTimeSec, np, ifScore, profile.ftp);
  const vam = calculateVAM(elevM, movingTimeSec);

  // 2. Zone distributions
  const hrZones = hrArray.length > 0 ? calculateHRZones(hrArray, profile.lthr) : undefined;
  const powerZones = wattsArray.length > 0 ? calculatePowerZones(wattsArray, profile.ftp) : undefined;

  // Map Strava activity type to internal multi-sport type
  let sportType: Activity['sport_type'] = 'cycling';
  const typeStr = (rawActivity.type || rawActivity.sport_type || '').toLowerCase();
  if (typeStr.includes('zwift') || typeStr.includes('virtualride')) sportType = 'zwift';
  else if (typeStr.includes('skimo') || typeStr.includes('mountaineering')) sportType = 'skimo';
  else if (typeStr.includes('backcountry') || typeStr.includes('nordicski')) sportType = 'backcountry_skiing';
  else if (typeStr.includes('scramble') || typeStr.includes('rockclimbing')) sportType = 'scrambling';
  else if (typeStr.includes('hike') || typeStr.includes('walk')) sportType = 'weighted_hiking';

  // Build stream points
  const pointsCount = Math.max(wattsArray.length, hrArray.length, altArray.length, latlngArray.length);
  const streamPoints = [];

  for (let i = 0; i < pointsCount; i++) {
    streamPoints.push({
      time: i * 5,
      watts: wattsArray[i],
      hr: hrArray[i],
      alt: altArray[i],
      lat: latlngArray[i]?.[0],
      lng: latlngArray[i]?.[1],
    });
  }

  const parsedActivity: Activity = {
    id: `strava-${rawActivity.id || Date.now()}`,
    strava_activity_id: rawActivity.id,
    title: rawActivity.name || 'Strava Activity',
    sport_type: sportType,
    start_date: rawActivity.start_date || new Date().toISOString(),
    duration_seconds: durationSec,
    moving_time_seconds: movingTimeSec,
    distance_meters: distanceM,
    total_elevation_gain_m: elevM,
    avg_power: avgWatts,
    max_power: maxWatts,
    normalized_power: np > 0 ? np : undefined,
    intensity_factor: ifScore > 0 ? ifScore : undefined,
    training_stress_score: tss > 0 ? tss : undefined,
    avg_hr: rawActivity.average_heartrate || (hrArray.length > 0 ? Math.round(hrArray.reduce((a, b) => a + b, 0) / hrArray.length) : undefined),
    max_hr: rawActivity.max_heartrate || (hrArray.length > 0 ? Math.max(...hrArray) : undefined),
    avg_vam_mh: vam > 0 ? vam : undefined,
    time_in_hr_zones: hrZones,
    time_in_power_zones: powerZones,
    streams_data: streamPoints.length > 0 ? streamPoints : undefined,
  };

  return dataService.addActivity(parsedActivity);
}

// Mock Strava Sync Trigger for UI demonstration
export async function triggerMockStravaSync(): Promise<Activity> {
  const mockStravaPayload = {
    id: Math.floor(Math.random() * 900000000) + 100000000,
    name: 'Artist Point Hill Climb Interval Blast',
    type: 'Ride',
    start_date: new Date().toISOString(),
    moving_time: 5400, // 1.5h
    elapsed_time: 5600,
    distance: 41200, // 41.2 km
    total_elevation_gain: 1120, // 1120m
    average_watts: 262,
    max_watts: 440,
    weighted_average_watts: 278,
    average_heartrate: 166,
    max_heartrate: 185
  };

  return await ingestStravaActivity(mockStravaPayload);
}
