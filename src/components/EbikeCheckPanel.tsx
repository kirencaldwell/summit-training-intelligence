import React, { useState } from 'react';
import { Zap } from 'lucide-react';
import type { Activity, AthleteProfile } from '../types';
import { detectEbike, type EbikeDetection } from '../lib/ebikeDetect';
import { EBIKE_TAG, isEbike, normalizeTags } from '../lib/tags';

/** What the e-bike detector makes of this ride, with the evidence, and a way to tag it when the detector was unsure. */
export const EbikeCheckPanel: React.FC<{
  activity: Activity;
  profile?: AthleteProfile | null;
  onTag?: (tags: string[]) => Promise<void>;
}> = ({ activity, profile, onTag }) => {
  const [result, setResult] = useState<EbikeDetection | null>(null);
  const [tagging, setTagging] = useState(false);
  const [error, setError] = useState('');
  const tagged = isEbike(activity);
  const run = () => setResult(detectEbike(activity, activity.streams_data, { weight_kg: profile?.weight_kg, ftp: profile?.ftp, lthr: profile?.lthr, max_hr: profile?.max_hr }));
  const tag = async () => {
    if (!onTag) return;
    setTagging(true); setError('');
    try { await onTag(normalizeTags([...(activity.tags ?? []), EBIKE_TAG])); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not tag the ride.'); }
    setTagging(false);
  };
  const d = result?.details;

  return (
    <details className="rounded-xl border border-white/10 bg-slate-900/40 px-3 py-2">
      <summary className="cursor-pointer select-none min-h-9 flex items-center gap-2 text-xs font-semibold text-slate-300">
        <Zap className="w-3.5 h-3.5 text-amber-300" /> E-bike check <span className="font-normal text-slate-500">{tagged ? 'tagged as an e-bike ride' : 'see what the detector makes of this ride'}</span>
      </summary>
      <div className="mt-2 space-y-2 text-xs text-slate-300">
        <button type="button" onClick={run} className="min-h-9 rounded-lg border border-white/15 px-3 font-semibold text-slate-100 hover:bg-white/10">{result ? 'Check again' : 'Check this ride'}</button>
        {result && (
          <div className="space-y-1.5" aria-label="E-bike check result">
            <p className={`font-semibold ${result.ebike ? 'text-emerald-300' : 'text-slate-200'}`}>
              {result.ebike ? 'Looks like an e-bike ride.' : result.insufficient ? `Could not judge: ${result.insufficient}.` : 'No clear sign of motor assist.'}
            </p>
            {result.reasons.map((r) => <p key={r} className="text-slate-300">{r}</p>)}
            {d && (
              <ul className="list-disc list-inside space-y-0.5 text-slate-400">
                <li>{d.moving_minutes} min of riding, {d.flat_minutes} min of it on flat or uphill ground (speeds {d.speed_source === 'gps' ? 'worked out from the GPS track' : 'from the recording'}).</li>
                {d.cap
                  ? <li>Closest assist cutoff {d.cap.mph} mph: {d.cap.near_percent}% of flat time within a few mph of it, {d.cap.over_percent}% above it ({d.cap.score >= 2 ? 'strong sign' : d.cap.score === 1 ? 'a hint' : 'not a cutoff pattern'}).</li>
                  : <li>Not enough flat or uphill riding to look for an assist cutoff.</li>}
                {d.climbs.length === 0 ? <li>No sustained climb long enough to weigh (3 min or more at 3% or steeper).</li> : d.climbs.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            )}
            {!tagged && !result.ebike && onTag && (
              <button type="button" onClick={() => void tag()} disabled={tagging} className="min-h-9 rounded-lg bg-amber-400 px-3 font-bold text-slate-950 hover:bg-amber-300 disabled:opacity-50">{tagging ? 'Tagging…' : 'Tag as e-bike anyway'}</button>
            )}
            {error && <p role="alert" className="text-rose-300">{error}</p>}
          </div>
        )}
      </div>
    </details>
  );
};
