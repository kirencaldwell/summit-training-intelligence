import type { Activity, Goal, PMCDayPoint, TrainingSession } from '../types';
import { adherence, buildWeekSummaries, goalProgress } from './trainingLog';
import { evaluateMetric, formatMetricValue, type MetricContext } from './trackingMetrics';
import { addDaysToDateOnly, getLocalDateString, getNextTrainingWeekStartDate, getWeekStartDate } from './trainingSessions';
import type { LoadProfile } from './trainingMath';

/**
 * The coach's brief, with no AI: where the athlete stands today and what needs attention, worked out from the same
 * facts the rest of the app uses (plan, load, goal pacing, tracked metrics). Each flag says what it noticed, with
 * the numbers, and what to do about it.
 */
export type BriefAction = { kind: 'plan_week' } | { kind: 'tab'; tab: 'training' | 'goals' | 'activities' | 'performance'; label: string };

export interface BriefFlag {
  id: string;
  level: 'warn' | 'info' | 'good';
  text: string;
  action?: BriefAction;
}

export type FormLabel = 'very fatigued' | 'fatigued' | 'balanced' | 'fresh' | 'very fresh';

export interface CoachBriefData {
  date: string;
  today: TrainingSession[];
  fitness?: { ctl: number; atl: number; tsb: number; form: FormLabel; rampPerWeek?: number };
  week: { start: string; planned: number; done: number; tssPlanned: number; tssDone: number };
  flags: BriefFlag[];
  /** One plain sentence for the top of the card */
  headline: string;
}

export const formLabel = (tsb: number): FormLabel =>
  tsb < -30 ? 'very fatigued' : tsb < -10 ? 'fatigued' : tsb <= 5 ? 'balanced' : tsb <= 20 ? 'fresh' : 'very fresh';

interface BriefInput {
  sessions: TrainingSession[];
  activities: Activity[];
  pmc: PMCDayPoint[];
  goals: Goal[];
  loadProfile?: LoadProfile;
  metricContext: MetricContext;
  today?: string;
}

const list = (items: string[], max = 3) => (items.length <= max ? items.join(', ') : `${items.slice(0, max).join(', ')} and ${items.length - max} more`);

export function buildBrief({ sessions, activities, pmc, goals, loadProfile, metricContext, today = getLocalDateString() }: BriefInput): CoachBriefData {
  const flags: BriefFlag[] = [];
  const sorted = [...pmc].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted[sorted.length - 1];
  const weekStart = getWeekStartDate(today);
  const plan = sessions.filter((s) => s.status === 'ACCEPTED' || s.status === 'COMPLETED');
  const todays = plan.filter((s) => s.session_date === today);
  const thisWeek = plan.filter((s) => s.week_start_date === weekStart);
  const weeks = buildWeekSummaries(sessions, activities, sorted, loadProfile, today, 8);
  const current = weeks.find((w) => w.isCurrent);

  // Fitness and form
  let rampPerWeek: number | undefined;
  const fourWeeksAgo = [...sorted].reverse().find((p) => p.date <= addDaysToDateOnly(today, -28));
  if (last && fourWeeksAgo) rampPerWeek = (last.ctl - fourWeeksAgo.ctl) / 4;
  const fitness = last ? { ctl: last.ctl, atl: last.atl, tsb: last.tsb, form: formLabel(last.tsb), rampPerWeek } : undefined;
  if (fitness) {
    if (fitness.tsb < -30) flags.push({ id: 'form-low', level: 'warn', text: `Form is ${Math.round(fitness.tsb)}: very fatigued. Keep the next days easy so the fitness you built can settle.` });
    else if (fitness.tsb < -20) flags.push({ id: 'form-low', level: 'warn', text: `Form is ${Math.round(fitness.tsb)}: fatigued. A hard day now costs more than it gives.` });
    else if (fitness.tsb > 20) flags.push({ id: 'form-high', level: 'info', text: `Form is +${Math.round(fitness.tsb)}: very fresh. There is room to add load if a goal needs it.` });
    if (rampPerWeek !== undefined && rampPerWeek > 5) {
      flags.push({ id: 'ramp', level: 'warn', text: `Fitness has risen about ${rampPerWeek.toFixed(1)} CTL a week for four weeks, faster than is sustainable. Plan a lighter week soon.` });
    }
  }

  // The plan this week
  const missed = thisWeek.filter((s) => s.status === 'ACCEPTED' && s.session_date < today);
  if (missed.length > 0) {
    flags.push({
      id: 'missed', level: 'warn',
      text: `${missed.length} planned ${missed.length === 1 ? 'session is' : 'sessions are'} not marked done: ${list(missed.map((s) => s.title))}. Mark ${missed.length === 1 ? 'it' : 'them'} complete if you did ${missed.length === 1 ? 'it' : 'them'}.`,
      action: { kind: 'tab', tab: 'training', label: 'Open the plan' },
    });
  }
  const unlinked = thisWeek.filter((s) => s.status === 'COMPLETED' && (s.completed_activity_ids?.length ?? 0) === 0);
  if (unlinked.length > 0) {
    flags.push({
      id: 'unlinked', level: 'info',
      text: `${unlinked.length === 1 ? 'A completed session has' : `${unlinked.length} completed sessions have`} no linked activity (${list(unlinked.map((s) => s.title))}), so ${unlinked.length === 1 ? 'it cannot' : 'they cannot'} be scored.`,
      action: { kind: 'tab', tab: 'training', label: 'Link activities' },
    });
  }

  // Next week
  const dow = new Date(`${today}T12:00:00`).getDay();
  const nextWeek = getNextTrainingWeekStartDate(new Date(`${today}T12:00:00`));
  const nextPlanned = plan.some((s) => s.week_start_date === nextWeek);
  if ((dow === 0 || dow >= 5) && !nextPlanned) {
    flags.push({ id: 'next-week', level: 'warn', text: "Next week isn't planned yet. A two-minute check-in sets it up around your schedule.", action: { kind: 'plan_week' } });
  } else if (!thisWeek.some((s) => s.session_date >= today && s.status === 'ACCEPTED') && dow >= 1 && dow <= 4 && thisWeek.length === 0) {
    flags.push({ id: 'week-empty', level: 'info', text: 'Nothing is planned for the rest of this week.', action: { kind: 'plan_week' } });
  }

  // Habits over the last weeks
  const adh = adherence(weeks, 4);
  if (adh.sessionRate !== undefined && adh.sessionsDue >= 4 && adh.sessionRate < 0.6) {
    flags.push({
      id: 'adherence', level: 'warn',
      text: `Only ${adh.sessionsDone} of ${adh.sessionsDue} planned sessions were done over the last ${adh.weeks} weeks. A lighter plan you can keep beats a full one you cannot.`,
      action: { kind: 'plan_week' },
    });
  }

  // Goals: pacing against the phase targets, and the tracked metrics that are behind
  for (const goal of goals.filter((g) => g.status === 'ACTIVE')) {
    const gp = goalProgress(goal, sorted, today);
    if (gp.status === 'behind' || gp.status === 'well_behind') {
      flags.push({
        id: `goal-${goal.id}`, level: 'warn',
        text: `${goal.name} is ${gp.status === 'well_behind' ? 'well ' : ''}behind its plan: fitness ${Math.round(gp.actualCtl ?? 0)} against about ${Math.round(gp.expectedCtl ?? 0)} expected today${gp.neededRampPerWeek !== undefined ? `, needing about ${gp.neededRampPerWeek >= 0 ? '+' : ''}${gp.neededRampPerWeek.toFixed(1)} CTL a week to catch up` : ''}.`,
        action: { kind: 'tab', tab: 'training', label: 'See the long-term plan' },
      });
    } else if (gp.status === 'ahead') {
      flags.push({ id: `goal-${goal.id}`, level: 'good', text: `${goal.name} is ahead of its plan (fitness ${Math.round(gp.actualCtl ?? 0)} vs about ${Math.round(gp.expectedCtl ?? 0)}).` });
    }
    for (const metric of goal.tracking_metrics ?? []) {
      const ev = evaluateMetric(metric, metricContext);
      if ((ev.status === 'behind' || ev.status === 'well_behind') && ev.current !== undefined && ev.expected !== undefined) {
        flags.push({
          id: `metric-${metric.id}`, level: 'warn',
          text: `${metric.name}: ${formatMetricValue(metric, ev.current)} now vs about ${formatMetricValue(metric, ev.expected)} on the path to ${formatMetricValue(metric, metric.target)}.`,
          action: { kind: 'tab', tab: 'training', label: 'See the metric' },
        });
      }
    }
  }

  const order = { warn: 0, info: 1, good: 2 } as const;
  flags.sort((a, b) => order[a.level] - order[b.level]);

  const done = thisWeek.filter((s) => s.status === 'COMPLETED').length;
  const pending = todays.filter((s) => s.status !== 'COMPLETED');
  const attention = flags.filter((f) => f.level === 'warn').length;
  const headline = [
    pending.length > 0 ? `Today: ${list(pending.map((s) => s.title), 2)}.` : todays.length > 0 ? 'Today\'s session is done.' : 'Nothing planned for today.',
    fitness ? `Form is ${fitness.form}.` : '',
    attention > 0 ? `${attention} ${attention === 1 ? 'thing needs' : 'things need'} attention.` : 'Nothing needs attention.',
  ].filter(Boolean).join(' ');

  return {
    date: today,
    today: todays,
    fitness,
    week: { start: weekStart, planned: thisWeek.length, done, tssPlanned: current?.plannedTss ?? 0, tssDone: current?.actualTss ?? 0 },
    flags,
    headline,
  };
}
