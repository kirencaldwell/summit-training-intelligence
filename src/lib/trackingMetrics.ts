import type { Activity, AthleteProfile, Goal, PMCDayPoint, SportType, TrainingSession } from '../types';
import { calculatePowerCurve, resolveTss, type LoadProfile } from './trainingMath';
import { isEbike } from './tags';
import { kmToMi, kmhToMph, mToFt, roundTo } from './units';
import { addDaysToDateOnly, getLocalDateString, getWeekStartDate } from './trainingSessions';
import type { MunterParams } from './munter';

/**
 * Tracked metrics: things worth measuring every week to see whether the athlete is heading for a goal. The AI coach
 * picks which ones and sets their targets (a declarative definition, never code); the software measures them from
 * the activities, so the numbers come from the athlete's data and cannot be made up.
 */
export type MetricKind = 'weekly_volume' | 'long_effort' | 'best_power' | 'fitness_ctl' | 'travel_pace' | 'plan_adherence';
export type VolumeMeasure = 'hours' | 'miles' | 'vert_ft' | 'tss';
export type PaceParam = 'ascent' | 'descent' | 'flat' | 'units';
export type MetricStatus = 'met' | 'ahead' | 'on_track' | 'behind' | 'well_behind' | 'no_data';

export interface TrackingMetric {
  id: string;
  name: string;
  /** One sentence tying the metric to what the goal demands */
  why: string;
  kind: MetricKind;
  /** weekly_volume, long_effort */
  measure?: VolumeMeasure;
  /** Empty or missing: all sports (e-bike rides are never counted) */
  sports?: SportType[];
  /** best_power */
  duration_seconds?: 300 | 1200 | 3600;
  /** travel_pace */
  pace?: PaceParam;
  target: number;
  target_date: string;
  /** Where the athlete was when the metric was set up: the start of the path to the target */
  start_value?: number;
  start_date?: string;
}

export interface MetricContext {
  activities: Activity[];
  sessions: TrainingSession[];
  pmc: PMCDayPoint[];
  profile?: Pick<AthleteProfile, 'weight_kg'> | null;
  /** Thresholds for working out each activity's TSS */
  loadProfile?: LoadProfile;
  /** Munter travel parameters by activity id (for travel_pace metrics) */
  munter?: Record<string, MunterParams>;
  today?: string;
}

export interface MetricEvaluation {
  /** The value now (weekly volume: average of the last 4 finished weeks) */
  current?: number;
  /** One point per week, oldest first, up to and including the current week */
  series: { week: string; value?: number }[];
  /** Where the path from the starting value to the target puts the metric today */
  expected?: number;
  status: MetricStatus;
  /** 0-100: how far from the starting value to the target */
  percentToTarget?: number;
}

export const SPORT_KEYS: SportType[] = ['cycling', 'zwift', 'skimo', 'backcountry_skiing', 'resort_skiing', 'scrambling', 'weighted_hiking'];

export function metricUnit(m: Pick<TrackingMetric, 'kind' | 'measure' | 'pace'>): string {
  switch (m.kind) {
    case 'weekly_volume': return ({ hours: 'h/week', miles: 'mi/week', vert_ft: 'ft/week', tss: 'TSS/week' } as const)[m.measure ?? 'hours'];
    case 'long_effort': return ({ hours: 'h', miles: 'mi', vert_ft: 'ft', tss: 'TSS' } as const)[m.measure ?? 'hours'];
    case 'best_power': return 'W';
    case 'fitness_ctl': return 'CTL';
    case 'travel_pace': return ({ ascent: 'ft/h', descent: 'ft/h', flat: 'mph', units: 'units/h' } as const)[m.pace ?? 'ascent'];
    case 'plan_adherence': return '%';
  }
}

const decimals = (m: Pick<TrackingMetric, 'kind' | 'measure' | 'pace'>) =>
  m.kind === 'weekly_volume' || m.kind === 'long_effort' ? (m.measure === 'hours' || m.measure === 'miles' ? 1 : 0)
  : m.kind === 'travel_pace' && (m.pace === 'flat' || m.pace === 'units') ? 1 : 0;

export const formatMetricValue = (m: Pick<TrackingMetric, 'kind' | 'measure' | 'pace'>, v: number) =>
  `${roundTo(v, decimals(m)).toLocaleString()} ${metricUnit(m)}`;

const localDay = (a: Activity) => getLocalDateString(new Date(a.start_date));
const hoursOf = (a: Activity) => (a.moving_time_seconds || a.duration_seconds || 0) / 3600;
const measureOf = (a: Activity, measure: VolumeMeasure, ctx: MetricContext): number => {
  switch (measure) {
    case 'hours': return hoursOf(a);
    case 'miles': return kmToMi(a.distance_meters / 1000);
    case 'vert_ft': return mToFt(a.total_elevation_gain_m || 0);
    case 'tss': return resolveTss(a, ctx.loadProfile).tss;
  }
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n === 0 ? undefined : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

const matchesSports = (a: Activity, m: TrackingMetric) => !isEbike(a) && (!m.sports?.length || m.sports.includes(a.sport_type));

/** The value of a metric as of a date (inclusive). Undefined when there is nothing to measure yet. */
export function metricValueAt(m: TrackingMetric, asOf: string, ctx: MetricContext): number | undefined {
  const within = (from: string, to: string) => ctx.activities.filter((a) => { const d = localDay(a); return d >= from && d <= to && matchesSports(a, m); });
  switch (m.kind) {
    case 'weekly_volume': {
      const set = within(addDaysToDateOnly(asOf, -6), asOf);
      return set.reduce((s, a) => s + measureOf(a, m.measure ?? 'hours', ctx), 0);
    }
    case 'long_effort': {
      const set = within(addDaysToDateOnly(asOf, -27), asOf);
      return set.length ? Math.max(...set.map((a) => measureOf(a, m.measure ?? 'hours', ctx))) : undefined;
    }
    case 'best_power': {
      const set = within(addDaysToDateOnly(asOf, -41), asOf);
      const curve = calculatePowerCurve(set, ctx.profile?.weight_kg || undefined);
      const w = curve.find((p) => p.durationSeconds === (m.duration_seconds ?? 1200))?.watts;
      return w && w > 0 ? w : undefined;
    }
    case 'fitness_ctl': {
      let found: number | undefined;
      for (const p of ctx.pmc) { if (p.date <= asOf) found = p.ctl; else break; }
      return found;
    }
    case 'travel_pace': {
      const set = within(addDaysToDateOnly(asOf, -41), asOf);
      const values: number[] = [];
      for (const a of set) {
        const p = ctx.munter?.[a.id];
        if (!p) continue;
        const v = m.pace === 'descent' ? p.descent_mh : m.pace === 'flat' ? p.flat_kmh : m.pace === 'units' ? p.effort_units_per_hour : p.ascent_mh;
        if (v === undefined) continue;
        values.push(m.pace === 'descent' || m.pace === 'ascent' || m.pace === undefined ? mToFt(v) : m.pace === 'flat' ? kmhToMph(v) : v);
      }
      return median(values);
    }
    case 'plan_adherence': {
      const from = addDaysToDateOnly(asOf, -27);
      const planned = ctx.sessions.filter((s) => (s.status === 'ACCEPTED' || s.status === 'COMPLETED') && s.session_date >= from && s.session_date <= asOf);
      return planned.length ? (planned.filter((s) => s.status === 'COMPLETED').length / planned.length) * 100 : undefined;
    }
  }
}

/** The metric over time (weekly) and where it stands against the path to its target. */
export function evaluateMetric(m: TrackingMetric, ctx: MetricContext, weeks = 12): MetricEvaluation {
  const today = ctx.today ?? getLocalDateString();
  const thisWeek = getWeekStartDate(today);
  const series = Array.from({ length: weeks }, (_, i) => addDaysToDateOnly(thisWeek, -7 * (weeks - 1 - i))).map((week) => {
    const asOf = week === thisWeek ? today : addDaysToDateOnly(week, 6);
    const value = metricValueAt(m, asOf, ctx);
    return { week, value: value === undefined ? undefined : roundTo(value, 2) };
  });

  // Weekly volume is judged on the average of the last 4 finished weeks, so a single short week or the week still in progress doesn't decide it
  let current: number | undefined;
  if (m.kind === 'weekly_volume') {
    const finished = series.filter((p) => p.week < thisWeek).slice(-4).map((p) => p.value ?? 0);
    current = finished.length ? finished.reduce((s, v) => s + v, 0) / finished.length : undefined;
  } else {
    current = metricValueAt(m, today, ctx);
  }
  if (current === undefined) return { series, status: 'no_data' };

  const start = m.start_value ?? current;
  const startDate = m.start_date ?? today;
  const total = m.target - start;
  const span = Math.max(1, (new Date(`${m.target_date}T12:00:00Z`).getTime() - new Date(`${startDate}T12:00:00Z`).getTime()) / 86400000);
  const elapsed = Math.min(span, Math.max(0, (new Date(`${today}T12:00:00Z`).getTime() - new Date(`${startDate}T12:00:00Z`).getTime()) / 86400000));
  const expected = start + total * (elapsed / span);
  const percentToTarget = total !== 0 ? Math.max(0, Math.min(100, ((current - start) / total) * 100)) : 100;

  let status: MetricStatus;
  if (current >= m.target) status = 'met';
  else if (total <= 0) status = 'on_track';
  else {
    const diff = (current - start) / total - elapsed / span;
    status = diff >= 0.15 ? 'ahead' : diff >= -0.1 ? 'on_track' : diff >= -0.3 ? 'behind' : 'well_behind';
  }
  return { current, series, expected, status, percentToTarget };
}

// ── Reading what the AI coach proposes ───────────────────────────────────────

const MAX_METRICS = 6;
const clampNum = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

const TARGET_RANGE: Record<string, [number, number]> = {
  'weekly_volume:hours': [1, 40], 'weekly_volume:miles': [5, 600], 'weekly_volume:vert_ft': [500, 100000], 'weekly_volume:tss': [50, 2000],
  'long_effort:hours': [0.5, 30], 'long_effort:miles': [2, 400], 'long_effort:vert_ft': [300, 40000], 'long_effort:tss': [30, 1500],
  'best_power:*': [80, 1000], 'fitness_ctl:*': [10, 200], 'plan_adherence:*': [30, 100],
  'travel_pace:ascent': [300, 5000], 'travel_pace:descent': [500, 10000], 'travel_pace:flat': [1.5, 6], 'travel_pace:units': [1.5, 10],
};

function stableId(goalId: string, m: Pick<TrackingMetric, 'kind' | 'measure' | 'pace' | 'duration_seconds' | 'sports'>): string {
  const text = [goalId, m.kind, m.measure ?? '', m.pace ?? '', m.duration_seconds ?? '', (m.sports ?? []).join(',')].join('|');
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return `m-${h.toString(36)}`;
}

/**
 * Turns whatever the model returned into valid metrics for a goal. Anything malformed, out of range or that
 * duplicates another metric is dropped; target dates are held between today and the goal's date.
 */
export function parseMetricProposals(raw: unknown, goal: Pick<Goal, 'id' | 'target_date'>, today = getLocalDateString()): TrackingMetric[] {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    try { value = JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : raw); } catch { return []; }
  }
  const list = Array.isArray(value) ? value : (value as { metrics?: unknown })?.metrics;
  if (!Array.isArray(list)) return [];
  const lastDate = goal.target_date && goal.target_date > today ? goal.target_date : addDaysToDateOnly(today, 120);
  const out: TrackingMetric[] = [];
  const seen = new Set<string>();
  for (const item of list as Record<string, unknown>[]) {
    if (!item || typeof item !== 'object') continue;
    const kind = item.kind as MetricKind;
    if (!['weekly_volume', 'long_effort', 'best_power', 'fitness_ctl', 'travel_pace', 'plan_adherence'].includes(kind)) continue;
    const measure = ['hours', 'miles', 'vert_ft', 'tss'].includes(item.measure as string) ? (item.measure as VolumeMeasure) : undefined;
    const pace = ['ascent', 'descent', 'flat', 'units'].includes(item.pace as string) ? (item.pace as PaceParam) : undefined;
    const duration = [300, 1200, 3600].includes(item.duration_seconds as number) ? (item.duration_seconds as 300 | 1200 | 3600) : undefined;
    if ((kind === 'weekly_volume' || kind === 'long_effort') && !measure) continue;
    if (kind === 'travel_pace' && !pace) continue;
    if (kind === 'best_power' && !duration) continue;
    const sports = Array.isArray(item.sports) ? (item.sports.filter((s): s is SportType => SPORT_KEYS.includes(s as SportType))) : [];
    const range = TARGET_RANGE[`${kind}:${kind === 'weekly_volume' || kind === 'long_effort' ? measure : kind === 'travel_pace' ? pace : '*'}`];
    const target = range ? clampNum(item.target, range[0], range[1]) : undefined;
    const name = str(item.name, 60);
    if (target === undefined || !name) continue;
    let targetDate = typeof item.target_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.target_date) ? item.target_date : lastDate;
    if (targetDate > lastDate) targetDate = lastDate;
    if (targetDate <= today) targetDate = lastDate;
    const base: TrackingMetric = {
      id: '', name, why: str(item.why, 220), kind, ...(measure && (kind === 'weekly_volume' || kind === 'long_effort') ? { measure } : {}),
      ...(sports.length ? { sports } : {}), ...(kind === 'best_power' ? { duration_seconds: duration } : {}),
      ...(kind === 'travel_pace' ? { pace } : {}), target: roundTo(target, 2), target_date: targetDate,
    };
    base.id = stableId(goal.id, base);
    if (seen.has(base.id)) continue;
    seen.add(base.id);
    out.push(base);
    if (out.length >= MAX_METRICS) break;
  }
  return out;
}

/** Fixes each metric's starting point at today's value, so progress is measured from where the athlete is now. */
export function withBaselines(metrics: TrackingMetric[], ctx: MetricContext): TrackingMetric[] {
  const today = ctx.today ?? getLocalDateString();
  return metrics.map((m) => {
    const e = evaluateMetric({ ...m, start_value: undefined, start_date: undefined }, ctx);
    return { ...m, start_value: e.current !== undefined ? roundTo(e.current, 2) : 0, start_date: today };
  });
}

/**
 * Where the athlete stands on each measurable thing right now, so the coach sets targets that are realistic. Only
 * things with data appear; null or missing means "no data, do not propose a metric of that kind".
 */
export function metricMenu(ctx: MetricContext) {
  const today = ctx.today ?? getLocalDateString();
  const sportsWithData = SPORT_KEYS.filter((s) => ctx.activities.some((a) => a.sport_type === s && !isEbike(a)));
  const groups: { label: string; sports?: SportType[] }[] = [{ label: 'all sports' }, ...sportsWithData.map((s) => ({ label: s, sports: [s] }))];
  const volume = groups.map((g) => {
    const row: Record<string, unknown> = { sports: g.label };
    for (const measure of ['hours', 'miles', 'vert_ft', 'tss'] as VolumeMeasure[]) {
      const m: TrackingMetric = { id: 'x', name: 'x', why: '', kind: 'weekly_volume', measure, sports: g.sports, target: 1, target_date: today };
      const e = evaluateMetric(m, ctx);
      const weekly = e.series.filter((p) => p.week < getWeekStartDate(today)).map((p) => p.value ?? 0);
      row[`${measure}_per_week_avg_last_4_weeks`] = e.current !== undefined ? roundTo(e.current, 1) : null;
      row[`${measure}_per_week_best_of_last_11_weeks`] = weekly.length ? roundTo(Math.max(...weekly), 1) : null;
    }
    return row;
  }).filter((r) => (r.hours_per_week_avg_last_4_weeks as number | null) !== null);
  const longest = groups.map((g) => {
    const row: Record<string, unknown> = { sports: g.label };
    for (const measure of ['hours', 'miles', 'vert_ft'] as VolumeMeasure[]) {
      const m: TrackingMetric = { id: 'x', name: 'x', why: '', kind: 'long_effort', measure, sports: g.sports, target: 1, target_date: today };
      const v = metricValueAt(m, today, ctx);
      row[`longest_single_activity_${measure}_last_28_days`] = v !== undefined ? roundTo(v, 1) : null;
    }
    return row;
  }).filter((r) => r['longest_single_activity_hours_last_28_days'] !== null);
  const power: Record<string, number | null> = {};
  for (const d of [300, 1200, 3600] as const) {
    const m: TrackingMetric = { id: 'x', name: 'x', why: '', kind: 'best_power', duration_seconds: d, target: 1, target_date: today };
    const v = metricValueAt(m, today, ctx);
    power[`best_${d / 60}_min_watts_last_42_days`] = v !== undefined ? Math.round(v) : null;
  }
  const pace: Record<string, unknown>[] = [];
  for (const s of (['weighted_hiking', 'skimo', 'backcountry_skiing'] as SportType[]).filter((x) => sportsWithData.includes(x))) {
    const row: Record<string, unknown> = { sport: s };
    let any = false;
    for (const p of ['ascent', 'descent', 'flat', 'units'] as PaceParam[]) {
      const v = metricValueAt({ id: 'x', name: 'x', why: '', kind: 'travel_pace', pace: p, sports: [s], target: 1, target_date: today }, today, ctx);
      row[`${p}_${metricUnit({ kind: 'travel_pace', pace: p }).replace('/', '_per_')}`] = v !== undefined ? roundTo(v, 1) : null;
      if (v !== undefined) any = true;
    }
    if (any) pace.push(row);
  }
  const ctl = metricValueAt({ id: 'x', name: 'x', why: '', kind: 'fitness_ctl', target: 1, target_date: today }, today, ctx);
  const adherence = metricValueAt({ id: 'x', name: 'x', why: '', kind: 'plan_adherence', target: 1, target_date: today }, today, ctx);
  return {
    weekly_volume_by_sport: volume,
    longest_single_activity_by_sport: longest,
    best_power_last_42_days: Object.values(power).some((v) => v !== null) ? power : 'no power-meter data',
    travel_pace_median_last_42_days: pace.length ? pace : 'no estimated travel pace yet',
    fitness_ctl_now: ctl !== undefined ? roundTo(ctl, 1) : null,
    plan_adherence_percent_last_28_days: adherence !== undefined ? Math.round(adherence) : 'no planned sessions',
  };
}
