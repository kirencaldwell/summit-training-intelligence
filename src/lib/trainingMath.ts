import type { Activity, MetricStreamPoint, PMCDayPoint, PowerCurvePoint, ZoneDistribution } from '../types';

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

/**
 * Calculates Performance Management Chart (PMC) over time (CTL, ATL, TSB)
 */
export function calculatePMC(activities: Activity[], daysBack: number = 90): PMCDayPoint[] {
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
    tssMap.set(dateStr, existing + Math.max(0, act.training_stress_score || 0));
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
  const curve: PowerCurvePoint[] = POWER_CURVE_DURATIONS.map((dt) => ({
    durationSeconds: dt.sec,
    label: dt.label,
    watts: 0,
    wattsPerKg: 0,
  }));

  activities.forEach((act) => {
    const sampledEfforts = calculateBestPowerEfforts(act.streams_data || []);
    POWER_CURVE_DURATIONS.forEach((target, index) => {
      const storedEffort = act.power_curve_best_efforts?.[String(target.sec)] || 0;
      const sampledEffort = sampledEfforts[String(target.sec)] || 0;
      const summaryPeak = target.sec === 1 ? act.max_power || 0 : 0;
      const bestEffort = Math.max(storedEffort, sampledEffort, summaryPeak);

      if (bestEffort > curve[index].watts) {
        curve[index].watts = Math.round(bestEffort);
        curve[index].wattsPerKg = weightKg > 0
          ? Number((bestEffort / weightKg).toFixed(2))
          : 0;
      }
    });
  });

  return curve;
}
