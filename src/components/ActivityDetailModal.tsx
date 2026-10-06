import React from 'react';
import { X, Calendar, Clock, Navigation, Mountain, Zap, Heart, ShieldAlert, Bot, RefreshCw } from 'lucide-react';
import type { Activity } from '../types';
import { RouteMapViewer } from './RouteMapViewer';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

interface ActivityDetailModalProps {
  activity: Activity | null;
  onClose: () => void;
  onAssess?: (activity: Activity) => void;
  isAssessing?: boolean;
  assessmentError?: string;
}

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

export const ActivityDetailModal: React.FC<ActivityDetailModalProps> = ({
  activity,
  onClose,
  onAssess,
  isAssessing = false,
  assessmentError,
}) => {
  if (!activity) return null;

  const streamData = activity.streams_data || [];
  const durationMin = Math.round(activity.duration_seconds / 60);
  const distanceKm = (activity.distance_meters / 1000).toFixed(1);

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
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

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
            <span className="text-lg font-extrabold text-white">{distanceKm} km</span>
          </div>

          <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5">
            <span className="text-xs text-slate-400 flex items-center mb-1">
              <Mountain className="w-3.5 h-3.5 mr-1 text-sky-400" /> Elevation Gain
            </span>
            <span className="text-lg font-extrabold text-white">{activity.total_elevation_gain_m} m</span>
          </div>

          <div className="p-3 rounded-xl bg-slate-900/60 border border-white/5">
            <span className="text-xs text-slate-400 flex items-center mb-1">
              <Zap className="w-3.5 h-3.5 mr-1 text-amber-400" /> TSS (Stress)
            </span>
            <span className="text-lg font-extrabold text-amber-400">{activity.training_stress_score || 'N/A'}</span>
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
              <p className="text-base font-bold text-slate-100">{activity.avg_vam_mh} m/h</p>
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
