import React from 'react';
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Clock3 } from 'lucide-react';
import type { Activity, SportType } from '../types';
import { kmToMi, mToFt, roundTo } from '../lib/units';

const SPORTS: { key: SportType; label: string; color: string }[] = [
  { key: 'cycling', label: 'Road Cycling', color: '#34D399' },
  { key: 'zwift', label: 'Zwift / Indoor', color: '#2DD4BF' },
  { key: 'skimo', label: 'Skimo', color: '#38BDF8' },
  { key: 'backcountry_skiing', label: 'Backcountry Ski', color: '#60A5FA' },
  { key: 'scrambling', label: 'Scrambling', color: '#A78BFA' },
  { key: 'weighted_hiking', label: 'Weighted Hike', color: '#FBBF24' },
];

interface SportTotals {
  label: string;
  color: string;
  count: number;
  miles: number;
  vertFeet: number;
}

const formatHours = (seconds: number) => {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours.toLocaleString()}h ${minutes}m` : `${minutes}m`;
};

const tooltipStyle = {
  backgroundColor: 'rgba(15, 23, 42, 0.95)',
  borderColor: 'rgba(255, 255, 255, 0.15)',
  borderRadius: '0.5rem',
  fontSize: '12px',
};

interface ActivityTotalsProps {
  /** Activities already narrowed to the selected date range */
  activities: Activity[];
  /** Describes the date range, e.g. "All time" or "Oct 1, 2026 to Oct 31, 2026" */
  rangeLabel: string;
}

/** Total time across all sports, plus distance and climbing per activity type, for the selected dates. */
export const ActivityTotals: React.FC<ActivityTotalsProps> = ({ activities, rangeLabel }) => {
  const totalSeconds = activities.reduce((sum, a) => sum + (a.moving_time_seconds || a.duration_seconds || 0), 0);

  const bySport: SportTotals[] = SPORTS.map((sport) => {
    const matching = activities.filter((a) => a.sport_type === sport.key);
    return {
      label: sport.label,
      color: sport.color,
      count: matching.length,
      miles: roundTo(kmToMi(matching.reduce((sum, a) => sum + a.distance_meters, 0) / 1000), 1),
      vertFeet: Math.round(mToFt(matching.reduce((sum, a) => sum + (a.total_elevation_gain_m || 0), 0))),
    };
  }).filter((sport) => sport.count > 0);

  return (
    <section className="rounded-2xl border border-white/10 bg-slate-900/40 p-4 sm:p-5 space-y-4" aria-label="Totals for the selected dates">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-white">Totals</h2>
          <p className="text-xs text-slate-400">{rangeLabel}</p>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5">
          <Clock3 className="w-5 h-5 text-cyan-400" />
          <div>
            <p className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Activity time, all sports</p>
            <p className="text-xl font-extrabold text-white">
              {formatHours(totalSeconds)}
              <span className="ml-2 text-xs font-normal text-slate-400">
                {activities.length} {activities.length === 1 ? 'activity' : 'activities'}
              </span>
            </p>
          </div>
        </div>
      </div>

      {bySport.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">No activities in this date range.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {([
            { key: 'miles', title: 'Distance by activity type', unit: 'mi' },
            { key: 'vertFeet', title: 'Vert by activity type', unit: 'ft' },
          ] as const).map((chart) => (
            <div key={chart.key} className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-300">{chart.title}</h3>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={bySport} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis dataKey="label" stroke="#64748B" tick={{ fontSize: 11 }} interval={0} />
                    <YAxis stroke="#64748B" tick={{ fontSize: 11 }} tickFormatter={(v: number) => v.toLocaleString()} width={52} />
                    <Tooltip
                      cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                      contentStyle={tooltipStyle}
                      formatter={(value) => [`${Number(value ?? 0).toLocaleString()} ${chart.unit}`, chart.title.split(' by')[0]]}
                      labelFormatter={(label, items) => {
                        const entry = items?.[0]?.payload as SportTotals | undefined;
                        return entry ? `${label} (${entry.count} ${entry.count === 1 ? 'activity' : 'activities'})` : label;
                      }}
                    />
                    <Bar dataKey={chart.key} radius={[4, 4, 0, 0]}>
                      {bySport.map((sport) => <Cell key={sport.label} fill={sport.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
