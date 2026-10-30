import React, { useState } from 'react';
import { Brain, Trash2, X } from 'lucide-react';
import { addNote, clearFindings, removeNote, type CoachMemory } from '../lib/coachMemory';

interface CoachMemoryPanelProps {
  memory: CoachMemory;
  onChange: (change: (memory: CoachMemory) => CoachMemory) => void;
}

/** What the coach remembers, in the open: durable notes you can add to or remove, and the findings of recent assessments. */
export const CoachMemoryPanel: React.FC<CoachMemoryPanelProps> = ({ memory, onChange }) => {
  const [text, setText] = useState('');
  const add = () => {
    if (!text.trim()) return;
    onChange((m) => addNote(m, text, 'athlete'));
    setText('');
  };
  return (
    <details className="w-full max-w-5xl mx-auto glass-panel rounded-2xl border border-white/10 p-4 sm:p-5 group">
      <summary className="cursor-pointer list-none flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-bold text-white"><Brain className="w-4 h-4 text-cyan-400" /> What the coach remembers</span>
        <span className="text-[11px] text-slate-400">{memory.notes.length} {memory.notes.length === 1 ? 'note' : 'notes'} · {memory.findings.length} recent {memory.findings.length === 1 ? 'finding' : 'findings'}</span>
      </summary>
      <div className="mt-4 space-y-4">
        <div>
          <p className="text-xs font-semibold text-slate-300">Notes</p>
          <p className="text-[11px] text-slate-500">Things the coach should always keep in mind: injuries, preferences, constraints. It reads these before every answer, assessment and plan.</p>
          {memory.notes.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {memory.notes.map((n) => (
                <li key={n.id} className="flex items-start gap-2 rounded-lg border border-white/10 bg-slate-900/50 px-3 py-2 text-sm text-slate-200">
                  <span className="min-w-0 flex-1">{n.text}<span className="ml-2 text-[10px] text-slate-500">{n.from === 'coach' ? 'suggested by the coach' : 'added by you'}</span></span>
                  <button type="button" onClick={() => onChange((m) => removeNote(m, n.id))} aria-label={`Forget: ${n.text}`} className="min-h-8 min-w-8 inline-flex items-center justify-center rounded-md text-slate-500 hover:text-rose-300">
                    <X className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={240}
              aria-label="Add a note for the coach"
              placeholder="e.g. Left knee aches on long descents"
              className="min-h-10 min-w-0 flex-1 rounded-lg bg-slate-900/90 border border-white/10 px-3 text-base sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50"
            />
            <button type="submit" disabled={!text.trim()} className="min-h-10 px-3 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-50">Add</button>
          </form>
        </div>

        <div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-300">Recent findings</p>
            {memory.findings.length > 0 && (
              <button type="button" onClick={() => onChange(clearFindings)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-rose-300">
                <Trash2 className="w-3 h-3" /> Clear
              </button>
            )}
          </div>
          <p className="text-[11px] text-slate-500">From the coach's last assessments, so it can spot repeats and trends.</p>
          {memory.findings.length === 0 ? (
            <p className="mt-2 text-xs text-slate-500">Nothing yet. Findings appear here after you generate an assessment.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {[...memory.findings].reverse().map((f, i) => (
                <li key={`${f.ref}-${i}`} className="rounded-lg border border-white/10 bg-slate-900/50 px-3 py-2 text-xs text-slate-300">
                  <span className="text-slate-500">{f.date} · {f.about} · </span><span className="font-semibold text-cyan-200">{f.topic}.</span> {f.detail}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </details>
  );
};
