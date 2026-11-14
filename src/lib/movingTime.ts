import type { MetricStreamPoint } from '../types';
import { maxGapSeconds } from './streamSummary';

/**
 * Moving time worked out from the recording: the time actually spent moving, without breaks, waiting or standing at
 * a trailhead. Many devices only pause their timer when told to, so the saved "moving time" is often the whole
 * elapsed time; training load, pace and the coach's reading of an activity should use the time spent moving.
 * A step counts as stopped when speed (or the distance between positions) is under a walking-pace floor; a long gap
 * with the position unchanged is a paused timer, which is stopped time too.
 */
export const MOVING_FLOOR_KMH = 1;
const MIN_PAUSE_SECONDS = 60;
const MAX_SPAN_SECONDS = 4 * 24 * 3600;

export interface MovingTime {
  moving_seconds: number;
  stopped_seconds: number;
  /** Time covered by the recording (a dropout in the recording is neither moving nor stopped) */
  recorded_seconds: number;
  stopped_share: number;
}

const toRad = (d: number) => (d * Math.PI) / 180;
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

export function measureMovingTime(points: MetricStreamPoint[] | undefined): MovingTime | undefined {
  if (!points || points.length < 10) return undefined;
  const pts = points
    .filter((p) => typeof p.time === 'number' && Number.isFinite(p.time) && p.time >= 0)
    .sort((a, b) => a.time - b.time);
  if (pts.length < 10 || pts[pts.length - 1].time > MAX_SPAN_SECONDS) return undefined;
  const maxGap = maxGapSeconds(pts.map((p) => p.time));

  let moving = 0;
  let stopped = 0;
  let judged = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dt = b.time - a.time;
    if (dt <= 0) continue;
    const placed = [a.lat, a.lng, b.lat, b.lng].every((v) => typeof v === 'number');
    if (dt > maxGap) {
      // A long gap with the position unchanged is a paused timer; with movement it is a recording dropout
      if (dt >= MIN_PAUSE_SECONDS && (!placed || haversineKm(a.lat!, a.lng!, b.lat!, b.lng!) < 0.1)) {
        stopped += dt;
        judged += dt;
      }
      continue;
    }
    let kmh: number | undefined;
    if (typeof a.speed === 'number' && typeof b.speed === 'number') kmh = (a.speed + b.speed) / 2;
    else if (placed) kmh = (haversineKm(a.lat!, a.lng!, b.lat!, b.lng!) / dt) * 3600;
    if (kmh === undefined) continue;
    judged += dt;
    if (kmh < MOVING_FLOOR_KMH) stopped += dt;
    else moving += dt;
  }
  if (judged < 300 || moving <= 0) return undefined;
  return { moving_seconds: Math.round(moving), stopped_seconds: Math.round(stopped), recorded_seconds: Math.round(judged), stopped_share: stopped / judged };
}

/**
 * The moving time to save for an activity, or undefined to leave the device's figure alone. The device's figure is
 * replaced only when it is effectively the whole elapsed time (no pause was recorded) and the recording shows real
 * stopped time; a timer that already paused is trusted.
 */
export function adoptMovingTime(
  deviceMovingSeconds: number,
  elapsedSeconds: number,
  points: MetricStreamPoint[] | undefined,
): MovingTime | undefined {
  if (!(elapsedSeconds > 600) || deviceMovingSeconds < elapsedSeconds * 0.97) return undefined;
  const measured = measureMovingTime(points);
  if (!measured || measured.stopped_share < 0.03) return undefined;
  // The recording must cover most of the activity, or its stopped share says little about the whole
  if (measured.recorded_seconds < elapsedSeconds * 0.8) return undefined;
  // Scale to the elapsed time the activity reports, so the two always add up
  return { ...measured, moving_seconds: Math.round(elapsedSeconds * (1 - measured.stopped_share)), stopped_seconds: Math.round(elapsedSeconds * measured.stopped_share) };
}
