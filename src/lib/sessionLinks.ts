import type { Activity, TrainingSession } from '../types';
import { addDaysToDateOnly, getLocalDateString } from './trainingSessions';

export interface LinkCandidate {
  activity: Activity;
  date: string;
  /** Whole days from the planned session (0 = same day) */
  daysAway: number;
  sameSport: boolean;
  /** Another session this activity is already linked to */
  linkedTo?: TrainingSession;
}

const DAY_MS = 24 * 3600 * 1000;

/**
 * Activities that could be the workout a planned session describes: within a few days of it, nearest first.
 * `windowDays` widens how far either side to look.
 */
export function linkCandidates(session: TrainingSession, activities: Activity[], sessions: TrainingSession[], windowDays = 3): LinkCandidate[] {
  const from = addDaysToDateOnly(session.session_date, -windowDays);
  const to = addDaysToDateOnly(session.session_date, windowDays);
  const sessionDay = new Date(`${session.session_date}T12:00:00`).getTime();
  const linkedElsewhere = new Map<string, TrainingSession>();
  for (const other of sessions) {
    if (other.id === session.id) continue;
    for (const id of other.completed_activity_ids ?? []) linkedElsewhere.set(id, other);
  }
  return activities
    .map((activity) => {
      const date = getLocalDateString(new Date(activity.start_date));
      const day = new Date(`${date}T12:00:00`).getTime();
      return {
        activity,
        date,
        daysAway: Math.round((day - sessionDay) / DAY_MS),
        sameSport: activity.sport_type === session.sport_type,
        linkedTo: linkedElsewhere.get(activity.id),
      };
    })
    .filter((c) => c.date >= from && c.date <= to)
    .sort((a, b) =>
      Math.abs(a.daysAway) - Math.abs(b.daysAway)
      || Number(b.sameSport) - Number(a.sameSport)
      || a.activity.start_date.localeCompare(b.activity.start_date));
}

/** What to tick by default: same-day activities in the same sport that aren't already linked to another session. */
export function suggestedLinks(candidates: LinkCandidate[]): string[] {
  return candidates.filter((c) => c.daysAway === 0 && c.sameSport && !c.linkedTo).map((c) => c.activity.id);
}
