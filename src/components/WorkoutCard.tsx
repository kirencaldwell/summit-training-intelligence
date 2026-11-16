import React, { useState } from 'react';
import { Dumbbell, Loader2, Send, Sparkles } from 'lucide-react';
import type { TrainingSession } from '../types';
import { coachEngine } from '../lib/ai/coachEngine';
import { CorosError, isCorosConnected, listCorosTools, sendCorosWorkout, type CorosTool } from '../lib/coros';
import { pickWorkoutTool } from '../lib/corosWorkout';
import { itemLine, fmtSeconds, storedWorkout, type StructuredWorkout } from '../lib/workoutStructure';

const FACTS = (w: StructuredWorkout) => w.blocks.reduce((n, b) => n + b.items.length, 0);

/** A planned session as steps (exercises, sets, reps, load), with a way to put it on the COROS watch. */
export const WorkoutCard: React.FC<{ session: TrainingSession }> = ({ session }) => {
  const [workout, setWorkout] = useState<StructuredWorkout | undefined>(() => storedWorkout(session));
  const [busy, setBusy] = useState<'structure' | 'prepare' | 'send' | null>(null);
  const [error, setError] = useState('');
  const [prepared, setPrepared] = useState<{ tool: CorosTool; args: Record<string, unknown> } | null>(null);
  const [sent, setSent] = useState('');

  const structure = async () => {
    setBusy('structure'); setError('');
    try {
      const w = await coachEngine.structureSession(session);
      if (!w) setError('The coach could not turn this into steps. Try again.');
      else setWorkout(w);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not structure the workout.'); }
    setBusy(null);
  };

  const prepare = async () => {
    if (!workout) return;
    setBusy('prepare'); setError(''); setSent('');
    try {
      const tools = await listCorosTools();
      const tool = pickWorkoutTool(tools);
      if (!tool) {
        const likely = tools.map((t) => t.name).filter((n) => /workout|plan|schedule/i.test(n));
        setError(`COROS offers no tool this app can use to create a workout. It offers: ${likely.join(', ') || tools.map((t) => t.name).join(', ')}.`);
      } else {
        const result = await coachEngine.corosWorkoutArgs(workout, tool, session.session_date);
        if ('error' in result) setError(`The workout could not be prepared for COROS: ${result.error}`);
        else setPrepared({ tool, args: result.args });
      }
    } catch (e) { setError(e instanceof CorosError && e.reconnect ? 'Reconnect COROS in Import data → COROS.' : e instanceof Error ? e.message : 'Could not reach COROS.'); }
    setBusy(null);
  };

  const send = async () => {
    if (!prepared) return;
    setBusy('send'); setError('');
    try {
      const r = await sendCorosWorkout(prepared.tool.name, prepared.args);
      if (r.ok) { setSent(r.text.slice(0, 400) || 'Sent.'); setPrepared(null); }
      else setError(`COROS refused it: ${r.text.slice(0, 400)}`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not send the workout.'); }
    setBusy(null);
  };

  return (
    <div className="mt-3 space-y-2">
      {!workout ? (
        <button type="button" onClick={() => void structure()} disabled={busy !== null} className="min-h-9 inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {busy === 'structure' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Dumbbell className="w-3.5 h-3.5" />} {busy === 'structure' ? 'Building steps…' : 'Show as steps'}
        </button>
      ) : (
        <div className="rounded-lg border border-white/10 bg-slate-950/40 p-3 space-y-3" aria-label="Workout steps">
          {workout.blocks.map((b, bi) => (
            <div key={bi}>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-cyan-300">{b.title}{b.rounds ? ` · ${b.rounds} rounds` : ''}</p>
              <ul className="mt-1 divide-y divide-white/5">
                {b.items.map((i, ii) => (
                  <li key={ii} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
                    <span className="text-sm text-white">{i.name}</span>
                    <span className="text-xs font-semibold text-amber-200">{itemLine(i)}{i.rest_s ? <span className="ml-2 font-normal text-slate-400">rest {fmtSeconds(i.rest_s)}</span> : null}</span>
                    {i.notes && <span className="basis-full text-[11px] text-slate-400">{i.notes}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {workout.notes && <p className="text-[11px] text-slate-400">{workout.notes}</p>}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {isCorosConnected() && !prepared && (
              <button type="button" onClick={() => void prepare()} disabled={busy !== null} className="min-h-9 inline-flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3 text-xs font-bold text-slate-950 hover:bg-cyan-400 disabled:opacity-50">
                {busy === 'prepare' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} {busy === 'prepare' ? 'Preparing…' : 'Send to COROS'}
              </button>
            )}
            <button type="button" onClick={() => void structure()} disabled={busy !== null} className="min-h-9 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white disabled:opacity-50">
              <Sparkles className="w-3.5 h-3.5" /> {busy === 'structure' ? 'Rebuilding…' : 'Rebuild steps'}
            </button>
            <span className="text-[10px] text-slate-500">{FACTS(workout)} exercises</span>
          </div>
        </div>
      )}

      {prepared && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 space-y-2" aria-label="Confirm COROS workout">
          <p className="text-xs font-semibold text-amber-200">This is exactly what will be sent to COROS ({prepared.tool.name}):</p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-black/40 p-2 text-[10px] text-slate-300">{JSON.stringify(prepared.args, null, 2)}</pre>
          <div className="flex gap-2">
            <button type="button" onClick={() => void send()} disabled={busy !== null} className="min-h-9 rounded-lg bg-amber-400 px-3 text-xs font-bold text-slate-950 hover:bg-amber-300 disabled:opacity-50">{busy === 'send' ? 'Sending…' : 'Send it'}</button>
            <button type="button" onClick={() => setPrepared(null)} disabled={busy !== null} className="min-h-9 rounded-lg border border-white/15 px-3 text-xs font-semibold text-slate-200 hover:bg-white/10">Cancel</button>
          </div>
        </div>
      )}
      {sent && <p role="status" className="text-xs text-emerald-300">Sent to COROS. {sent}</p>}
      {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
    </div>
  );
};
