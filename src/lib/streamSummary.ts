import type { MetricStreamPoint } from '../types';

export interface StreamSummaryOptions {
  ftp?: number;
  lthr?: number;
  maxHr?: number;
  ebike?: boolean;
}

const MAX_GAP_S = 10;
const MAX_TIMELINE_POINTS = 48;
const MAX_LISTED = 6;
const round = (n: number, d = 0) => { const f = 10 ** d; return Math.round(n * f) / f; };
const KMH_TO_MPH = 0.621371;
const M_TO_FT = 3.28084;

export interface RunInfo { start_min: number; duration_min: number; avg_watts?: number; percent_ftp?: number; avg_hr?: number; avg_mph?: number }
export interface BlockInfo extends RunInfo { role: 'hard' | 'easy' | 'step_up' | 'step_down' }
export interface SurgeInfo { start_min: number; seconds: number; peak_5s_watts: number }
export interface DistributionBin { watts: string; percent_ftp?: string; minutes: number; percent_of_ride: number }
export interface StreamSummary {
  sample_note: string;
  elapsed_minutes: number;
  timeline: Record<string, number>[];
  best_power_watts?: Record<string, number>;
  power_distribution?: {
    note: string;
    coasting_minutes: number;
    percentiles_watts_while_pedalling: Record<string, number>;
    bins: DistributionBin[];
  };
  block_structure?: { criteria: string; blocks: BlockInfo[]; trend?: string };
  sustained_power_efforts?: { criteria: string; efforts: RunInfo[] };
  power_surges?: { criteria: string; surges: SurgeInfo[] };
  high_heart_rate_periods?: { criteria: string; periods: RunInfo[] };
  ebike_note?: string;
}

export interface CurvePoint { seconds: number; watts: number; start: number }
const CURVE_DURATIONS = [1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 300, 420, 600, 900, 1200, 1800, 2400, 3600, 5400, 7200];

/** Median seconds between recorded samples; saved rides are thinned to ~500 samples, so this grows with ride length. */
export function sampleSpacingSeconds(points: MetricStreamPoint[] | undefined): number {
  if (!points || points.length < 2) return 1;
  const times = points.map((p) => p.time).filter((t) => typeof t === 'number').sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) if (times[i] > times[i - 1]) gaps.push(times[i] - times[i - 1]);
  if (gaps.length === 0) return 1;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

/** Best average power for each duration, and the second of the ride where that best effort started. */
export function powerCurve(points: MetricStreamPoint[] | undefined): CurvePoint[] {
  if (!points || points.length < 2) return [];
  const secs = toSeconds(points);
  const n = secs.length;
  const prefix = new Float64Array(n + 1);
  const cnt = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) {
    const v = secs[i]?.w;
    prefix[i + 1] = prefix[i] + (v ?? 0);
    cnt[i + 1] = cnt[i] + (v !== undefined ? 1 : 0);
  }
  const out: CurvePoint[] = [];
  // Windows shorter than a couple of sample spacings would just be single samples, not real averages
  const minDuration = sampleSpacingSeconds(points) * 2;
  for (const d of CURVE_DURATIONS) {
    if (d > n) break;
    if (d < minDuration) continue;
    let best = -1;
    let at = 0;
    for (let i = 0; i + d <= n; i++) {
      if (cnt[i + d] - cnt[i] < d * 0.95) continue; // skip windows with recording gaps
      const avg = (prefix[i + d] - prefix[i]) / d;
      if (avg > best) { best = avg; at = i; }
    }
    if (best > 0) out.push({ seconds: d, watts: Math.round(best), start: at });
  }
  return out;
}

export interface SelectionStats {
  seconds: number;
  avg_watts?: number;
  max_watts?: number;
  normalized_watts?: number;
  percent_ftp?: number;
  avg_hr?: number;
  max_hr?: number;
  avg_cadence?: number;
  avg_mph?: number;
  miles?: number;
  gain_ft?: number;
  loss_ft?: number;
  avg_grade_pct?: number;
  climb_ft_per_hour?: number;
}

/** Stats for a time range of the ride (seconds from the start), from the same 1 Hz grid the detectors use. */
export function selectionStats(points: MetricStreamPoint[] | undefined, fromSec: number, toSec: number, ftp?: number): SelectionStats | undefined {
  if (!points) return undefined;
  const secs = toSeconds(points);
  const from = Math.max(0, Math.floor(Math.min(fromSec, toSec)));
  const to = Math.min(secs.length, Math.ceil(Math.max(fromSec, toSec)));
  if (to - from < 2) return undefined;
  const out: SelectionStats = { seconds: to - from };

  const values = (key: 'w' | 'hr' | 'speed' | 'cad') => {
    const v: number[] = [];
    for (let i = from; i < to; i++) { const x = secs[i]?.[key]; if (x !== undefined) v.push(x); }
    return v;
  };
  const w = values('w');
  if (w.length >= 2) {
    const avg = mean(w)!;
    out.avg_watts = round(avg);
    out.max_watts = round(Math.max(...w));
    if (w.length >= 60) {
      const w30 = smooth(secs.slice(from, to), 'w', 30).filter((x): x is number => x !== undefined);
      if (w30.length) {
        const np = (w30.reduce((a, x) => a + x ** 4, 0) / w30.length) ** 0.25;
        out.normalized_watts = round(np);
      }
    }
    if (ftp) out.percent_ftp = round(((out.normalized_watts ?? avg) / ftp) * 100);
  }
  const hr = values('hr');
  if (hr.length >= 2) { out.avg_hr = round(mean(hr)!); out.max_hr = round(Math.max(...hr)); }
  const cad = values('cad');
  if (cad.length >= 2) out.avg_cadence = round(mean(cad)!);
  const speed = values('speed');
  if (speed.length >= 2) {
    out.avg_mph = round(mean(speed)! * KMH_TO_MPH, 1);
    // Each second with a speed reading covers speed/3600 km
    out.miles = round((speed.reduce((a, x) => a + x, 0) / 3600) * KMH_TO_MPH, 2);
  }
  const alt = smooth(secs, 'alt', 15);
  let gain = 0;
  let loss = 0;
  let last: number | undefined;
  let seen = 0;
  for (let i = from; i < to; i += 5) {
    const a = alt[i];
    if (a === undefined) continue;
    seen++;
    if (last !== undefined) { const d = a - last; if (d > 0) gain += d; else loss -= d; }
    last = a;
  }
  if (seen >= 2) {
    out.gain_ft = round(gain * M_TO_FT);
    out.loss_ft = round(loss * M_TO_FT);
    if (out.miles && out.miles > 0.02) {
      const first = alt.slice(from, to).find((x) => x !== undefined);
      const lastAlt = [...alt.slice(from, to)].reverse().find((x) => x !== undefined);
      if (first !== undefined && lastAlt !== undefined) {
        out.avg_grade_pct = round(((lastAlt - first) / (out.miles * 1609.34)) * 100, 1);
      }
    }
    if (out.seconds >= 60) out.climb_ft_per_hour = round((gain * M_TO_FT) / (out.seconds / 3600));
  }
  return out;
}

/** Smoothed watts / HR for charting: a centred moving average of `window` seconds, sampled every `step` seconds. */
export function smoothedSeries(points: MetricStreamPoint[] | undefined, window: number, step: number) {
  if (!points || points.length < 2) return [];
  const secs = toSeconds(points);
  const w = window > 1 ? smooth(secs, 'w', window) : secs.map((x) => x?.w);
  const h = window > 1 ? smooth(secs, 'hr', window) : secs.map((x) => x?.hr);
  // Altitude is lightly smoothed regardless of the power setting: raw GPS/barometer altitude is jittery
  const a = smooth(secs, 'alt', Math.max(5, Math.min(window, 30)));
  const out: { time: number; watts?: number; hr?: number; elevation_ft?: number }[] = [];
  for (let t = 0; t < secs.length; t += step) {
    out.push({
      time: t,
      watts: w[t] !== undefined ? Math.round(w[t]!) : undefined,
      hr: h[t] !== undefined ? Math.round(h[t]!) : undefined,
      elevation_ft: a[t] !== undefined ? Math.round(a[t]! * M_TO_FT) : undefined,
    });
  }
  return out;
}

interface Second { w?: number; hr?: number; speed?: number; alt?: number; cad?: number }

/**
 * The longest gap between two samples that still counts as one continuous stretch. Saved rides are thinned to ~500
 * samples, so on a long ride the normal spacing is itself more than MAX_GAP_S (a 2 h ride has a sample every ~14 s):
 * the limit has to scale with the spacing, or every sample stands alone and the charts come out empty.
 * Pauses are still gaps: they are far longer than a few normal spacings.
 */
export function maxGapSeconds(sortedTimes: number[]): number {
  const spacings: number[] = [];
  for (let i = 1; i < sortedTimes.length; i++) {
    const d = sortedTimes[i] - sortedTimes[i - 1];
    if (d > 0) spacings.push(d);
  }
  if (spacings.length === 0) return MAX_GAP_S;
  spacings.sort((a, b) => a - b);
  const median = spacings[Math.floor(spacings.length / 2)];
  return Math.max(MAX_GAP_S, Math.ceil(median * 2.5));
}

/** Resample to a 1 Hz grid; gaps longer than the allowed gap stay empty so pauses don't smear into efforts. */
function toSeconds(points: MetricStreamPoint[]): Second[] {
  const sorted = points
    .filter((p) => typeof p.time === 'number' && p.time >= 0)
    .sort((a, b) => a.time - b.time);
  if (sorted.length < 2) return [];
  const maxGap = maxGapSeconds(sorted.map((p) => p.time));
  const out: Second[] = new Array(Math.floor(sorted[sorted.length - 1].time) + 1);
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const next = sorted[i + 1];
    const from = Math.floor(p.time);
    const to = next && next.time - p.time <= maxGap ? Math.floor(next.time) : from + 1;
    for (let s = from; s < to && s < out.length; s++) {
      out[s] = {
        w: typeof p.watts === 'number' && p.watts >= 0 ? p.watts : undefined,
        hr: typeof p.hr === 'number' && p.hr > 0 ? p.hr : undefined,
        speed: typeof p.speed === 'number' ? p.speed : undefined,
        alt: typeof p.alt === 'number' ? p.alt : undefined,
        cad: typeof p.cadence === 'number' && p.cadence > 0 ? p.cadence : undefined,
      };
    }
  }
  return out;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

function avgOver(secs: Second[], from: number, to: number, key: 'w' | 'hr' | 'speed') {
  const vals: number[] = [];
  for (let s = from; s < to && s < secs.length; s++) {
    const v = secs[s]?.[key];
    if (v !== undefined) vals.push(v);
  }
  return mean(vals);
}

/** Centred moving average per second (undefined where the window has no data). */
function smooth(secs: Second[], key: 'w' | 'hr' | 'alt', window: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(secs.length);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < secs.length; i++) {
    const add = secs[i]?.[key];
    if (add !== undefined) { sum += add; count++; }
    const j = i - window;
    if (j >= 0) {
      const rem = secs[j]?.[key];
      if (rem !== undefined) { sum -= rem; count--; }
    }
    // Centre the window on the sample it describes so detected runs aren't shifted late
    const centre = i - Math.floor(window / 2);
    if (centre >= 0) out[centre] = count >= window * 0.6 ? sum / count : undefined;
  }
  return out;
}

/** Contiguous runs where pred is true, allowing short dips below the line to be bridged. */
function findRuns(values: (number | undefined)[], pred: (v: number) => boolean, minSeconds: number, bridge = 20) {
  const runs: { start: number; end: number }[] = [];
  let start = -1;
  let lastTrue = -1;
  for (let i = 0; i <= values.length; i++) {
    const v = values[i];
    const on = v !== undefined && pred(v);
    if (on) {
      if (start < 0) start = i;
      lastTrue = i;
    } else if (start >= 0 && (i >= values.length || i - lastTrue > bridge)) {
      if (lastTrue - start + 1 >= minSeconds) runs.push({ start, end: lastTrue + 1 });
      start = -1;
    }
  }
  return runs;
}

function bestAverage(values: (number | undefined)[], window: number) {
  let best: { avg: number; end: number } | undefined;
  for (let i = window - 1; i < values.length; i++) {
    const v = values[i];
    if (v !== undefined && (!best || v > best.avg)) best = { avg: v, end: i + 1 };
  }
  return best;
}


interface Block { start: number; end: number; watts: number }

/**
 * Split the power trace into steady blocks wherever the average level changes noticeably,
 * judged against the ride itself (not FTP), so easy intervals and stepped/ramped sets are found
 * too. Returns undefined when the ride has no repeated level changes (a steady ride).
 */
function findPowerBlocks(secs: Second[], ftp?: number): Block[] | undefined {
  const n = secs.length;
  const prefix = new Float64Array(n + 1);
  const cnt = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) {
    const v = secs[i]?.w;
    prefix[i + 1] = prefix[i] + (v ?? 0);
    cnt[i + 1] = cnt[i] + (v !== undefined ? 1 : 0);
  }
  const avg = (a: number, b: number) => {
    const c = cnt[Math.min(b, n)] - cnt[Math.max(a, 0)];
    return c >= (b - a) * 0.6 ? (prefix[Math.min(b, n)] - prefix[Math.max(a, 0)]) / c : undefined;
  };
  const minStep = Math.max(15, ftp ? ftp * 0.06 : 0);
  const isStep = (a: number, b: number) => Math.abs(a - b) >= Math.max(minStep, 0.18 * Math.max(a, b));

  const W = 30;
  const score = new Float64Array(n);
  for (let i = W; i <= n - W; i++) {
    const before = avg(i - W, i);
    const after = avg(i, i + W);
    if (before !== undefined && after !== undefined && isStep(before, after)) score[i] = Math.abs(after - before);
  }
  // Boundaries = local maxima of the change score, at least 30 s apart
  const bounds: number[] = [];
  for (let i = W; i <= n - W; i++) {
    if (score[i] <= 0) continue;
    let isMax = true;
    for (let j = Math.max(W, i - 20); j <= Math.min(n - W, i + 20); j++) {
      if (score[j] > score[i] || (score[j] === score[i] && j < i)) { isMax = false; break; }
    }
    if (!isMax) continue;
    if (bounds.length && i - bounds[bounds.length - 1] < 30) continue;
    bounds.push(i);
  }
  if (bounds.length < 3) return undefined;

  const edges = [0, ...bounds, n];
  let blocks: Block[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const w = avg(edges[i], edges[i + 1]);
    if (w !== undefined) blocks.push({ start: edges[i], end: edges[i + 1], watts: w });
  }
  // Merge neighbours that turned out to be the same level
  for (let changed = true; changed;) {
    changed = false;
    const merged: Block[] = [];
    for (const b of blocks) {
      const last = merged[merged.length - 1];
      if (last && !isStep(last.watts, b.watts)) {
        const w = avg(last.start, b.end) ?? last.watts;
        merged[merged.length - 1] = { start: last.start, end: b.end, watts: w };
        changed = true;
      } else merged.push(b);
    }
    blocks = merged;
  }
  const lasting = blocks.filter((b) => b.end - b.start >= 45);
  return lasting.length >= 4 ? lasting : undefined;
}

/** Time-in-power histogram with bins sized to this ride (about 8-14 bins of a round width), plus coasting time and percentiles. */
function powerDistribution(secs: Second[], ftp?: number) {
  const vals = secs.map((s) => s?.w).filter((v): v is number => v !== undefined);
  if (vals.length < 60) return undefined;
  const coasting = vals.filter((v) => v < 5).length;
  const pedalling = vals.filter((v) => v >= 5).sort((a, b) => a - b);
  if (pedalling.length < 30) return undefined;
  const pct = (q: number) => pedalling[Math.min(pedalling.length - 1, Math.floor(q * pedalling.length))];
  const top = pct(0.99);
  const widths = [5, 10, 20, 25, 50, 100];
  const width = widths.find((w) => Math.ceil(top / w) <= 14) ?? 100;
  const count = Math.max(1, Math.ceil(top / width));
  const bins = new Array<number>(count).fill(0);
  for (const v of pedalling) bins[Math.min(count - 1, Math.floor(v / width))]++;
  const total = vals.length;
  return {
    note: `Seconds of recorded data by power. Bins are ${width} W wide; the last bin includes everything above it. Coasting is under 5 W.`,
    coasting_minutes: round(coasting / 60, 1),
    percentiles_watts_while_pedalling: { p10: round(pct(0.1)), p50: round(pct(0.5)), p90: round(pct(0.9)), p99: round(top) },
    bins: bins
      .map((n, i) => ({
        watts: i === count - 1 ? `${i * width}+` : `${i * width}-${(i + 1) * width}`,
        ...(ftp ? { percent_ftp: i === count - 1 ? `${round((i * width / ftp) * 100)}+` : `${round((i * width / ftp) * 100)}-${round(((i + 1) * width / ftp) * 100)}` } : {}),
        minutes: round(n / 60, 1),
        percent_of_ride: round((n / total) * 100),
      }))
      .filter((b) => b.minutes > 0),
  };
}

/**
 * Condense a raw time-series into something a language model can read: a coarse timeline, best
 * power for key durations, sustained efforts, short power surges and periods of high heart rate.
 * Returns undefined when there is no usable power/HR/speed data.
 */
export function summarizeStreams(points: MetricStreamPoint[] | undefined, opts: StreamSummaryOptions = {}): StreamSummary | undefined {
  if (!points || points.length < 10) return undefined;
  const secs = toSeconds(points);
  if (secs.length < 60) return undefined;

  const hasPower = secs.some((s) => s && s.w !== undefined && s.w > 0);
  const hasHr = secs.some((s) => s && s.hr !== undefined);
  const hasSpeed = secs.some((s) => s && s.speed !== undefined);
  if (!hasPower && !hasHr && !hasSpeed) return undefined;

  const min = (s: number) => round(s / 60, 1);
  const ftp = opts.ftp && opts.ftp > 0 ? opts.ftp : undefined;
  const hrs = secs.map((s) => s?.hr).filter((v): v is number => v !== undefined);
  const maxHr = opts.maxHr && opts.maxHr > 0 ? opts.maxHr : hrs.length ? Math.max(...hrs) : undefined;
  const hrThreshold = opts.lthr && opts.lthr > 0 ? opts.lthr : maxHr ? maxHr * 0.9 : undefined;

  // Coarse timeline
  const bucket = Math.max(60, Math.ceil(secs.length / MAX_TIMELINE_POINTS / 60) * 60);
  const timeline: Record<string, number>[] = [];
  for (let from = 0; from < secs.length; from += bucket) {
    const to = Math.min(from + bucket, secs.length);
    const row: Record<string, number> = { at_min: min(from) };
    const w = hasPower ? avgOver(secs, from, to, 'w') : undefined;
    const hr = hasHr ? avgOver(secs, from, to, 'hr') : undefined;
    const sp = hasSpeed ? avgOver(secs, from, to, 'speed') : undefined;
    const altStart = secs[from]?.alt;
    const altEnd = secs[to - 1]?.alt;
    if (w !== undefined) row.avg_watts = round(w);
    if (hr !== undefined) row.avg_hr = round(hr);
    if (sp !== undefined) row.avg_mph = round(sp * KMH_TO_MPH, 1);
    if (altStart !== undefined && altEnd !== undefined) row.net_climb_ft = round((altEnd - altStart) * M_TO_FT);
    if (Object.keys(row).length > 1) timeline.push(row);
  }

  const describeRun = (r: { start: number; end: number }): RunInfo => {
    const w = avgOver(secs, r.start, r.end, 'w');
    const hr = avgOver(secs, r.start, r.end, 'hr');
    const sp = avgOver(secs, r.start, r.end, 'speed');
    return {
      start_min: min(r.start),
      duration_min: min(r.end - r.start),
      ...(w !== undefined && hasPower ? { avg_watts: round(w), ...(ftp ? { percent_ftp: round((w / ftp) * 100) } : {}) } : {}),
      ...(hr !== undefined ? { avg_hr: round(hr) } : {}),
      ...(sp !== undefined && hasSpeed ? { avg_mph: round(sp * KMH_TO_MPH, 1) } : {}),
    };
  };

  const out: StreamSummary = {
    sample_note: 'Condensed from the recorded time-series. Times are minutes from the start (elapsed, including stops).',
    elapsed_minutes: min(secs.length),
    timeline,
  };

  if (hasPower) {
    const w30 = smooth(secs, 'w', 30);
    const best: Record<string, number> = {};
    for (const [label, win] of [['5s', 5], ['1min', 60], ['5min', 300], ['20min', 1200]] as const) {
      const b = bestAverage(smooth(secs, 'w', win), win);
      if (b && secs.length >= win) best[label] = round(b.avg);
    }
    out.best_power_watts = best;
    out.power_distribution = powerDistribution(secs, ftp);

    const allW = secs.map((s) => s?.w).filter((v): v is number => v !== undefined && v > 0);
    const avgW = mean(allW) ?? 0;
    const effortLine = ftp ? ftp * 0.88 : avgW * 1.25;
    const efforts = findRuns(w30, (v) => v >= effortLine, 180)
      .map(describeRun)
      .sort((a, b) => b.duration_min - a.duration_min)
      .slice(0, MAX_LISTED);
    out.sustained_power_efforts = {
      criteria: ftp ? `30s-smoothed power at or above 88% of FTP (${round(effortLine)} W) for 3+ minutes` : `30s-smoothed power at least 25% above the ride average (${round(effortLine)} W) for 3+ minutes`,
      efforts,
    };


    const blocks = findPowerBlocks(secs, ftp);
    if (blocks) {
      const rows = blocks.slice(0, 30).map((b, i) => {
        const prev = blocks[i - 1]?.watts;
        const next = blocks[i + 1]?.watts;
        const above = (x?: number) => x === undefined || b.watts >= x * 1.15;
        const below = (x?: number) => x === undefined || b.watts <= x / 1.15;
        const role = above(prev) && above(next) ? 'hard' : below(prev) && below(next) ? 'easy' : next !== undefined && b.watts > next ? 'step_down' : 'step_up';
        return { ...describeRun(b), role } as BlockInfo;
      });
      const hard = rows.filter((r) => r.role === 'hard' && r.avg_watts !== undefined);
      const trend = hard.length >= 3
        ? hard[hard.length - 1].avg_watts! >= hard[0].avg_watts! * 1.1 ? 'hard blocks get harder over the session'
          : hard[hard.length - 1].avg_watts! <= hard[0].avg_watts! * 0.9 ? 'hard blocks get easier over the session'
          : 'hard blocks stay at a similar level'
        : undefined;
      out.block_structure = {
        criteria: 'Consecutive blocks of 45s+ whose average power differs by 18%+ (and at least 15 W) from the neighbouring block. Judged against the ride itself, not FTP, so easy or sub-threshold intervals count. Terrain, traffic or stops can also produce this pattern.',
        blocks: rows,
        ...(trend ? { trend } : {}),
      };
    }

    const w5 = smooth(secs, 'w', 5);
    const surgeLine = ftp ? ftp * 1.5 : avgW * 2.5;
    const surges = findRuns(w5, (v) => v >= surgeLine, 5, 5)
      .map((r) => ({ start_min: min(r.start), seconds: r.end - r.start, peak_5s_watts: round(Math.max(...w5.slice(r.start, r.end).filter((v): v is number => v !== undefined))) }))
      .sort((a, b) => b.peak_5s_watts - a.peak_5s_watts)
      .slice(0, MAX_LISTED);
    out.power_surges = {
      criteria: `5s power at or above ${round(surgeLine)} W${ftp ? ' (150% of FTP)' : ' (2.5x the ride average)'} for 5+ seconds`,
      surges,
    };
  }

  if (hasHr && hrThreshold) {
    const hr60 = smooth(secs, 'hr', 60);
    const high = findRuns(hr60, (v) => v >= hrThreshold * (opts.lthr ? 0.97 : 1), 180, 30)
      .map(describeRun)
      .sort((a, b) => b.duration_min - a.duration_min)
      .slice(0, MAX_LISTED);
    out.high_heart_rate_periods = {
      criteria: `60s-smoothed HR at or above ${round(hrThreshold * (opts.lthr ? 0.97 : 1))} bpm (${opts.lthr ? '97% of threshold HR' : '90% of the highest HR seen'}) for 3+ minutes`,
      periods: high,
    };
  }

  if (opts.ebike) out.ebike_note = 'Motor-assisted ride: power and speed figures include the motor; weigh heart rate more heavily.';
  return out;
}
