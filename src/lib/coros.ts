/**
 * coros.ts
 * COROS Open API OAuth2 integration.
 * Docs: https://open.coros.com/docs
 * Register at: https://developer.coros.com
 */
import type { Activity } from '../types';
import { dataService } from './supabase';
import {
  calculateNormalizedPower,
  calculateIntensityFactor,
  calculateTSS,
  calculateVAM,
  calculateHRZones,
  calculatePowerZones,
} from './trainingMath';

// ─── Constants ───────────────────────────────────────────────────────────────
const COROS_AUTH_URL = 'https://open.coros.com/oauth2/authorize';
const COROS_API_BASE = 'https://open.coros.com';
const COROS_CLIENT_ID = import.meta.env.VITE_COROS_CLIENT_ID || '';

const STORAGE_KEYS = {
  CLIENT_ID: 'summit_coros_client_id',
  ACCESS_TOKEN: 'summit_coros_access_token',
  REFRESH_TOKEN: 'summit_coros_refresh_token',
  ATHLETE: 'summit_coros_athlete',
};

// ─── Storage helpers ──────────────────────────────────────────────────────────
export function getStoredCorosClientId(): string {
  return localStorage.getItem(STORAGE_KEYS.CLIENT_ID) || COROS_CLIENT_ID;
}
export function setStoredCorosClientId(id: string) {
  localStorage.setItem(STORAGE_KEYS.CLIENT_ID, id);
}

export function getCorosAccessToken(): string | null {
  return localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
}

export function setCorosTokens(accessToken: string, refreshToken: string) {
  localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, accessToken);
  localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, refreshToken);
}

export function clearCorosTokens() {
  localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
  localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
  localStorage.removeItem(STORAGE_KEYS.ATHLETE);
}

export function isCorosConnected(): boolean {
  return Boolean(getCorosAccessToken());
}

// ─── OAuth URL builder ────────────────────────────────────────────────────────
export function getCorosAuthUrl(clientId?: string): string {
  const id = clientId || getStoredCorosClientId();
  if (!id) return '';
  const redirectUri = window.location.origin + '/';
  return (
    `${COROS_AUTH_URL}?client_id=${id}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=user_read,activity_read`
  );
}

// ─── Parse the ?coros_code= redirect param ───────────────────────────────────
export function parseCorosAuthCode(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('coros_code') || params.get('code');
}

// ─── Exchange code for tokens via our serverless /api/coros-token endpoint ───
export async function exchangeCorosCode(
  code: string,
  clientId: string
): Promise<{ accessToken: string; refreshToken: string }> {
  const redirectUri = window.location.origin + '/';
  const response = await fetch(
    `/api/coros-token?code=${encodeURIComponent(code)}&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}`
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`COROS token exchange failed: ${body}`);
  }

  const json = await response.json();
  return { accessToken: json.access_token, refreshToken: json.refresh_token };
}

// ─── Sport type mapping ───────────────────────────────────────────────────────
function mapCorosSport(modeId?: number): Activity['sport_type'] {
  // COROS sport IDs (partial — covers most common)
  // https://open.coros.com/docs#section/Sport-Types
  switch (modeId) {
    case 20: return 'cycling';        // Road Cycling
    case 21: return 'cycling';        // Mountain Biking
    case 22: return 'zwift';          // Indoor Cycling
    case 30: return 'weighted_hiking'; // Hiking
    case 31: return 'scrambling';     // Mountaineering
    case 40: return 'backcountry_skiing'; // Ski / Snowboard
    case 41: return 'skimo';          // Ski Touring
    default: return 'cycling';
  }
}

// ─── Fetch recent activities from COROS API ───────────────────────────────────
export async function fetchCorosActivities(
  accessToken: string,
  pageNumber = 1,
  pageSize = 20
): Promise<any[]> {
  const url = `${COROS_API_BASE}/v2/coros/sport/list?pageNumber=${pageNumber}&pageSize=${pageSize}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) throw new Error(`COROS API error: ${res.status}`);
  const json = await res.json();

  // COROS wraps data in { result: 0000, data: { sportDataList: [...] } }
  return json?.data?.dataList || json?.data?.sportDataList || [];
}

// ─── Map a raw COROS activity object → Activity ───────────────────────────────
export async function ingestCorosActivity(raw: any): Promise<Activity> {
  const profile = await dataService.getProfile();

  const durationSec: number = raw.totalTime || 0;
  const movingTimeSec: number = raw.workoutTime || durationSec;
  const distanceM: number = (raw.distance || 0) * 1; // COROS already in meters
  const elevM: number = raw.totalAscent || 0;

  const avgWatts: number | undefined = raw.avgPower || undefined;
  const maxWatts: number | undefined = raw.maxPower || undefined;
  const np = avgWatts ? calculateNormalizedPower(avgWatts ? [avgWatts] : []) : 0;
  const ifScore = calculateIntensityFactor(np || avgWatts || 0, profile.ftp);
  const tss = calculateTSS(movingTimeSec, np || avgWatts || 0, ifScore, profile.ftp);
  const vam = calculateVAM(elevM, movingTimeSec);

  const avgHr: number | undefined = raw.avgHr || undefined;
  const maxHr: number | undefined = raw.maxHr || undefined;
  const hrArray = avgHr ? [avgHr] : [];
  const hrZones = hrArray.length > 0 ? calculateHRZones(hrArray, profile.lthr) : undefined;
  const powerZones = avgWatts ? calculatePowerZones([avgWatts], profile.ftp) : undefined;

  const sportType = mapCorosSport(raw.mode);

  return {
    id: `coros-${raw.labelId || Date.now()}`,
    title: raw.name || `COROS ${sportType} Activity`,
    sport_type: sportType,
    start_date: raw.startTime
      ? new Date(raw.startTime * 1000).toISOString()
      : new Date().toISOString(),
    duration_seconds: Math.round(durationSec),
    moving_time_seconds: Math.round(movingTimeSec),
    distance_meters: Math.round(distanceM),
    total_elevation_gain_m: Math.round(elevM),
    avg_power: avgWatts,
    max_power: maxWatts,
    normalized_power: np > 0 ? Math.round(np) : undefined,
    intensity_factor: ifScore > 0 ? Math.round(ifScore * 100) / 100 : undefined,
    training_stress_score: tss > 0 ? Math.round(tss) : undefined,
    avg_hr: avgHr,
    max_hr: maxHr,
    avg_cadence: raw.avgCadence || undefined,
    avg_vam_mh: vam > 0 ? Math.round(vam) : undefined,
    time_in_hr_zones: hrZones,
    time_in_power_zones: powerZones,
  };
}

// ─── Full COROS sync: fetch + ingest all recent activities ───────────────────
export async function syncCorosActivities(
  accessToken: string,
  pageSize = 20
): Promise<Activity[]> {
  const rawList = await fetchCorosActivities(accessToken, 1, pageSize);
  const activities: Activity[] = [];

  for (const raw of rawList) {
    try {
      const activity = await ingestCorosActivity(raw);
      await dataService.addActivity(activity);
      activities.push(activity);
    } catch (err) {
      console.warn('Failed to ingest COROS activity', raw, err);
    }
  }

  return activities;
}
