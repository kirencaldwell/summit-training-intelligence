import React, { useMemo } from 'react';
import { History, Target, TrendingUp } from 'lucide-react';
import type { AthleteProfile, Goal, TrainingSession } from '../types';
import { calculatePMC } from '../lib/trainingMath';
import { adherence, buildWeekSummaries, goalProgress, type GoalProgress, type WeekSummary } from '../lib/trainingLog';
import { getLocalDateString } from '../lib/trainingSessions';
import { TrainingWeekSection, type TrainingWeekSectionProps } from './TrainingWeekSection';

interface TrainingLogProps extends Omit<TrainingWeekSectionProps, 'trainingSessions' | 'variant' | 'allSessions'> {
  sessions: TrainingSession[];
  goals: Goal[];
  profile: AthleteProfile;
}

const fmtDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' });
const hours = (minutes: number) => `${Math.round((minutes / 60) * 10) / 10} h`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const signed = (x: number, d = 1) => `${x >= 0 ? '+' : ''}${x.toFixed(d)}`;

const STATUS_META: Record<GoalProgress['status'], { label: string; cls: string }> = {
  on_track: { label: 'On track', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  ahead: { label: 'Ahead of plan', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  behind: { label: 'Slightly behind', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  well_behind: { label: 'Behind', cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
  no_targets: { label: 'No fitness targets', cls: 'bg-white/5 text-slate-300 border-white/10' },
  not_started: { label: 'Plan not started', cls: 'bg-white/5 text-slate-300 border-white/10' },
  past: { label: 'Goal date passed', cls: 'bg-white/5 text-slate-300 border-white/10' },
};

const GoalProgressCard: React.FC<{ progress: GoalProgress }> = ({ progress: p }) => {
  const meta = STATUS_META[p.status];
  const ramp = p.recentRampPerWeek;
  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/50 p-4 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-white flex items-center gap-2"><Target className="w-4 h-4 text-amber-400" /> {p.goal.name}</p>
        <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${meta.cls}`}>{meta.label}</span>
      </div>
      {p.expectedCtl !== undefined && p.actualCtl !== undefined ? (
        <p className="text-xs text-slate-300">
          Fitness (CTL) is <span className="font-semibold text-white">{Math.round(p.actualCtl)}</span>; the plan expects about{' '}
          <span className="font-semibold text-white">{Math.round(p.expectedCtl)}</span> today.
        </p>
      ) : p.actualCtl !== undefined ? (
        <p className="text-xs text-slate-300">Fitness (CTL) is <span className="font-semibold text-white">{Math.round(p.actualCtl)}</span>.</p>
      ) : null}
      {p.nextTarget && p.neededRampPerWeek !== undefined && (
        <p className="text-xs text-slate-400">
          Next target: {p.nextTarget.phase} CTL {p.nextTarget.ctl} by {fmtDay(p.nextTarget.by)}. That needs {signed(p.neededRampPerWeek)} per week
          {ramp !== undefined ? `; you have been gaining ${signed(ramp)} per week over the last 4 weeks` : ''}.
          {p.neededRampPerWeek > 8 ? ' More than about 8 a week is a steep build and hard to sustain.' : ''}
        </p>
      )}
      {p.status === 'no_targets' && (
        <p className="text-xs text-slate-400">
          This goal's phases have no fitness (CTL) targets, so on-track can't be measured. Ask the coach to add targets when it replans the goal.
          {ramp !== undefined ? ` Your fitness has changed ${signed(ramp)} per week over the last 4 weeks.` : ''}
        </p>
      )}
    </div>
  );
};

const Chip: React.FC<{ children: React.ReactNode; tone?: 'ok' | 'warn' | 'plain' }> = ({ children, tone = 'plain' }) => (
  <span className={`rounded-full border px-2 py-0.5 text-[11px] tabular-nums ${tone === 'ok' ? 'border-emerald-500/30 text-emerald-300' : tone === 'warn' ? 'border-amber-500/30 text-amber-300' : 'border-white/10 text-slate-300'}`}>
    {children}
  </span>
);

const WeekRow: React.FC<{ week: WeekSummary; open: boolean; children: React.ReactNode }> = ({ week, open, children }) => {
  const due = week.planned.length - week.upcoming.length;
  const loadShare = week.plannedTss > 0 ? week.actualTss / week.plannedTss : undefined;
  return (
    <details open={open} className="rounded-xl border border-white/10 bg-slate-900/40">
      <summary className="cursor-pointer list-none px-4 py-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-white">
          {week.isCurrent ? 'This week' : `Week of ${fmtDay(week.weekStart)}`}
          <span className="ml-2 text-[11px] font-normal text-slate-500">{fmtDay(week.weekStart)} – {fmtDay(week.weekEnd)}</span>
        </span>
        <span className="flex flex-wrap gap-1.5">
          {week.planned.length > 0 && (
            <Chip tone={due === 0 ? 'plain' : week.completed.length >= due ? 'ok' : 'warn'}>
              {week.completed.length}/{week.planned.length} sessions done{week.missed.length ? ` · ${week.missed.length} missed` : ''}
            </Chip>
          )}
          <Chip tone={loadShare === undefined ? 'plain' : loadShare >= 0.85 && loadShare <= 1.2 ? 'ok' : 'warn'}>
            {week.plannedTss > 0 ? `${week.actualTss} of ${week.plannedTss} TSS` : `${week.actualTss} TSS`}
          </Chip>
          <Chip>{week.plannedMinutes > 0 ? `${hours(week.actualMinutes)} of ${hours(week.plannedMinutes)}` : hours(week.actualMinutes)}</Chip>
          {week.ctlStart !== undefined && week.ctlEnd !== undefined && (
            <Chip tone={week.ctlEnd >= week.ctlStart ? 'ok' : 'plain'}>CTL {Math.round(week.ctlStart)} → {Math.round(week.ctlEnd)}</Chip>
          )}
        </span>
      </summary>
      <div className="px-4 pb-4 space-y-3">{children}</div>
    </details>
  );
};

/**
 * Completed (and missed) sessions live here, week by week: what was planned, what was actually done, and how
 * fitness moved, with each goal's progress against its plan on top.
 */
export const TrainingLog: React.FC<TrainingLogProps> = ({ sessions, goals, profile, activities, onOpenActivity, ...actions }) => {
  const today = getLocalDateString();
  const loadProfile = useMemo(() => ({ ftp: profile.ftp, lthr: profile.lthr, weight_kg: profile.weight_kg }), [profile.ftp, profile.lthr, profile.weight_kg]);
  const pmc = useMemo(() => calculatePMC(activities, 400, loadProfile), [activities, loadProfile]);
  const weeks = useMemo(() => buildWeekSummaries(sessions, activities, pmc, loadProfile, today), [sessions, activities, pmc, loadProfile, today]);
  const progress = useMemo(
    () => goals.filter((g) => g.status === 'ACTIVE').map((g) => goalProgress(g, pmc, today)),
    [goals, pmc, today],
  );
  const recent = adherence(weeks);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-white flex items-center gap-2"><History className="w-4 h-4 text-cyan-400" /> Training log</h2>
        <p className="text-xs text-slate-400 mt-1">What was planned each week, what you actually did, and whether it is moving you toward your goals.</p>
      </div>

      {(progress.length > 0 || recent.weeks > 0) && (
        <div className="grid gap-3 lg:grid-cols-2">
          {progress.map((p) => <GoalProgressCard key={p.goal.id} progress={p} />)}
          {recent.weeks > 0 && (
            <div className="rounded-xl border border-white/10 bg-slate-900/50 p-4 space-y-1">
              <p className="text-sm font-bold text-white flex items-center gap-2"><TrendingUp className="w-4 h-4 text-cyan-400" /> Sticking to the plan</p>
              <p className="text-xs text-slate-300">
                Last {recent.weeks} finished {recent.weeks === 1 ? 'week' : 'weeks'}: {recent.sessionsDone} of {recent.sessionsDue} planned sessions done
                {recent.sessionRate !== undefined ? ` (${pct(recent.sessionRate)})` : ''}
                {recent.tssRate !== undefined ? `, ${pct(recent.tssRate)} of the planned load` : ''}.
              </p>
              <p className="text-[11px] text-slate-500">Load counts every activity in those weeks, planned or not.</p>
            </div>
          )}
        </div>
      )}

      {weeks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/10 px-4 py-5 text-sm text-slate-400">
          Nothing logged yet. Completed sessions and the weeks you train will show up here.
        </div>
      ) : (
        <div className="space-y-2">
          {weeks.map((week, i) => {
            // The current week's open sessions are listed above; the log shows what is done (and past-due) so far
            // Newest first so the latest session is at the top
            const listed = (week.isCurrent ? week.planned.filter((s) => s.status === 'COMPLETED') : week.planned)
              .slice()
              .sort((a, b) => b.session_date.localeCompare(a.session_date));
            return (
              <WeekRow key={week.weekStart} week={week} open={i === 0 || (i === 1 && weeks[0].isCurrent && listed.length === 0)}>
                {listed.length > 0 && (
                  <TrainingWeekSection
                    {...actions}
                    variant="log"
                    trainingSessions={listed}
                    allSessions={sessions}
                    activities={activities}
                    onOpenActivity={onOpenActivity}
                  />
                )}
                {week.isCurrent && week.upcoming.length + week.missed.length > 0 && (
                  <p className="text-[11px] text-slate-500">
                    {week.upcoming.length + week.missed.length} more planned this week, listed under This week above.
                  </p>
                )}
                {week.unplanned.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-slate-300 mb-1">Not in the plan</p>
                    <div className="flex flex-wrap gap-1.5">
                      {week.unplanned.slice().sort((a, b) => b.start_date.localeCompare(a.start_date)).map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => onOpenActivity(a)}
                          className="max-w-full truncate rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[11px] text-slate-300 hover:bg-white/10"
                        >
                          {fmtDay(getLocalDateString(new Date(a.start_date)))} · {a.title}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {listed.length === 0 && week.unplanned.length === 0 && !week.isCurrent && (
                  <p className="text-xs text-slate-500">No sessions or activities this week.</p>
                )}
              </WeekRow>
            );
          })}
        </div>
      )}
    </section>
  );
};
