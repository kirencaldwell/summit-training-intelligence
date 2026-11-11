import type { Activity } from '../types';
import { isEbike } from './tags';

/**
 * What this device remembers about e-bike detection, so a ride is judged once and a ride the athlete un-tagged is never
 * tagged again: 'tagged' by the detector (with its reasons), 'clear' judged not an e-bike, 'rejected' tagged then
 * un-tagged by the athlete.
 */
export type EbikeCheck = { state: 'tagged' | 'clear' | 'rejected'; at: string; reasons?: string[] };

const KEY = 'summit_ebike_checks';
const MAX = 2000;

export function readEbikeChecks(): Record<string, EbikeCheck> {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeEbikeCheck(id: string, check: EbikeCheck) {
  try {
    const all = readEbikeChecks();
    all[id] = check;
    const entries = Object.entries(all);
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries.length > MAX ? entries.slice(-MAX) : entries)));
  } catch { /* storage unavailable: the ride may be looked at again next time */ }
}

/** Rides worth a look: outdoor cycling, not already tagged, never judged, long enough, newest first. */
export function ebikeCandidates(activities: Activity[], checks: Record<string, EbikeCheck> = readEbikeChecks(), limit = Infinity): Activity[] {
  return activities
    .filter((a) => a.sport_type === 'cycling' && !isEbike(a) && !checks[a.id] && (a.moving_time_seconds || a.duration_seconds || 0) >= 15 * 60)
    .sort((a, b) => b.start_date.localeCompare(a.start_date))
    .slice(0, limit);
}
