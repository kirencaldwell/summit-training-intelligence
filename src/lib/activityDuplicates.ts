import type { Activity } from '../types';

function sportFamily(sportType: string): string {
  if (sportType === 'cycling' || sportType === 'zwift') return 'cycling';
  if (sportType === 'skimo' || sportType === 'backcountry_skiing') return 'skiing';
  return sportType;
}

/** Two devices rarely start on the same second; this is how far apart their starts can be. */
export const MAX_START_GAP_MS = 10 * 60 * 1000;
/** How much of the shorter recording must fall inside the other one's time span. */
const MIN_OVERLAP_SHARE = 0.8;

/** Elapsed length of a recording: the longer of elapsed and moving time (auto-pause only shortens moving time). */
function spanSeconds(a: Activity): number {
  return Math.max(a.duration_seconds || 0, a.moving_time_seconds || 0);
}

/**
 * True when two records are the same workout recorded twice (say a Garmin and a COROS worn on one ride).
 * They must be the same sport family, start within 10 minutes of each other, and cover mostly the same stretch
 * of time. Overlap is what matters rather than moving time: one watch may auto-pause at a stop and the other
 * not, so their moving times can differ a lot while the rides are plainly the same. Distance only has to be
 * roughly alike (devices disagree by a few percent).
 */
export function isDuplicateActivity(candidate: Activity, existing: Activity): boolean {
  const candidateStart = new Date(candidate.start_date).getTime();
  const existingStart = new Date(existing.start_date).getTime();
  if (!Number.isFinite(candidateStart) || !Number.isFinite(existingStart)) return false;
  if (Math.abs(candidateStart - existingStart) > MAX_START_GAP_MS) return false;
  if (sportFamily(candidate.sport_type) !== sportFamily(existing.sport_type)) return false;

  const candidateSpan = spanSeconds(candidate) * 1000;
  const existingSpan = spanSeconds(existing) * 1000;
  if (!(candidateSpan > 0 && existingSpan > 0)) return false;

  const overlap = Math.min(candidateStart + candidateSpan, existingStart + existingSpan) - Math.max(candidateStart, existingStart);
  if (overlap < MIN_OVERLAP_SHARE * Math.min(candidateSpan, existingSpan)) return false;

  if (candidate.distance_meters > 0 && existing.distance_meters > 0) {
    const larger = Math.max(candidate.distance_meters, existing.distance_meters);
    if (Math.abs(candidate.distance_meters - existing.distance_meters) > Math.max(500, larger * 0.15)) return false;
  }

  return true;
}
