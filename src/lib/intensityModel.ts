/**
 * A learned estimate of how hard an activity was, for activities without power.
 *
 * It learns from two kinds of activity the athlete already has:
 *  - rides with a power meter, where the true intensity is known. The model sees only what a heart-rate-only
 *    activity would have (heart rate, speed, climbing, duration, pack weight...), so it learns to estimate
 *    intensity without power, and can be scored against the truth;
 *  - activities the AI has estimated, which teach it to imitate the AI where power can't (hikes, e-bike rides).
 *
 * It is a regularised linear model on a handful of scale-free features, fitted in the browser in milliseconds.
 * Before it is used it is scored on activities it was not trained on and compared with the formulas it would
 * replace; it only takes over for kinds of activity where it measurably does better, and says how big its error is.
 */
import type { Activity } from '../types';
import { isEbike } from './tags';
import { baselineTss, heartRateTss, tssFromIntensity, type LoadProfile } from './trainingMath';
import { setActiveIntensityModel, type ActiveIntensityModel, type LearnedPrediction } from './learnedIntensity';

// ── Tunables ──────────────────────────────────────────────────────────────────────────────────────────────────
export const MIN_TRAINING_ROWS = 30;
const MIN_GROUP_ROWS = 10;
const MIN_EBIKE_ROWS = 15;
/** The model must cut the typical error by at least this much to replace the formulas for a group. */
const REQUIRED_IMPROVEMENT = 0.1;
const POWER_WEIGHT = 1;
/** AI estimates are themselves guesses, so they count for less than measured power. */
const AI_WEIGHT = 0.6;
const MIN_HOURS = 0.25;
const IF_MIN = 0.25;
const IF_MAX = 1.2;
const FOLDS = 5;
const LAMBDAS = [0.3, 1, 3, 10, 30, 100];
/** Beyond this many standard deviations from the training data a feature is "outside what the model has seen". */
const MAX_Z = 4;

const SPORTS = ['cycling', 'zwift', 'skimo', 'backcountry_skiing', 'resort_skiing', 'scrambling', 'weighted_hiking'] as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const hoursOf = (a: Activity) => (a.moving_time_seconds || a.duration_seconds || 0) / 3600;

/** Assist level an e-bike rider mentions in their notes (Bosch: eco/tour/sport/turbo; Shimano: eco/trail/boost). */
export function assistLevel(a: Activity): number | null {
  const text = `${a.effort_notes ?? ''} ${a.gear_notes ?? ''} ${(a.tags ?? []).join(' ')}`.toLowerCase();
  if (/\b(turbo|boost)\b/.test(text)) return 1;
  if (/\bsport\s*(mode|assist)\b|\bemtb\s*sport\b/.test(text)) return 0.75;
  if (/\b(tour|trail)\s*(mode|assist)?\b/.test(text) && /assist|mode|ebike|e-bike|motor|battery/.test(text)) return 0.5;
  if (/\beco\b/.test(text)) return 0.25;
  return null;
}

// ── Features ──────────────────────────────────────────────────────────────────────────────────────────────────
export const FEATURE_NAMES = [
  'heart rate vs threshold', 'heart rate vs threshold, squared', 'zone-based heart-rate intensity', 'peak heart rate vs threshold', 'has heart rate',
  'speed', 'grade', 'climb rate', 'log duration', 'pack weight vs body weight', 'effort rating', 'has effort rating',
  'rough formula intensity', 'e-bike',
  'e-bike x heart rate', 'e-bike x speed', 'e-bike x grade', 'e-bike x log duration', 'e-bike assist level', 'has assist level',
  ...SPORTS.map((s) => `sport: ${s}`),
] as const;

/**
 * Features that don't depend on power: nothing here may leak the answer for rides that have a power meter.
 * Null when the activity has no usable duration.
 */
export function extractFeatures(a: Activity, profile?: LoadProfile): number[] | null {
  const hours = hoursOf(a);
  if (!(hours > 0)) return null;
  const lthr = profile?.lthr ?? 0;
  const km = (a.distance_meters || 0) / 1000;
  const gain = a.total_elevation_gain_m || 0;
  const speed = km / hours;
  const grade = km > 0.5 ? clamp(gain / (km * 1000), 0, 0.3) : 0;
  const climbRate = clamp(gain / hours, 0, 2500);
  const logHours = Math.log(Math.max(hours, 0.1));

  // Heart rate counts if there is an average or time-in-zone data; the zone-based formula is a feature too
  const hrFormula = lthr > 0 ? heartRateTss(a, lthr)?.intensityFactor ?? 0 : 0;
  const hasHr = lthr > 0 && ((a.avg_hr || 0) > 0 || hrFormula > 0) ? 1 : 0;
  const hrRatio = hasHr ? clamp((a.avg_hr || 0) > 0 ? a.avg_hr! / lthr : hrFormula, 0.4, 1.3) : 0;
  const peakRatio = hasHr && (a.max_hr || 0) > 0 ? clamp(a.max_hr! / lthr, 0.6, 1.5) : 0;

  const rpe = (a.perceived_exertion || 0) > 0 ? a.perceived_exertion! / 10 : 0;
  const pack = a.pack_weight_kg && profile?.weight_kg ? clamp(a.pack_weight_kg / profile.weight_kg, 0, 0.5) : 0;
  const rough = baselineTss(a, profile?.weight_kg)?.intensityFactor ?? 0.55;

  const ebike = isEbike(a) ? 1 : 0;
  const assist = ebike ? assistLevel(a) : null;
  const sport = SPORTS.map((s) => (a.sport_type === s ? 1 : 0));

  return [
    hrRatio, hrRatio * hrRatio, hasHr ? hrFormula : 0, peakRatio, hasHr,
    speed / 20, grade * 10, climbRate / 500, logHours, pack * 5, rpe, rpe > 0 ? 1 : 0,
    rough, ebike,
    ebike * hrRatio, ebike * (speed / 20), ebike * grade * 10, ebike * logHours, assist ?? 0, assist === null || !ebike ? 0 : 1,
    ...sport,
  ];
}

// ── Training data ─────────────────────────────────────────────────────────────────────────────────────────────
export type LabelKind = 'power' | 'ai';

export interface TrainingRow {
  id: string;
  x: number[];
  y: number;
  weight: number;
  kind: LabelKind;
  ebike: boolean;
  sport: string;
  /** What the existing formulas (heart rate, then rough baseline) would have said, for comparison */
  formulaIf: number;
}

/** What the current formulas give when there is no power and no AI estimate: the thing the model must beat. */
function formulaIntensity(a: Activity, profile?: LoadProfile): number {
  return heartRateTss(a, profile?.lthr ?? 0)?.intensityFactor ?? baselineTss(a, profile?.weight_kg)?.intensityFactor ?? 0.55;
}

export function buildTrainingRows(activities: Activity[], profile?: LoadProfile): TrainingRow[] {
  const rows: TrainingRow[] = [];
  const ftp = profile?.ftp ?? 0;
  for (const a of activities) {
    const hours = hoursOf(a);
    if (hours < MIN_HOURS) continue;

    const ebike = isEbike(a);
    // Power rides: the true intensity. E-bike power is not the athlete's own effort, so it doesn't count.
    let truth: number | undefined;
    if (!ebike) {
      if ((a.training_stress_score || 0) > 0 && (a.intensity_factor || 0) > 0) truth = a.intensity_factor;
      else if ((a.normalized_power || 0) > 0 && ftp > 0) truth = a.normalized_power! / ftp;
    }
    let kind: LabelKind | undefined;
    let y: number | undefined;
    if (truth !== undefined && truth >= IF_MIN && truth <= 1.3) {
      kind = 'power';
      y = truth;
    } else if (!((a.normalized_power || 0) > 0) && a.tss_source === 'ai' && (a.estimated_if || 0) >= IF_MIN && a.estimated_if! <= 1.3) {
      kind = 'ai';
      y = a.estimated_if;
    }
    if (!kind || y === undefined) continue;

    const x = extractFeatures(a, profile);
    if (!x) continue;
    rows.push({
      id: a.id, x, y, kind, ebike, sport: a.sport_type,
      weight: kind === 'power' ? POWER_WEIGHT : AI_WEIGHT,
      formulaIf: formulaIntensity(a, profile),
    });
  }
  return rows;
}

// ── Ridge regression ──────────────────────────────────────────────────────────────────────────────────────────
interface Scaler {
  mean: number[];
  std: number[];
}

function fitScaler(rows: TrainingRow[]): Scaler {
  const p = rows[0].x.length;
  const mean = new Array<number>(p).fill(0);
  const std = new Array<number>(p).fill(1);
  for (let j = 0; j < p; j++) {
    let sum = 0;
    for (const r of rows) sum += r.x[j];
    mean[j] = sum / rows.length;
    let sq = 0;
    for (const r of rows) sq += (r.x[j] - mean[j]) ** 2;
    const sd = Math.sqrt(sq / rows.length);
    std[j] = sd > 1e-9 ? sd : 1;
  }
  return { mean, std };
}

const standardize = (x: number[], s: Scaler) => x.map((v, j) => (v - s.mean[j]) / s.std[j]);

/** Solves A v = b by Gaussian elimination with partial pivoting. A is small (about 30 x 30). */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const d = M[col][col];
    if (Math.abs(d) < 1e-12) continue;
    for (let c = col; c <= n; c++) M[col][c] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

interface Fit {
  scaler: Scaler;
  /** [intercept, ...one per feature] */
  beta: number[];
}

function fit(rows: TrainingRow[], lambda: number): Fit {
  const scaler = fitScaler(rows);
  const p = rows[0].x.length + 1;
  const XtWX = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const XtWy = new Array<number>(p).fill(0);
  for (const r of rows) {
    const z = [1, ...standardize(r.x, scaler)];
    for (let i = 0; i < p; i++) {
      XtWy[i] += r.weight * z[i] * r.y;
      for (let j = 0; j < p; j++) XtWX[i][j] += r.weight * z[i] * z[j];
    }
  }
  // Ridge penalty on every coefficient except the intercept
  for (let i = 1; i < p; i++) XtWX[i][i] += lambda;
  return { scaler, beta: solve(XtWX, XtWy) };
}

function predictFit(f: Fit, x: number[]): number {
  const z = standardize(x, f.scaler);
  let out = f.beta[0];
  for (let j = 0; j < z.length; j++) out += f.beta[j + 1] * z[j];
  return clamp(out, IF_MIN, IF_MAX);
}

/** Deterministic shuffle so the same data always gives the same scores. */
function foldAssignment(n: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  let seed = 1234567;
  for (let i = n - 1; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const folds = new Array<number>(n);
  order.forEach((rowIndex, k) => { folds[rowIndex] = k % FOLDS; });
  return folds;
}

/**
 * Predictions for every row from models that never saw that row (k-fold cross-validation), alongside what simply
 * guessing the average of the training rows would have said: a model that can't beat that has learned nothing.
 */
function crossValidate(rows: TrainingRow[], lambda: number): { model: number[]; average: number[] } {
  const folds = foldAssignment(rows.length);
  const model = new Array<number>(rows.length).fill(0);
  const average = new Array<number>(rows.length).fill(0);
  for (let k = 0; k < FOLDS; k++) {
    const train = rows.filter((_, i) => folds[i] !== k);
    if (train.length < 5) continue;
    const totalWeight = train.reduce((s, r) => s + r.weight, 0);
    const mean = train.reduce((s, r) => s + r.weight * r.y, 0) / totalWeight;
    const f = fit(train, lambda);
    rows.forEach((r, i) => {
      if (folds[i] !== k) return;
      model[i] = predictFit(f, r.x);
      average[i] = mean;
    });
  }
  return { model, average };
}

const mae = (pairs: [number, number][]) => (pairs.length ? pairs.reduce((s, [a, b]) => s + Math.abs(a - b), 0) / pairs.length : NaN);
const rmse = (pairs: [number, number][]) => (pairs.length ? Math.sqrt(pairs.reduce((s, [a, b]) => s + (a - b) ** 2, 0) / pairs.length) : NaN);

// ── Scoring and the public model ──────────────────────────────────────────────────────────────────────────────
export interface GroupScore {
  rows: number;
  /** Typical error of the model on activities it had not seen, in intensity-factor units */
  modelError: number;
  /** Typical error of the existing formulas on the same activities */
  formulaError: number;
  /** Typical error of just guessing the average intensity: the model must be clearly better than this too */
  averageError: number;
  /** Spread of the model's errors, used for the range shown with a prediction */
  sigma: number;
  /** True when the model beats the formulas by enough to be used for this group */
  trusted: boolean;
}

export interface ModelSummary {
  status: 'ready' | 'not-enough-data' | 'no-better-than-formulas';
  /** Why the model is or isn't in use, in a sentence */
  message: string;
  powerRows: number;
  aiRows: number;
  /** How well the model recovers true power-based intensity (the honest accuracy check) */
  vsPower?: GroupScore;
  /** How closely the model reproduces the AI's estimates */
  vsAi?: GroupScore;
  ebike?: GroupScore;
  /** Groups the model is trusted for */
  trustedFor: string[];
}

export interface TrainedIntensityModel extends ActiveIntensityModel {
  summary: ModelSummary;
}

function score(rows: TrainingRow[], predictions: number[], averages: number[]): GroupScore | undefined {
  if (rows.length === 0) return undefined;
  const modelPairs = rows.map((r, i) => [predictions[i], r.y] as [number, number]);
  const formulaPairs = rows.map((r) => [r.formulaIf, r.y] as [number, number]);
  const averagePairs = rows.map((r, i) => [averages[i], r.y] as [number, number]);
  const modelError = mae(modelPairs);
  const formulaError = mae(formulaPairs);
  const averageError = mae(averagePairs);
  return {
    rows: rows.length,
    modelError,
    formulaError,
    averageError,
    sigma: rmse(modelPairs),
    trusted: rows.length >= MIN_GROUP_ROWS && modelError <= Math.min(formulaError, averageError) * (1 - REQUIRED_IMPROVEMENT),
  };
}

const none: TrainedIntensityModel = {
  predict: () => undefined,
  summary: { status: 'not-enough-data', message: '', powerRows: 0, aiRows: 0, trustedFor: [] },
};

/**
 * Fits and scores the model on the athlete's activities. Always returns something safe to use: when there is too
 * little data, or the model doesn't beat the existing formulas, its predictions are simply empty.
 */
export function trainIntensityModel(activities: Activity[], profile?: LoadProfile): TrainedIntensityModel {
  const rows = buildTrainingRows(activities, profile);
  const powerRows = rows.filter((r) => r.kind === 'power').length;
  const aiRows = rows.length - powerRows;
  const base: ModelSummary = { status: 'not-enough-data', message: '', powerRows, aiRows, trustedFor: [] };

  if (rows.length < MIN_TRAINING_ROWS) {
    return {
      ...none,
      summary: {
        ...base,
        message: `Needs at least ${MIN_TRAINING_ROWS} activities with a measured or AI-estimated load to learn from; you have ${rows.length}. Rides with a power meter and AI estimates both count.`,
      },
    };
  }

  // Pick the regularisation strength that predicts held-out activities best
  let best = { lambda: LAMBDAS[0], error: Infinity, cv: { model: [] as number[], average: [] as number[] } };
  for (const lambda of LAMBDAS) {
    const cv = crossValidate(rows, lambda);
    const error = mae(rows.map((r, i) => [cv.model[i], r.y] as [number, number]));
    if (error < best.error) best = { lambda, error, cv };
  }
  const cv = best.cv;

  const idx = (pred: (r: TrainingRow) => boolean) => rows.map((r, i) => (pred(r) ? i : -1)).filter((i) => i >= 0);
  const scoreOf = (pred: (r: TrainingRow) => boolean) => {
    const ids = idx(pred);
    return score(ids.map((i) => rows[i]), ids.map((i) => cv.model[i]), ids.map((i) => cv.average[i]));
  };
  const vsPower = scoreOf((r) => r.kind === 'power');
  const vsAi = scoreOf((r) => r.kind === 'ai');
  const ebike = scoreOf((r) => r.ebike);
  const overall = scoreOf(() => true)!;
  const bySport = new Map<string, GroupScore>();
  for (const sport of SPORTS) {
    const s = scoreOf((r) => r.sport === sport && !r.ebike);
    if (s) bySport.set(sport, s);
  }

  // Where the model may be used: non-e-bike sports it beat the formulas on, and e-bike rides if it learned them well
  const trustedSports = new Set([...bySport.entries()].filter(([, s]) => s.trusted).map(([sport]) => sport));
  const ebikeTrusted = Boolean(ebike && ebike.rows >= MIN_EBIKE_ROWS && ebike.trusted);
  const trustedFor = [...trustedSports, ...(ebikeTrusted ? ['e-bike'] : [])];

  const summary: ModelSummary = { ...base, vsPower, vsAi, ebike, trustedFor, status: 'ready', message: '' };
  if (trustedFor.length === 0) {
    summary.status = 'no-better-than-formulas';
    summary.message = `Learned from ${rows.length} activities, but it was not clearly better than the built-in formulas (typical error ${overall.modelError.toFixed(2)} vs ${overall.formulaError.toFixed(2)}) or than just guessing the average (${overall.averageError.toFixed(2)}), so it is not being used yet. It is re-checked as you add more.`;
    return { ...none, summary };
  }
  summary.message = `Learned from ${rows.length} activities. Used for ${trustedFor.map((t) => t.replace(/_/g, ' ')).join(', ')}.`;

  // Final model on all the data
  const final = fit(rows, best.lambda);
  const scaler = final.scaler;
  const sigmaFor = (ebikeRide: boolean) => (ebikeRide ? ebike?.sigma : undefined) ?? overall.sigma;
  const cache = new WeakMap<Activity, { lthr: number; weight: number; ftp: number; result: LearnedPrediction | undefined }>();

  return {
    summary,
    predict(activity, p) {
      const lthr = p?.lthr ?? 0;
      const weight = p?.weight_kg ?? 0;
      const ftp = p?.ftp ?? 0;
      const cached = cache.get(activity);
      if (cached && cached.lthr === lthr && cached.weight === weight && cached.ftp === ftp) return cached.result;

      let result: LearnedPrediction | undefined;
      const ebikeRide = isEbike(activity);
      const allowed = ebikeRide ? ebikeTrusted : trustedSports.has(activity.sport_type);
      const x = allowed ? extractFeatures(activity, { lthr, weight_kg: weight, ftp }) : null;
      if (x) {
        const inRange = x.every((v, j) => Math.abs((v - scaler.mean[j]) / scaler.std[j]) <= MAX_Z);
        if (inRange) result = { intensityFactor: predictFit(final, x), sigma: sigmaFor(ebikeRide) };
      }
      cache.set(activity, { lthr, weight, ftp, result });
      return result;
    },
  };
}

/** Trains the model and makes it the one `resolveTss` consults. */
export function installIntensityModel(activities: Activity[], profile?: LoadProfile): ModelSummary {
  const model = trainIntensityModel(activities, profile);
  setActiveIntensityModel(model);
  return model.summary;
}

/** Typical range of the activity's TSS for a learned prediction, from its intensity-factor error. */
export function tssRange(activity: Activity, intensityFactor: number, sigma: number): [number, number] {
  const hours = hoursOf(activity);
  return [
    tssFromIntensity(hours, Math.max(IF_MIN, intensityFactor - 1.64 * sigma)),
    tssFromIntensity(hours, Math.min(IF_MAX, intensityFactor + 1.64 * sigma)),
  ];
}
