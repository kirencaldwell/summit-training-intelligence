import type { Activity, MetricStreamPoint, PMCDayPoint, PowerCurvePoint, ZoneDistribution } from '../types';
import { isEbike } from './tags';

const POWER_CURVE_DURATIONS = [
  { sec: 1, label: '1s' },
  { sec: 5, label: '5s' },
  { sec: 15, label: '15s' },
  { sec: 30, label: '30s' },
  { sec: 60, label: '1m' },
  { sec: 300, label: '5m' },
  { sec: 1200, label: '20m' },
  { sec: 3600, label: '1h' },
  { sec: 7200, label: '2h' },
];

/**
 * Calculates Normalized Power (NP) using 30-second rolling average 4th power algorithm
 */
export function calculateNormalizedPower(wattsStream: number[]): number {
  if (!wattsStream || wattsStream.length === 0) return 0;
  if (wattsStream.length < 30) {
    const avg = wattsStream.reduce((a, b) => a + b, 0) / wattsStream.length;
    return Math.round(avg);
  }

  const windowSize = 30;
  const rollingAverages: number[] = [];

  for (let i = 0; i <= wattsStream.length - windowSize; i++) {
    const slice = wattsStream.slice(i, i + windowSize);
    const sum = slice.reduce((a, b) => a + b, 0);
    rollingAverages.push(sum / windowSize);
  }

  // Raise 30s averages to 4th power, take average, then 4th root
  const fourthPowers = rollingAverages.map((val) => Math.pow(val, 4));
  const avgFourthPower = fourthPowers.reduce((a, b) => a + b, 0) / fourthPowers.length;
  const np = Math.pow(avgFourthPower, 0.25);

  return Math.round(np);
}

/**
 * Calculates Intensity Factor (IF) = NP / FTP
 */
export function calculateIntensityFactor(np: number, ftp: number): number {
  if (ftp <= 0 || np <= 0) return 0;
  return Number((np / ftp).toFixed(3));
}

/**
 * Calculates Training Stress Score (TSS)
 * TSS = (sec * NP * IF) / (FTP * 3600) * 100
 */
export function calculateTSS(durationSeconds: number, np: number, ifScore: number, ftp: number): number {
  if (ftp <= 0 || durationSeconds <= 0 || np <= 0) return 0;
  const tss = ((durationSeconds * np * ifScore) / (ftp * 3600)) * 100;
  return Math.round(tss);
}

/**
 * Calculates Vertical Ascent Rate (VAM) in meters/hour
 */
export function calculateVAM(elevationGainMeters: number, durationSeconds: number): number {
  if (durationSeconds <= 0 || elevationGainMeters <= 0) return 0;
  return Math.round((elevationGainMeters * 3600) / durationSeconds);
}

/**
 * Calculates 5-zone HR breakdown (Friel LTHR model)
 */
export function calculateHRZones(hrStream: number[], lthr: number): ZoneDistribution {
  const zones: ZoneDistribution = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
  if (!hrStream || hrStream.length === 0 || lthr <= 0) return zones;

  const z1Threshold = lthr * 0.81;
  const z2Threshold = lthr * 0.90;
  const z3Threshold = lthr * 0.95;
  const z4Threshold = lthr * 1.02;

  for (const hr of hrStream) {
    if (hr < z1Threshold) zones.z1++;
    else if (hr < z2Threshold) zones.z2++;
    else if (hr < z3Threshold) zones.z3++;
    else if (hr < z4Threshold) zones.z4++;
    else zones.z5++;
  }

  return zones;
}

export function calculateActivityHRZoneDuration(activity: Activity, lthr: number): ZoneDistribution {
  const zones: ZoneDistribution = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
  if (lthr <= 0) return zones;

  const samples = (activity.streams_data || [])
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.hr) && point.hr! > 0)
    .sort((a, b) => a.time - b.time);

  if (samples.length >= 2) {
    const intervals = samples.slice(1)
      .map((sample, index) => sample.time - samples[index].time)
      .filter((interval) => interval > 0);
    intervals.sort((a, b) => a - b);
    const typicalInterval = intervals.length > 0
      ? intervals[Math.floor(intervals.length / 2)]
      : 1;
    const maxAttributionInterval = Math.max(30, typicalInterval * 2);
    const boundaries = [lthr * 0.81, lthr * 0.90, lthr * 0.95, lthr * 1.02];

    samples.forEach((sample, index) => {
      const observedInterval = index < samples.length - 1
        ? samples[index + 1].time - sample.time
        : Math.min(typicalInterval, Math.max(0, activity.duration_seconds - sample.time));
      const seconds = Math.max(0, Math.min(observedInterval, maxAttributionInterval));
      const zoneIndex = boundaries.findIndex((boundary) => sample.hr! < boundary);
      const key = `z${zoneIndex < 0 ? 5 : zoneIndex + 1}` as keyof ZoneDistribution;
      zones[key] = (zones[key] || 0) + seconds;
    });

    if (Object.values(zones).some((seconds) => seconds > 0)) return zones;
  }

  const estimatedHr = activity.avg_hr;
  const estimatedDuration = activity.moving_time_seconds || activity.duration_seconds;
  if (estimatedHr && estimatedDuration > 0) {
    const singleZone = calculateHRZones([estimatedHr], lthr);
    const zoneKey = (Object.keys(singleZone) as (keyof ZoneDistribution)[])
      .find((key) => (singleZone[key] || 0) > 0);
    if (zoneKey) zones[zoneKey] = estimatedDuration;
    return zones;
  }

  return activity.time_in_hr_zones || zones;
}

/**
 * Calculates 7-zone Coggan Power breakdown
 */
export function calculatePowerZones(wattsStream: number[], ftp: number): ZoneDistribution {
  const zones: ZoneDistribution = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0, z6: 0, z7: 0 };
  if (!wattsStream || wattsStream.length === 0 || ftp <= 0) return zones;

  for (const w of wattsStream) {
    const pct = w / ftp;
    if (pct < 0.55) zones.z1++;
    else if (pct < 0.75) zones.z2++;
    else if (pct < 0.90) zones.z3++;
    else if (pct < 1.05) zones.z4++;
    else if (pct < 1.20) zones.z5++;
    else if (pct < 1.50) zones.z6!++;
    else zones.z7!++;
  }

  return zones;
}

// ---------------------------------------------------------------------------
// Training load (TSS) for activities of any data quality.
//
// Priority: measured power  >  AI estimate from the athlete's notes  >  heart rate  >  baseline.
// Everything except the AI estimate is derived on the fly from stored data, so changing the
// athlete's LTHR or weight updates the curves without rewriting activities.
// ---------------------------------------------------------------------------

export type TssSource = 'power' | 'ai' | 'heart_rate' | 'baseline';

export interface ResolvedTss {
  tss: number;
  source: TssSource;
  intensityFactor?: number;
}

export interface LoadProfile {
  ftp?: number;
  lthr?: number;
  weight_kg?: number;
}

/** Approximate TSS earned per hour spent in each LTHR heart-rate zone (Z1..Z5). */
const HR_ZONE_TSS_PER_HOUR = [25, 55, 75, 100, 130];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const movingHours = (activity: Activity) =>
  (activity.moving_time_seconds || activity.duration_seconds || 0) / 3600;

/** TSS = moving hours x IF^2 x 100: one hour at threshold (IF 1.0) is 100. */
export function tssFromIntensity(hours: number, intensityFactor: number): number {
  if (hours <= 0 || intensityFactor <= 0) return 0;
  return Math.round(hours * intensityFactor * intensityFactor * 1000) / 10;
}

/** Heart-rate based TSS, or undefined when there is no usable HR data or LTHR. */
export function heartRateTss(activity: Activity, lthr: number): ResolvedTss | undefined {
  const hours = movingHours(activity);
  if (hours <= 0 || !lthr || lthr <= 0) return undefined;

  const zones = activity.time_in_hr_zones;
  const zoneValues = zones ? [zones.z1, zones.z2, zones.z3, zones.z4, zones.z5].map((v) => v || 0) : [];
  const zoneTotal = zoneValues.reduce((sum, v) => sum + v, 0);
  if (zoneTotal > 0) {
    // Time-in-zone fractions applied to the moving time, so sample rate doesn't matter
    const perHour = zoneValues.reduce((sum, seconds, i) => sum + (seconds / zoneTotal) * HR_ZONE_TSS_PER_HOUR[i], 0);
    const tss = Math.round(hours * perHour * 10) / 10;
    return { tss, source: 'heart_rate', intensityFactor: Math.round(Math.sqrt(perHour / 100) * 100) / 100 };
  }

  if (activity.avg_hr && activity.avg_hr > 0) {
    const intensityFactor = clamp(activity.avg_hr / lthr, 0.4, 1.15);
    return { tss: tssFromIntensity(hours, intensityFactor), source: 'heart_rate', intensityFactor: Math.round(intensityFactor * 100) / 100 };
  }
  return undefined;
}

const BASE_INTENSITY: Record<string, number> = {
  cycling: 0.6,
  zwift: 0.6,
  skimo: 0.72,
  backcountry_skiing: 0.55,
  scrambling: 0.7,
  weighted_hiking: 0.58,
};

/**
 * Rough estimate for activities with neither power nor heart rate (e.g. old hikes with only
 * GPS and timestamps): terrain and pace versus a Naismith-style expectation, pack weight, and
 * the athlete's RPE when logged, and scaled down for e-bike rides. Deliberately conservative; AI estimates from notes replace it.
 */
export function baselineTss(activity: Activity, weightKg?: number): ResolvedTss | undefined {
  const hours = movingHours(activity);
  if (hours <= 0) return undefined;

  let intensityFactor: number;
  if (activity.perceived_exertion && activity.perceived_exertion > 0) {
    intensityFactor = clamp(0.3 + 0.07 * activity.perceived_exertion, 0.3, 1.0);
  } else {
    const base = BASE_INTENSITY[activity.sport_type] ?? 0.58;
    const km = activity.distance_meters / 1000;
    const gain = activity.total_elevation_gain_m || 0;
    const isCycling = activity.sport_type === 'cycling' || activity.sport_type === 'zwift';

    let adjustment = 1;
    if (isCycling) {
      // Climbier rides cost more
      adjustment = 1 + clamp(gain / Math.max(km, 1) / 40, 0, 0.3);
    } else {
      // Pace relative to 5 km/h + 600 m of climbing per hour
      const expectedHours = km / 5 + gain / 600;
      const ratio = expectedHours > 0 ? expectedHours / hours : 1;
      adjustment = clamp(Math.pow(ratio, 0.6), 0.75, 1.3);
      if (activity.pack_weight_kg && weightKg && weightKg > 0) {
        adjustment *= 1 + 1.2 * (activity.pack_weight_kg / weightKg);
      }
    }
    // A motor does part of the work, so the same speed and climbing costs the rider much less
    const motorFactor = isEbike(activity) ? 0.65 : 1;
    intensityFactor = clamp(base * adjustment * motorFactor, 0.3, 1.0);
  }
  return { tss: tssFromIntensity(hours, intensityFactor), source: 'baseline', intensityFactor: Math.round(intensityFactor * 100) / 100 };
}

/** Short label for where an activity's training load came from. */
export function describeTssSource(source: TssSource): string {
  switch (source) {
    case 'power': return 'measured power';
    case 'ai': return 'AI estimate from your notes';
    case 'heart_rate': return 'heart-rate estimate';
    default: return 'rough baseline estimate';
  }
}

/** True when the AI could meaningfully improve this activity's load: no power, and no HR or the athlete wrote notes. */
export function canImproveWithAi(activity: Activity, profile?: LoadProfile): boolean {
  const { source } = resolveTss(activity, profile);
  return source === 'baseline' || (source === 'heart_rate' && Boolean(activity.effort_notes?.trim()));
}

/** The training load to use for an activity, and where it came from. */
export function resolveTss(activity: Activity, profile?: LoadProfile): ResolvedTss {
  if ((activity.training_stress_score || 0) > 0) {
    return { tss: activity.training_stress_score!, source: 'power', intensityFactor: activity.intensity_factor };
  }
  // Power recorded but no stored TSS (e.g. imported before FTP was set): compute it now
  if ((activity.normalized_power || 0) > 0 && (profile?.ftp || 0) > 0) {
    const intensityFactor = calculateIntensityFactor(activity.normalized_power!, profile!.ftp!);
    const tss = calculateTSS(activity.moving_time_seconds || activity.duration_seconds, activity.normalized_power!, intensityFactor, profile!.ftp!);
    if (tss > 0) return { tss: Math.round(tss * 10) / 10, source: 'power', intensityFactor };
  }
  if (activity.tss_source === 'ai' && (activity.estimated_tss || 0) > 0) {
    return { tss: activity.estimated_tss!, source: 'ai', intensityFactor: activity.estimated_if };
  }
  return (
    heartRateTss(activity, profile?.lthr ?? 0) ??
    baselineTss(activity, profile?.weight_kg) ?? { tss: 0, source: 'baseline' }
  );
}

/**
 * Calculates Performance Management Chart (PMC) over time (CTL, ATL, TSB)
 */
export function calculatePMC(activities: Activity[], daysBack: number = 90, profile?: LoadProfile): PMCDayPoint[] {
  const result: PMCDayPoint[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const displayStart = new Date(today);
  displayStart.setUTCDate(displayStart.getUTCDate() - Math.max(0, Math.floor(daysBack)));

  const tssMap = new Map<string, number>();
  let firstActivityDay: Date | undefined;
  activities.forEach((act) => {
    const activityDate = new Date(act.start_date);
    if (!Number.isFinite(activityDate.getTime())) return;
    activityDate.setUTCHours(0, 0, 0, 0);
    if (!firstActivityDay || activityDate < firstActivityDay) firstActivityDay = activityDate;

    const dateStr = activityDate.toISOString().slice(0, 10);
    const existing = tssMap.get(dateStr) || 0;
    tssMap.set(dateStr, existing + Math.max(0, resolveTss(act, profile).tss));
  });

  const ctlTC = 42; // Chronic Training Load time constant (days)
  const atlTC = 7;  // Acute Training Load time constant (days)

  const ctlLambda = 1 - Math.exp(-1 / ctlTC);
  const atlLambda = 1 - Math.exp(-1 / atlTC);

  let ctl = 0;
  let atl = 0;

  const startDate = firstActivityDay && firstActivityDay < displayStart
    ? firstActivityDay
    : displayStart;

  const curr = new Date(startDate);
  while (curr <= today) {
    const dateStr = curr.toISOString().slice(0, 10);
    const dailyTss = tssMap.get(dateStr) || 0;

    ctl = ctl + (dailyTss - ctl) * ctlLambda;
    atl = atl + (dailyTss - atl) * atlLambda;
    const tsb = ctl - atl;

    if (curr >= displayStart) {
      result.push({
        date: dateStr,
        ctl: Math.round(ctl * 10) / 10,
        atl: Math.round(atl * 10) / 10,
        tsb: Math.round(tsb * 10) / 10,
        tss: dailyTss,
      });
    }

    curr.setUTCDate(curr.getUTCDate() + 1);
  }

  return result;
}

export function calculateBestPowerEfforts(
  streamData: MetricStreamPoint[]
): Record<string, number> {
  const samples = streamData
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.watts) && point.watts! >= 0)
    .sort((a, b) => a.time - b.time);
  if (samples.length === 0) return {};

  const intervals = samples
    .slice(1)
    .map((sample, index) => sample.time - samples[index].time)
    .filter((interval) => interval > 0);
  intervals.sort((a, b) => a - b);
  const sampleInterval = intervals.length > 0
    ? intervals[Math.floor(intervals.length / 2)]
    : 1;
  const watts = samples.map((sample) => sample.watts!);
  const efforts: Record<string, number> = {};

  for (const target of POWER_CURVE_DURATIONS) {
    if (sampleInterval > target.sec * 1.25) continue;
    const windowSize = Math.max(1, Math.round(target.sec / sampleInterval));
    if (windowSize > watts.length) continue;

    let windowTotal = watts.slice(0, windowSize).reduce((total, value) => total + value, 0);
    let bestAverage = windowTotal / windowSize;
    for (let index = windowSize; index < watts.length; index++) {
      windowTotal += watts[index] - watts[index - windowSize];
      bestAverage = Math.max(bestAverage, windowTotal / windowSize);
    }

    if (bestAverage > 0) efforts[String(target.sec)] = Math.round(bestAverage);
  }

  return efforts;
}

export function hasPowerCurveData(activity: Activity): boolean {
  return (activity.max_power || 0) > 0
    || Object.values(activity.power_curve_best_efforts || {}).some((watts) => watts > 0)
    || Boolean(activity.streams_data?.some((point) => typeof point.watts === 'number' && point.watts > 0));
}

/**
 * Calculates Power Curve across durations
 */
export function calculatePowerCurve(activities: Activity[], weightKg: number = 70.5): PowerCurvePoint[] {
  const perKg = (watts: number) => (weightKg > 0 ? Number((watts / weightKg).toFixed(2)) : 0);

  // Each activity's own best effort at every duration (activities too short for a duration are skipped)
  const effortsByDuration: number[][] = POWER_CURVE_DURATIONS.map(() => []);
  activities.forEach((act) => {
    const sampledEfforts = calculateBestPowerEfforts(act.streams_data || []);
    POWER_CURVE_DURATIONS.forEach((target, index) => {
      const storedEffort = act.power_curve_best_efforts?.[String(target.sec)] || 0;
      const sampledEffort = sampledEfforts[String(target.sec)] || 0;
      const summaryPeak = target.sec === 1 ? act.max_power || 0 : 0;
      const bestEffort = Math.max(storedEffort, sampledEffort, summaryPeak);
      if (bestEffort > 0) effortsByDuration[index].push(bestEffort);
    });
  });

  return POWER_CURVE_DURATIONS.map((target, index) => {
    const efforts = effortsByDuration[index].sort((a, b) => a - b);
    const count = efforts.length;
    const max = count > 0 ? efforts[count - 1] : 0;
    const mean = count > 0 ? efforts.reduce((sum, w) => sum + w, 0) / count : 0;
    const median = count === 0
      ? 0
      : count % 2 === 1
      ? efforts[(count - 1) / 2]
      : (efforts[count / 2 - 1] + efforts[count / 2]) / 2;

    return {
      durationSeconds: target.sec,
      label: target.label,
      watts: Math.round(max),
      wattsPerKg: perKg(max),
      meanWatts: Math.round(mean),
      meanWattsPerKg: perKg(mean),
      medianWatts: Math.round(median),
      medianWattsPerKg: perKg(median),
      sampleCount: count,
    };
  });
}
