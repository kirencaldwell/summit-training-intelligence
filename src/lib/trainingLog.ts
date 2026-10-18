import type { Activity, Goal, PMCDayPoint, TrainingSession } from '../types';
import { resolveTss, type LoadProfile } from './trainingMath';
import { addDaysToDateOnly, getLocalDateString, getWeekStartDate } from './trainingSessions';

/** What was planned for a training week, what was done, and how fitness moved. */
export interface WeekSummary {
  weekStart: string;
  weekEnd: string;
  isCurrent: boolean;
  /** Accepted or completed sessions of the week (the plan) */
  planned: TrainingSession[];
  completed: TrainingSession[];
  /** Planned, not marked complete, and the day has passed */
  missed: TrainingSession[];
  /** Planned for today or later (current week only) */
  upcoming: TrainingSession[];
  plannedMinutes: number;
  plannedTss: number;
  /** Every activity recorded that week, planned or not */
  activities: Activity[];
  actualMinutes: number;
  actualTss: number;
  /** Activities that week that are not linked to any session */
  unplanned: Activity[];
  /** Fitness (CTL) at the start and end of the week, when known */
  ctlStart?: number;
  ctlEnd?: number;
}

const localDay = (iso: string) => getLocalDateString(new Date(iso));
const minutesOf = (a: Activity) => Math.round((a.moving_time_seconds || a.duration_seconds || 0) / 60);

/** CTL on a date: the last training-load point on or before it. */
export function ctlOn(pmc: PMCDayPoint[], date: string): number | undefined {
  let found: number | undefined;
  for (const p of pmc) {
    if (p.date <= date) found = p.ctl;
    else break;
  }
  return found;
}

/**
 * One summary per training week (Monday to Sunday), newest first, from the current week back to the earliest week
 * with a planned session (at most `maxWeeks`). Weeks with neither a plan nor an activity are left out.
 */
export function buildWeekSummaries(
  sessions: TrainingSession[],
  activities: Activity[],
  pmc: PMCDayPoint[],
  profile: LoadProfile | undefined,
  today = getLocalDateString(),
  maxWeeks = 26,
): WeekSummary[] {
  const plan = sessions.filter((s) => s.status === 'ACCEPTED' || s.status === 'COMPLETED');
  const currentWeek = getWeekStartDate(today);
  const earliestPlanned = plan.reduce((min, s) => (s.session_date < min ? s.session_date : min), currentWeek);
  const firstWeek = getWeekStartDate(earliestPlanned);
  const linkedIds = new Set(plan.flatMap((s) => s.completed_activity_ids ?? []));
  const sortedPmc = [...pmc].sort((a, b) => a.date.localeCompare(b.date));

  const weeks: WeekSummary[] = [];
  for (let week = currentWeek, n = 0; week >= firstWeek && n < maxWeeks; week = addDaysToDateOnly(week, -7), n++) {
    const end = addDaysToDateOnly(week, 6);
    const planned = plan
      .filter((s) => s.session_date >= week && s.session_date <= end)
      .sort((a, b) => a.session_date.localeCompare(b.session_date));
    const done = activities
      .filter((a) => { const d = localDay(a.start_date); return d >= week && d <= end; })
      .sort((a, b) => a.start_date.localeCompare(b.start_date));
    if (planned.length === 0 && done.length === 0) continue;
    weeks.push({
      weekStart: week,
      weekEnd: end,
      isCurrent: week === currentWeek,
      planned,
      completed: planned.filter((s) => s.status === 'COMPLETED'),
      missed: planned.filter((s) => s.status !== 'COMPLETED' && s.session_date < today),
      upcoming: planned.filter((s) => s.status !== 'COMPLETED' && s.session_date >= today),
      plannedMinutes: planned.reduce((sum, s) => sum + (s.duration_minutes || 0), 0),
      plannedTss: planned.reduce((sum, s) => sum + (s.target_tss || 0), 0),
      activities: done,
      actualMinutes: done.reduce((sum, a) => sum + minutesOf(a), 0),
      actualTss: Math.round(done.reduce((sum, a) => sum + resolveTss(a, profile).tss, 0)),
      unplanned: done.filter((a) => !linkedIds.has(a.id)),
      ctlStart: ctlOn(sortedPmc, addDaysToDateOnly(week, -1)),
      ctlEnd: ctlOn(sortedPmc, end < today ? end : today),
    });
  }
  return weeks;
}

/** Plan adherence over finished weeks: sessions done of those due, and load done of load planned. */
export function adherence(weeks: WeekSummary[], lastN = 4) {
  const finished = weeks.filter((w) => !w.isCurrent && w.planned.length > 0).slice(0, lastN);
  const due = finished.reduce((s, w) => s + w.planned.length, 0);
  const done = finished.reduce((s, w) => s + w.completed.length, 0);
  const plannedTss = finished.reduce((s, w) => s + w.plannedTss, 0);
  const actualTss = finished.reduce((s, w) => s + w.actualTss, 0);
  return {
    weeks: finished.length,
    sessionsDone: done,
    sessionsDue: due,
    sessionRate: due > 0 ? done / due : undefined,
    tssRate: plannedTss > 0 ? actualTss / plannedTss : undefined,
  };
}

export type GoalProgressStatus = 'on_track' | 'ahead' | 'behind' | 'well_behind' | 'no_targets' | 'not_started' | 'past';

export interface GoalProgress {
  goal: Goal;
  status: GoalProgressStatus;
  /** CTL now, and where the plan's phase targets put it today (straight line between targets) */
  actualCtl?: number;
  expectedCtl?: number;
  /** The next phase target still ahead, and the weekly CTL rise needed to reach it on time */
  nextTarget?: { phase: string; ctl: number; by: string };
  neededRampPerWeek?: number;
  /** CTL change per week over the last four weeks */
  recentRampPerWeek?: number;
}

/**
 * Is fitness where the goal's plan says it should be? The phases are laid out ending on the goal date; each phase
 * with a target CTL is a point on the path, starting from the CTL actually held when the plan began. Today's
 * expected CTL is read off that path and compared with the real one.
 */
export function goalProgress(goal: Goal, pmc: PMCDayPoint[], today = getLocalDateString()): GoalProgress {
  const sorted = [...pmc].sort((a, b) => a.date.localeCompare(b.date));
  const actualCtl = ctlOn(sorted, today);
  const fourWeeksAgo = ctlOn(sorted, addDaysToDateOnly(today, -28));
  const recentRampPerWeek = actualCtl !== undefined && fourWeeksAgo !== undefined ? (actualCtl - fourWeeksAgo) / 4 : undefined;
  const base = { goal, actualCtl, recentRampPerWeek };

  const phases = goal.periodization_phases ?? [];
  if (!goal.target_date || !phases.some((p) => typeof p.target_ctl === 'number')) return { ...base, status: 'no_targets' };
  if (today > goal.target_date) return { ...base, status: 'past' };

  const totalDays = phases.reduce((s, p) => s + Math.max(0, p.weeks) * 7, 0);
  const planStart = addDaysToDateOnly(goal.target_date, -totalDays);
  if (today < planStart) return { ...base, status: 'not_started' };

  const startCtl = ctlOn(sorted, planStart) ?? 0;
  const path: { date: string; ctl: number; phase: string }[] = [{ date: planStart, ctl: startCtl, phase: 'start' }];
  let cursor = planStart;
  for (const p of phases) {
    const end = addDaysToDateOnly(cursor, Math.max(0, p.weeks) * 7 - 1);
    if (typeof p.target_ctl === 'number') path.push({ date: end, ctl: p.target_ctl, phase: p.name });
    cursor = addDaysToDateOnly(end, 1);
  }
  const days = (a: string, b: string) => (new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86400000;
  let expectedCtl = path[path.length - 1].ctl;
  for (let i = 1; i < path.length; i++) {
    if (today <= path[i].date) {
      const a = path[i - 1];
      const b = path[i];
      const span = days(a.date, b.date);
      expectedCtl = span > 0 ? a.ctl + ((b.ctl - a.ctl) * days(a.date, today)) / span : b.ctl;
      break;
    }
  }
  const next = path.slice(1).find((p) => p.date >= today);
  const weeksToNext = next ? Math.max(1, days(today, next.date) / 7) : undefined;
  const neededRampPerWeek = next && actualCtl !== undefined && weeksToNext ? (next.ctl - actualCtl) / weeksToNext : undefined;

  let status: GoalProgressStatus = 'on_track';
  if (actualCtl !== undefined) {
    const tolerance = Math.max(3, expectedCtl * 0.05);
    const gap = actualCtl - expectedCtl;
    status = gap > tolerance * 2 ? 'ahead' : gap >= -tolerance ? 'on_track' : gap >= -tolerance * 3 ? 'behind' : 'well_behind';
  }
  return {
    ...base,
    status,
    expectedCtl,
    nextTarget: next ? { phase: next.phase, ctl: next.ctl, by: next.date } : undefined,
    neededRampPerWeek,
  };
}
