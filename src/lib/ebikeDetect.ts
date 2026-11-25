import type { Activity, MetricStreamPoint } from '../types';
import { isEbike } from './tags';
import { kmhToMph } from './units';

/**
 * Spotting rides with motor assist, so the e-bike tag does not have to be remembered. Two kinds of evidence:
 * the athlete's own words and the recording's labels (strong), and what the data shows: speed that stops at the
 * assist cutoff (about 15.5 mph in much of the world, 20 mph for US class 1 and 2) even on flat or uphill ground, and
 * climbs that need far more power than the legs were producing, judged by power when a meter was on, else heart rate.
 * It aims to be right when it says yes; a ride it is unsure about stays untagged.
 */
export interface EbikeProfile {
  weight_kg?: number;
  ftp?: number;
  lthr?: number;
  max_hr?: number;
}

/** Bump when the rules change: rides judged "not an e-bike" by an older version are looked at again. */
export const EBIKE_DETECTOR_VERSION = 2;

export interface EbikeDetails {
  /** Minutes at 6 km/h or more, and the part of it on flat or uphill ground (where an assist cutoff shows) */
  moving_minutes: number;
  flat_minutes: number;
  /** The assist cutoff that fitted best, and how the flat-ground time was spread around it */
  cap?: { mph: number; near_percent: number; over_percent: number; score: number };
  /** Each sustained climb that was weighed, with what it needed against what the legs gave */
  climbs: string[];
  /** Where the speeds came from */
  speed_source: 'recorded' | 'gps';
}

export interface EbikeDetection {
  ebike: boolean;
  /** 0 nothing, 1 a hint, 2 or more is enough */
  score: number;
  basis: 'metadata' | 'data' | 'none';
  reasons: string[];
  /** Why it could not judge (too short, no speed or altitude), when that is the case */
  insufficient?: string;
  /** What the data showed, whether or not it was enough (for the ride's e-bike check panel) */
  details?: EbikeDetails;
}

const NOT_AN_EBIKE = /\b(not|no|without|isn'?t|wasn'?t)\b[^.\n]{0,20}\be-?bike\b/i;
const EBIKE_WORDS = /\be-?bike\b|\bebike\b|\bemtb\b|\be-?mtb\b|\bpedelec\b|\bbosch\b|\bturbo (?:vado|levo|creo|como)\b|\bshimano ep\d\b|\bmotor assist/i;

// 25 km/h (15.5 mph) in much of the world, 32 km/h (20 mph) US class 1 and 2, 45 km/h (28 mph) class 3 and speed pedelecs
export const CAPS_KMH = [25, 32.2, 45];

const round = (n: number, d = 0) => { const f = 10 ** d; return Math.round(n * f) / f; };

interface Sample { t: number; speed: number; alt?: number; hr?: number; watts?: number; dist: number }

const R = 6371000;
const haversine = (la1: number, lo1: number, la2: number, lo2: number) => {
  const rad = Math.PI / 180;
  const a = Math.sin(((la2 - la1) * rad) / 2) ** 2 + Math.cos(la1 * rad) * Math.cos(la2 * rad) * Math.sin(((lo2 - lo1) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
};

/** Speeds from the recording, or worked out from the GPS track when the recording has none. */
function withSpeeds(points: MetricStreamPoint[]): { points: MetricStreamPoint[]; source: 'recorded' | 'gps' } | undefined {
  const recorded = points.filter((p) => typeof p.speed === 'number' && Number.isFinite(p.speed)).length;
  if (recorded >= 60 && recorded >= points.length * 0.5) return { points, source: 'recorded' };
  const track = points
    .filter((p) => typeof p.time === 'number' && typeof p.lat === 'number' && typeof p.lng === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .sort((a, b) => a.time - b.time);
  if (track.length < 60) return recorded >= 60 ? { points, source: 'recorded' } : undefined;
  const out: MetricStreamPoint[] = [];
  for (let i = 1; i < track.length; i++) {
    const dt = track[i].time - track[i - 1].time;
    if (dt < 1 || dt > 120) continue;
    const m = haversine(track[i - 1].lat as number, track[i - 1].lng as number, track[i].lat as number, track[i].lng as number);
    out.push({ ...track[i], speed: (m / dt) * 3.6 });
  }
  return out.length >= 60 ? { points: out, source: 'gps' } : undefined;
}

function prepare(points: MetricStreamPoint[]): Sample[] {
  const pts = points
    .filter((p) => typeof p.time === 'number' && Number.isFinite(p.time) && typeof p.speed === 'number' && Number.isFinite(p.speed))
    .sort((a, b) => a.time - b.time);
  const out: Sample[] = [];
  let dist = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const speed = p.speed as number;
    if (i > 0) dist += ((pts[i - 1].speed as number) + speed) / 2 * ((p.time - pts[i - 1].time) / 3600) * 1000; // metres
    out.push({ t: p.time, speed, alt: typeof p.alt === 'number' ? p.alt : undefined, hr: typeof p.hr === 'number' && p.hr > 0 ? p.hr : undefined, watts: typeof p.watts === 'number' ? p.watts : undefined, dist });
  }
  // Speeds are used as recorded: smoothing would narrow a normal ride's spread and make it look capped
  return out;
}

/** Grade at each sample: height change over distance across about a minute either side, which is steady enough to trust. */
function grades(samples: Sample[]): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(samples.length);
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < samples.length; i++) {
    while (lo < i && samples[i].t - samples[lo].t > 45) lo++;
    while (hi < samples.length - 1 && samples[hi + 1].t - samples[i].t <= 45) hi++;
    const a = samples[lo].alt;
    const b = samples[hi].alt;
    const run = samples[hi].dist - samples[lo].dist;
    out[i] = a !== undefined && b !== undefined && run > 60 ? (b - a) / run : undefined;
  }
  return out;
}

/** Power the rider and bike need at the wheel to climb at this speed and grade. */
export function requiredPower(speedKmh: number, grade: number, massKg: number): number {
  const v = speedKmh / 3.6;
  const g = 9.81;
  const climb = massKg * g * v * Math.sin(Math.atan(grade));
  const rolling = 0.006 * massKg * g * v;
  const air = 0.5 * 1.2 * 0.4 * v ** 3;
  return Math.max(0, climb + rolling + air);
}

export function detectEbike(
  activity: Pick<Activity, 'title' | 'sport_type' | 'effort_notes' | 'gear_notes' | 'tags'>,
  points: MetricStreamPoint[] | undefined,
  profile: EbikeProfile = {},
): EbikeDetection {
  if (isEbike(activity)) return { ebike: true, score: 3, basis: 'metadata', reasons: ['Already tagged as an e-bike ride.'] };
  if (activity.sport_type !== 'cycling') return { ebike: false, score: 0, basis: 'none', reasons: [], insufficient: 'only road and trail rides are checked' };

  // 1. The athlete's own words
  const words = [activity.title, activity.effort_notes, activity.gear_notes].filter(Boolean).join('\n');
  if (EBIKE_WORDS.test(words) && !NOT_AN_EBIKE.test(words)) {
    return { ebike: true, score: 3, basis: 'metadata', reasons: ['The title or your notes mention an e-bike.'] };
  }

  // 2. What the data shows
  const speeds = points && points.length >= 60 ? withSpeeds(points) : undefined;
  const samples = speeds ? prepare(speeds.points) : [];
  if (samples.length < 60) return { ebike: false, score: 0, basis: 'none', reasons: [], insufficient: 'no speed or GPS track recorded' };
  const maxGap = Math.max(30, 4 * (samples[samples.length - 1].t - samples[0].t) / samples.length);
  const g = grades(samples);
  const reasons: string[] = [];
  let capScore = 0;
  let climbScore = 0;

  // Time-weight each sample by the gap to the next (a paused timer is not riding time)
  const dtOf = (i: number) => (i + 1 < samples.length ? Math.min(samples[i + 1].t - samples[i].t, maxGap) : 0);
  let movingSeconds = 0;
  for (let i = 0; i < samples.length; i++) if (samples[i].speed >= 6) movingSeconds += dtOf(i);
  if (movingSeconds < 15 * 60) return { ebike: false, score: 0, basis: 'none', reasons: [], insufficient: 'under 15 minutes of riding' };
  const details: EbikeDetails = { moving_minutes: round(movingSeconds / 60), flat_minutes: 0, climbs: [], speed_source: speeds?.source ?? 'recorded' };

  // The cap: speed that piles up at the assist cutoff and is not exceeded on flat or uphill ground
  let flatSeconds = 0;
  for (let i = 0; i < samples.length; i++) if (samples[i].speed >= 6 && (g[i] === undefined || g[i]! >= -0.01)) flatSeconds += dtOf(i);
  details.flat_minutes = round(flatSeconds / 60);
  if (flatSeconds >= 600) {
    let best: { cap: number; near: number; over: number } | undefined;
    for (const cap of CAPS_KMH) {
      let near = 0;
      let over = 0;
      for (let i = 0; i < samples.length; i++) {
        if (samples[i].speed < 6 || (g[i] !== undefined && g[i]! < -0.01)) continue;
        const dt = dtOf(i);
        if (samples[i].speed >= cap - 2.5 && samples[i].speed <= cap + 1.5) near += dt;
        else if (samples[i].speed > cap + 1.5) over += dt;
      }
      if (!best || near > best.near) best = { cap, near: near / flatSeconds, over: over / flatSeconds };
    }
    // A natural distribution keeps going past any speed it reaches; an assist cutoff does not
    if (best && ((best.near >= 0.2 && best.over <= 0.04) || (best.near >= 0.35 && best.over <= 0.06))) capScore = 2;
    else if (best && best.near >= 0.1 && best.over <= 0.05) capScore = 1;
    if (best) details.cap = { mph: round(kmhToMph(best.cap), 1), near_percent: round(best.near * 100), over_percent: round(best.over * 100, 1), score: capScore };
    if (capScore > 0 && best) {
      reasons.push(`Speed sat at about ${round(kmhToMph(best.cap), 1)} mph for ${round(best.near * 100)}% of the time on flat or uphill ground and almost never went above it, like an assist cutoff.`);
    }
  }

  // Climbs: sustained, steep enough that the power needed is large and the legs' effort can be compared
  const mass = (profile.weight_kg && profile.weight_kg > 30 ? profile.weight_kg : 80) + 10;
  const ftp = profile.ftp && profile.ftp > 50 ? profile.ftp : 3.5 * (mass - 10);
  const lthr = profile.lthr && profile.lthr > 90 ? profile.lthr : profile.max_hr && profile.max_hr > 120 ? profile.max_hr * 0.88 : undefined;
  let i = 0;
  while (i < samples.length) {
    if (!(g[i] !== undefined && g[i]! >= 0.03)) { i++; continue; }
    let j = i;
    let last = i;
    while (j + 1 < samples.length && (g[j + 1] === undefined || g[j + 1]! >= 0.02) && samples[j + 1].t - samples[j].t <= maxGap) {
      j++;
      if (g[j] !== undefined && g[j]! >= 0.03) last = j;
    }
    const seg = samples.slice(i, last + 1);
    const seconds = seg[seg.length - 1].t - seg[0].t;
    if (seconds >= 180) {
      const a = seg[0].alt;
      const b = seg[seg.length - 1].alt;
      const run = seg[seg.length - 1].dist - seg[0].dist;
      if (a !== undefined && b !== undefined && run > 150) {
        const grade = (b - a) / run;
        const speed = (run / seconds) * 3.6;
        const need = requiredPower(speed, grade, mass);
        const hrs = seg.map((s) => s.hr).filter((v): v is number => v !== undefined);
        const hr = hrs.length >= seg.length * 0.7 ? hrs.reduce((x, y) => x + y, 0) / hrs.length : undefined;
        const watts = seg.map((s) => s.watts).filter((v): v is number => v !== undefined && v >= 0);
        const meter = watts.length >= seg.length * 0.7 ? watts.reduce((x, y) => x + y, 0) / watts.length : undefined;
        const mins = round(seconds / 60);
        let score = 0;
        let why = '';
        if (meter !== undefined && need >= 150 && meter < 0.5 * need) {
          score = 2;
          why = `A ${mins} minute climb at ${round(grade * 100)}% needed about ${round(need)} W, but the power meter read ${round(meter)} W.`;
        } else if (hr !== undefined && lthr !== undefined) {
          const effort = need / ftp;
          const hrShare = hr / lthr;
          if (effort >= 0.8 && hrShare <= 0.8) score = 2;
          else if (effort >= 0.65 && hrShare <= 0.72) score = 1;
          why = `A ${mins} minute climb at ${round(grade * 100)}% needed about ${round(need)} W (${round(effort * 100)}% of ${profile.ftp ? 'your FTP' : 'a typical threshold'}), yet heart rate averaged ${round(hr)} bpm (${round(hrShare * 100)}% of threshold).`;
        }
        if (why) details.climbs.push(`${why}${score > 0 ? '' : ' (not unusual)'}`);
        else if (hr === undefined || lthr === undefined) details.climbs.push(`A ${mins} minute climb at ${round(grade * 100)}% needed about ${round(need)} W, but there was no heart rate${lthr === undefined ? ' or threshold' : ''} to compare it with.`);
        if (score > 0) {
          climbScore += score;
          reasons.push(why);
        }
      }
    }
    i = Math.max(last + 1, i + 1);
  }
  climbScore = Math.min(2, climbScore);

  const score = capScore + climbScore;
  return { ebike: score >= 2, score, basis: score >= 2 ? 'data' : 'none', reasons: score >= 2 ? reasons : [], details };
}
