import React, { useMemo, useState } from 'react';
import { CalendarDays, X, Sparkles, Check, RefreshCw, AlertTriangle, Wrench } from 'lucide-react';
import type { Goal, PMCDayPoint, TrainingSession } from '../types';
import { addDaysToDateOnly, getCurrentTrainingWeekStartDate, getLocalDateString, getNextTrainingWeekStartDate } from '../lib/trainingSessions';
import {
  buildWeekBudget, checkWeekDraft, defaultCheckIn, sessionIsHard,
  type CheckIn, type DraftSession, type Feel, type WeekCheck,
} from '../lib/weekBudget';

const PREFS_KEY = 'summit_checkin_prefs';
type Prefs = Record<string, { available: boolean; max_minutes: number }>;

const readPrefs = (): Prefs => {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); } catch { return {}; }
};
const writePrefs = (checkIn: CheckIn) => {
  try {
    const prefs: Prefs = {};
    for (const d of checkIn.days) prefs[String(new Date(`${d.date}T12:00:00`).getDay())] = { available: d.available, max_minutes: d.max_minutes };
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch { /* storage unavailable: the pattern just is not remembered */ }
};

const startingCheckIn = (weekStart: string, today: string): CheckIn => {
  const base = defaultCheckIn(weekStart, today);
  const prefs = readPrefs();
  return {
    ...base,
    days: base.days.map((d) => {
      const p = prefs[String(new Date(`${d.date}T12:00:00`).getDay())];
      return p ? { ...d, available: d.date >= today && p.available, max_minutes: p.max_minutes } : { ...d, available: d.date >= today && d.available };
    }),
  };
};

const HOUR_OPTIONS = Array.from({ length: 16 }, (_, i) => (i + 1) * 30);
const hoursLabel = (m: number) => `${m / 60} h`;
const dayName = (date: string, opts: Intl.DateTimeFormatOptions) => new Date(`${date}T12:00:00`).toLocaleDateString([], opts);

export interface WeeklyCheckInProps {
  pmc: PMCDayPoint[];
  goals: Goal[];
  sessions: TrainingSession[];
  onGenerate: (checkIn: CheckIn, budget: ReturnType<typeof buildWeekBudget>, note?: string) => Promise<DraftSession[]>;
  /** Saves the drafted sessions as accepted ones for the week, replacing the open sessions on the days they cover */
  onAccept: (weekStart: string, drafts: DraftSession[], replaceIds: string[]) => Promise<void>;
  onClose: () => void;
}

/**
 * The weekly check-in: tell the coach which days you can train and how you feel, see the load the week should hold
 * (worked out in software), then review a drafted week that has been checked against it before accepting.
 */
export const WeeklyCheckIn: React.FC<WeeklyCheckInProps> = ({ pmc, goals, sessions, onGenerate, onAccept, onClose }) => {
  const today = getLocalDateString();
  const dow = new Date().getDay();
  const thisWeek = getCurrentTrainingWeekStartDate();
  const nextWeek = getNextTrainingWeekStartDate();
  // From Friday on, the week to plan is the next one
  const [checkIn, setCheckIn] = useState<CheckIn>(() => startingCheckIn(dow === 0 || dow >= 5 ? nextWeek : thisWeek, today));
  const [stage, setStage] = useState<'setup' | 'review'>('setup');
  const [check, setCheck] = useState<WeekCheck | null>(null);
  const [busy, setBusy] = useState<'build' | 'accept' | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const budget = useMemo(() => buildWeekBudget({ checkIn, pmc, goals, sessions, today }), [checkIn, pmc, goals, sessions, today]);
  // Open planned sessions on the days offered will be replaced by the new week
  const replaceIds = useMemo(() => {
    const on = new Set(checkIn.days.filter((d) => d.available).map((d) => d.date));
    return sessions.filter((s) => s.week_start_date === checkIn.week_start && s.status !== 'COMPLETED' && on.has(s.session_date)).map((s) => s.id);
  }, [sessions, checkIn]);

  const switchWeek = (weekStart: string) => {
    setCheckIn(startingCheckIn(weekStart, today));
    setStage('setup');
    setCheck(null);
    setError('');
  };
  const setDay = (date: string, patch: Partial<CheckIn['days'][number]>) =>
    setCheckIn((c) => ({ ...c, days: c.days.map((d) => (d.date === date ? { ...d, ...patch } : d)) }));

  const build = async (extra?: string) => {
    setBusy('build');
    setError('');
    try {
      const drafts = await onGenerate(checkIn, budget, extra);
      setCheck(checkWeekDraft(drafts, budget, today));
      setStage('review');
      writePrefs(checkIn);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The week could not be drafted.');
    } finally {
      setBusy(null);
    }
  };

  const accept = async () => {
    if (!check || check.sessions.length === 0) return;
    setBusy('accept');
    setError('');
    try {
      await onAccept(checkIn.week_start, check.sessions, replaceIds);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The week could not be saved.');
      setBusy(null);
    }
  };

  const weekLabel = `${dayName(checkIn.week_start, { month: 'short', day: 'numeric' })} – ${dayName(addDaysToDateOnly(checkIn.week_start, 6), { month: 'short', day: 'numeric' })}`;
  const anyAvailable = checkIn.days.some((d) => d.available);
  const bar = (v: number, max: number) => `${Math.max(0, Math.min(100, (v / Math.max(max, 1)) * 100))}%`;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/80 backdrop-blur-md" role="dialog" aria-modal="true" aria-label="Weekly check-in">
      <div className="w-full sm:max-w-2xl glass-panel rounded-t-2xl sm:rounded-2xl border border-white/15 p-4 sm:p-5 shadow-2xl space-y-4 max-h-[94dvh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase text-cyan-300">Weekly check-in</p>
            <h2 className="text-lg font-bold text-white flex items-center gap-2"><CalendarDays className="w-4 h-4 text-cyan-400" /> Plan the week · {weekLabel}</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {stage === 'setup' && (
          <>
            <div className="flex gap-2">
              {[{ id: thisWeek, label: 'This week' }, { id: nextWeek, label: 'Next week' }].map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => switchWeek(w.id)}
                  aria-pressed={checkIn.week_start === w.id}
                  className={`min-h-10 flex-1 rounded-lg border px-3 text-xs font-semibold ${checkIn.week_start === w.id ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200' : 'border-white/10 text-slate-300 hover:bg-white/5'}`}
                >
                  {w.label}{w.id === thisWeek ? ' (from today)' : ''}
                </button>
              ))}
            </div>

            <div>
              <p className="text-sm font-semibold text-slate-200">Which days can you train, and for how long at most?</p>
              <ul className="mt-2 space-y-1.5">
                {checkIn.days.map((d) => {
                  const past = d.date < today;
                  return (
                    <li key={d.date} className={`flex items-center gap-3 rounded-lg border border-white/10 bg-slate-900/50 px-3 py-1.5 ${past ? 'opacity-40' : ''}`}>
                      <label className="flex min-h-10 flex-1 items-center gap-2.5 text-sm text-slate-200">
                        <input
                          type="checkbox"
                          checked={d.available}
                          disabled={past}
                          onChange={(e) => setDay(d.date, { available: e.target.checked })}
                          className="accent-cyan-500 w-4 h-4"
                        />
                        <span className="w-24 font-semibold">{dayName(d.date, { weekday: 'long' })}</span>
                        <span className="text-xs text-slate-500">{dayName(d.date, { month: 'short', day: 'numeric' })}</span>
                      </label>
                      <select
                        value={d.max_minutes}
                        disabled={past || !d.available}
                        onChange={(e) => setDay(d.date, { max_minutes: Number(e.target.value) })}
                        aria-label={`Longest session on ${dayName(d.date, { weekday: 'long' })}`}
                        className="min-h-10 rounded-lg bg-slate-900 border border-white/10 px-2 text-sm text-white disabled:opacity-40"
                      >
                        {HOUR_OPTIONS.map((m) => <option key={m} value={m}>{hoursLabel(m)}</option>)}
                      </select>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div>
              <p className="text-sm font-semibold text-slate-200">How do you feel?</p>
              <div className="mt-2 flex gap-2">
                {([['fresh', 'Fresh'], ['normal', 'Normal'], ['tired', 'Tired']] as [Feel, string][]).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setCheckIn((c) => ({ ...c, feel: id }))}
                    aria-pressed={checkIn.feel === id}
                    className={`min-h-10 flex-1 rounded-lg border px-3 text-xs font-semibold ${checkIn.feel === id ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200' : 'border-white/10 text-slate-300 hover:bg-white/5'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="checkin-notes" className="text-sm font-semibold text-slate-200">Anything the coach should know this week?</label>
              <textarea
                id="checkin-notes"
                value={checkIn.notes}
                onChange={(e) => setCheckIn((c) => ({ ...c, notes: e.target.value }))}
                rows={2}
                placeholder="Travelling Thursday, knee a bit sore, want one big hike on Saturday…"
                className="mt-2 w-full rounded-lg bg-slate-900/90 border border-white/10 px-3 py-2 text-base sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50"
              />
            </div>

            <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3 space-y-2" aria-label="Load budget">
              <p className="text-sm font-bold text-cyan-200">
                {anyAvailable ? `The week should hold about ${budget.week_tss_target} TSS` : 'Pick at least one day'}
                {anyAvailable && <span className="font-normal text-slate-300"> (CTL {budget.ctl_change >= 0 ? '+' : ''}{budget.ctl_change}, now {Math.round(budget.ctl_now)})</span>}
              </p>
              {anyAvailable && (
                <p className="text-[11px] text-slate-400">
                  {budget.remaining_tss_min}–{budget.remaining_tss_max} TSS to place · biggest session about {budget.max_session_tss} TSS · at most {budget.max_hard_days} hard {budget.max_hard_days === 1 ? 'day' : 'days'}
                </p>
              )}
              <ul className="space-y-1 text-[11px] text-slate-300 list-disc pl-4">
                {budget.reasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>

            {replaceIds.length > 0 && (
              <p className="text-[11px] text-amber-300">{replaceIds.length} session{replaceIds.length === 1 ? '' : 's'} already planned on these days will be replaced when you accept the new week.</p>
            )}
            {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="min-h-10 px-3 text-xs font-semibold text-slate-400 hover:text-white">Cancel</button>
              <button
                onClick={() => void build()}
                disabled={!anyAvailable || busy === 'build'}
                className="min-h-10 px-4 rounded-lg bg-cyan-500 text-xs font-bold text-slate-950 hover:bg-cyan-400 disabled:opacity-50 inline-flex items-center gap-2"
              >
                <Sparkles className={`w-3.5 h-3.5 ${busy === 'build' ? 'animate-pulse' : ''}`} /> {busy === 'build' ? 'Building the week…' : 'Build my week'}
              </button>
            </div>
          </>
        )}

        {stage === 'review' && check && (
          <>
            <div className="rounded-lg border border-white/10 bg-slate-900/50 p-3 space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-bold text-white">{check.total_tss} TSS · {Math.round(check.total_minutes / 6) / 10} h · {check.sessions.length} sessions</p>
                <p className="text-[11px] text-slate-400">Budget {budget.remaining_tss_min}–{budget.remaining_tss_max} TSS</p>
              </div>
              <div className="relative h-2 rounded-full bg-slate-800 overflow-hidden" aria-hidden>
                <div className="absolute inset-y-0 bg-cyan-500/25" style={{ left: bar(budget.remaining_tss_min, budget.remaining_tss_max * 1.2), width: `calc(${bar(budget.remaining_tss_max, budget.remaining_tss_max * 1.2)} - ${bar(budget.remaining_tss_min, budget.remaining_tss_max * 1.2)})` }} />
                <div className="absolute inset-y-0 left-0 bg-cyan-400" style={{ width: bar(check.total_tss, budget.remaining_tss_max * 1.2) }} />
              </div>
              <p className="text-[11px] text-slate-300">
                If you do it all: CTL {Math.round(budget.ctl_now)} → <span className="font-semibold text-white">{Math.round(check.projected.ctl)}</span>, form {Math.round(check.projected.tsb)} · {check.hard_days} hard {check.hard_days === 1 ? 'day' : 'days'}
              </p>
            </div>

            {check.issues.length > 0 && (
              <ul className="space-y-1.5" aria-label="Checks">
                {check.issues.map((issue, i) => (
                  <li key={i} className={`flex gap-2 rounded-lg border px-3 py-2 text-[11px] leading-snug ${issue.level === 'warning' ? 'border-amber-500/30 bg-amber-500/10 text-amber-100' : 'border-white/10 bg-white/5 text-slate-300'}`}>
                    {issue.level === 'warning' ? <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400 mt-px" /> : <Wrench className="w-3.5 h-3.5 shrink-0 text-slate-500 mt-px" />}
                    <span>{issue.text}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="space-y-2">
              {check.sessions.map((s, i) => (
                <article key={`${s.session_date}-${i}`} className="rounded-lg border border-white/10 bg-slate-900/60 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase text-cyan-300">{dayName(s.session_date, { weekday: 'long', month: 'short', day: 'numeric' })} · {s.sport_type.replace('_', ' ')}</p>
                      <h3 className="mt-0.5 text-sm font-bold text-white">{s.title}</h3>
                      <p className="mt-0.5 text-xs text-slate-400">{s.duration_minutes} min · {s.focus}</p>
                    </div>
                    <span className="shrink-0 text-right text-[11px] font-semibold text-amber-300">
                      {s.target_tss} TSS
                      {sessionIsHard(s.duration_minutes, s.target_tss) && <span className="block text-[10px] text-rose-300">hard</span>}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-slate-300">{s.details}</p>
                </article>
              ))}
              {check.sessions.length === 0 && <p className="text-xs text-slate-400">Nothing usable came back. Go back and try again.</p>}
            </div>

            <div>
              <label htmlFor="checkin-tweak" className="text-xs font-semibold text-slate-300">Want changes? Say what, then rebuild</label>
              <input
                id="checkin-tweak"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Make Wednesday easier, swap the long day to Sunday…"
                className="mt-1 w-full min-h-10 rounded-lg bg-slate-900/90 border border-white/10 px-3 text-base sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50"
              />
            </div>
            {replaceIds.length > 0 && (
              <p className="text-[11px] text-amber-300">Accepting replaces {replaceIds.length} session{replaceIds.length === 1 ? '' : 's'} already planned on these days.</p>
            )}
            {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button onClick={() => { setStage('setup'); setError(''); }} className="min-h-10 px-3 text-xs font-semibold text-slate-400 hover:text-white">Back</button>
              <button
                onClick={() => void build(note)}
                disabled={busy !== null}
                className="min-h-10 px-3 rounded-lg border border-white/10 text-xs font-semibold text-slate-200 hover:bg-white/5 disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${busy === 'build' ? 'animate-spin' : ''}`} /> {busy === 'build' ? 'Rebuilding…' : 'Rebuild'}
              </button>
              <button
                onClick={() => void accept()}
                disabled={busy !== null || check.sessions.length === 0}
                className="min-h-10 px-4 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-xs font-bold text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                <Check className="w-3.5 h-3.5" /> {busy === 'accept' ? 'Saving…' : `Accept ${check.sessions.length} sessions`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
