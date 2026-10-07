import React, { useEffect, useState } from 'react';
import { Gauge, Loader2, RefreshCw } from 'lucide-react';
import type { Goal } from '../types';
import {
  READINESS_STATUS_LABEL,
  loadReadiness,
  saveReadiness,
  type DimensionRating,
  type GoalReadinessAssessment,
  type ReadinessStatus,
} from '../lib/goalReadiness';

interface GoalReadinessPanelProps {
  goal: Goal;
  onAssess: (goalId: string) => Promise<GoalReadinessAssessment>;
}

const STATUS_STYLE: Record<ReadinessStatus, string> = {
  ahead: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  on_track: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  slightly_behind: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  behind: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  too_early: 'bg-slate-500/15 text-slate-300 border-white/15',
  insufficient_data: 'bg-slate-500/15 text-slate-300 border-white/15',
};

const RATING_STYLE: Record<DimensionRating, { label: string; className: string }> = {
  strong: { label: 'Strong', className: 'text-emerald-300' },
  on_track: { label: 'On track', className: 'text-cyan-300' },
  needs_work: { label: 'Needs work', className: 'text-amber-300' },
  unknown: { label: 'Unknown', className: 'text-slate-400' },
};

function assessedAgo(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  return `${days} days ago`;
}

export const GoalReadinessPanel: React.FC<GoalReadinessPanelProps> = ({ goal, onAssess }) => {
  const [assessment, setAssessment] = useState<GoalReadinessAssessment | null>(() => loadReadiness(goal.id));
  const [isAssessing, setIsAssessing] = useState(false);
  const [error, setError] = useState('');

  // A different goal brings its own saved assessment (if any)
  useEffect(() => {
    setAssessment(loadReadiness(goal.id));
    setError('');
  }, [goal.id]);

  const run = async () => {
    setIsAssessing(true);
    setError('');
    try {
      const result = await onAssess(goal.id);
      saveReadiness(result);
      setAssessment(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The readiness assessment failed.');
    } finally {
      setIsAssessing(false);
    }
  };

  return (
    <section className="glass-panel rounded-2xl border-white/10 p-5 space-y-4" aria-label="Goal readiness">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Gauge className="w-4 h-4 text-cyan-400" /> Goal Readiness
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Your coach looks at your recent training against “{goal.name}” and tells you where things stand.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void run()}
          disabled={isAssessing}
          className="inline-flex min-h-10 items-center justify-center gap-2 px-3.5 py-2 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-60 transition-all"
        >
          {isAssessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          {isAssessing ? 'Assessing…' : assessment ? 'Re-assess' : 'Assess readiness'}
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p>
      )}

      {assessment ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className={`px-3 py-1 rounded-full border text-xs font-bold ${STATUS_STYLE[assessment.status]}`}>
              {READINESS_STATUS_LABEL[assessment.status]}
            </span>
            {assessment.headline && <p className="text-sm font-semibold text-white">{assessment.headline}</p>}
          </div>

          {assessment.summary && <p className="text-sm leading-relaxed text-slate-300">{assessment.summary}</p>}

          {assessment.dimensions.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {assessment.dimensions.map((dimension) => (
                <div key={dimension.name} className="rounded-lg border border-white/10 bg-slate-900/50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-bold text-white">{dimension.name}</h3>
                    <span className={`text-[10px] font-semibold uppercase ${RATING_STYLE[dimension.rating].className}`}>
                      {RATING_STYLE[dimension.rating].label}
                    </span>
                  </div>
                  {dimension.evidence && <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{dimension.evidence}</p>}
                </div>
              ))}
            </div>
          )}

          {assessment.nextFocus.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Focus next</p>
              <ul className="mt-1.5 list-disc list-inside space-y-1 text-xs text-slate-300">
                {assessment.nextFocus.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          )}

          {assessment.dataGaps.length > 0 && (
            <p className="text-[11px] leading-relaxed text-slate-500">
              Limited by: {assessment.dataGaps.join('; ')}.
            </p>
          )}

          <p className="text-[11px] text-slate-500">Assessed {assessedAgo(assessment.assessedAt)}. It reflects your training at that time, so re-assess after a few weeks.</p>
        </div>
      ) : (
        !isAssessing && !error && (
          <p className="rounded-lg border border-dashed border-white/10 px-4 py-4 text-sm text-slate-400">
            No assessment yet. Ask for one when you want a read on how your training lines up with this goal.
          </p>
        )
      )}
    </section>
  );
};
