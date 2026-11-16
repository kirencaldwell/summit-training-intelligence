import React, { useState } from 'react';
import { Loader2, MessageSquare } from 'lucide-react';
import type { TrainingSession } from '../types';
import { coachEngine } from '../lib/ai/coachEngine';
import { isSameEdit, type SessionEditProposal } from '../lib/sessionEditing';
import type { SessionEdit } from '../lib/morningCheck';

const Row: React.FC<{ label: string; from: string; to: string }> = ({ label, from, to }) => (
  from === to ? null : (
    <div className="text-xs">
      <p className="text-[10px] font-semibold uppercase text-slate-500">{label}</p>
      <p className="text-slate-500 line-through whitespace-pre-wrap">{from || '—'}</p>
      <p className="text-slate-100 whitespace-pre-wrap">{to || '—'}</p>
    </div>
  )
);

/** Ask the coach to change one planned session; see exactly what changes; apply or discard. */
export const SessionEditor: React.FC<{ session: TrainingSession; onApply: (id: string, edit: SessionEdit) => Promise<void> }> = ({ session, onApply }) => {
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState('');
  const [busy, setBusy] = useState<'ask' | 'apply' | null>(null);
  const [proposal, setProposal] = useState<SessionEditProposal | null>(null);
  const [error, setError] = useState('');

  const current: SessionEdit = { title: session.title, duration_minutes: session.duration_minutes, target_tss: session.target_tss, focus: session.focus, details: session.details };
  const close = () => { setOpen(false); setProposal(null); setRequest(''); setError(''); };

  const ask = async () => {
    if (!request.trim()) return;
    setBusy('ask'); setError('');
    try {
      const p = await coachEngine.editSession(session, request, proposal?.edit);
      if (!p) setError('The coach could not make that change. Try rephrasing.');
      else { setProposal(p); setRequest(''); }
    } catch (e) { setError(e instanceof Error ? e.message : 'The coach could not be reached.'); }
    setBusy(null);
  };

  const apply = async () => {
    if (!proposal) return;
    setBusy('apply'); setError('');
    try { await onApply(session.id, proposal.edit); close(); }
    catch (e) { setError(e instanceof Error ? e.message : 'The change could not be saved.'); }
    setBusy(null);
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-3 min-h-9 inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 text-xs font-semibold text-slate-200 hover:bg-white/10">
        <MessageSquare className="w-3.5 h-3.5" /> Edit with coach
      </button>
    );
  }

  const changed = proposal && !isSameEdit(proposal.edit, current);
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3" aria-label="Edit session with coach">
      <label className="block text-[11px] font-semibold text-cyan-300" htmlFor={`edit-${session.id}`}>{proposal ? 'Refine it further' : 'What should change?'}</label>
      <textarea
        id={`edit-${session.id}`}
        value={request}
        onChange={(e) => setRequest(e.target.value)}
        rows={2}
        maxLength={800}
        placeholder="For example: swap squats for leg press (sore knee), cut it to 45 minutes, add a climbing effort"
        className="w-full rounded-lg border border-white/10 bg-slate-950/60 p-2 text-sm text-white placeholder:text-slate-500"
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void ask()} disabled={busy !== null || !request.trim()} className="min-h-9 inline-flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3 text-xs font-bold text-slate-950 hover:bg-cyan-400 disabled:opacity-50">
          {busy === 'ask' && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {busy === 'ask' ? 'Thinking…' : proposal ? 'Refine' : 'Ask coach'}
        </button>
        <button type="button" onClick={close} disabled={busy !== null} className="min-h-9 rounded-lg border border-white/15 px-3 text-xs font-semibold text-slate-200 hover:bg-white/10">Cancel</button>
      </div>

      {proposal && (
        <div className="space-y-2 rounded-lg border border-white/10 bg-slate-950/50 p-3" aria-label="Proposed change">
          <p className="text-xs text-slate-200">{proposal.reply}</p>
          {proposal.warnings.map((w) => <p key={w} className="text-[11px] font-semibold text-amber-300">{w}</p>)}
          {changed ? (
            <>
              <Row label="Title" from={current.title} to={proposal.edit.title} />
              <Row label="Duration" from={`${current.duration_minutes} min`} to={`${proposal.edit.duration_minutes} min`} />
              <Row label="Target TSS" from={current.target_tss != null ? String(current.target_tss) : ''} to={proposal.edit.target_tss != null ? String(proposal.edit.target_tss) : ''} />
              <Row label="Focus" from={current.focus} to={proposal.edit.focus} />
              <Row label="Details" from={current.details} to={proposal.edit.details} />
              <button type="button" onClick={() => void apply()} disabled={busy !== null} className="min-h-9 rounded-lg bg-emerald-400 px-3 text-xs font-bold text-slate-950 hover:bg-emerald-300 disabled:opacity-50">{busy === 'apply' ? 'Saving…' : 'Apply this change'}</button>
            </>
          ) : <p className="text-[11px] text-slate-500">Nothing would change.</p>}
        </div>
      )}
      {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
    </div>
  );
};
