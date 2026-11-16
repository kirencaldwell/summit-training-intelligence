import React, { useState } from 'react';
import { Dumbbell, Loader2, Send, Sparkles } from 'lucide-react';
import type { TrainingSession } from '../types';
import { coachEngine } from '../lib/ai/coachEngine';
import { CorosError, isCorosConnected, listCorosTools, queryCoros, sendCorosWorkout, type CorosTool } from '../lib/coros';
import { pickWorkoutTool } from '../lib/corosWorkout';
import { gymExerciseNames, gymLogin, readGymAuth, sendGymWorkout, type GymPlan } from '../lib/corosGym';
import { itemLine, fmtSeconds, storedWorkout, type StructuredWorkout } from '../lib/workoutStructure';

const FACTS = (w: StructuredWorkout) => w.blocks.reduce((n, b) => n + b.items.length, 0);

/** A planned session as steps (exercises, sets, reps, load), with a way to put it on the COROS watch. */
export const WorkoutCard: React.FC<{ session: TrainingSession }> = ({ session }) => {
  const [workout, setWorkout] = useState<StructuredWorkout | undefined>(() => storedWorkout(session));
  const [busy, setBusy] = useState<'structure' | 'prepare' | 'send' | null>(null);
  const [error, setError] = useState('');
  const [prepared, setPrepared] = useState<{ tool: CorosTool; args: Record<string, unknown>; problem?: string } | null>(null);
  const [debug, setDebug] = useState('');
  // Gym workouts go through the COROS Training Hub (its official MCP takes only running and cycling workouts)
  const [gymPlan, setGymPlan] = useState<GymPlan | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [login, setLogin] = useState({ email: '', password: '', region: 'eu' as 'eu' | 'us' });

  const prepareGym = async () => {
    if (!workout) return;
    setBusy('prepare'); setError(''); setSent(''); setGymPlan(null);
    try {
      if (!readGymAuth()) { setNeedLogin(true); setBusy(null); return; }
      const list = await gymExerciseNames();
      const plan = await coachEngine.matchGymExercises(workout, list);
      if (!plan) setError('The coach could not match these exercises to COROS\'s list. Try again.');
      else setGymPlan(plan);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not prepare the workout.'); }
    setBusy(null);
  };

  const signIn = async () => {
    setBusy('prepare'); setError('');
    try {
      await gymLogin(login.email.trim(), login.password, login.region);
      setLogin({ ...login, password: '' });
      setNeedLogin(false);
      setBusy(null);
      await prepareGym();
      return;
    } catch (e) { setError(e instanceof Error ? e.message : 'Sign-in failed.'); }
    setBusy(null);
  };

  const sendGym = async () => {
    if (!workout || !gymPlan) return;
    setBusy('send'); setError('');
    try {
      const r = await sendGymWorkout(workout, gymPlan);
      setSent(`${r.totalSets} sets${r.duration ? `, about ${Math.round(r.duration / 60)} min` : ''}. Find it in COROS under Workouts and sync your watch.`);
      setGymPlan(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not send the workout.'); setNeedLogin(!readGymAuth()); }
    setBusy(null);
  };
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
    setBusy('prepare'); setError(''); setSent(''); setDebug('');
    try {
      const tools = await listCorosTools();
      const tool = pickWorkoutTool(tools);
      if (!tool) {
        const likely = tools.map((t) => t.name).filter((n) => /workout|plan|schedule/i.test(n));
        setError(`COROS offers no tool this app can use to create a workout. It offers: ${likely.join(', ') || tools.map((t) => t.name).join(', ')}.`);
      } else {
        // What is already on the account shows the coach the real field names and units (best effort)
        const library = tools.find((t) => t.name === 'queryWorkoutLibrary');
        let example = '';
        if (library) { try { example = ((await queryCoros([{ tool: library.name, args: {} }]))[0]?.text ?? '').slice(0, 5000); } catch { /* the example is optional */ } }
        const result = await coachEngine.corosWorkoutArgs(workout, tool, session.session_date, example);
        setDebug(`Tool: ${tool.name}\nSchema:\n${JSON.stringify(tool.inputSchema, null, 2)}\n\nCoach reply:\n${result.raw}${example ? `\n\nLibrary example given to the coach:\n${example.slice(0, 1500)}` : ''}`);
        if ('error' in result) setError(`The workout could not be prepared for COROS: ${result.error}`);
        else setPrepared({ tool, args: result.args, problem: result.problem });
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
            {(workout.kind === 'strength' || isCorosConnected()) && !prepared && !gymPlan && !needLogin && (
              <button type="button" onClick={() => void (workout.kind === 'strength' ? prepareGym() : prepare())} disabled={busy !== null} className="min-h-9 inline-flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3 text-xs font-bold text-slate-950 hover:bg-cyan-400 disabled:opacity-50">
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

      {needLogin && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 space-y-2" aria-label="COROS sign-in">
          <p className="text-xs font-semibold text-amber-200">Gym workouts go to COROS through its Training Hub, which needs your COROS sign-in.</p>
          <p className="text-[11px] text-slate-400">Your password is used once to get a token and is not stored. Signing in this way signs you out of the COROS website. It's an unofficial route that COROS could change.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <input type="email" autoComplete="username" placeholder="COROS email" value={login.email} onChange={(e) => setLogin({ ...login, email: e.target.value })} className="rounded-lg border border-white/10 bg-slate-950/60 p-2 text-sm text-white" />
            <input type="password" autoComplete="current-password" placeholder="COROS password" value={login.password} onChange={(e) => setLogin({ ...login, password: e.target.value })} className="rounded-lg border border-white/10 bg-slate-950/60 p-2 text-sm text-white" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="COROS region" value={login.region} onChange={(e) => setLogin({ ...login, region: e.target.value as 'eu' | 'us' })} className="rounded-lg border border-white/10 bg-slate-950/60 p-2 text-xs text-white">
              <option value="eu">Europe</option><option value="us">United States</option>
            </select>
            <button type="button" onClick={() => void signIn()} disabled={busy !== null || !login.email || !login.password} className="min-h-9 rounded-lg bg-amber-400 px-3 text-xs font-bold text-slate-950 hover:bg-amber-300 disabled:opacity-50">{busy ? 'Signing in…' : 'Sign in and continue'}</button>
            <button type="button" onClick={() => setNeedLogin(false)} disabled={busy !== null} className="min-h-9 rounded-lg border border-white/15 px-3 text-xs font-semibold text-slate-200 hover:bg-white/10">Cancel</button>
          </div>
        </div>
      )}

      {gymPlan && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 space-y-2" aria-label="Confirm COROS gym workout">
          <p className="text-xs font-semibold text-amber-200">This is what will be created in COROS:</p>
          <ul className="divide-y divide-white/5">
            {gymPlan.exercises.map((e, i) => (
              <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1 text-xs">
                <span className="text-white">{e.name}{e.source.toLowerCase() !== e.name.toLowerCase() && <span className="ml-1 text-slate-500">(your "{e.source}")</span>}</span>
                <span className="text-amber-200">{e.sets ?? '—'} × {e.reps ?? (e.duration_s ? `${e.duration_s}s` : '—')}{e.weight_lb ? ` @ ${e.weight_lb} lb` : ''}{e.rest_s ? <span className="ml-2 text-slate-400">rest {e.rest_s}s</span> : null}</span>
              </li>
            ))}
          </ul>
          {gymPlan.unmatched.length > 0 && <p className="text-[11px] font-semibold text-rose-300">Left out, no match in COROS's exercise list: {gymPlan.unmatched.join(', ')}.</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => void sendGym()} disabled={busy !== null} className="min-h-9 rounded-lg bg-amber-400 px-3 text-xs font-bold text-slate-950 hover:bg-amber-300 disabled:opacity-50">{busy === 'send' ? 'Sending…' : 'Send it'}</button>
            <button type="button" onClick={() => setGymPlan(null)} disabled={busy !== null} className="min-h-9 rounded-lg border border-white/15 px-3 text-xs font-semibold text-slate-200 hover:bg-white/10">Cancel</button>
          </div>
        </div>
      )}

      {prepared && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 space-y-2" aria-label="Confirm COROS workout">
          {prepared.problem && <p className="text-xs text-rose-200">The coach says it could not complete this: {prepared.problem}</p>}
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
      {debug && (error || prepared) && (
        <details className="text-[10px] text-slate-500">
          <summary className="cursor-pointer">What COROS expects and what the coach answered</summary>
          <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded bg-black/40 p-2">{debug}</pre>
        </details>
      )}
    </div>
  );
};
