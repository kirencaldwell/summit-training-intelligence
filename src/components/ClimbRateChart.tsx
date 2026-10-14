import React, { useMemo, useState } from 'react';
import { ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';
import type { MetricStreamPoint } from '../types';
import { climbRateSeries, type MunterParams } from '../lib/munter';
import { mToFt } from '../lib/units';

interface ClimbRateChartProps {
  points: MetricStreamPoint[] | undefined;
  /** The activity's overall figures, drawn as reference lines */
  munter?: MunterParams;
}

const WINDOWS = [
  { label: '2 min', seconds: 120 },
  { label: '5 min', seconds: 300 },
  { label: '10 min', seconds: 600 },
];

const clock = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}` : `${m}m`;
};

/** Vertical speed through a hiking or ski activity, with the elevation profile behind it. */
export const ClimbRateChart: React.FC<ClimbRateChartProps> = ({ points, munter }) => {
  const [windowSeconds, setWindowSeconds] = useState(300);
  const data = useMemo(
    () => climbRateSeries(points, windowSeconds, Math.max(15, Math.round(windowSeconds / 10))).map((p) => ({
      time: p.time,
      rate: p.rate_mh !== undefined ? Math.round(mToFt(p.rate_mh)) : undefined,
      elevation: p.elevation_m !== undefined ? Math.round(mToFt(p.elevation_m)) : undefined,
    })),
    [points, windowSeconds],
  );
  const elevations = data.map((d) => d.elevation).filter((v): v is number => v !== undefined);
  if (data.length < 5 || !data.some((d) => d.rate !== undefined)) return null;
  const elevLow = elevations.reduce((m, v) => (v < m ? v : m), Infinity);
  const elevHigh = elevations.reduce((m, v) => (v > m ? v : m), -Infinity);
  const hasElevation = elevations.length > 5 && elevHigh - elevLow >= 30;
  const avgUp = munter?.ascent_mh !== undefined ? Math.round(mToFt(munter.ascent_mh)) : undefined;
  const avgDown = munter?.descent_mh !== undefined ? -Math.round(mToFt(munter.descent_mh)) : undefined;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h3 className="text-sm font-semibold text-slate-300">Climb Rate</h3>
        <label className="flex items-center gap-2 text-[11px] text-slate-400">
          Average over
          <select
            value={windowSeconds}
            onChange={(e) => setWindowSeconds(Number(e.target.value))}
            aria-label="Climb rate window"
            className="rounded-lg bg-slate-900 border border-white/10 px-2 py-1 text-xs text-slate-300"
          >
            {WINDOWS.map((w) => <option key={w.seconds} value={w.seconds}>{w.label}</option>)}
          </select>
        </label>
      </div>
      <p className="text-[10px] text-slate-500 mb-2">
        Height gained (above zero) or lost (below) per hour of moving time, so breaks don't pull it down. Gaps in the line are stops.
        {avgUp !== undefined ? ` Dashed lines mark your average climbing (${avgUp.toLocaleString()} ft/h)${avgDown !== undefined ? ' and descending' : ''} pace.` : ''}
      </p>
      <div className="w-full h-56 rounded-xl bg-slate-900/60 p-3 border border-white/10">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="time" type="number" domain={['dataMin', 'dataMax']} stroke="#64748B" tick={{ fontSize: 10 }} tickFormatter={clock} />
            <YAxis yAxisId="rate" stroke="#34D399" tick={{ fontSize: 10 }} width={52} tickFormatter={(v) => Number(v).toLocaleString()} />
            {hasElevation && <YAxis yAxisId="elev" hide width={0} orientation="right" domain={[elevLow, elevLow + (elevHigh - elevLow) * 2.2]} />}
            <Tooltip
              contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', borderColor: 'rgba(255, 255, 255, 0.15)', borderRadius: '0.5rem', fontSize: '11px' }}
              labelFormatter={(sec) => clock(Number(sec))}
              formatter={(value, name) => [`${Number(value).toLocaleString()} ft${name === 'Climb rate' ? '/h' : ''}`, name]}
            />
            {hasElevation && <Area yAxisId="elev" type="monotone" dataKey="elevation" name="Elevation" stroke="#94A3B8" strokeWidth={1} fill="#94A3B8" fillOpacity={0.15} dot={false} activeDot={false} isAnimationActive={false} connectNulls />}
            <ReferenceLine yAxisId="rate" y={0} stroke="rgba(255,255,255,0.35)" />
            {avgUp !== undefined && <ReferenceLine yAxisId="rate" y={avgUp} stroke="#34D399" strokeDasharray="5 4" strokeOpacity={0.6} />}
            {avgDown !== undefined && <ReferenceLine yAxisId="rate" y={avgDown} stroke="#F43F5E" strokeDasharray="5 4" strokeOpacity={0.6} />}
            <Line yAxisId="rate" type="monotone" dataKey="rate" name="Climb rate" stroke="#34D399" strokeWidth={1.8} dot={false} connectNulls={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
