import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, CheckCircle2, Info, Sparkles, X } from 'lucide-react';
import type { Activity, AthleteProfile, Goal, PMCDayPoint, TrainingSession } from '../types';
import type { MunterParams } from '../lib/munter';
import type { LoadProfile } from '../lib/trainingMath';
import { dataService } from '../lib/supabase';
import { buildBrief, type BriefAction } from '../lib/coachBrief';
import { scrollToTarget } from '../lib/scrollToTarget';
import type { AppTab } from './TrainingWeekSection';

interface CoachBriefProps {
  sessions: TrainingSession[];
  activities: Activity[];
  pmc: PMCDayPoint[];
  goals: Goal[];
  profile: AthleteProfile;
  loadProfile?: LoadProfile;
  onPlanWeek: () => void;
  onNavigateTab: (tab: AppTab) => void;
}

const FLAG_STYLE = {
  warn: { box: 'border-amber-500/30 bg-amber-500/10', icon: <AlertTriangle className="w-4 h-4 text-amber-400" /> },
  info: { box: 'border-white/10 bg-white/5', icon: <Info className="w-4 h-4 text-slate-400" /> },
  good: { box: 'border-emerald-500/25 bg-emerald-500/10', icon: <CheckCircle2 className="w-4 h-4 text-emerald-400" /> },
};

// A closed flag stays away for a week, then comes back if it still holds
const DISMISS_KEY = 'summit_brief_dismissed';
const SNOOZE_DAYS = 7;
const readDismissed = (): Record<string, string> => {
  try { return JSON.parse(localStorage.getItem(DISMISS_KEY) || '{}'); } catch { return {}; }
};

/** The top of the Coach tab: today, how fit and fresh you are, and what needs attention, all worked out from your data. */
export const CoachBrief: React.FC<CoachBriefProps> = ({ sessions, activities, pmc, goals, profile, loadProfile, onPlanWeek, onNavigateTab }) => {
  const [munter, setMunter] = useState<Record<string, MunterParams>>({});
  useEffect(() => {
    let active = true;
    dataService.getMunterParams().then((m) => { if (active) setMunter(m); }).catch(() => {});
    return () => { active = false; };
  }, []);

  const [dismissed, setDismissed] = useState<Record<string, string>>(readDismissed);
  const todayKey = new Date().toISOString().slice(0, 10);
  const isDismissed = (id: string) => (dismissed[id] ?? '') > todayKey;
  const dismiss = (id: string) => {
    const until = new Date(Date.now() + SNOOZE_DAYS * 86400000).toISOString().slice(0, 10);
    const next = { ...dismissed, [id]: until };
    setDismissed(next);
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify(next)); } catch { /* storage unavailable: closes for this visit only */ }
  };
  const restoreAll = () => {
    setDismissed({});
    try { localStorage.removeItem(DISMISS_KEY); } catch { /* ignore */ }
  };

  const brief = useMemo(
    () => buildBrief({ sessions, activities, pmc, goals, loadProfile, isDismissed, metricContext: { activities, sessions, pmc, profile, loadProfile, munter } }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions, activities, pmc, goals, profile, loadProfile, munter, dismissed],
  );
  const hiddenCount = Object.values(dismissed).filter((until) => until > todayKey).length;

  const run = (action: BriefAction) => {
    if (action.kind === 'plan_week') return onPlanWeek();
    onNavigateTab(action.tab);
    if (action.target) scrollToTarget(action.target);
  };
  const f = brief.fitness;

  return (
    <section className="w-full max-w-5xl mx-auto glass-panel rounded-2xl border border-white/10 p-4 sm:p-5 space-y-4" aria-label="Coach brief">
      <div>
        <p className="text-[10px] font-semibold uppercase text-cyan-300">Your brief</p>
        <h2 className="mt-0.5 text-base sm:text-lg font-bold text-white">{brief.headline}</h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="rounded-lg border border-white/10 bg-slate-900/50 p-3">
          <p className="text-[10px] font-semibold uppercase text-slate-400 flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5" /> Today</p>
          {brief.today.length === 0 ? (
            <p className="mt-1 text-sm text-slate-300">Nothing planned.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {brief.today.map((s) => (
                <li key={s.id} className="text-sm text-white">
                  <span className={s.status === 'COMPLETED' ? 'line-through text-slate-500' : ''}>{s.title}</span>
                  <span className="block text-[11px] text-slate-400">{s.duration_minutes} min{s.target_tss != null ? ` · ${s.target_tss} TSS` : ''}{s.status === 'COMPLETED' ? ' · done' : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-lg border border-white/10 bg-slate-900/50 p-3">
          <p className="text-[10px] font-semibold uppercase text-slate-400">Fitness and form</p>
          {f ? (
            <>
              <p className="mt-1 text-sm text-white">CTL {Math.round(f.ctl)} · form {f.tsb > 0 ? '+' : ''}{Math.round(f.tsb)}</p>
              <p className="text-[11px] text-slate-400">{f.form}{f.rampPerWeek !== undefined ? ` · ${f.rampPerWeek >= 0 ? '+' : ''}${f.rampPerWeek.toFixed(1)} CTL/week over 4 weeks` : ''}</p>
            </>
          ) : <p className="mt-1 text-sm text-slate-300">No training load yet.</p>}
        </div>
        <div className="rounded-lg border border-white/10 bg-slate-900/50 p-3">
          <p className="text-[10px] font-semibold uppercase text-slate-400">This week</p>
          <p className="mt-1 text-sm text-white">{brief.week.done} of {brief.week.planned} sessions done</p>
          <p className="text-[11px] text-slate-400">{brief.week.tssPlanned > 0 ? `${brief.week.tssDone} of ${brief.week.tssPlanned} TSS` : `${brief.week.tssDone} TSS so far`}</p>
        </div>
      </div>

      {brief.flags.length > 0 && (
        <ul className="space-y-2" aria-label="Needs attention">
          {brief.flags.map((flag) => (
            <li key={flag.id} className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2.5 ${FLAG_STYLE[flag.level].box}`}>
              <span className="shrink-0">{FLAG_STYLE[flag.level].icon}</span>
              <p className="min-w-0 flex-1 basis-60 text-sm leading-snug text-slate-200">{flag.text}</p>
              {flag.action && (
                <button
                  type="button"
                  onClick={() => run(flag.action!)}
                  className="min-h-9 shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 text-xs font-semibold text-slate-100 hover:bg-white/10"
                >
                  {flag.action.kind === 'plan_week' ? <><Sparkles className="w-3.5 h-3.5 text-cyan-300" /> Plan the week</> : flag.action.label}
                </button>
              )}
              <button
                type="button"
                onClick={() => dismiss(flag.id)}
                aria-label="Close this card"
                title="Close (comes back in a week if it still applies)"
                className="min-h-9 min-w-9 shrink-0 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/10"
              >
                <X className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {hiddenCount > 0 && (
        <p className="text-[11px] text-slate-500">
          {hiddenCount} closed card{hiddenCount === 1 ? '' : 's'} hidden for a week.{' '}
          <button type="button" onClick={restoreAll} className="font-semibold text-cyan-300 hover:underline">Show again</button>
        </p>
      )}
    </section>
  );
};
