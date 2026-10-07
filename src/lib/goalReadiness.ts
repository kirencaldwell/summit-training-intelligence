/** A coach-written, on-request judgement of how ready the athlete is for one goal. */

export type ReadinessStatus = 'ahead' | 'on_track' | 'slightly_behind' | 'behind' | 'too_early' | 'insufficient_data';
export type DimensionRating = 'strong' | 'on_track' | 'needs_work' | 'unknown';

export interface ReadinessDimension {
  name: string;
  rating: DimensionRating;
  evidence: string;
}

export interface GoalReadinessAssessment {
  goalId: string;
  status: ReadinessStatus;
  headline: string;
  summary: string;
  dimensions: ReadinessDimension[];
  nextFocus: string[];
  dataGaps: string[];
  assessedAt: string;
}

export const READINESS_STATUS_LABEL: Record<ReadinessStatus, string> = {
  ahead: 'Ahead of schedule',
  on_track: 'On track',
  slightly_behind: 'Slightly behind',
  behind: 'Behind',
  too_early: 'Too early to judge',
  insufficient_data: 'Not enough data',
};

const STATUSES = Object.keys(READINESS_STATUS_LABEL) as ReadinessStatus[];
const RATINGS: DimensionRating[] = ['strong', 'on_track', 'needs_work', 'unknown'];

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const textList = (value: unknown, count: number, max: number) =>
  (Array.isArray(value) ? value : []).map((v) => text(v, max)).filter(Boolean).slice(0, count);

/** Reads the model's JSON reply, tolerating stray prose or fences, and clamps it to the expected shape. */
export function parseReadinessReply(raw: string, goalId: string): GoalReadinessAssessment {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The coach did not return a readable assessment. Try again.');
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new Error('The coach returned an assessment that could not be read. Try again.');
  }

  const status = STATUSES.includes(parsed.status as ReadinessStatus) ? (parsed.status as ReadinessStatus) : 'insufficient_data';
  const dimensions = (Array.isArray(parsed.dimensions) ? parsed.dimensions : [])
    .map((d): ReadinessDimension => {
      const item = (d ?? {}) as Record<string, unknown>;
      return {
        name: text(item.name, 60),
        rating: RATINGS.includes(item.rating as DimensionRating) ? (item.rating as DimensionRating) : 'unknown',
        evidence: text(item.evidence, 400),
      };
    })
    .filter((d) => d.name)
    .slice(0, 6);

  const headline = text(parsed.headline, 200);
  const summary = text(parsed.summary, 1200);
  if (!headline && !summary) throw new Error('The coach returned an empty assessment. Try again.');

  return {
    goalId,
    status,
    headline,
    summary,
    dimensions,
    nextFocus: textList(parsed.next_focus, 3, 300),
    dataGaps: textList(parsed.data_gaps, 5, 200),
    assessedAt: new Date().toISOString(),
  };
}

// Kept in this browser only; an assessment is cheap to re-run and goes stale as training changes.
const storageKey = (goalId: string) => `summit_goal_readiness_${goalId}`;

export function loadReadiness(goalId: string): GoalReadinessAssessment | null {
  try {
    const raw = localStorage.getItem(storageKey(goalId));
    if (!raw) return null;
    const saved = JSON.parse(raw) as GoalReadinessAssessment;
    return saved && saved.goalId === goalId && STATUSES.includes(saved.status) ? saved : null;
  } catch {
    return null;
  }
}

export function saveReadiness(assessment: GoalReadinessAssessment): void {
  try {
    localStorage.setItem(storageKey(assessment.goalId), JSON.stringify(assessment));
  } catch {
    // Storage can be blocked or full; the assessment still shows for this session
  }
}
