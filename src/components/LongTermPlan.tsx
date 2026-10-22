import React, { useState } from 'react';
import { Flag, Sparkles, CheckCircle2, Circle } from 'lucide-react';
import type { Activity, AthleteProfile, Goal, PeriodizationPhase, TrainingSession } from '../types';
import type { TrackingMetric } from '../lib/trackingMetrics';
import { GoalMetrics } from './GoalMetrics';
import { addDaysToDateOnly, getLocalDateString } from '../lib/trainingSessions';

interface LongTermPlanProps {
  goals: Goal[];
  /** Current fitness (CTL), to compare with each phase's target */
  currentCtl?: number;
  onPlanWithCoach?: (goal: Goal) => void;
  /** Needed for the weekly progress metrics under each goal */
  activities?: Activity[];
  sessions?: TrainingSession[];
  profile?: AthleteProfile;
  onSuggestMetrics?: (goalId: string) => Promise<TrackingMetric[]>;
  onSaveMetrics?: (goalId: string, metrics: TrackingMetric[]) => Promise<{ synced: boolean }>;
  /** Sets up metrics for every active goal that has none, measured from when its plan began */
  onBackfillMetrics?: () => Promise<{ goal: string; count?: number; synced?: boolean; error?: string }[]>;
}

interface PlacedPhase extends PeriodizationPhase {
  start?: string;
  end?: string;
  current: boolean;
  past: boolean;
}

const DAY_MS = 86400000;
const fmtDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' });
const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / DAY_MS);

/**
 * Lays the phases out on the calendar so they end on the goal date (phases are planned backwards from it).
 * Without a goal date there are no dates, and the phase marked CURRENT (if any) is the current one.
 */
function placePhases(goal: Goal, today: string): PlacedPhase[] {
  const phases = goal.periodization_phases ?? [];
  if (!goal.target_date) {
    return phases.map((p) => ({ ...p, current: p.status === 'CURRENT', past: p.status === 'COMPLETED' }));
  }
  const totalDays = phases.reduce((sum, p) => sum + Math.max(0, p.weeks) * 7, 0);
  let cursor = addDaysToDateOnly(goal.target_date, -totalDays);
  return phases.map((p) => {
    const start = cursor;
    const end = addDaysToDateOnly(start, Math.max(0, p.weeks) * 7 - 1);
    cursor = addDaysToDateOnly(end, 1);
    return { ...p, start, end, current: today >= start && today <= end, past: today > end };
  });
}

const PHASE_COLORS = ['#38BDF8', '#34D399', '#FBBF24', '#F97316', '#F43F5E', '#A78BFA'];

export const LongTermPlan: React.FC<LongTermPlanProps> = ({ goals, currentCtl, onPlanWithCoach, activities, sessions, profile, onSuggestMetrics, onSaveMetrics, onBackfillMetrics }) => {
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResults, setBackfillResults] = useState<{ goal: string; count?: number; synced?: boolean; error?: string }[] | null>(null);
  const today = getLocalDateString();
  const active = goals
    .filter((g) => g.status === 'ACTIVE')
    .sort((a, b) => (a.target_date ?? '9999').localeCompare(b.target_date ?? '9999'));

  if (active.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-white/10 px-4 py-5 text-sm text-slate-400">
        No active goals. Add a goal on the Goals tab and the coach can plan the phases leading up to it.
      </div>
    );
  }

  const missing = active.filter((g) => !(g.tracking_metrics?.length));
  const runBackfill = async () => {
    if (!onBackfillMetrics) return;
    setBackfilling(true);
    setBackfillResults(null);
    try {
      setBackfillResults(await onBackfillMetrics());
    } finally {
      setBackfilling(false);
    }
  };

  return (
    <div className="space-y-4">
      {onBackfillMetrics && (missing.length > 0 || backfillResults) && (
        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3 space-y-2">
          {missing.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-300">
                {missing.length} of your {active.length} {active.length === 1 ? 'goal has' : 'goals have'} no progress metrics yet. The coach can set them all up now, measured from when each plan began so what you have already done counts.
              </p>
              <button
                type="button"
                disabled={backfilling}
                onClick={() => void runBackfill()}
                className="min-h-9 inline-flex items-center gap-1.5 px-3 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-50"
              >
                <Sparkles className={`w-3.5 h-3.5 ${backfilling ? 'animate-pulse' : ''}`} />
                {backfilling ? 'Setting up…' : `Set up metrics for ${missing.length === 1 ? 'this goal' : `all ${missing.length} goals`}`}
              </button>
            </div>
          )}
          {backfillResults && (
            <ul role="status" className="space-y-0.5 text-xs">
              {backfillResults.map((r, i) => (
                <li key={i} className={r.error ? 'text-rose-300' : 'text-emerald-300'}>
                  {r.error ? `${r.goal}: ${r.error}` : `${r.goal}: ${r.count} ${r.count === 1 ? 'metric' : 'metrics'} set up${r.synced === false ? ' (saved on this device only until the database is updated)' : ''}`}
                </li>
              ))}
              <li className="text-slate-500">Each can be removed, or replaced with new suggestions, from its goal below.</li>
            </ul>
          )}
        </div>
      )}
      {active.map((goal) => {
        const phases = placePhases(goal, today);
        const totalWeeks = phases.reduce((s, p) => s + Math.max(0, p.weeks), 0);
        const planStart = phases[0]?.start;
        const daysLeft = goal.target_date ? daysBetween(today, goal.target_date) : undefined;
        const todayShare = planStart && goal.target_date && totalWeeks > 0
          ? Math.min(1, Math.max(0, daysBetween(planStart, today) / (totalWeeks * 7)))
          : undefined;
        const current = phases.find((p) => p.current);
        const milestones = [...(goal.milestones ?? [])].sort((a, b) => (a.target_date ?? '9999').localeCompare(b.target_date ?? '9999'));
        return (
          <article key={goal.id} className="glass-panel rounded-2xl border border-white/10 p-4 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2"><Flag className="w-4 h-4 text-amber-400" /> {goal.name}</h3>
                <p className="text-xs text-slate-400">
                  {goal.target_date ? `${new Date(`${goal.target_date}T12:00:00`).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })}` : goal.timeframe_text || 'No date set'}
                  {daysLeft !== undefined && daysLeft >= 0 ? ` · ${Math.ceil(daysLeft / 7)} weeks to go` : ''}
                </p>
              </div>
              {current && (
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">Current phase</p>
                  <p className="text-sm font-bold text-white">{current.name}</p>
                  {current.end && <p className="text-[11px] text-slate-400">until {fmtDate(current.end)}</p>}
                </div>
              )}
            </div>

            {phases.length === 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-white/10 px-3 py-3">
                <p className="text-xs text-slate-400">No phase plan for this goal yet.</p>
                {onPlanWithCoach && (
                  <button onClick={() => onPlanWithCoach(goal)} className="min-h-9 inline-flex items-center gap-1.5 px-3 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20">
                    <Sparkles className="w-3.5 h-3.5" /> Plan with the coach
                  </button>
                )}
              </div>
            ) : (
              <>
                {/* Timeline: phase widths follow their length in weeks */}
                {totalWeeks > 0 && (
                  <div className="relative pt-4">
                    {todayShare !== undefined && todayShare > 0 && todayShare < 1 && (
                      <div className="absolute top-0 bottom-0 z-10 flex flex-col items-center" style={{ left: `${todayShare * 100}%` }}>
                        <span className="text-[9px] font-semibold text-white -translate-x-1/2 absolute -top-0.5">Today</span>
                        <span className="mt-3 h-full w-px bg-white" />
                      </div>
                    )}
                    <div className="flex h-8 w-full overflow-hidden rounded-lg">
                      {phases.map((p, i) => (
                        <div
                          key={i}
                          title={`${p.name}: ${p.weeks} weeks`}
                          className={`flex items-center justify-center px-1 text-[10px] font-semibold text-slate-950 truncate ${p.past ? 'opacity-40' : ''} ${p.current ? 'ring-2 ring-white ring-inset' : ''}`}
                          style={{ width: `${(Math.max(0, p.weeks) / totalWeeks) * 100}%`, background: PHASE_COLORS[i % PHASE_COLORS.length] }}
                        >
                          <span className="truncate">{p.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <ol className="space-y-2">
                  {phases.map((p, i) => (
                    <li key={i} className={`rounded-lg border px-3 py-2 ${p.current ? 'border-white/30 bg-white/5' : 'border-white/10 bg-slate-900/40'} ${p.past ? 'opacity-60' : ''}`}>
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm font-semibold text-white flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: PHASE_COLORS[i % PHASE_COLORS.length] }} />
                          {p.name}
                          {p.current && <span className="text-[10px] font-semibold uppercase text-cyan-300">now</span>}
                        </p>
                        <p className="text-[11px] text-slate-400 tabular-nums">
                          {p.weeks} {p.weeks === 1 ? 'week' : 'weeks'}{p.start && p.end ? ` · ${fmtDate(p.start)} – ${fmtDate(p.end)}` : ''}
                        </p>
                      </div>
                      <p className="mt-1 text-xs text-slate-300">{p.focus}</p>
                      {p.target_ctl !== undefined && (
                        <p className="mt-1 text-[11px] text-slate-500">
                          Target fitness (CTL) {p.target_ctl}
                          {currentCtl !== undefined && (p.current || (!p.past && i === phases.findIndex((x) => !x.past)))
                            ? ` · you are at ${Math.round(currentCtl)}`
                            : ''}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              </>
            )}

            {milestones.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-300 mb-1.5">Milestones</p>
                <ul className="space-y-1">
                  {milestones.map((m, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs">
                      {m.completed ? <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" /> : <Circle className="w-4 h-4 shrink-0 text-slate-600" />}
                      <span className={`min-w-0 flex-1 ${m.completed ? 'text-slate-400 line-through' : 'text-slate-200'}`}>
                        {m.title}{m.target_metric ? <span className="text-slate-500"> · {m.target_metric}</span> : null}
                      </span>
                      {m.target_date && (
                        <span className={`shrink-0 tabular-nums ${!m.completed && m.target_date < today ? 'text-amber-300' : 'text-slate-500'}`}>{fmtDate(m.target_date)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {onSuggestMetrics && onSaveMetrics && activities && sessions && profile && (
              <GoalMetrics goal={goal} activities={activities} sessions={sessions} profile={profile} onSuggest={onSuggestMetrics} onSave={onSaveMetrics} />
            )}
          </article>
        );
      })}
    </div>
  );
};
