import type { Activity, PMCDayPoint, PowerCurvePoint, ZoneDistribution } from '../types';

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
  
  // Create daily map of TSS
  const tssMap = new Map<string, number>();
  activities.forEach((act) => {
    const dateStr = act.start_date.split('T')[0];
    const existing = tssMap.get(dateStr) || 0;
    tssMap.set(dateStr, existing + (act.training_stress_score || 0));
  });

  const ctlTC = 42; // Chronic Training Load time constant (days)
  const atlTC = 7;  // Acute Training Load time constant (days)

  const ctlLambda = 1 - Math.exp(-1 / ctlTC);
  const atlLambda = 1 - Math.exp(-1 / atlTC);

  let ctl = 45; // Baseline CTL
  let atl = 50; // Baseline ATL

  // Generate date array from (today - daysBack) to today
  const startDate = new Date();
  startDate.setDate(today.getDate() - daysBack);

  const curr = new Date(startDate);
  while (curr <= today) {
    const dateStr = curr.toISOString().split('T')[0];
    const dailyTss = tssMap.get(dateStr) || 0;

    ctl = ctl + (dailyTss - ctl) * ctlLambda;
    atl = atl + (dailyTss - atl) * atlLambda;
    const tsb = ctl - atl;

    result.push({
      date: dateStr,
      ctl: Math.round(ctl * 10) / 10,
      atl: Math.round(atl * 10) / 10,
      tsb: Math.round(tsb * 10) / 10,
      tss: dailyTss,
    });

    curr.setDate(curr.getDate() + 1);
  }

  return result;
}

/**
 * Calculates Power Curve across durations
 */
export function calculatePowerCurve(activities: Activity[], weightKg: number = 70.5): PowerCurvePoint[] {
  const durationTargets = [
    { sec: 1, label: '1s' },
    { sec: 5, label: '5s' },
    { sec: 15, label: '15s' },
    { sec: 30, label: '30s' },
    { sec: 60, label: '1m' },
    { sec: 300, label: '5m' },
    { sec: 1200, label: '20m' },
    { sec: 3600, label: '1h' },
  ];

  const curve: PowerCurvePoint[] = durationTargets.map((dt) => ({
    durationSeconds: dt.sec,
    label: dt.label,
    watts: 0,
    wattsPerKg: 0,
  }));

  activities.forEach((act) => {
    if (!act.streams_data) return;
    const watts = act.streams_data.map((s) => s.watts || 0);

    durationTargets.forEach((dt, idx) => {
      let maxAvg = 0;
      if (watts.length >= dt.sec) {
        let currentSum = watts.slice(0, dt.sec).reduce((a, b) => a + b, 0);
        maxAvg = currentSum / dt.sec;

        for (let i = dt.sec; i < watts.length; i++) {
          currentSum += watts[i] - watts[i - dt.sec];
          const avg = currentSum / dt.sec;
          if (avg > maxAvg) maxAvg = avg;
        }
      } else if (watts.length > 0 && dt.sec === 1) {
        maxAvg = Math.max(...watts);
      }

      if (maxAvg > curve[idx].watts) {
        curve[idx].watts = Math.round(maxAvg);
        curve[idx].wattsPerKg = Number((maxAvg / weightKg).toFixed(2));
      }
    });
  });

  return curve;
}
