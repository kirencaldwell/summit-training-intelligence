import React, { useState } from 'react';
import { ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import type { PowerCurvePoint } from '../types';

interface PowerCurveChartProps {
  data: PowerCurvePoint[];
}

type SeriesKey = 'max' | 'mean' | 'median';

const SERIES: { key: SeriesKey; label: string; color: string; note: string }[] = [
  { key: 'max', label: 'Max', color: '#F59E0B', note: 'Best effort across all activities' },
  { key: 'mean', label: 'Mean', color: '#22D3EE', note: 'Average of each activity’s best effort' },
  { key: 'median', label: 'Median', color: '#A78BFA', note: 'Middle activity’s best effort (less swayed by outliers)' },
];

const TooltipBody: React.FC<{ active?: boolean; payload?: { payload: PowerCurvePoint }[]; visible: Record<SeriesKey, boolean> }> = ({
  active,
  payload,
  visible,
}) => {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  if (point.sampleCount === 0) {
    return (
      <div className="rounded-lg border border-white/15 bg-slate-900/95 px-3 py-2 text-xs text-slate-400 shadow-xl">
        <p className="font-semibold text-white">{point.label}</p>
        No activity long enough with power data
      </div>
    );
  }
  const rows: Record<SeriesKey, { watts: number; perKg: number }> = {
    max: { watts: point.watts, perKg: point.wattsPerKg },
    mean: { watts: point.meanWatts, perKg: point.meanWattsPerKg },
    median: { watts: point.medianWatts, perKg: point.medianWattsPerKg },
  };
  return (
    <div className="rounded-lg border border-white/15 bg-slate-900/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      <p className="mb-1 font-semibold text-white">{point.label}</p>
      {SERIES.filter((s) => visible[s.key]).map((s) => (
        <p key={s.key} className="flex items-center justify-between gap-4" style={{ color: s.color }}>
          <span>{s.label}</span>
          <span className="font-semibold">
            {rows[s.key].watts} W{rows[s.key].perKg > 0 ? ` (${rows[s.key].perKg} W/kg)` : ''}
          </span>
        </p>
      ))}
      <p className="mt-1 text-[11px] text-slate-400">
        {point.sampleCount} {point.sampleCount === 1 ? 'activity' : 'activities'}
      </p>
    </div>
  );
};

export const PowerCurveChart: React.FC<PowerCurveChartProps> = ({ data }) => {
  const [visible, setVisible] = useState<Record<SeriesKey, boolean>>({ max: true, mean: true, median: true });

  if (!data.some((point) => point.watts > 0)) {
    return (
      <div className="w-full h-72 flex items-center justify-center border border-dashed border-white/10 rounded-lg text-sm text-slate-400">
        No usable power data for this period
      </div>
    );
  }

  const toggle = (key: SeriesKey) => setVisible((prev) => ({ ...prev, [key]: !prev[key] }));

  // Durations with no activity long enough leave a gap instead of dropping the lines to 0 W
  const chartData = data.map((point) =>
    point.sampleCount > 0 ? point : { ...point, watts: null, meanWatts: null, medianWatts: null }
  ) as unknown as PowerCurvePoint[];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {SERIES.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => toggle(s.key)}
            aria-pressed={visible[s.key]}
            title={s.note}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-all ${
              visible[s.key] ? 'border-white/20 bg-white/5 text-white' : 'border-white/5 text-slate-500'
            }`}
          >
            <span
              className="inline-block h-2 w-4 rounded-sm"
              style={{ backgroundColor: visible[s.key] ? s.color : '#475569', opacity: s.key === 'median' ? 0.7 : 1 }}
            />
            {s.label}
          </button>
        ))}
      </div>

      <div className="w-full h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="powerGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#F59E0B" stopOpacity={0.0} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="label" stroke="#64748B" tick={{ fontSize: 12 }} />
            <YAxis stroke="#64748B" tick={{ fontSize: 12 }} unit="W" />
            <Tooltip content={<TooltipBody visible={visible} />} />
            {visible.max && (
              <Area type="monotone" dataKey="watts" name="Max" stroke="#F59E0B" strokeWidth={3} fillOpacity={1} fill="url(#powerGradient)" />
            )}
            {visible.mean && (
              <Line type="monotone" dataKey="meanWatts" name="Mean" stroke="#22D3EE" strokeWidth={2.5} dot={{ r: 2 }} />
            )}
            {visible.median && (
              <Line type="monotone" dataKey="medianWatts" name="Median" stroke="#A78BFA" strokeWidth={2} strokeDasharray="5 4" dot={false} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
