import type { Activity } from '../types';

function sportFamily(sportType: string): string {
  if (sportType === 'cycling' || sportType === 'zwift') return 'cycling';
  if (sportType === 'skimo' || sportType === 'backcountry_skiing') return 'skiing';
  return sportType;
}

/** True when two records look like the same workout: start within 5 minutes, same sport family, similar time and distance. */
export function isDuplicateActivity(candidate: Activity, existing: Activity): boolean {
  const candidateStart = new Date(candidate.start_date).getTime();
  const existingStart = new Date(existing.start_date).getTime();
  if (!Number.isFinite(candidateStart) || !Number.isFinite(existingStart)) return false;
  if (Math.abs(candidateStart - existingStart) > 5 * 60 * 1000) return false;
  if (sportFamily(candidate.sport_type) !== sportFamily(existing.sport_type)) return false;

  const candidateDuration = candidate.moving_time_seconds || candidate.duration_seconds;
  const existingDuration = existing.moving_time_seconds || existing.duration_seconds;
  const durationTolerance = Math.max(120, Math.max(candidateDuration, existingDuration) * 0.03);
  if (Math.abs(candidateDuration - existingDuration) > durationTolerance) return false;

  if (candidate.distance_meters > 0 && existing.distance_meters > 0) {
    const distanceTolerance = Math.max(300, Math.max(candidate.distance_meters, existing.distance_meters) * 0.03);
    if (Math.abs(candidate.distance_meters - existing.distance_meters) > distanceTolerance) return false;
  }

  return true;
}
