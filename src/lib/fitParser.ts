/**
 * fitParser.ts
 * Parses Garmin/COROS/Wahoo .fit binary files directly in the browser.
 * Uses the fit-file-parser npm package to decode, then maps to our Activity type.
 */
import FitParser from 'fit-file-parser';
import type { Activity, MetricStreamPoint, SportType } from '../types';
import {
  calculateNormalizedPower,
  calculateIntensityFactor,
  calculateTSS,
  calculateVAM,
  calculateHRZones,
  calculatePowerZones,
} from './trainingMath';
import { dataService } from './supabase';

// ─── FIT sport type → our SportType ────────────────────────────────────────

function mapFitSport(sport?: string, subSport?: string): SportType {
  const s = (sport || '').toLowerCase();
  const ss = (subSport || '').toLowerCase();

  if (ss.includes('virtual') || ss.includes('indoor_cycling') || s === 'e_biking') return 'zwift';
  if (s === 'cycling' || s === 'biking') return 'cycling';
  if (s === 'skiing' && (ss.includes('skimo') || ss.includes('mountaineering'))) return 'skimo';
  if (s === 'skiing' || ss.includes('backcountry') || ss.includes('cross_country')) return 'backcountry_skiing';
  if (s === 'hiking' || ss.includes('hiking')) return 'weighted_hiking';
  if (s === 'mountaineering' || ss.includes('scramble') || ss.includes('rock_climbing')) return 'scrambling';

  // Default unmapped types → cycling if power data present, else weighted hiking
  return 'cycling';
}

// ─── Parse a single File object → Activity ─────────────────────────────────

export async function parseFitFile(file: File): Promise<Activity> {
  const buffer = await file.arrayBuffer();
  const profile = await dataService.getProfile();

  return new Promise((resolve, reject) => {
    const parser = new FitParser({
      force: true,
      speedUnit: 'km/h',
      lengthUnit: 'km',
      temperatureUnit: 'celsius',
      elapsedRecordField: true,
      mode: 'both', // gives us both list and cascade
    });

    parser.parse(buffer, (error: string | undefined, data: any) => {
      if (error) {
        reject(new Error(`FIT parse error in "${file.name}": ${error}`));
        return;
      }

      try {
        // ── Session summary (summary record from device) ──────────────────
        const sessions: any[] = data.activity?.sessions || [];
        const session = sessions[0] || {};
        const records: any[] = session.laps?.flatMap((l: any) => l.records || []) || data.records || [];

        // ── Sport type ────────────────────────────────────────────────────
        const sportType = mapFitSport(session.sport, session.sub_sport);

        // ── Date ──────────────────────────────────────────────────────────
        const startDate: string =
          session.start_time instanceof Date
            ? session.start_time.toISOString()
            : data.activity?.timestamp instanceof Date
            ? data.activity.timestamp.toISOString()
            : new Date().toISOString();

        // ── Duration / Distance / Elevation ───────────────────────────────
        const durationSec: number =
          session.total_elapsed_time || session.total_timer_time || records.length || 0;
        const movingTimeSec: number = session.total_timer_time || durationSec;
        const distanceM: number = (session.total_distance || 0) * 1000; // fit-file-parser gives km
        const elevM: number = session.total_ascent || 0;

        // ── Stream arrays ─────────────────────────────────────────────────
        const wattsArray: number[] = records
          .map((r: any) => r.power)
          .filter((v): v is number => typeof v === 'number' && v > 0);

        const hrArray: number[] = records
          .map((r: any) => r.heart_rate)
          .filter((v): v is number => typeof v === 'number' && v > 0);

        const cadenceArray: number[] = records
          .map((r: any) => r.cadence)
          .filter((v): v is number => typeof v === 'number' && v >= 0);

        const speedArray: number[] = records
          .map((r: any) => r.speed)
          .filter((v): v is number => typeof v === 'number' && v >= 0);

        // ── Calculated metrics ────────────────────────────────────────────
        const avgWatts: number | undefined =
          session.avg_power ||
          (wattsArray.length > 0
            ? Math.round(wattsArray.reduce((a, b) => a + b, 0) / wattsArray.length)
            : undefined);

        const maxWatts: number | undefined =
          session.max_power ||
          (wattsArray.length > 0 ? Math.max(...wattsArray) : undefined);

        const np = wattsArray.length > 10 ? calculateNormalizedPower(wattsArray) : session.normalized_power || avgWatts || 0;
        const ifScore = calculateIntensityFactor(np, profile.ftp);
        const tss = calculateTSS(movingTimeSec, np, ifScore, profile.ftp);
        const vam = calculateVAM(elevM, movingTimeSec);

        const avgHr: number | undefined =
          session.avg_heart_rate ||
          (hrArray.length > 0
            ? Math.round(hrArray.reduce((a, b) => a + b, 0) / hrArray.length)
            : undefined);
        const maxHr: number | undefined = session.max_heart_rate || (hrArray.length > 0 ? Math.max(...hrArray) : undefined);

        const avgCadence: number | undefined =
          session.avg_cadence ||
          (cadenceArray.length > 0
            ? Math.round(cadenceArray.reduce((a, b) => a + b, 0) / cadenceArray.length)
            : undefined);

        const maxSpeedKmh: number | undefined =
          session.max_speed || (speedArray.length > 0 ? Math.max(...speedArray) : undefined);

        const hrZones = hrArray.length > 10 ? calculateHRZones(hrArray, profile.lthr) : undefined;
        const powerZones = wattsArray.length > 10 ? calculatePowerZones(wattsArray, profile.ftp) : undefined;

        // ── Stream points (sampled down to ~500 points max for perf) ──────
        const step = Math.max(1, Math.floor(records.length / 500));
        const streamPoints: MetricStreamPoint[] = records
          .filter((_: any, i: number) => i % step === 0)
          .map((r: any, i: number) => ({
            time: i * step,
            watts: typeof r.power === 'number' ? r.power : undefined,
            hr: typeof r.heart_rate === 'number' ? r.heart_rate : undefined,
            alt: typeof r.altitude === 'number' ? r.altitude : undefined,
            cadence: typeof r.cadence === 'number' ? r.cadence : undefined,
            speed: typeof r.speed === 'number' ? r.speed : undefined,
            lat: r.position_lat,
            lng: r.position_long,
          }));

        // ── Activity title ────────────────────────────────────────────────
        const sportLabel = sportType.replace('_', ' ');
        const dateStr = new Date(startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const title = file.name.replace(/\.fit$/i, '') || `${sportLabel} — ${dateStr}`;

        const activity: Activity = {
          id: `fit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          title,
          sport_type: sportType,
          start_date: startDate,
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
          avg_cadence: avgCadence,
          max_speed_kmh: maxSpeedKmh ? Math.round(maxSpeedKmh * 10) / 10 : undefined,
          avg_vam_mh: vam > 0 ? Math.round(vam) : undefined,
          time_in_hr_zones: hrZones,
          time_in_power_zones: powerZones,
          streams_data: streamPoints.length > 0 ? streamPoints : undefined,
        };

        resolve(activity);
      } catch (err: any) {
        reject(new Error(`Failed to process "${file.name}": ${err.message}`));
      }
    });
  });
}

// ─── Batch parse multiple FIT files ──────────────────────────────────────────

export interface FitImportResult {
  file: string;
  status: 'success' | 'error';
  activity?: Activity;
  error?: string;
}

export async function parseFitFiles(files: File[]): Promise<FitImportResult[]> {
  const results: FitImportResult[] = [];

  for (const file of files) {
    try {
      const activity = await parseFitFile(file);
      await dataService.addActivity(activity);
      results.push({ file: file.name, status: 'success', activity });
    } catch (err: any) {
      results.push({ file: file.name, status: 'error', error: err.message });
    }
  }

  return results;
}
