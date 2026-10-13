import React, { useMemo, useState } from 'react';
import { X, Check, Link2 } from 'lucide-react';
import type { Activity, TrainingSession } from '../types';
import { linkCandidates, suggestedLinks } from '../lib/sessionLinks';
import { formatMilesFromMeters } from '../lib/units';

interface SessionCompleteModalProps {
  session: TrainingSession;
  activities: Activity[];
  sessions: TrainingSession[];
  onCancel: () => void;
  onConfirm: (activityIds: string[]) => Promise<void>;
}

const dayLabel = (daysAway: number) =>
  daysAway === 0 ? 'Same day' : daysAway === -1 ? 'Day before' : daysAway === 1 ? 'Day after' : daysAway < 0 ? `${-daysAway} days before` : `${daysAway} days after`;

export const SessionCompleteModal: React.FC<SessionCompleteModalProps> = ({ session, activities, sessions, onCancel, onConfirm }) => {
  const [windowDays, setWindowDays] = useState(3);
  const candidates = useMemo(() => linkCandidates(session, activities, sessions, windowDays), [session, activities, sessions, windowDays]);
  // Start from what is already linked, else the obvious same-day matches
  const [selected, setSelected] = useState<string[]>(() => {
    const existing = session.completed_activity_ids ?? [];
    return existing.length ? existing : suggestedLinks(linkCandidates(session, activities, sessions, 3));
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggle = (id: string) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const submit = async (ids: string[]) => {
    setSaving(true);
    setError('');
    try {
      await onConfirm(ids);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not mark the session complete.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md" role="dialog" aria-modal="true" aria-label="Mark session complete">
      <div className="w-full max-w-lg glass-panel rounded-2xl border border-white/15 p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase text-emerald-300">Mark complete</p>
            <h2 className="text-lg font-bold text-white">{session.title}</h2>
            <p className="text-xs text-slate-400">
              {new Date(`${session.session_date}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
              {' · '}{session.duration_minutes} min planned
            </p>
          </div>
          <button onClick={onCancel} aria-label="Close" className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div>
          <p className="text-sm font-semibold text-slate-200 flex items-center gap-1.5"><Link2 className="w-4 h-4 text-cyan-300" /> Which activities did this workout?</p>
          <p className="text-xs text-slate-500 mt-0.5">Pick one or several (a ride plus a hike, say). Same-day matches are ticked for you.</p>
        </div>

        {candidates.length === 0 ? (
          <p className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-xs text-slate-400">
            No activities within {windowDays} days of this session.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {candidates.map((c) => {
              const checked = selected.includes(c.activity.id);
              return (
                <li key={c.activity.id}>
                  <label className={`flex items-start gap-3 rounded-lg border px-3 py-2 cursor-pointer transition-all ${checked ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-white/10 bg-slate-900/50 hover:bg-white/5'}`}>
                    <input type="checkbox" checked={checked} onChange={() => toggle(c.activity.id)} className="mt-1 accent-emerald-500" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-white break-words">{c.activity.title}</span>
                      <span className="block text-[11px] text-slate-400">
                        {dayLabel(c.daysAway)} · {c.activity.sport_type.replace('_', ' ')} · {Math.round(c.activity.duration_seconds / 60)} min
                        {c.activity.distance_meters > 0 ? ` · ${formatMilesFromMeters(c.activity.distance_meters)}` : ''}
                      </span>
                      {c.linkedTo && <span className="block text-[11px] text-amber-300">Already linked to “{c.linkedTo.title}”</span>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        {windowDays < 14 && (
          <button onClick={() => setWindowDays(14)} className="text-xs text-cyan-300 hover:underline">Show activities from up to 2 weeks either side</button>
        )}
        {error && <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p>}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          <button onClick={onCancel} disabled={saving} className="min-h-9 px-3 text-xs font-semibold text-slate-400 hover:text-white">Cancel</button>
          <button
            onClick={() => void submit([])}
            disabled={saving}
            className="min-h-9 px-3 rounded-lg border border-white/10 text-xs font-semibold text-slate-300 hover:bg-white/5 disabled:opacity-50"
          >
            Complete without linking
          </button>
          <button
            onClick={() => void submit(selected)}
            disabled={saving || selected.length === 0}
            className="min-h-9 px-4 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <Check className="w-3.5 h-3.5" /> {saving ? 'Saving…' : `Complete with ${selected.length} ${selected.length === 1 ? 'activity' : 'activities'}`}
          </button>
        </div>
      </div>
    </div>
  );
};
