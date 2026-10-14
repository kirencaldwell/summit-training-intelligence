import React, { useRef, useState } from 'react';
import { Mountain } from 'lucide-react';
import type { Activity } from '../types';
import { dataService } from '../lib/supabase';
import { browserTileLoader, terrainGain } from '../lib/elevation';
import { formatFeetFromMeters, mToFt } from '../lib/units';

/** A correction is only proposed when the terrain model is clearly lower than the recorded climb. */
const MIN_OVERSTATEMENT = 0.1;
const MIN_DIFFERENCE_M = 30;

export interface ElevationChange { id: string; gain_m: number }

interface Proposal { activity: Activity; recorded_m: number; terrain_m: number }

const percentLower = (recorded: number, terrain: number) => Math.round(((recorded - terrain) / recorded) * 100);

/** Works out the terrain-model gain for an activity, loading its track if the list left it out. */
async function terrainFor(activity: Activity) {
  const stream = activity.streams_data?.length ? activity.streams_data : (await dataService.getActivityById(activity.id))?.streams_data;
  return terrainGain(stream, browserTileLoader);
}

/**
 * Activities page panel: checks every outdoor activity's recorded climb against the terrain model, lists the ones
 * that look overstated, and applies the corrections the athlete keeps ticked.
 */
export const ElevationCheckPanel: React.FC<{
  activities: Activity[];
  onApply: (changes: ElevationChange[]) => Promise<void>;
}> = ({ activities, onApply }) => {
  const [phase, setPhase] = useState<'idle' | 'running' | 'review' | 'applying' | 'done'>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [checkedCount, setCheckedCount] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [ticked, setTicked] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [appliedCount, setAppliedCount] = useState(0);
  const cancelled = useRef(false);

  const eligible = activities.filter((a) => a.sport_type !== 'zwift' && a.total_elevation_gain_m > 0);

  const run = async () => {
    cancelled.current = false;
    setError('');
    setPhase('running');
    setProposals([]);
    setSkipped(0);
    setProgress({ done: 0, total: eligible.length });
    const found: Proposal[] = [];
    let skippedNoGps = 0;
    let checked = 0;
    for (let i = 0; i < eligible.length; i++) {
      if (cancelled.current) break;
      const activity = eligible[i];
      try {
        const result = await terrainFor(activity);
        if (!result) skippedNoGps++;
        else {
          checked++;
          const recorded = activity.total_elevation_gain_m;
          if (recorded - result.gain_m >= MIN_DIFFERENCE_M && result.gain_m < recorded * (1 - MIN_OVERSTATEMENT)) {
            found.push({ activity, recorded_m: recorded, terrain_m: result.gain_m });
          }
        }
      } catch (err) {
        console.warn('Terrain check failed for an activity:', err);
        skippedNoGps++;
      }
      setProgress({ done: i + 1, total: eligible.length });
    }
    found.sort((a, b) => (b.recorded_m - b.terrain_m) - (a.recorded_m - a.terrain_m));
    setProposals(found);
    setTicked(found.map((p) => p.activity.id));
    setCheckedCount(checked);
    setSkipped(skippedNoGps);
    setPhase(cancelled.current ? 'idle' : 'review');
  };

  const apply = async () => {
    setPhase('applying');
    setError('');
    try {
      const changes = proposals.filter((p) => ticked.includes(p.activity.id)).map((p) => ({ id: p.activity.id, gain_m: p.terrain_m }));
      await onApply(changes);
      setAppliedCount(changes.length);
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The corrections could not be saved.');
      setPhase('review');
    }
  };

  if (eligible.length === 0) return null;
  const totalOver = proposals.filter((p) => ticked.includes(p.activity.id)).reduce((sum, p) => sum + (p.recorded_m - p.terrain_m), 0);

  return (
    <div className="glass-panel rounded-2xl border border-white/10 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white flex items-center gap-2"><Mountain className="w-4 h-4 text-sky-400" /> Elevation check</p>
          <p className="text-xs text-slate-400">
            GPS altitude is noisy and can overstate climbing. This compares each activity's climb with a terrain elevation model along its route
            (about 30 m resolution), and offers a correction only where the recorded climb is at least 10% higher.
          </p>
        </div>
        {(phase === 'idle' || phase === 'done') && (
          <button
            onClick={() => void run()}
            className="min-h-9 px-3 rounded-lg bg-sky-500/10 border border-sky-500/30 text-xs font-semibold text-sky-300 hover:bg-sky-500/20"
          >
            {phase === 'done' ? 'Check again' : `Check ${eligible.length} activities`}
          </button>
        )}
      </div>

      {phase === 'running' && (
        <div role="status">
          <div className="h-2 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full bg-sky-400 transition-all" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            Checking {progress.done} of {progress.total}…{' '}
            <button onClick={() => { cancelled.current = true; }} className="underline">Stop</button>
          </p>
        </div>
      )}

      {phase === 'review' && (
        <div className="space-y-2">
          <p className="text-xs text-slate-300">
            Checked {checkedCount} {checkedCount === 1 ? 'activity' : 'activities'}
            {skipped > 0 ? ` (${skipped} skipped: no GPS track or the terrain data could not be loaded)` : ''}.{' '}
            {proposals.length === 0
              ? 'None looks overstated.'
              : `${proposals.length} look overstated, by ${Math.round(mToFt(totalOver)).toLocaleString()} ft in total for the ones ticked.`}
          </p>
          {proposals.length > 0 && (
            <>
              <ul className="max-h-72 overflow-y-auto space-y-1 pr-1">
                {proposals.map((p) => {
                  const on = ticked.includes(p.activity.id);
                  return (
                    <li key={p.activity.id}>
                      <label className="flex items-start gap-3 rounded-lg border border-white/10 bg-slate-900/50 px-3 py-2 cursor-pointer text-xs">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => setTicked((prev) => (on ? prev.filter((id) => id !== p.activity.id) : [...prev, p.activity.id]))}
                          className="mt-0.5 accent-sky-500"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-slate-200 truncate">{p.activity.title}</span>
                          <span className="block text-[11px] text-slate-500">
                            {new Date(p.activity.start_date).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                        </span>
                        <span className="text-right tabular-nums whitespace-nowrap">
                          <span className="text-slate-500 line-through">{formatFeetFromMeters(p.recorded_m)}</span>{' '}
                          <span className="font-semibold text-sky-200">{formatFeetFromMeters(p.terrain_m)}</span>
                          <span className="block text-[11px] text-slate-500">{percentLower(p.recorded_m, p.terrain_m)}% lower</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => void apply()}
                  disabled={ticked.length === 0}
                  className="min-h-9 px-3 rounded-lg bg-sky-500/20 border border-sky-500/40 text-xs font-semibold text-sky-100 hover:bg-sky-500/30 disabled:opacity-50"
                >
                  Apply {ticked.length} {ticked.length === 1 ? 'correction' : 'corrections'}
                </button>
                <button onClick={() => setPhase('idle')} className="min-h-9 px-3 text-xs font-semibold text-slate-400 hover:text-white">Discard</button>
              </div>
            </>
          )}
        </div>
      )}

      {phase === 'applying' && <p role="status" className="text-xs text-slate-400">Saving corrections…</p>}
      {phase === 'done' && <p role="status" className="text-xs text-emerald-300">Updated the elevation gain on {appliedCount} {appliedCount === 1 ? 'activity' : 'activities'}.</p>}
      {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
    </div>
  );
};

/** In the activity view: check this one activity's climb against the terrain model, and optionally adopt it. */
export const ElevationCheckRow: React.FC<{
  activity: Activity;
  onApply?: (changes: ElevationChange[]) => Promise<void>;
}> = ({ activity, onApply }) => {
  const [state, setState] = useState<'idle' | 'checking' | 'result' | 'saving' | 'saved'>('idle');
  const [terrain, setTerrain] = useState<number | undefined>();
  const [error, setError] = useState('');

  const hasGps = (activity.streams_data ?? []).some((p) => typeof p.lat === 'number' && typeof p.lng === 'number');
  if (activity.sport_type === 'zwift' || !hasGps) return null;

  const check = async () => {
    setState('checking');
    setError('');
    try {
      const result = await terrainFor(activity);
      if (!result) {
        setError('The terrain data could not be loaded for this route.');
        setState('idle');
        return;
      }
      setTerrain(result.gain_m);
      setState('result');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The check failed.');
      setState('idle');
    }
  };

  const recorded = activity.total_elevation_gain_m;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {state === 'idle' && (
        <button onClick={() => void check()} className="font-semibold text-sky-300 hover:underline">Check elevation against terrain data</button>
      )}
      {state === 'checking' && <span className="text-slate-400">Checking the route against terrain data…</span>}
      {(state === 'result' || state === 'saving') && terrain !== undefined && (
        <>
          <span className="text-slate-300">
            Terrain model: <span className="font-semibold text-sky-200">{formatFeetFromMeters(terrain)}</span> vs recorded {formatFeetFromMeters(recorded)}
            {recorded > 0 && Math.abs(recorded - terrain) / recorded >= 0.03 ? ` (${terrain < recorded ? percentLower(recorded, terrain) + '% lower' : Math.round(((terrain - recorded) / recorded) * 100) + '% higher'})` : ' (about the same)'}
          </span>
          {onApply && Math.abs(recorded - terrain) >= 1 && (
            <button
              disabled={state === 'saving'}
              onClick={async () => {
                setState('saving');
                try {
                  await onApply([{ id: activity.id, gain_m: terrain }]);
                  setState('saved');
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Could not save.');
                  setState('result');
                }
              }}
              className="px-2.5 py-1 rounded-md border border-sky-500/40 text-sky-200 hover:bg-sky-500/10 disabled:opacity-50"
            >
              {state === 'saving' ? 'Saving…' : 'Use terrain value'}
            </button>
          )}
        </>
      )}
      {state === 'saved' && <span className="text-emerald-300">Elevation gain updated.</span>}
      {error && <span role="alert" className="text-rose-300">{error}</span>}
    </div>
  );
};
