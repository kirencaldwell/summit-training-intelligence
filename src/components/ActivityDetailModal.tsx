import React, { useState } from 'react';
import { X, Calendar, Clock, Navigation, Mountain, Zap, Heart, ShieldAlert, Bot, RefreshCw, Pencil, Check, Tag } from 'lucide-react';
import type { Activity, AthleteProfile, SportType } from '../types';
import { MAX_TAG_LENGTH, MAX_TAGS_PER_ACTIVITY, normalizeTags } from '../lib/tags';
import { describeTssSource, resolveTss } from '../lib/trainingMath';
import { kgToLb, lbToKg, roundTo } from '../lib/units';
import { RouteMapViewer } from './RouteMapViewer';
import { formatFeetFromMeters, formatFtPerHourFromMph, formatMilesFromMeters } from '../lib/units';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

interface ActivityDetailModalProps {
  activity: Activity | null;
  onClose: () => void;
  onAssess?: (activity: Activity) => void;
  isAssessing?: boolean;
  assessmentError?: string;
  onUpdate?: (
    id: string,
    updates: Pick<Partial<Activity>, 'title' | 'sport_type' | 'tags' | 'effort_notes' | 'pack_weight_kg' | 'perceived_exertion'>
  ) => Promise<void>;
  profile?: AthleteProfile | null;
  /** Ask the coach to (re-)estimate this activity's training load */
  onEstimate?: (activity: Activity) => void;
  isEstimating?: boolean;
  estimateError?: string;
  /** Every tag already used on any activity, offered as quick picks */
  allTags?: string[];
}

const SPORT_OPTIONS: { value: SportType; label: string }[] = [
  { value: 'cycling', label: 'Road Cycling' },
  { value: 'zwift', label: 'Zwift / Indoor' },
  { value: 'skimo', label: 'Skimo' },
  { value: 'backcountry_skiing', label: 'Backcountry Skiing' },
  { value: 'scrambling', label: 'Peak Scramble' },
  { value: 'weighted_hiking', label: 'Weighted Hike' },
];

/** Inline editor for the activity name, sport and custom tags. */
const ActivityEditor: React.FC<{
  activity: Activity;
  allTags: string[];
  onSave: (updates: Pick<Partial<Activity>, 'title' | 'sport_type' | 'tags' | 'effort_notes' | 'pack_weight_kg' | 'perceived_exertion'>) => Promise<void>;
  onCancel: () => void;
}> = ({ activity, allTags, onSave, onCancel }) => {
  const [title, setTitle] = useState(activity.title);
  const [sport, setSport] = useState<SportType>(activity.sport_type);
  const [tags, setTags] = useState<string[]>(activity.tags ?? []);
  const [tagInput, setTagInput] = useState('');
  const [effortNotes, setEffortNotes] = useState(activity.effort_notes ?? '');
  const [packLb, setPackLb] = useState(activity.pack_weight_kg ? String(roundTo(kgToLb(activity.pack_weight_kg), 1)) : '');
  const [rpe, setRpe] = useState(activity.perceived_exertion ? String(activity.perceived_exertion) : '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const addTags = (raw: string) => {
    // Commas also separate tags so "race, indoor" works when pasted
    setTags((prev) => normalizeTags([...prev, ...raw.split(',')]));
    setTagInput('');
  };
  const removeTag = (tag: string) => setTags((prev) => prev.filter((t) => t !== tag));
  const suggestions = allTags.filter((t) => !tags.some((x) => x.toLowerCase() === t.toLowerCase())).slice(0, 12);

  const handleSave = async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      setError('Name cannot be empty.');
      return;
    }
    setIsSaving(true);
    setError('');
    try {
      // Include a tag still typed in the box so it isn't silently dropped
      const finalTags = normalizeTags([...tags, ...tagInput.split(',')]);
      const rpeNumber = Number(rpe);
      const packNumber = Number(packLb);
      await onSave({
        title: trimmed,
        sport_type: sport,
        tags: finalTags,
        effort_notes: effortNotes.trim() || undefined,
        // null (not undefined) so clearing a field is saved
        pack_weight_kg: (packNumber > 0 ? roundTo(lbToKg(packNumber), 2) : null) as unknown as number | undefined,
        perceived_exertion: (rpeNumber >= 1 && rpeNumber <= 10 ? Math.round(rpeNumber) : null) as unknown as number | undefined,
      });
    } catch (err: any) {
      setError(err?.message || 'Could not save changes.');
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-cyan-500/25 bg-slate-900/60 p-4">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_12rem] gap-3">
        <label className="text-xs font-medium text-slate-400">
          Name
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            className="mt-1 w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
          />
        </label>
        <label className="text-xs font-medium text-slate-400">
          Sport
          <select
            value={sport}
            onChange={(e) => setSport(e.target.value as SportType)}
            className="mt-1 w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
          >
            {SPORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      </div>

      <div>
        <span className="text-xs font-medium text-slate-400 flex items-center"><Tag className="w-3.5 h-3.5 mr-1" /> Tags</span>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {tags.map((tag) => (
            <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-cyan-500/15 border border-cyan-500/30 pl-2.5 pr-1 py-0.5 text-xs text-cyan-200">
              {tag}
              <button type="button" onClick={() => removeTag(tag)} aria-label={`Remove tag ${tag}`} className="rounded-full p-0.5 hover:bg-white/10">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          {tags.length < MAX_TAGS_PER_ACTIVITY && (
            <input
              type="text"
              value={tagInput}
              maxLength={MAX_TAG_LENGTH}
              placeholder="Add a tag, press Enter"
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  if (tagInput.trim()) addTags(tagInput);
                } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
                  setTags((prev) => prev.slice(0, -1));
                }
              }}
              className="min-w-40 flex-1 bg-transparent px-1 py-1 text-xs text-white placeholder-slate-500 focus:outline-none"
            />
          )}
        </div>
        {suggestions.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-500">Existing:</span>
            {suggestions.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => addTags(tag)}
                className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[11px] text-slate-300 hover:bg-white/10"
              >
                + {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-white/10 pt-3">
        <label className="block text-xs font-medium text-slate-400">
          Effort description <span className="text-slate-500">(optional)</span>
          <textarea
            rows={3}
            value={effortNotes}
            onChange={(e) => setEffortNotes(e.target.value)}
            maxLength={2000}
            placeholder="e.g. Heavy 35 lb pack, steep scrambling in snow, felt like an 8/10 for the last hour. Rest stops included."
            className="mt-1 w-full bg-slate-900 border border-white/10 rounded-xl p-3 text-xs text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs font-medium text-slate-400">
            Pack weight (lb)
            <input
              type="number"
              min={0}
              step="0.5"
              value={packLb}
              onChange={(e) => setPackLb(e.target.value)}
              className="mt-1 w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
            />
          </label>
          <label className="text-xs font-medium text-slate-400">
            Perceived effort (RPE 1-10)
            <input
              type="number"
              min={1}
              max={10}
              value={rpe}
              onChange={(e) => setRpe(e.target.value)}
              className="mt-1 w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
            />
          </label>
        </div>
        <p className="text-[11px] text-slate-500">
          Saving a new description asks the coach to re-estimate this activity's training load, and your fitness and fatigue curves update.
        </p>
      </div>

      {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={isSaving} className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-300 disabled:opacity-50">
          Cancel
        </button>
        <button type="button" onClick={() => void handleSave()} disabled={isSaving} className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold disabled:opacity-50">
          <Check className="w-3.5 h-3.5" /> {isSaving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
};

/** Minimal markdown for the coach text: **bold** inline, "- " bullets, blank-line paragraphs. */
const AssessmentText: React.FC<{ text: string }> = ({ text }) => {
  const inline = (line: string) =>
    line.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**') && part.length > 4
        ? <strong key={i} className="text-white">{part.slice(2, -2)}</strong>
        : <React.Fragment key={i}>{part}</React.Fragment>
    );
  return (
    <div className="space-y-2 text-sm text-slate-300 leading-relaxed">
      {text.split(/\n{2,}/).map((block, i) => {
        const lines = block.split('\n').filter((l) => l.trim());
        if (lines.length > 0 && lines.every((l) => /^\s*[-*] /.test(l))) {
          return (
            <ul key={i} className="list-disc pl-5 space-y-1">
              {lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*] /, ''))}</li>)}
            </ul>
          );
        }
        return <p key={i} className="whitespace-pre-line">{inline(block)}</p>;
      })}
    </div>
  );
};

export const ActivityDetailModal: React.FC<ActivityDetailModalProps> = ({ activity, ...rest }) => {
  if (!activity) return null;
  // Keyed so edit state resets when a different activity is opened
  return <ActivityDetailContent key={activity.id} activity={activity} {...rest} />;
};

const ActivityDetailContent: React.FC<Omit<ActivityDetailModalProps, 'activity'> & { activity: Activity }> = ({
  activity,
  onClose,
  onAssess,
  isAssessing = false,
  assessmentError,
  onUpdate,
  allTags = [],
  profile,
  onEstimate,
  isEstimating = false,
  estimateError,
}) => {
  const load = resolveTss(activity, profile ? { ftp: profile.ftp, lthr: profile.lthr, weight_kg: profile.weight_kg } : undefined);
  const [isEditing, setIsEditing] = useState(false);

  const streamData = activity.streams_data || [];
  const durationMin = Math.round(activity.duration_seconds / 60);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto">
      <div className="w-full max-w-4xl glass-panel rounded-2xl border border-white/15 p-6 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto">
        
        {/* Modal Header */}
        <div className="flex items-start justify-between border-b border-white/10 pb-4">
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 uppercase tracking-wide">
                {activity.sport_type.replace('_', ' ')}
              </span>
              <span className="text-xs text-slate-400 flex items-center">
                <Calendar className="w-3.5 h-3.5 mr-1" />
                {new Date(activity.start_date).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            </div>
            <h2 className="text-xl font-bold text-white mt-1">{activity.title}</h2>
            {(activity.tags?.length ?? 0) > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {activity.tags!.map((tag) => (
                  <span key={tag} className="rounded-full bg-cyan-500/10 border border-cyan-500/25 px-2.5 py-0.5 text-[11px] text-cyan-200">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {onUpdate && !isEditing && (
              <button
                onClick={() => setIsEditing(true)}
                aria-label="Edit activity"
                title="Edit name, sport and tags"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-300 hover:text-white transition-all"
              >
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
            )}
            <button 
              onClick={onClose}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {isEditing && onUpdate && (
          <ActivityEditor
            activity={activity}
            allTags={allTags}
            onCancel={() => setIsEditing(false)}
            onSave={async (updates) => {
              await onUpdate(activity.id, updates);
              setIsEditing(false);
            }}
          />
        )}

        {/* Primary Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5">
            <span className="text-xs text-slate-400 flex items-center mb-1">
              <Clock className="w-3.5 h-3.5 mr-1 text-cyan-400" /> Duration
            </span>
            <span className="text-lg font-extrabold text-white">{durationMin} min</span>
          </div>

          <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5">
            <span className="text-xs text-slate-400 flex items-center mb-1">
              <Navigation className="w-3.5 h-3.5 mr-1 text-emerald-400" /> Distance
            </span>
            <span className="text-lg font-extrabold text-white">{formatMilesFromMeters(activity.distance_meters)}</span>
          </div>

          <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5">
            <span className="text-xs text-slate-400 flex items-center mb-1">
              <Mountain className="w-3.5 h-3.5 mr-1 text-sky-400" /> Elevation Gain
            </span>
            <span className="text-lg font-extrabold text-white">{formatFeetFromMeters(activity.total_elevation_gain_m)}</span>
          </div>

          <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5">
            <span className="text-xs text-slate-400 flex items-center mb-1">
              <Zap className="w-3.5 h-3.5 mr-1 text-amber-400" /> TSS (Stress)
            </span>
            <span className="text-lg font-extrabold text-amber-400" title={describeTssSource(load.source)}>
              {load.tss > 0 ? `${load.source === 'power' ? '' : '~'}${Math.round(load.tss)}` : 'N/A'}
            </span>
          </div>
        </div>

        {/* Secondary Training Engine Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {activity.normalized_power && (
            <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
              <span className="text-[11px] text-amber-400 font-medium">Normalized Power (NP)</span>
              <p className="text-base font-bold text-slate-100">{activity.normalized_power} W</p>
            </div>
          )}

          {activity.intensity_factor && (
            <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
              <span className="text-[11px] text-amber-400 font-medium">Intensity Factor (IF)</span>
              <p className="text-base font-bold text-slate-100">{activity.intensity_factor}</p>
            </div>
          )}

          {activity.avg_hr && (
            <div className="p-3 rounded-xl bg-rose-500/5 border border-rose-500/20">
              <span className="text-[11px] text-rose-400 font-medium flex items-center">
                <Heart className="w-3 h-3 mr-1" /> Avg Heart Rate
              </span>
              <p className="text-base font-bold text-slate-100">{activity.avg_hr} BPM (Max {activity.max_hr || 'N/A'})</p>
            </div>
          )}

          {activity.avg_vam_mh && (
            <div className="p-3 rounded-xl bg-sky-500/5 border border-sky-500/20">
              <span className="text-[11px] text-sky-400 font-medium">Ascent Rate (VAM)</span>
              <p className="text-base font-bold text-slate-100">{formatFtPerHourFromMph(activity.avg_vam_mh)}</p>
            </div>
          )}
        </div>

        {/* Injury / Knee rating notice if any */}
        {(activity.knee_discomfort_level || 0) > 0 && (
          <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center space-x-3 text-amber-300 text-xs">
            <ShieldAlert className="w-5 h-5 flex-shrink-0 text-amber-400" />
            <span>
              <strong>Knee Discomfort Rating: {activity.knee_discomfort_level}/10.</strong> Logged for this activity.
            </span>
          </div>
        )}

        {/* Training load: where it came from, the athlete's notes, and the AI estimate */}
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-amber-300 flex items-center">
              <Zap className="w-4 h-4 mr-1.5" /> Training Load
            </h3>
            {onEstimate && load.source !== 'power' && (
              <button
                onClick={() => onEstimate(activity)}
                disabled={isEstimating}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-xs font-semibold disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isEstimating ? 'animate-spin' : ''}`} />
                {isEstimating ? 'Estimating…' : activity.tss_source === 'ai' ? 'Re-estimate with AI' : 'Estimate with AI'}
              </button>
            )}
          </div>
          <p className="text-xs text-slate-300">
            <span className="font-bold text-white">{load.tss > 0 ? `${load.source === 'power' ? '' : '~'}${Math.round(load.tss)} TSS` : 'No load'}</span>
            {load.intensityFactor ? <span className="text-slate-400"> · IF {load.intensityFactor}</span> : null}
            <span className="text-slate-400"> · {describeTssSource(load.source)}</span>
            {load.source === 'ai' && activity.tss_confidence ? <span className="text-slate-400"> ({activity.tss_confidence} confidence)</span> : null}
          </p>
          {load.source === 'ai' && activity.tss_rationale && (
            <p className="text-xs text-slate-300 leading-relaxed">{activity.tss_rationale}</p>
          )}
          {activity.effort_notes && (
            <p className="text-xs text-slate-400 italic border-l-2 border-white/10 pl-2">"{activity.effort_notes}"</p>
          )}
          {load.source === 'baseline' && !activity.effort_notes && (
            <p className="text-[11px] text-slate-500">
              A rough estimate from duration, terrain and pace. Add an effort description (Edit) for a better one.
            </p>
          )}
          {estimateError && <p role="alert" className="text-xs text-rose-400">{estimateError}</p>}
        </div>

        {/* AI Coach Assessment (saved with the activity) */}
        <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/5 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-cyan-300 flex items-center">
              <Bot className="w-4 h-4 mr-1.5" /> Coach Assessment
            </h3>
            {onAssess && (
              <button
                onClick={() => onAssess(activity)}
                disabled={isAssessing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 text-xs font-semibold disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isAssessing ? 'animate-spin' : ''}`} />
                {isAssessing ? 'Assessing…' : activity.coach_assessment ? 'Regenerate' : 'Generate assessment'}
              </button>
            )}
          </div>

          {activity.coach_assessment ? (
            <>
              <AssessmentText text={activity.coach_assessment} />
              {activity.coach_assessment_at && (
                <p className="text-[10px] text-slate-500">
                  Generated {new Date(activity.coach_assessment_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                </p>
              )}
            </>
          ) : isAssessing ? (
            <p className="text-xs text-slate-400">Your coach is reviewing this activity against your plan and goals…</p>
          ) : (
            <p className="text-xs text-slate-400">No assessment yet. Generate one to see how this fits your accepted plan and goals.</p>
          )}
          {assessmentError && <p className="text-xs text-rose-400">{assessmentError}</p>}
        </div>

        {/* Interactive Leaflet GPS Map */}
        <div>
          <h3 className="text-sm font-semibold text-slate-300 mb-2">GPS Route & Map Overview</h3>
          <RouteMapViewer streamPoints={activity.streams_data} title={activity.title} />
        </div>

        {/* Time-series Power & HR Streams Chart */}
        {streamData.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-slate-300 mb-2">Metric Time-Series Streams (Power / Heart Rate)</h3>
            <div className="w-full h-56 rounded-xl bg-slate-900/60 p-3 border border-white/10">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={streamData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis 
                    dataKey="time" 
                    stroke="#64748B" 
                    tick={{ fontSize: 10 }}
                    tickFormatter={(sec) => `${Math.floor(sec / 60)}m`}
                  />
                  <YAxis yAxisId="watts" stroke="#F59E0B" tick={{ fontSize: 10 }} unit="W" />
                  <YAxis yAxisId="hr" orientation="right" stroke="#F43F5E" tick={{ fontSize: 10 }} unit="bpm" />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'rgba(15, 23, 42, 0.95)', 
                      borderColor: 'rgba(255, 255, 255, 0.15)',
                      borderRadius: '0.5rem',
                      fontSize: '11px'
                    }}
                  />
                  <Line yAxisId="watts" type="monotone" dataKey="watts" stroke="#F59E0B" dot={false} strokeWidth={1.5} name="Watts" />
                  <Line yAxisId="hr" type="monotone" dataKey="hr" stroke="#F43F5E" dot={false} strokeWidth={1.5} name="Heart Rate" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
