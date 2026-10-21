import type { Activity, AthleteProfile, Goal, TrainingSession } from '../../types';
import { calculatePMC, calculatePowerCurve, resolveTss } from '../trainingMath';
import { isEbike } from '../tags';
import { kmToMi, mToFt, roundTo } from '../units';
import { addDaysToDateOnly, getCurrentTrainingWeekStartDate, getLocalDateString, getWeekStartDate } from '../trainingSessions';
import { buildWeekSummaries, goalProgress } from '../trainingLog';

/**
 * A curated "how is the athlete progressing" summary for the chat coach: how fitness has moved over time, weekly and
 * monthly volume, this year against the same date last year, plan against what was done, each goal's progress against
 * its plan, and how trustworthy the numbers are. Without it the chat coach only saw today's fitness number and the
 * latest few activities, which is not enough to say anything about progress.
 */
export function buildProgressContext(
  profile: AthleteProfile | null,
  activities: Activity[],
  goals: Goal[],
  sessions: TrainingSession[],
  now = new Date(),
) {
  const loadProfile = profile ? { ftp: profile.ftp, lthr: profile.lthr, weight_kg: profile.weight_kg } : undefined;
  const today = getLocalDateString(now);
  const dayMs = 24 * 3600 * 1000;
  const dateDaysAgo = (n: number) => getLocalDateString(new Date(now.getTime() - n * dayMs));
  const localDay = (a: Activity) => getLocalDateString(new Date(a.start_date));
  const hoursOf = (a: Activity) => (a.moving_time_seconds || a.duration_seconds || 0) / 3600;
  const milesOf = (a: Activity) => kmToMi(a.distance_meters / 1000);
  const feetOf = (a: Activity) => mToFt(a.total_elevation_gain_m || 0);
  // Motor-assisted rides do not measure the athlete's own output: keep them out of volume totals
  const own = activities.filter((a) => !isEbike(a));

  // Fitness over time
  const pmc = calculatePMC(activities, 400, loadProfile);
  const pmcOn = (daysAgo: number) => {
    const date = dateDaysAgo(daysAgo);
    let found: (typeof pmc)[number] | undefined;
    for (const p of pmc) { if (p.date <= date) found = p; else break; }
    return found;
  };
  const nowPoint = pmc[pmc.length - 1];
  const ctlAt = (d: number) => { const p = pmcOn(d); return p ? roundTo(p.ctl, 1) : null; };
  const change = (d: number) => { const p = pmcOn(d); return p && nowPoint ? roundTo(nowPoint.ctl - p.ctl, 1) : null; };

  // Weekly volume, newest first, 12 weeks
  const thisWeek = getCurrentTrainingWeekStartDate(now);
  const weekly = Array.from({ length: 12 }, (_, i) => addDaysToDateOnly(thisWeek, -7 * i)).map((weekStart) => {
    const inWeek = activities.filter((a) => getWeekStartDate(localDay(a)) === weekStart);
    const mine = inWeek.filter((a) => !isEbike(a));
    return {
      week_start: weekStart + (weekStart === thisWeek ? ' (this week, in progress)' : ''),
      activities: mine.length,
      hours: roundTo(mine.reduce((s, a) => s + hoursOf(a), 0), 1),
      miles: roundTo(mine.reduce((s, a) => s + milesOf(a), 0), 1),
      vert_ft: Math.round(mine.reduce((s, a) => s + feetOf(a), 0)),
      tss: Math.round(inWeek.reduce((s, a) => s + resolveTss(a, loadProfile).tss, 0)),
    };
  });
  const finishedWeeks = weekly.slice(1);
  const avg = (rows: typeof weekly, key: 'hours' | 'tss' | 'vert_ft') => (rows.length ? roundTo(rows.reduce((s, r) => s + r[key], 0) / rows.length, 1) : null);

  // Last 12 months, by month
  const monthly = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = getLocalDateString(d).slice(0, 7);
    const mine = own.filter((a) => localDay(a).slice(0, 7) === key);
    return {
      month: key,
      activities: mine.length,
      hours: roundTo(mine.reduce((s, a) => s + hoursOf(a), 0), 1),
      miles: roundTo(mine.reduce((s, a) => s + milesOf(a), 0), 1),
      vert_ft: Math.round(mine.reduce((s, a) => s + feetOf(a), 0)),
    };
  });

  // This year so far against the same stretch of last year
  const year = now.getFullYear();
  const sameDayLastYear = `${year - 1}${today.slice(4)}`;
  const span = (from: string, to: string) => {
    const set = own.filter((a) => { const d = localDay(a); return d >= from && d <= to; });
    const bySport: Record<string, { activities: number; hours: number; miles: number; vert_ft: number }> = {};
    for (const a of set) {
      const s = (bySport[a.sport_type] ??= { activities: 0, hours: 0, miles: 0, vert_ft: 0 });
      s.activities += 1;
      s.hours = roundTo(s.hours + hoursOf(a), 1);
      s.miles = roundTo(s.miles + milesOf(a), 1);
      s.vert_ft += Math.round(feetOf(a));
    }
    return {
      activities: set.length,
      hours: roundTo(set.reduce((s, a) => s + hoursOf(a), 0), 1),
      miles: roundTo(set.reduce((s, a) => s + milesOf(a), 0), 1),
      vert_ft: Math.round(set.reduce((s, a) => s + feetOf(a), 0)),
      by_sport: bySport,
    };
  };

  // Power, own efforts only
  const weightKg = profile?.weight_kg || undefined;
  const own90 = own.filter((a) => localDay(a) >= dateDaysAgo(90));
  const recentCurve = calculatePowerCurve(own90, weightKg);
  const allTimeCurve = calculatePowerCurve(own, weightKg);
  const powerFor = (sec: number) => {
    const r = recentCurve.find((p) => p.durationSeconds === sec);
    const all = allTimeCurve.find((p) => p.durationSeconds === sec);
    return { duration_minutes: sec / 60, best_watts_last_90_days: r?.watts || null, all_time_best_watts: all?.watts || null };
  };
  const hasPower = own.some((a) => (a.avg_power ?? 0) > 0);

  // Plan vs what was done, and goal progress
  const trainingLog = buildWeekSummaries(sessions, activities, calculatePMC(activities, 400, loadProfile), loadProfile, today).slice(0, 4).map((w) => ({
    week: `${w.weekStart} to ${w.weekEnd}${w.isCurrent ? ' (current, in progress)' : ''}`,
    sessions_planned: w.planned.length,
    sessions_completed: w.completed.length,
    sessions_missed: w.missed.length,
    planned_tss: w.plannedTss,
    actual_tss: w.actualTss,
    planned_hours: roundTo(w.plannedMinutes / 60, 1),
    actual_hours: roundTo(w.actualMinutes / 60, 1),
    unplanned_activities: w.unplanned.length,
  }));
  const goalsProgress = goals.filter((g) => g.status === 'ACTIVE').map((g) => {
    const p = goalProgress(g, pmc, today);
    return {
      goal: g.name,
      target_date: g.target_date ?? null,
      weeks_to_go: g.target_date ? roundTo((new Date(`${g.target_date}T12:00:00`).getTime() - now.getTime()) / (7 * dayMs), 1) : null,
      status_against_plan: p.status,
      ctl_now: p.actualCtl !== undefined ? roundTo(p.actualCtl, 1) : null,
      ctl_the_plan_expects_today: p.expectedCtl !== undefined ? roundTo(p.expectedCtl, 1) : null,
      next_target: p.nextTarget ?? null,
      ctl_gain_per_week_needed: p.neededRampPerWeek !== undefined ? roundTo(p.neededRampPerWeek, 1) : null,
      ctl_gain_per_week_last_4_weeks: p.recentRampPerWeek !== undefined ? roundTo(p.recentRampPerWeek, 1) : null,
      has_phase_plan: (g.periodization_phases?.length ?? 0) > 0,
      has_ctl_targets: (g.periodization_phases ?? []).some((ph) => typeof ph.target_ctl === 'number'),
    };
  });

  // How much to trust the numbers
  const recent12w = activities.filter((a) => localDay(a) >= dateDaysAgo(84));
  const basis: Record<string, number> = { power: 0, ai_estimate: 0, learned_model: 0, heart_rate: 0, rough_baseline: 0 };
  for (const a of recent12w) {
    const source = resolveTss(a, loadProfile).source;
    if (source === 'power') basis.power += 1;
    else if (source === 'ai') basis.ai_estimate += 1;
    else if (source === 'model') basis.learned_model += 1;
    else if (source === 'baseline') basis.rough_baseline += 1;
    else basis.heart_rate += 1;
  }

  return {
    today,
    note: 'Summary of how training has progressed. TSS for activities without power is estimated (see data_quality). Volume totals leave out e-bike rides.',
    training_load: {
      now: nowPoint ? { ctl: roundTo(nowPoint.ctl, 1), atl: roundTo(nowPoint.atl, 1), tsb: roundTo(nowPoint.tsb, 1) } : null,
      ctl_by_age: { weeks_ago_4: ctlAt(28), weeks_ago_8: ctlAt(56), weeks_ago_12: ctlAt(84), weeks_ago_26: ctlAt(182), weeks_ago_52: ctlAt(364) },
      ctl_change: { last_4_weeks: change(28), last_12_weeks: change(84), last_26_weeks: change(182), last_52_weeks: change(364) },
      meaning: 'ctl = fitness (42-day load), atl = fatigue (7-day), tsb = form (ctl - atl)',
    },
    weekly_last_12_weeks_newest_first: weekly,
    weekly_averages: {
      last_4_finished_weeks: { hours: avg(finishedWeeks.slice(0, 4), 'hours'), tss: avg(finishedWeeks.slice(0, 4), 'tss'), vert_ft: avg(finishedWeeks.slice(0, 4), 'vert_ft') },
      the_8_weeks_before_that: { hours: avg(finishedWeeks.slice(4, 12), 'hours'), tss: avg(finishedWeeks.slice(4, 12), 'tss'), vert_ft: avg(finishedWeeks.slice(4, 12), 'vert_ft') },
    },
    monthly_last_12_months_newest_first: monthly,
    year_to_date_vs_same_dates_last_year: {
      this_year: { from: `${year}-01-01`, to: today, ...span(`${year}-01-01`, today) },
      last_year: { from: `${year - 1}-01-01`, to: sameDayLastYear, ...span(`${year - 1}-01-01`, sameDayLastYear) },
    },
    power: hasPower ? { last_90_days_vs_all_time: [powerFor(300), powerFor(1200), powerFor(3600)] } : 'no power-meter data recorded',
    plan_vs_actual_last_4_weeks_newest_first: trainingLog,
    goal_progress: goalsProgress,
    data_quality: {
      activities_in_history: activities.length,
      activities_last_12_weeks: recent12w.length,
      training_load_basis_last_12_weeks: basis,
      ebike_rides_last_12_weeks: recent12w.filter((a) => isEbike(a)).length,
    },
  };
}
