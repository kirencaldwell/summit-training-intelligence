import type { MetricStreamPoint, SportType } from '../types';
import { maxGapSeconds } from './streamSummary';

/** The sports the Munter travel parameters make sense for (how fast you climb, descend and cover flat ground on foot or skis). */
export const MUNTER_SPORTS: SportType[] = ['weighted_hiking', 'skimo', 'backcountry_skiing'];
export const isMunterSport = (sport: SportType) => MUNTER_SPORTS.includes(sport);

/** Bumped when the estimation changes, so stored values from an older version are recomputed. */
export const MUNTER_VERSION = 1;

export interface MunterParams {
  v: number;
  /** Climbing rate on ascending ground, metres of height gained per moving hour */
  ascent_mh?: number;
  /** Descending rate on descending ground, metres lost per moving hour */
  descent_mh?: number;
  /** Speed on flat ground, km/h */
  flat_kmh?: number;
  /** Munter effort units per moving hour: (km + height gained / 100 m) / hours. About 4 is a typical planning pace */
  effort_units_per_hour?: number;
  /** Best 30 minutes of climbing, metres per hour (needs a 40 min+ activity) */
  best_30min_climb_mh?: number;
  /** The same figures with breaks left in (a Munter pace includes them): height or distance over moving AND stopped time */
  ascent_mh_with_breaks?: number;
  descent_mh_with_breaks?: number;
  flat_kmh_with_breaks?: number;
  effort_units_per_hour_with_breaks?: number;
  /** Moving minutes behind each figure, so thin evidence can be told apart */
  up_minutes: number;
  down_minutes: number;
  flat_minutes: number;
  moving_minutes: number;
  /** Minutes standing still (breaks, waiting, stops for photos), and so the share of tracked time stopped */
  stopped_minutes?: number;
  stopped_percent?: number;
  /** Individual breaks of a minute or more, in minutes (longest first, at most 30) */
  breaks_min?: number[];
}

// Ground steeper than this counts as ascending/descending; between the limits is rolling terrain, left out of the rates
const UP_GRADE = 0.08;
const DOWN_GRADE = -0.08;
const FLAT_GRADE = 0.05;
const MOVING_KMH = 1;
const BLOCK_SECONDS = 60;
const MIN_UP_SECONDS = 600;
const MIN_DOWN_SECONDS = 300;
const MIN_FLAT_SECONDS = 300;

const toRad = (d: number) => (d * Math.PI) / 180;
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

/** Altitude averaged over a window centred on each sample (by time), to take the jitter out of GPS/barometer altitude. */
function smoothAltitude(points: MetricStreamPoint[], windowSeconds: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(points.length);
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < points.length; i++) {
    while (lo < i && points[i].time - points[lo].time > windowSeconds / 2) lo++;
    while (hi < points.length - 1 && points[hi + 1].time - points[i].time <= windowSeconds / 2) hi++;
    let sum = 0;
    let n = 0;
    for (let j = lo; j <= hi; j++) {
      const a = points[j].alt;
      if (typeof a === 'number' && Number.isFinite(a)) { sum += a; n++; }
    }
    out[i] = n > 0 ? sum / n : undefined;
  }
  return out;
}

/**
 * Estimate Munter travel parameters from a recorded track. Only moving time counts. The track is cut into
 * one-minute blocks, each classed by its average grade as climbing, descending or flat; each parameter is
 * the total height or distance in those blocks over the moving time spent in them. Works from speed when the
 * recording has it, else from the GPS positions. Returns undefined when there is no usable altitude and
 * distance, or the activity is too short to say anything.
 */
export function estimateMunter(points: MetricStreamPoint[] | undefined): MunterParams | undefined {
  if (!points || points.length < 10) return undefined;
  const pts = points
    .filter((p) => typeof p.time === 'number' && Number.isFinite(p.time) && p.time >= 0)
    .sort((a, b) => a.time - b.time);
  if (pts.length < 10 || pts[pts.length - 1].time > 4 * 24 * 3600) return undefined;
  const maxGap = maxGapSeconds(pts.map((p) => p.time));
  const alt = smoothAltitude(pts, 45);

  interface Block { seconds: number; km: number; dz: number; stop: number }
  const blocks: Block[] = [];
  let cur: Block = { seconds: 0, km: 0, dz: 0, stop: 0 };
  let moving = 0;
  let stopped = 0;
  let run = 0; // length of the stop in progress, seconds
  const breaks: number[] = [];
  // A break belongs to the ground just travelled. Blocks never span a break: the block in progress is closed
  // when a break starts (a sliver is folded into the previous block), and the stop is charged to that block.
  const addStop = (seconds: number) => {
    if (cur.seconds > 0) {
      const prev = blocks[blocks.length - 1];
      if (cur.seconds < 20 && prev) {
        prev.seconds += cur.seconds;
        prev.km += cur.km;
        prev.dz += cur.dz;
      } else {
        blocks.push(cur);
      }
      cur = { seconds: 0, km: 0, dz: 0, stop: 0 };
    }
    if (blocks.length > 0) blocks[blocks.length - 1].stop += seconds;
  };
  const closeRun = () => {
    if (run >= 60) breaks.push(Math.round((run / 60) * 10) / 10);
    run = 0;
  };
  let totalKm = 0;
  let totalGain = 0;

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dt = b.time - a.time;
    if (dt <= 0) continue;
    if (dt > maxGap) {
      // A long gap with the position unchanged is a paused timer (a break); with movement it is a recording dropout
      const placed = [a.lat, a.lng, b.lat, b.lng].every((v) => typeof v === 'number');
      if (dt >= 60 && (!placed || haversineKm(a.lat!, a.lng!, b.lat!, b.lng!) < 0.1)) {
        stopped += dt;
        run += dt;
        addStop(dt);
      } else {
        closeRun();
      }
      continue;
    }
    let km: number | undefined;
    if (typeof a.speed === 'number' && typeof b.speed === 'number') km = (((a.speed + b.speed) / 2) * dt) / 3600;
    else if ([a.lat, a.lng, b.lat, b.lng].every((v) => typeof v === 'number')) km = haversineKm(a.lat!, a.lng!, b.lat!, b.lng!);
    const za = alt[i];
    const zb = alt[i + 1];
    if (km === undefined || za === undefined || zb === undefined) continue;
    if ((km / dt) * 3600 < MOVING_KMH) { // stopped
      stopped += dt;
      run += dt;
      addStop(dt);
      continue;
    }
    closeRun();
    cur.seconds += dt;
    cur.km += km;
    cur.dz += zb - za;
    moving += dt;
    totalKm += km;
    if (zb > za) totalGain += zb - za;
    if (cur.seconds >= BLOCK_SECONDS) {
      blocks.push(cur);
      cur = { seconds: 0, km: 0, dz: 0, stop: 0 };
    }
  }
  closeRun();
  if (cur.seconds >= BLOCK_SECONDS / 2) blocks.push(cur);
  if (moving < 20 * 60 || blocks.length < 10) return undefined;

  const sum = { up: { s: 0, stop: 0, dz: 0 }, down: { s: 0, stop: 0, dz: 0 }, flat: { s: 0, stop: 0, km: 0 } };
  for (const b of blocks) {
    const grade = b.km > 0 ? b.dz / (b.km * 1000) : 0;
    if (grade >= UP_GRADE) { sum.up.s += b.seconds; sum.up.stop += b.stop; sum.up.dz += b.dz; }
    else if (grade <= DOWN_GRADE) { sum.down.s += b.seconds; sum.down.stop += b.stop; sum.down.dz += -b.dz; }
    else if (Math.abs(grade) < FLAT_GRADE) { sum.flat.s += b.seconds; sum.flat.stop += b.stop; sum.flat.km += b.km; }
  }

  const params: MunterParams = {
    v: MUNTER_VERSION,
    up_minutes: Math.round(sum.up.s / 60),
    down_minutes: Math.round(sum.down.s / 60),
    flat_minutes: Math.round(sum.flat.s / 60),
    moving_minutes: Math.round(moving / 60),
    stopped_minutes: Math.round(stopped / 60),
    stopped_percent: Math.round((stopped / (moving + stopped)) * 1000) / 10,
    breaks_min: breaks.sort((x, y) => y - x).slice(0, 30),
  };
  const perHour = (amount: number, seconds: number) => amount / (seconds / 3600);
  if (sum.up.s >= MIN_UP_SECONDS) {
    params.ascent_mh = Math.round(perHour(sum.up.dz, sum.up.s));
    params.ascent_mh_with_breaks = Math.round(perHour(sum.up.dz, sum.up.s + sum.up.stop));
  }
  if (sum.down.s >= MIN_DOWN_SECONDS) {
    params.descent_mh = Math.round(perHour(sum.down.dz, sum.down.s));
    params.descent_mh_with_breaks = Math.round(perHour(sum.down.dz, sum.down.s + sum.down.stop));
  }
  if (sum.flat.s >= MIN_FLAT_SECONDS) {
    params.flat_kmh = Math.round(perHour(sum.flat.km, sum.flat.s) * 10) / 10;
    params.flat_kmh_with_breaks = Math.round(perHour(sum.flat.km, sum.flat.s + sum.flat.stop) * 10) / 10;
  }
  const effort = totalKm + totalGain / 100;
  params.effort_units_per_hour = Math.round(perHour(effort, moving) * 10) / 10;
  params.effort_units_per_hour_with_breaks = Math.round(perHour(effort, moving + stopped) * 10) / 10;

  // Best sustained 30 minutes of climbing: the biggest height gain across any 30-minute stretch of elapsed time
  const span = pts[pts.length - 1].time - pts[0].time;
  if (span >= 40 * 60) {
    let best = 0;
    let j = 0;
    for (let i = 0; i < pts.length; i++) {
      const zi = alt[i];
      if (zi === undefined) continue;
      while (j < pts.length - 1 && pts[j].time - pts[i].time < 30 * 60) j++;
      if (pts[j].time - pts[i].time < 29 * 60) break;
      const zj = alt[j];
      if (zj !== undefined && zj - zi > best) best = zj - zi;
    }
    if (best > 0) params.best_30min_climb_mh = Math.round(best * 2);
  }
  return params;
}

export interface Spread { n: number; min: number; p25: number; median: number; p75: number; max: number }

export function spread(values: number[]): Spread | undefined {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return undefined;
  const at = (q: number) => {
    const pos = (xs.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo);
  };
  return { n: xs.length, min: xs[0], p25: at(0.25), median: at(0.5), p75: at(0.75), max: xs[xs.length - 1] };
}
