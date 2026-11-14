import type { Activity } from '../types';

/**
 * Which saved activities this device has already looked at for stopped time, so each is read once: 'fixed' got a
 * shorter moving time (with the numbers, for the record), 'clear' showed no real stops or already had a paused timer.
 */
export type MovingCheck = { state: 'fixed' | 'clear'; at: string; from?: number; to?: number };

const KEY = 'summit_moving_checks';
const MAX = 3000;

export function readMovingChecks(): Record<string, MovingCheck> {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeMovingCheck(id: string, check: MovingCheck) {
  try {
    const all = readMovingChecks();
    all[id] = check;
    const entries = Object.entries(all);
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries.length > MAX ? entries.slice(-MAX) : entries)));
  } catch { /* storage unavailable: the activity may be looked at again next time */ }
}

/** Activities whose moving time may still be the whole elapsed time: outdoors, long enough, never looked at, newest first. */
export function movingCandidates(activities: Activity[], checks: Record<string, MovingCheck> = readMovingChecks(), limit = Infinity): Activity[] {
  return activities
    .filter((a) => a.sport_type !== 'zwift' && a.sport_type !== 'workout' && !checks[a.id]
      && a.duration_seconds > 600 && (a.moving_time_seconds || a.duration_seconds) >= a.duration_seconds * 0.97)
    .sort((a, b) => b.start_date.localeCompare(a.start_date))
    .slice(0, limit);
}
