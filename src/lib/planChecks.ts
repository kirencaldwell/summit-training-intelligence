import type { MetricStreamPoint } from '../types';
import { calculateHRZones, calculatePowerZones } from './trainingMath';
import { findRuns, smooth, toSeconds, type Second } from './streamSummary';

/**
 * Plan checks: measurable things a planned session asked for ("3 x 30 s sprints", "stay in Z2", "2 x 20 min at 250 W").
 * A cheap model turns the plan text into these checks; this file validates them (the model's output is only data,
 * never run) and measures each one against the recorded ride. The assessment then gets facts instead of guesses.
 */
export type PlanCheck =
  | { kind: 'repeated_efforts'; label: string; reps?: number; seconds: number; min_watts?: number; min_percent_ftp?: number; optional?: boolean }
  | { kind: 'intervals'; label: string; reps: number; minutes: number; target_watts?: number; target_percent_ftp?: number; tolerance_percent: number }
  | { kind: 'power_cap'; label: string; max_watts?: number; max_percent_ftp?: number }
  | { kind: 'time_in_zone'; label: string; metric: 'power' | 'hr'; zone_min?: number; zone_max?: number; min_percent_in_range?: number };

export const MAX_PLAN_CHECKS = 8;

const num = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined;
const int = (v: unknown, lo: number, hi: number) => {
  const n = num(v, lo, hi);
  return n === undefined ? undefined : Math.round(n);
};

/** Turns whatever the model returned into valid checks; anything malformed or out of range is dropped. */
export function parsePlanChecks(raw: unknown): PlanCheck[] {
  let value = raw;
  if (typeof raw === 'string') {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    try { value = JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : raw); } catch { return []; }
  }
  const list = Array.isArray(value) ? value : Array.isArray((value as { checks?: unknown })?.checks) ? (value as { checks: unknown[] }).checks : [];
  const out: PlanCheck[] = [];
  for (const item of list.slice(0, MAX_PLAN_CHECKS)) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    const label = typeof c.label === 'string' ? c.label.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
    if (!label) continue;
    if (c.kind === 'repeated_efforts') {
      const seconds = int(c.seconds, 5, 600);
      if (seconds === undefined) continue;
      out.push({
        kind: 'repeated_efforts', label, seconds,
        reps: int(c.reps, 1, 30), min_watts: int(c.min_watts, 50, 2000), min_percent_ftp: int(c.min_percent_ftp, 20, 400),
        optional: c.optional === true,
      });
    } else if (c.kind === 'intervals') {
      const reps = int(c.reps, 1, 30);
      const minutes = num(c.minutes, 1, 180);
      const target_watts = int(c.target_watts, 50, 2000);
      const target_percent_ftp = int(c.target_percent_ftp, 20, 400);
      if (reps === undefined || minutes === undefined || (target_watts === undefined && target_percent_ftp === undefined)) continue;
      out.push({ kind: 'intervals', label, reps, minutes, target_watts, target_percent_ftp, tolerance_percent: int(c.tolerance_percent, 1, 25) ?? 7 });
    } else if (c.kind === 'power_cap') {
      const max_watts = int(c.max_watts, 50, 2000);
      const max_percent_ftp = int(c.max_percent_ftp, 20, 400);
      if (max_watts === undefined && max_percent_ftp === undefined) continue;
      out.push({ kind: 'power_cap', label, max_watts, max_percent_ftp });
    } else if (c.kind === 'time_in_zone') {
      const metric = c.metric === 'hr' ? 'hr' : c.metric === 'power' ? 'power' : undefined;
      const zone_min = int(c.zone_min, 1, 7);
      const zone_max = int(c.zone_max, 1, 7);
      if (!metric || (zone_min === undefined && zone_max === undefined)) continue;
      if (metric === 'hr' && ((zone_min ?? 1) > 5 || (zone_max ?? 1) > 5)) continue;
      out.push({ kind: 'time_in_zone', label, metric, zone_min, zone_max, min_percent_in_range: int(c.min_percent_in_range, 1, 100) });
    }
  }
  return out;
}

export interface PlanCheckResult {
  label: string;
  kind: PlanCheck['kind'];
  /** met / partly_met / not_found for efforts and intervals; within_cap / brief_excursions / exceeded for caps;
   *  within_limit / exceeded (or met / not_met) for zone time; for intervals with no full repetition, shorter_than_planned
   *  or below_target_power when a shortened or easier version of the set was done; or why it could not be measured */
  status: string;
  optional?: boolean;
  /** How the check was measured, e.g. the power line used */
  measured_as: string;
  found?: number;
  expected?: number;
  efforts?: { start_min: number; seconds: number; avg_watts: number; peak_5s_watts?: number; percent_of_target?: number }[];
  /** Intervals only: efforts at the target power that were shorter than planned (a shortened set, e.g. 3 x 5 min for 3 x 15 min) */
  shorter_efforts?: { start_min: number; minutes: number; avg_watts: number; percent_of_target: number }[];
  /** Intervals only: efforts of the planned length that stayed below the target power */
  lower_power_efforts?: { start_min: number; minutes: number; avg_watts: number; percent_of_target: number }[];
  notes?: string[];
  stats?: Record<string, number | string>;
}

const round = (n: number, d = 0) => { const f = 10 ** d; return Math.round(n * f) / f; };
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const minutes = (s: number) => round(s / 60, 1);
const wattsOf = (secs: Second[]) => secs.map((s) => s?.w).filter((v): v is number => v !== undefined);

function avgW(secs: Second[], from: number, to: number) {
  const v: number[] = [];
  for (let i = from; i < to && i < secs.length; i++) { const w = secs[i]?.w; if (w !== undefined) v.push(w); }
  return mean(v);
}

export function evaluatePlanChecks(
  points: MetricStreamPoint[] | undefined,
  checks: PlanCheck[],
  profile: { ftp?: number; lthr?: number },
): PlanCheckResult[] {
  const secs = points && points.length >= 10 ? toSeconds(points) : [];
  const ftp = profile.ftp && profile.ftp > 0 ? profile.ftp : undefined;
  const lthr = profile.lthr && profile.lthr > 0 ? profile.lthr : undefined;
  const hasPower = secs.some((s) => s?.w !== undefined && s.w > 0);
  const hasHr = secs.some((s) => s?.hr !== undefined);
  const w5 = hasPower ? smooth(secs, 'w', 5) : [];
  const w30 = hasPower ? smooth(secs, 'w', 30) : [];
  const pedalling = wattsOf(secs).filter((w) => w > 0);

  return checks.map((c): PlanCheckResult => {
    const base = { label: c.label, kind: c.kind } as const;
    const unmeasurable = (status: string, why: string): PlanCheckResult => ({ ...base, status, measured_as: why });
    if (!secs.length) return unmeasurable('no_time_series', 'this ride has no recorded time series');

    if (c.kind === 'repeated_efforts') {
      if (!hasPower) return unmeasurable('no_power_data', 'no power data');
      const line = c.min_watts ?? (c.min_percent_ftp && ftp ? (ftp * c.min_percent_ftp) / 100 : ftp ? ftp : mean(pedalling) * 1.8);
      if (!line) return unmeasurable('needs_ftp', 'a percent-of-FTP target but no FTP is set');
      const minS = Math.max(5, Math.round(c.seconds * 0.5));
      const maxS = Math.round(c.seconds * 2.5);
      const runs = findRuns(w5, (v) => v >= line, minS, 5);
      const matching = runs.filter((r) => r.end - r.start <= maxS);
      const longer = runs.filter((r) => r.end - r.start > maxS).length;
      const found = matching.length;
      const status = c.reps === undefined ? (found > 0 ? 'met' : 'not_found') : found >= c.reps ? 'met' : found > 0 ? 'partly_met' : 'not_found';
      const notes: string[] = [];
      if (longer) notes.push(`${longer} other hard effort(s) at or above that power ran longer than ${maxS} s`);
      return {
        ...base, status, optional: c.optional || undefined,
        measured_as: `5 s power at or above ${round(line)} W for ${minS}-${maxS} s (the time above that power, so a ${c.seconds} s sprint's ramp-up and fade can read a few seconds shorter)`,
        found, ...(c.reps !== undefined ? { expected: c.reps } : {}),
        efforts: matching.map((r) => ({
          start_min: minutes(r.start), seconds: r.end - r.start, avg_watts: round(avgW(secs, r.start, r.end)),
          peak_5s_watts: round(Math.max(...w5.slice(r.start, r.end).filter((v): v is number => v !== undefined))),
        })),
        ...(notes.length ? { notes } : {}),
      };
    }

    if (c.kind === 'intervals') {
      if (!hasPower) return unmeasurable('no_power_data', 'no power data');
      const target = c.target_watts ?? (c.target_percent_ftp && ftp ? (ftp * c.target_percent_ftp) / 100 : undefined);
      if (!target) return unmeasurable('needs_ftp', 'a percent-of-FTP target but no FTP is set');
      const floor = target * (1 - c.tolerance_percent / 100);
      const minS = Math.round(c.minutes * 60 * 0.8);
      const runs = findRuns(w30, (v) => v >= floor, minS, 20);
      const found = runs.length;
      const describe = (r: { start: number; end: number }) => {
        const avg = avgW(secs, r.start, r.end);
        return { start_min: minutes(r.start), minutes: minutes(r.end - r.start), avg_watts: round(avg), percent_of_target: round((avg / target) * 100) };
      };
      const overlaps = (r: { start: number; end: number }, others: { start: number; end: number }[]) =>
        others.some((o) => r.start < o.end && o.start < r.end);
      // Near misses, so a shortened or easier version of the set is reported as what it was, not as "no intervals"
      let shorter: ReturnType<typeof describe>[] = [];
      let lower: ReturnType<typeof describe>[] = [];
      if (found < c.reps) {
        const shortMin = Math.max(60, Math.round(c.minutes * 60 * 0.2));
        shorter = findRuns(w30, (v) => v >= floor, shortMin, 20)
          .filter((r) => r.end - r.start < minS && !overlaps(r, runs))
          .map(describe);
        lower = findRuns(w30, (v) => v >= target * 0.8, minS, 20)
          .filter((r) => !overlaps(r, runs))
          .map(describe);
      }
      const status = found >= c.reps ? 'met'
        : found > 0 ? 'partly_met'
        : shorter.length > 0 ? 'shorter_than_planned'
        : lower.length > 0 ? 'below_target_power'
        : 'not_found';
      const notes: string[] = [];
      if (shorter.length) {
        const lens = shorter.map((e) => e.minutes);
        notes.push(`${shorter.length} effort(s) held the target power (${round(Math.min(...shorter.map((e) => e.avg_watts)))}-${round(Math.max(...shorter.map((e) => e.avg_watts)))} W) but for ${Math.min(...lens)}-${Math.max(...lens)} min, shorter than the ${round(minS / 60, 1)}+ min a ${c.minutes} min interval needs`);
      }
      if (lower.length) {
        notes.push(`${lower.length} effort(s) lasted the planned length but averaged ${Math.min(...lower.map((e) => e.percent_of_target))}-${Math.max(...lower.map((e) => e.percent_of_target))}% of the target power`);
      }
      return {
        ...base, status,
        measured_as: `30 s-smoothed power at or above ${round(floor)} W (${c.tolerance_percent}% under the ${round(target)} W target) for ${round(minS / 60, 1)}+ minutes`,
        found, expected: c.reps,
        efforts: runs.map((r) => {
          const avg = avgW(secs, r.start, r.end);
          return { start_min: minutes(r.start), seconds: r.end - r.start, avg_watts: round(avg), percent_of_target: round((avg / target) * 100) };
        }),
        ...(shorter.length ? { shorter_efforts: shorter } : {}),
        ...(lower.length ? { lower_power_efforts: lower } : {}),
        ...(notes.length ? { notes } : {}),
      };
    }

    if (c.kind === 'power_cap') {
      if (!hasPower) return unmeasurable('no_power_data', 'no power data');
      const cap = c.max_watts ?? (c.max_percent_ftp && ftp ? (ftp * c.max_percent_ftp) / 100 : undefined);
      if (!cap) return unmeasurable('needs_ftp', 'a percent-of-FTP cap but no FTP is set');
      const above = pedalling.filter((w) => w > cap).length;
      const pct = pedalling.length ? (above / pedalling.length) * 100 : 0;
      const status = pct <= 2 ? 'within_cap' : pct <= 8 ? 'brief_excursions' : 'exceeded';
      const peak30 = Math.max(...w30.filter((v): v is number => v !== undefined), 0);
      const peak5 = Math.max(...w5.filter((v): v is number => v !== undefined), 0);
      return {
        ...base, status, measured_as: `share of pedalling time above ${round(cap)} W`,
        stats: { cap_watts: round(cap), percent_of_pedalling_time_above_cap: round(pct, 1), seconds_above_cap: above, best_30s_watts: round(peak30), best_5s_watts: round(peak5) },
      };
    }

    // time_in_zone
    const zoneOf = (list: number[]) => (c.metric === 'power' ? calculatePowerZones(list, ftp ?? 0) : calculateHRZones(list, lthr ?? 0));
    if (c.metric === 'power' && !hasPower) return unmeasurable('no_power_data', 'no power data');
    if (c.metric === 'hr' && !hasHr) return unmeasurable('no_hr_data', 'no heart-rate data');
    if (c.metric === 'power' && !ftp) return unmeasurable('needs_ftp', 'power zones need an FTP');
    if (c.metric === 'hr' && !lthr) return unmeasurable('needs_lthr', 'heart-rate zones need a threshold HR');
    const list = c.metric === 'power' ? wattsOf(secs) : secs.map((s) => s?.hr).filter((v): v is number => v !== undefined && v > 0);
    const zones = zoneOf(list) as unknown as Record<string, number | undefined>;
    const keys = c.metric === 'power' ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5];
    const total = keys.reduce((s, k) => s + (zones[`z${k}`] ?? 0), 0) || 1;
    const lo = c.zone_min ?? 1;
    const hi = c.zone_max ?? keys[keys.length - 1];
    const share = (pred: (k: number) => boolean) => round((keys.filter(pred).reduce((s, k) => s + (zones[`z${k}`] ?? 0), 0) / total) * 100, 1);
    const inRange = share((k) => k >= lo && k <= hi);
    const aboveRange = share((k) => k > hi);
    const belowRange = share((k) => k < lo);
    const status = c.min_percent_in_range !== undefined
      ? (inRange >= c.min_percent_in_range ? 'met' : 'not_met')
      : (aboveRange <= 10 ? 'within_limit' : 'exceeded');
    return {
      ...base, status, measured_as: `${c.metric} zones ${lo}-${hi}${c.zone_max === undefined ? '+' : ''} (share of recorded time)`,
      stats: {
        percent_in_range: inRange, percent_above_range: aboveRange, percent_below_range: belowRange,
        ...Object.fromEntries(keys.map((k) => [`z${k}_percent`, round(((zones[`z${k}`] ?? 0) / total) * 100, 1)])),
      },
    };
  });
}
