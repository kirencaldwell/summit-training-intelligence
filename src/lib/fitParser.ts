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
  calculateBestPowerEfforts,
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
  let buffer = await file.arrayBuffer();
  if (/\.fit\.gz$/i.test(file.name)) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('This browser cannot decompress .fit.gz files. Try a current version of Chrome, Edge, or Firefox.');
    }
    const compressedFile = new Blob([buffer]);
    const decompressedStream = compressedFile.stream().pipeThrough(new DecompressionStream('gzip'));
    buffer = await new Response(decompressedStream).arrayBuffer();
  }
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

        const hasPowerSamples = records.some((record: any) => typeof record.power === 'number');
        const timestampValues = records.map((record: any) => {
          const timestamp = record.timestamp;
          if (timestamp instanceof Date) return timestamp.getTime();
          if (typeof timestamp === 'number') return timestamp > 1e12 ? timestamp : timestamp * 1000;
          if (typeof timestamp === 'string') return Date.parse(timestamp);
          return Number.NaN;
        });
        const timestampsAreUsable = timestampValues.every(Number.isFinite);
        const firstTimestamp = timestampValues[0];
        const powerSamples = hasPowerSamples
          ? records.map((record: any, index: number) => ({
              time: timestampsAreUsable ? (timestampValues[index] - firstTimestamp) / 1000 : index,
              watts: typeof record.power === 'number' ? record.power : 0,
            }))
          : [];
        const powerCurveBestEfforts = calculateBestPowerEfforts(powerSamples);

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
        const title = file.name.replace(/\.fit(?:\.gz)?$/i, '') || `${sportLabel} — ${dateStr}`;

        const activity: Activity = {
          id: crypto.randomUUID(),
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
          power_curve_best_efforts: Object.keys(powerCurveBestEfforts).length > 0
            ? powerCurveBestEfforts
            : undefined,
        };

        resolve(activity);
      } catch (err: any) {
        reject(new Error(`Failed to process "${file.name}": ${err.message}`));
      }
    });
  });
}

function findDescendantText(element: Element, localName: string): string | undefined {
  const match = Array.from(element.getElementsByTagName('*'))
    .find((child) => child.localName.toLowerCase() === localName.toLowerCase());
  return match?.textContent?.trim() || undefined;
}

function mapGpxSport(typeText: string | undefined, hasPower: boolean): SportType {
  const type = (typeText || '').toLowerCase();
  if (type.includes('virtual')) return 'zwift';
  if (type.includes('cycl') || type.includes('ride') || type.includes('bike')) return 'cycling';
  if (type.includes('skimo') || type.includes('ski mount')) return 'skimo';
  if (type.includes('ski') || type.includes('snow')) return 'backcountry_skiing';
  if (type.includes('scrambl') || type.includes('climb') || type.includes('mountain')) return 'scrambling';
  if (type.includes('hik') || type.includes('walk') || type.includes('run')) return 'weighted_hiking';
  return hasPower ? 'cycling' : 'weighted_hiking';
}

function distanceBetweenMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const radians = Math.PI / 180;
  const deltaLat = (lat2 - lat1) * radians;
  const deltaLng = (lng2 - lng1) * radians;
  const haversine = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(deltaLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export async function parseGpxFile(file: File): Promise<Activity> {
  const xml = new DOMParser().parseFromString(await file.text(), 'application/xml');
  if (Array.from(xml.getElementsByTagName('*')).some((element) => element.localName === 'parsererror')) {
    throw new Error(`GPX parse error in "${file.name}": invalid XML`);
  }

  const trackPoints = Array.from(xml.getElementsByTagName('*'))
    .filter((element) => element.localName === 'trkpt');
  if (trackPoints.length === 0) throw new Error(`No track points found in "${file.name}"`);

  const samples = trackPoints.map((point, index) => {
    const lat = Number(point.getAttribute('lat'));
    const lng = Number(point.getAttribute('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error(`Invalid GPS coordinates in "${file.name}"`);
    }
    const timestampText = findDescendantText(point, 'time');
    const timestamp = timestampText ? Date.parse(timestampText) : Number.NaN;
    const elevation = Number(findDescendantText(point, 'ele'));
    const heartRate = Number(findDescendantText(point, 'hr'));
    const cadence = Number(findDescendantText(point, 'cad'));
    const power = Number(findDescendantText(point, 'power'));
    return {
      index,
      lat,
      lng,
      timestamp,
      elevation: Number.isFinite(elevation) ? elevation : undefined,
      hr: Number.isFinite(heartRate) && heartRate > 0 ? heartRate : undefined,
      cadence: Number.isFinite(cadence) && cadence >= 0 ? cadence : undefined,
      watts: Number.isFinite(power) && power >= 0 ? power : undefined,
    };
  });

  const hasTimestamps = samples.every((sample) => Number.isFinite(sample.timestamp));
  const startTimestamp = hasTimestamps ? samples[0].timestamp : Number.NaN;
  const timedSamples = samples.map((sample) => ({
    ...sample,
    time: hasTimestamps ? (sample.timestamp - startTimestamp) / 1000 : sample.index,
  }));
  const durationSeconds = Math.max(0, timedSamples[timedSamples.length - 1].time);

  let distanceMeters = 0;
  let elevationGain = 0;
  for (let index = 1; index < timedSamples.length; index++) {
    const previous = timedSamples[index - 1];
    const current = timedSamples[index];
    distanceMeters += distanceBetweenMeters(previous.lat, previous.lng, current.lat, current.lng);
    if (previous.elevation !== undefined && current.elevation !== undefined) {
      elevationGain += Math.max(0, current.elevation - previous.elevation);
    }
  }

  const watts = timedSamples.flatMap((sample) => sample.watts === undefined ? [] : [sample.watts]);
  const heartRates = timedSamples.flatMap((sample) => sample.hr === undefined ? [] : [sample.hr]);
  const cadences = timedSamples.flatMap((sample) => sample.cadence === undefined ? [] : [sample.cadence]);
  const profile = await dataService.getProfile();
  const averagePower = watts.length > 0
    ? Math.round(watts.reduce((sum, value) => sum + value, 0) / watts.length)
    : undefined;
  const normalizedPower = watts.length > 10 ? calculateNormalizedPower(watts) : averagePower || 0;
  const intensityFactor = calculateIntensityFactor(normalizedPower, profile.ftp);
  const trainingStressScore = calculateTSS(durationSeconds, normalizedPower, intensityFactor, profile.ftp);
  const streamStep = Math.max(1, Math.ceil(timedSamples.length / 500));
  const streamPoints: MetricStreamPoint[] = timedSamples
    .filter((_, index) => index % streamStep === 0 || index === timedSamples.length - 1)
    .map((sample) => ({
      time: sample.time,
      lat: sample.lat,
      lng: sample.lng,
      alt: sample.elevation,
      watts: sample.watts,
      hr: sample.hr,
      cadence: sample.cadence,
    }));
  const bestEfforts = calculateBestPowerEfforts(
    timedSamples.flatMap((sample) => sample.watts === undefined ? [] : [{ time: sample.time, watts: sample.watts }])
  );
  const track = Array.from(xml.getElementsByTagName('*')).find((element) => element.localName === 'trk');
  const trackName = track ? findDescendantText(track, 'name') : undefined;
  const typeText = track ? findDescendantText(track, 'type') : undefined;
  const sportType = mapGpxSport(typeText, watts.length > 0);
  const startDate = hasTimestamps
    ? new Date(startTimestamp).toISOString()
    : new Date().toISOString();
  const elevationGainMeters = Math.round(elevationGain);
  const averageHr = heartRates.length > 0
    ? Math.round(heartRates.reduce((sum, value) => sum + value, 0) / heartRates.length)
    : undefined;

  return {
    id: crypto.randomUUID(),
    title: trackName || file.name.replace(/\.gpx$/i, ''),
    sport_type: sportType,
    start_date: startDate,
    duration_seconds: Math.round(durationSeconds),
    moving_time_seconds: Math.round(durationSeconds),
    distance_meters: Math.round(distanceMeters),
    total_elevation_gain_m: elevationGainMeters,
    avg_power: averagePower,
    max_power: watts.length > 0 ? Math.max(...watts) : undefined,
    normalized_power: normalizedPower > 0 ? normalizedPower : undefined,
    intensity_factor: intensityFactor > 0 ? intensityFactor : undefined,
    training_stress_score: trainingStressScore > 0 ? trainingStressScore : undefined,
    avg_hr: averageHr,
    max_hr: heartRates.length > 0 ? Math.max(...heartRates) : undefined,
    avg_cadence: cadences.length > 0
      ? Math.round(cadences.reduce((sum, value) => sum + value, 0) / cadences.length)
      : undefined,
    avg_vam_mh: calculateVAM(elevationGainMeters, durationSeconds) || undefined,
    time_in_hr_zones: heartRates.length > 10 ? calculateHRZones(heartRates, profile.lthr) : undefined,
    time_in_power_zones: watts.length > 10 ? calculatePowerZones(watts, profile.ftp) : undefined,
    streams_data: streamPoints,
    power_curve_best_efforts: Object.keys(bestEfforts).length > 0 ? bestEfforts : undefined,
  };
}

// ─── Batch parse multiple FIT files ──────────────────────────────────────────

export interface FitImportResult {
  file: string;
  status: 'success' | 'duplicate' | 'error';
  activity?: Activity;
  error?: string;
}

export async function parseFitFiles(files: File[]): Promise<FitImportResult[]> {
  return parseActivityFiles(files);
}

export async function parseActivityFiles(files: File[]): Promise<FitImportResult[]> {
  const supportedFiles = files.filter((file) => /\.(fit|fit\.gz|gpx)$/i.test(file.name));
  const results: FitImportResult[] = [];

  for (const file of supportedFiles) {
    try {
      const parsedActivity = /\.gpx$/i.test(file.name)
        ? await parseGpxFile(file)
        : await parseFitFile(file);
      const duplicate = await dataService.findDuplicateActivity(parsedActivity);
      if (duplicate) {
        results.push({ file: file.name, status: 'duplicate', activity: duplicate });
        continue;
      }
      const activity = await dataService.addActivity(parsedActivity);
      results.push({ file: file.name, status: 'success', activity });
    } catch (err) {
      results.push({
        file: file.name,
        status: 'error',
        error: err instanceof Error ? err.message : 'Activity import failed.',
      });
    }
  }

  return results;
}
