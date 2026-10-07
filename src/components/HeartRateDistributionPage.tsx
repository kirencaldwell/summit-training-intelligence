import React, { useState } from 'react';
import { HeartPulse } from 'lucide-react';
import type { Activity, AthleteProfile, ZoneDistribution } from '../types';
import { calculateActivityHRZoneDuration, getHrZoneRanges, type HrZoneRange } from '../lib/trainingMath';

interface HeartRateDistributionPageProps {
  activities: Activity[];
  profile: AthleteProfile;
  onOpenProfile?: () => void;
}

const ZONE_META = [
  { key: 'z1', label: 'Zone 1', name: 'Recovery', range: '<81% LTHR', color: '#38bdf8', background: 'bg-sky-400' },
  { key: 'z2', label: 'Zone 2', name: 'Aerobic', range: '81–90% LTHR', color: '#34d399', background: 'bg-emerald-400' },
  { key: 'z3', label: 'Zone 3', name: 'Tempo', range: '90–95% LTHR', color: '#facc15', background: 'bg-yellow-400' },
  { key: 'z4', label: 'Zone 4', name: 'Threshold', range: '95–102% LTHR', color: '#fb923c', background: 'bg-orange-400' },
  { key: 'z5', label: 'Zone 5', name: 'High intensity', range: '≥102% LTHR', color: '#f43f5e', background: 'bg-rose-500' },
] as const;

const formatDuration = (seconds: number): string => {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return `${Math.round(seconds)} sec`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return hours > 0 ? `${hours}h ${remainingMinutes}m` : `${minutes}m`;
};

function formatBpmRange(range: HrZoneRange): string {
  if (range.minBpm === null) return `Under ${range.maxBpm! + 1} bpm`;
  if (range.maxBpm === null) return `${range.minBpm}+ bpm`;
  return `${range.minBpm}–${range.maxBpm} bpm`;
}

export const HeartRateDistributionPage: React.FC<HeartRateDistributionPageProps> = ({ activities, profile, onOpenProfile }) => {
  const zoneRanges = getHrZoneRanges(profile.lthr);
  const [selectedYear, setSelectedYear] = useState('all');
  const years = Array.from(new Set(
    activities
      .map((activity) => new Date(activity.start_date).getFullYear())
      .filter(Number.isFinite)
      .map(String)
  )).sort((a, b) => Number(b) - Number(a));

  const periodActivities = selectedYear === 'all'
    ? activities
    : activities.filter((activity) => new Date(activity.start_date).getFullYear() === Number(selectedYear));
  const heartRateActivities = periodActivities.filter((activity) =>
    (activity.streams_data || []).some((point) => typeof point.hr === 'number' && point.hr > 0)
    || (activity.avg_hr || 0) > 0
    || (activity.time_in_hr_zones && Object.values(activity.time_in_hr_zones).some((seconds) => (seconds || 0) > 0))
  );
  const estimatedActivities = heartRateActivities.filter((activity) =>
    !(activity.streams_data || []).some((point) => typeof point.hr === 'number' && point.hr > 0)
    && (activity.avg_hr || 0) > 0
  ).length;

  const totals: ZoneDistribution = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
  for (const activity of heartRateActivities) {
    const distribution = calculateActivityHRZoneDuration(activity, profile.lthr);
    for (const zone of ZONE_META) totals[zone.key] += distribution[zone.key] || 0;
  }

  const totalSeconds = ZONE_META.reduce((sum, zone) => sum + totals[zone.key], 0);
  const maxZoneSeconds = Math.max(1, ...ZONE_META.map((zone) => totals[zone.key]));

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-white/10 pb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-white flex items-center gap-2">
            <HeartPulse className="w-6 h-6 text-rose-400" /> Heart Rate Distribution
          </h1>
          <p className="mt-1 text-sm text-slate-400">Time accumulated in heart-rate zones across recorded activities.</p>
        </div>
        <label className="flex items-center gap-3 text-sm text-slate-300">
          <span>Period</span>
          <select
            value={selectedYear}
            onChange={(event) => setSelectedYear(event.target.value)}
            className="min-h-11 w-full sm:w-auto rounded-lg border border-white/10 bg-slate-900 px-3 text-sm text-white focus:border-rose-400 focus:outline-none"
          >
            <option value="all">All time</option>
            {years.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
        </label>
      </header>

      <div className="flex flex-wrap gap-x-8 gap-y-3 border-b border-white/10 pb-5">
        <div>
          <p className="text-xs uppercase text-slate-500">Activities with HR</p>
          <p className="mt-1 text-xl font-bold text-white">{heartRateActivities.length}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-slate-500">Time classified</p>
          <p className="mt-1 text-xl font-bold text-white">{formatDuration(totalSeconds)}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-slate-500">Lactate threshold HR</p>
          <p className="mt-1 text-xl font-bold text-white">{profile.lthr} <span className="text-sm font-medium text-slate-400">bpm</span></p>
        </div>
      </div>

      {/* The athlete's own zone limits, from their lactate threshold HR */}
      <section className="space-y-3 border-b border-white/10 pb-6" aria-label="Your heart rate zones">
        <div>
          <h2 className="text-base font-bold text-white">Your heart rate zones</h2>
          <p className="text-xs text-slate-400">
            {zoneRanges
              ? `Based on your lactate threshold heart rate of ${profile.lthr} bpm (Friel model).`
              : 'Add your lactate threshold heart rate to see your zone ranges.'}
          </p>
        </div>
        {zoneRanges ? (
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
            {ZONE_META.map((zone) => {
              const range = zoneRanges.find((r) => r.key === zone.key)!;
              return (
                <div key={zone.key} className="rounded-lg border border-white/10 bg-slate-900/50 p-3">
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${zone.background}`} />
                    <p className="text-xs font-semibold text-white">{zone.label}</p>
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-400">{zone.name}</p>
                  <p className="mt-2 text-sm font-bold text-white">{formatBpmRange(range)}</p>
                  <p className="text-[11px] text-slate-500">{zone.range}</p>
                </div>
              );
            })}
          </div>
        ) : (
          onOpenProfile && (
            <button
              type="button"
              onClick={onOpenProfile}
              className="min-h-10 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 text-xs font-semibold text-rose-200 hover:bg-rose-500/20"
            >
              Set threshold heart rate in your profile
            </button>
          )
        )}
      </section>

      {totalSeconds > 0 ? (
        <>
          <section className="space-y-4">
            <div>
              <h2 className="text-base font-bold text-white">Overall distribution</h2>
              <p className="text-xs text-slate-400">Zones use the Friel LTHR model.</p>
            </div>

            <div className="flex h-5 w-full overflow-hidden rounded-full bg-slate-800" aria-label="Heart rate zone distribution">
              {ZONE_META.map((zone) => {
                const percentage = totalSeconds > 0 ? (totals[zone.key] / totalSeconds) * 100 : 0;
                return percentage > 0 ? (
                  <div
                    key={zone.key}
                    title={`${zone.label}: ${percentage.toFixed(1)}%`}
                    className={zone.background}
                    style={{ width: `${percentage}%` }}
                  />
                ) : null;
              })}
            </div>

            <div className="divide-y divide-white/5">
              {ZONE_META.map((zone) => {
                const seconds = totals[zone.key] || 0;
                const percentage = totalSeconds > 0 ? (seconds / totalSeconds) * 100 : 0;
                return (
                  <div key={zone.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(8rem,2fr)_auto_auto]">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className={`h-3 w-3 shrink-0 rounded-full ${zone.background}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white">{zone.label} <span className="font-normal text-slate-400">{zone.name}</span></p>
                        <p className="text-xs text-slate-500">
                          {zoneRanges ? `${formatBpmRange(zoneRanges.find((r) => r.key === zone.key)!)} · ` : ''}{zone.range}
                        </p>
                      </div>
                    </div>
                    <div className="hidden h-2 overflow-hidden rounded-full bg-slate-800 sm:block">
                      <div className={`h-full ${zone.background}`} style={{ width: `${(seconds / maxZoneSeconds) * 100}%` }} />
                    </div>
                    <p className="text-right text-sm font-semibold text-white">{formatDuration(seconds)}</p>
                    <p className="w-14 text-right text-xs text-slate-400">{percentage.toFixed(1)}%</p>
                  </div>
                );
              })}
            </div>
          </section>

          {estimatedActivities > 0 && (
            <p className="border-t border-white/10 pt-4 text-xs text-slate-500">
              {estimatedActivities} {estimatedActivities === 1 ? 'activity uses' : 'activities use'} average HR to estimate its zone time because no HR stream was available.
            </p>
          )}
        </>
      ) : (
        <div className="border-t border-white/10 py-12 text-center">
          <HeartPulse className="mx-auto h-8 w-8 text-slate-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-300">No heart-rate data for this period</h2>
          <p className="mt-1 text-xs text-slate-500">Import activities with heart-rate samples or summary HR to see a distribution.</p>
        </div>
      )}
    </div>
  );
};