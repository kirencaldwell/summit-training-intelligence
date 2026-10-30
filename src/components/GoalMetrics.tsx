import React, { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, ResponsiveContainer, ReferenceLine, YAxis } from 'recharts';
import { Sparkles, X, Gauge } from 'lucide-react';
import type { Activity, AthleteProfile, Goal, TrainingSession } from '../types';
import { dataService } from '../lib/supabase';
import { calculatePMC } from '../lib/trainingMath';
import type { MunterParams } from '../lib/munter';
import {
  backfillStartDate, evaluateMetric, formatMetricValue, metricUnit, withBaselines, type MetricContext, type MetricEvaluation, type MetricStatus, type TrackingMetric,
} from '../lib/trackingMetrics';

const STATUS: Record<MetricStatus, { label: string; cls: string; bar: string }> = {
  met: { label: 'Target met', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', bar: '#34D399' },
  ahead: { label: 'Ahead', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30', bar: '#38BDF8' },
  on_track: { label: 'On track', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', bar: '#34D399' },
  behind: { label: 'Slightly behind', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30', bar: '#FBBF24' },
  well_behind: { label: 'Behind', cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30', bar: '#F43F5E' },
  no_data: { label: 'No data yet', cls: 'bg-white/5 text-slate-300 border-white/10', bar: '#64748B' },
};

const fmtDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

const Spark: React.FC<{ evaluation: MetricEvaluation; metric: TrackingMetric; color: string }> = ({ evaluation, metric, color }) => {
  const data = evaluation.series.map((p) => ({ week: p.week, value: p.value }));
  const values = data.map((d) => d.value).filter((v): v is number => v !== undefined);
  if (values.length < 2) return <div className="h-12" />;
  const top = Math.max(metric.target, ...values) * 1.08;
  return (
    <div className="h-12 w-full" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 2, left: 2, bottom: 2 }}>
          <YAxis hide domain={[0, top]} />
          <ReferenceLine y={metric.target} stroke="#94A3B8" strokeDasharray="3 3" />
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

const MetricCard: React.FC<{ metric: TrackingMetric; evaluation: MetricEvaluation; onRemove?: () => void }> = ({ metric, evaluation, onRemove }) => {
  const meta = STATUS[evaluation.status];
  const pct = evaluation.percentToTarget ?? 0;
  const expectedPct = evaluation.expected !== undefined && metric.start_value !== undefined && metric.target !== metric.start_value
    ? Math.max(0, Math.min(100, ((evaluation.expected - metric.start_value) / (metric.target - metric.start_value)) * 100))
    : undefined;
  return (
    <div id={`metric-${metric.id}`} className="scroll-mt-24 rounded-xl border border-white/10 bg-slate-900/50 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white truncate">{metric.name}</p>
          <p className="text-[11px] text-slate-500">
            {metric.sports?.length ? metric.sports.map((s) => s.replace('_', ' ')).join(', ') : 'all sports'} · by {fmtDate(metric.target_date)}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.cls}`}>{meta.label}</span>
          {onRemove && (
            <button type="button" onClick={onRemove} aria-label={`Remove ${metric.name}`} title="Stop tracking this" className="p-1 rounded text-slate-500 hover:text-rose-300 hover:bg-white/5">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      <p className="text-xs text-slate-300 tabular-nums">
        <span className="text-lg font-extrabold text-white">{evaluation.current !== undefined ? formatMetricValue(metric, evaluation.current) : '–'}</span>
        <span className="text-slate-500"> of {formatMetricValue(metric, metric.target)}</span>
        {metric.start_value !== undefined && <span className="text-slate-500"> · started at {formatMetricValue(metric, metric.start_value)}</span>}
      </p>
      <div className="relative h-1.5 rounded-full bg-white/10" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: meta.bar }} />
        {expectedPct !== undefined && <span className="absolute -top-0.5 h-2.5 w-0.5 bg-white/80" style={{ left: `${expectedPct}%` }} title="Where the plan puts you today" />}
      </div>
      <Spark evaluation={evaluation} metric={metric} color={meta.bar} />
      {metric.why && <p className="text-[11px] leading-relaxed text-slate-400">{metric.why}</p>}
    </div>
  );
};

interface GoalMetricsProps {
  goal: Goal;
  activities: Activity[];
  sessions: TrainingSession[];
  profile: AthleteProfile;
  /** Asks the coach for metrics and targets (validated, with starting values) */
  onSuggest: (goalId: string) => Promise<TrackingMetric[]>;
  onSave: (goalId: string, metrics: TrackingMetric[]) => Promise<{ synced: boolean }>;
}

/** The weekly metrics the coach chose for a goal, measured from the athlete's activities against their targets. */
export const GoalMetrics: React.FC<GoalMetricsProps> = ({ goal, activities, sessions, profile, onSuggest, onSave }) => {
  const [munter, setMunter] = useState<Record<string, MunterParams>>({});
  const [proposals, setProposals] = useState<TrackingMetric[] | null>(null);
  const [kept, setKept] = useState<string[]>([]);
  const [busy, setBusy] = useState<'suggesting' | 'saving' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // Where progress is measured from: when the plan began (counting what is already done), or today
  const [from, setFrom] = useState<'earlier' | 'today'>('earlier');

  const metrics = goal.tracking_metrics ?? [];
  useEffect(() => {
    if (!(metrics.some((m) => m.kind === 'travel_pace') || proposals?.some((m) => m.kind === 'travel_pace'))) return;
    let live = true;
    dataService.getMunterParams().then((p) => { if (live) setMunter(p); }).catch(() => undefined);
    return () => { live = false; };
  }, [metrics.length, proposals]);

  const loadProfile = useMemo(() => ({ ftp: profile.ftp, lthr: profile.lthr, weight_kg: profile.weight_kg }), [profile.ftp, profile.lthr, profile.weight_kg]);
  const pmc = useMemo(() => calculatePMC(activities, 400, loadProfile), [activities, loadProfile]);
  const ctx: MetricContext = useMemo(() => ({ activities, sessions, pmc, profile, loadProfile, munter }), [activities, sessions, pmc, profile, loadProfile, munter]);
  const evaluations = useMemo(() => metrics.map((m) => ({ metric: m, evaluation: evaluateMetric(m, ctx) })), [metrics, ctx]);
  const proposalEvals = useMemo(() => (proposals ?? []).map((m) => ({ metric: m, evaluation: evaluateMetric(m, ctx) })), [proposals, ctx]);

  const earlierStart = useMemo(() => backfillStartDate(goal), [goal]);
  const startFor = (choice: 'earlier' | 'today') => (choice === 'earlier' ? earlierStart : undefined);
  const rebase = (choice: 'earlier' | 'today') => {
    setFrom(choice);
    setProposals((prev) => (prev ? withBaselines(prev, ctx, startFor(choice)) : prev));
  };

  const suggest = async () => {
    setBusy('suggesting');
    setError('');
    setNotice('');
    try {
      const next = await onSuggest(goal.id);
      setProposals(withBaselines(next, ctx, startFor(from)));
      setKept(next.map((m) => m.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The coach could not suggest metrics.');
    } finally {
      setBusy(null);
    }
  };

  const save = async (next: TrackingMetric[]) => {
    setBusy('saving');
    setError('');
    try {
      const { synced } = await onSave(goal.id, next);
      setNotice(synced ? '' : 'Saved on this device only until the database is updated (run the latest supabase/schema.sql).');
      setProposals(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The metrics could not be saved.');
    } finally {
      setBusy(null);
    }
  };

  const counts = evaluations.reduce((acc, { evaluation }) => {
    if (evaluation.status === 'met' || evaluation.status === 'ahead' || evaluation.status === 'on_track') acc.good += 1;
    else if (evaluation.status !== 'no_data') acc.bad += 1;
    return acc;
  }, { good: 0, bad: 0 });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5"><Gauge className="w-3.5 h-3.5 text-cyan-400" /> Progress metrics</p>
          {metrics.length > 0 && (
            <p className="text-[11px] text-slate-500">
              {counts.good} of {metrics.length} on track or better{counts.bad > 0 ? ` · ${counts.bad} behind` : ''}. Measured from your activities every week.
            </p>
          )}
        </div>
        {!proposals && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void suggest()}
            className="min-h-9 inline-flex items-center gap-1.5 px-3 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
          >
            <Sparkles className={`w-3.5 h-3.5 ${busy === 'suggesting' ? 'animate-pulse' : ''}`} />
            {busy === 'suggesting' ? 'Asking the coach…' : metrics.length ? 'Suggest new metrics' : 'Choose metrics with the coach'}
          </button>
        )}
      </div>

      {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
      {notice && <p role="status" className="text-xs text-amber-200">{notice}</p>}

      {proposals ? (
        <div className="space-y-2 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
          <p className="text-xs text-slate-300">
            The coach suggests these for “{goal.name}”. Adjust a target if you like, untick any you don't want, then save. This replaces the metrics now tracked for this goal.
          </p>
          {earlierStart && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-300" role="radiogroup" aria-label="Measure progress from">
              <span className="text-slate-400">Measure progress from</span>
              {([['earlier', `${fmtDate(earlierStart)}${goal.periodization_phases?.length ? ' (when the plan began)' : ''}`], ['today', 'today']] as const).map(([value, label]) => (
                <label key={value} className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name={`from-${goal.id}`} checked={from === value} onChange={() => rebase(value)} className="accent-cyan-500" />
                  {label}
                </label>
              ))}
            </div>
          )}
          <div className="grid gap-2 md:grid-cols-2">
            {proposalEvals.map(({ metric, evaluation }) => {
              const on = kept.includes(metric.id);
              return (
                <div key={metric.id} className={on ? '' : 'opacity-50'}>
                  <label className="flex items-center gap-2 mb-1 text-xs text-slate-300 cursor-pointer">
                    <input type="checkbox" checked={on} onChange={() => setKept((prev) => (on ? prev.filter((id) => id !== metric.id) : [...prev, metric.id]))} className="accent-cyan-500" />
                    Track this
                    <span className="ml-auto inline-flex items-center gap-1">
                      target
                      <input
                        type="number"
                        value={metric.target}
                        step="any"
                        aria-label={`Target for ${metric.name}`}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (Number.isFinite(v) && v > 0) setProposals((prev) => (prev ?? []).map((m) => (m.id === metric.id ? { ...m, target: v } : m)));
                        }}
                        className="w-20 rounded bg-slate-900 border border-white/10 px-1.5 py-0.5 text-right text-xs text-white"
                      />
                      <span className="text-slate-500">{metricUnit(metric)}</span>
                    </span>
                  </label>
                  <MetricCard metric={metric} evaluation={evaluation} />
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              disabled={busy !== null || kept.length === 0}
              onClick={() => void save(proposals.filter((m) => kept.includes(m.id)))}
              className="min-h-9 px-3 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-50"
            >
              {busy === 'saving' ? 'Saving…' : `Track ${kept.length} ${kept.length === 1 ? 'metric' : 'metrics'}`}
            </button>
            <button type="button" onClick={() => setProposals(null)} className="min-h-9 px-3 text-xs font-semibold text-slate-400 hover:text-white">Discard</button>
          </div>
        </div>
      ) : metrics.length === 0 ? (
        <p className="rounded-lg border border-dashed border-white/10 px-3 py-3 text-xs text-slate-400">
          Nothing is being tracked for this goal yet. The coach can choose a few things worth measuring every week (long-day vert, weekly volume, climbing pace, fitness) and set a target for each that leads to the goal.
        </p>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {evaluations.map(({ metric, evaluation }) => (
            <MetricCard key={metric.id} metric={metric} evaluation={evaluation} onRemove={() => void save(metrics.filter((m) => m.id !== metric.id))} />
          ))}
        </div>
      )}
    </div>
  );
};
