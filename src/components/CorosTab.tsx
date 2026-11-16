import React, { useState } from 'react';
import { HeartPulse, Loader2, RefreshCw, Unplug } from 'lucide-react';
import { CorosError, connectCoros, disconnectCoros, getCorosAccountStatus, isCorosConnected } from '../lib/coros';
import { assessReadiness, morningAutoApply, setMorningAutoApply } from '../lib/morningCheck';
import { readSnapshots, readinessLine, refreshReadiness, type ReadinessSnapshot } from '../lib/readiness';

interface CorosTabProps {
  /** Today's reading, held by the app (it is also read automatically when the app opens) */
  snapshot?: ReadinessSnapshot;
  onSnapshot: (snapshot: ReadinessSnapshot | undefined) => void;
}

/** Connect the COROS account, and see exactly what it says about sleep and recovery. */
export const CorosTab: React.FC<CorosTabProps> = ({ snapshot, onSnapshot }) => {
  const [connected, setConnected] = useState(isCorosConnected());
  const [busy, setBusy] = useState<'fetch' | 'disconnect' | null>(null);
  const [error, setError] = useState('');
  const account = getCorosAccountStatus();
  const [autoApply, setAutoApply] = useState(morningAutoApply());

  const fetchNow = async () => {
    setBusy('fetch');
    setError('');
    try {
      const s = await refreshReadiness();
      onSnapshot(s);
    } catch (err) {
      if (err instanceof CorosError && err.reconnect) setConnected(false);
      setError(err instanceof Error ? err.message : 'Could not read COROS.');
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    setBusy('disconnect');
    await disconnectCoros();
    setConnected(false);
    onSnapshot(undefined);
    setBusy(null);
  };

  if (!connected) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4 space-y-2">
          <p className="text-sm font-semibold text-white flex items-center gap-2"><HeartPulse className="w-4 h-4 text-rose-400" /> Connect COROS</p>
          <p className="text-xs text-slate-400 leading-relaxed">
            Lets the app read your sleep, HRV, resting heart rate and recovery from your COROS account, so the coach can see how rested you are.
            You approve the connection on COROS's own page; the app can only read, never change anything in your COROS account.
          </p>
        </div>
        {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
        <button type="button" onClick={connectCoros} className="min-h-11 w-full rounded-xl bg-cyan-500 text-sm font-bold text-slate-950 hover:bg-cyan-400">
          Connect COROS
        </button>
      </div>
    );
  }

  const facts = snapshot?.facts;
  const line = facts ? readinessLine(facts) : '';
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200">
        COROS is connected{account.state === 'saved' ? ' on your account, so your other devices are connected too' : account.state === 'unavailable' ? ' on this device only (run the latest supabase/schema.sql to share it across devices)' : ''}.
      </div>

      <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-white">Today</p>
          <button type="button" onClick={() => void fetchNow()} disabled={busy !== null} className="min-h-9 inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
            {busy === 'fetch' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} {busy === 'fetch' ? 'Reading…' : snapshot ? 'Refresh' : 'Read sleep and recovery'}
          </button>
        </div>
        {snapshot ? (
          <>
            <p className="text-sm text-slate-200">{line ? line.charAt(0).toUpperCase() + line.slice(1) : 'COROS answered, but no sleep or recovery figures could be picked out yet. See what it said below.'}</p>
            {facts && facts.notes.length > 0 && <p className="text-[11px] text-slate-400">{facts.notes.join(' · ')}</p>}
            <p className="text-[11px] text-slate-500">Read {new Date(snapshot.fetched_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>
          </>
        ) : (
          <p className="text-xs text-slate-500">Nothing read yet today. It also happens by itself when you open the app.</p>
        )}
        {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
      </div>

      {facts && (() => {
        const a = assessReadiness(facts, Object.values(readSnapshots()));
        const label = { good: 'Recovered: today\'s plan stands', low: 'Not fully recovered: today\'s session may be eased', poor: 'Poorly recovered: today\'s session will be eased', unknown: 'Not enough to judge recovery yet' }[a.level];
        return (
          <div className="rounded-xl border border-white/10 bg-slate-900/40 p-3 space-y-1">
            <p className="text-xs font-semibold text-white">{label}</p>
            {a.reasons.length > 0 && <p className="text-[11px] text-slate-400">{a.reasons.join('; ')}.</p>}
          </div>
        );
      })()}

      <label className="flex items-start gap-2 rounded-xl border border-white/10 bg-slate-900/40 p-3 text-xs text-slate-300">
        <input type="checkbox" className="mt-0.5" checked={autoApply} onChange={(e) => { setAutoApply(e.target.checked); setMorningAutoApply(e.target.checked); }} />
        <span><span className="font-semibold text-white">Ease today's session by itself</span> when I open the app in the morning and I'm not recovered. Off: it suggests the change and I choose. The original is always kept so it can be restored. (This device.)</span>
      </label>

      {snapshot && (
        <details className="rounded-xl border border-white/10 bg-slate-900/40 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-300">What COROS said ({Object.keys(snapshot.raw).length} {Object.keys(snapshot.raw).length === 1 ? 'reply' : 'replies'}{Object.keys(snapshot.errors).length ? `, ${Object.keys(snapshot.errors).length} failed` : ''})</summary>
          <div className="mt-2 space-y-2">
            {Object.entries(snapshot.raw).map(([tool, text]) => (
              <div key={tool}>
                <p className="text-[11px] font-semibold text-cyan-300">{tool}</p>
                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/40 p-2 text-[10px] text-slate-400">{text.slice(0, 2500)}</pre>
              </div>
            ))}
            {Object.entries(snapshot.errors).map(([tool, why]) => (
              <p key={tool} className="text-[11px] text-rose-300"><span className="font-semibold">{tool}:</span> {why}</p>
            ))}
          </div>
        </details>
      )}

      <button type="button" onClick={() => void disconnect()} disabled={busy !== null} className="min-h-10 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-rose-300 disabled:opacity-50">
        <Unplug className="w-3.5 h-3.5" /> Disconnect COROS
      </button>
    </div>
  );
};
