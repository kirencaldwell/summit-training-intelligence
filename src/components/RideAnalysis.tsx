import React, { useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceArea,
  BarChart, Bar,
} from 'recharts';
import type { Activity, AthleteProfile } from '../types';
import { isEbike } from '../lib/tags';
import { smoothedSeries, summarizeStreams, type RunInfo } from '../lib/streamSummary';

interface RideAnalysisProps {
  activity: Activity;
  profile?: AthleteProfile | null;
}

type Overlay = 'blocks' | 'efforts' | 'surges' | 'hr';

const OVERLAYS: { key: Overlay; label: string; fill: string; chip: string }[] = [
  { key: 'blocks', label: 'Hard intervals', fill: '#F59E0B', chip: 'border-amber-500/40 text-amber-300' },
  { key: 'efforts', label: 'Sustained efforts', fill: '#F97316', chip: 'border-orange-500/40 text-orange-300' },
  { key: 'surges', label: 'Surges', fill: '#22D3EE', chip: 'border-cyan-500/40 text-cyan-300' },
  { key: 'hr', label: 'High heart rate', fill: '#F43F5E', chip: 'border-rose-500/40 text-rose-300' },
];

const SMOOTHING = [
  { label: '30 s average', value: 30 },
  { label: '10 s average', value: 10 },
  { label: 'Raw', value: 1 },
];

const tooltipStyle = {
  backgroundColor: 'rgba(15, 23, 42, 0.95)',
  borderColor: 'rgba(255, 255, 255, 0.15)',
  borderRadius: '0.5rem',
  fontSize: '11px',
};

const clock = (min: number) => {
  const total = Math.round(min * 60);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};
const lengthLabel = (min: number) => (min < 1 ? `${Math.round(min * 60)} s` : `${min} min`);

const runText = (r: RunInfo) =>
  [
    r.avg_watts !== undefined ? `${r.avg_watts} W${r.percent_ftp !== undefined ? ` (${r.percent_ftp}% FTP)` : ''}` : null,
    r.avg_hr !== undefined ? `${r.avg_hr} bpm` : null,
  ].filter(Boolean).join(' · ');

const ListSection: React.FC<{ title: string; criteria: string; rows: { at: number; length: string; text: string; tag?: string }[]; empty: string }> = ({ title, criteria, rows, empty }) => (
  <div className="rounded-lg bg-slate-900/50 border border-white/10 p-3">
    <p className="text-xs font-semibold text-slate-200">{title}</p>
    <p className="text-[10px] text-slate-500 mb-1.5">{criteria}</p>
    {rows.length === 0 ? (
      <p className="text-[11px] text-slate-500">{empty}</p>
    ) : (
      <ul className="space-y-1">
        {rows.map((r, i) => (
          <li key={i} className="text-[11px] text-slate-300 flex gap-2">
            <span className="text-slate-500 tabular-nums w-14 shrink-0">{clock(r.at)}</span>
            <span className="tabular-nums w-14 shrink-0">{r.length}</span>
            <span className="min-w-0 break-words">{r.text}{r.tag ? <span className="text-slate-500"> · {r.tag}</span> : null}</span>
          </li>
        ))}
      </ul>
    )}
  </div>
);

export const RideAnalysis: React.FC<RideAnalysisProps> = ({ activity, profile }) => {
  const streams = activity.streams_data;
  const [smoothing, setSmoothing] = useState(30);
  const [shown, setShown] = useState<Record<Overlay, boolean>>({ blocks: true, efforts: false, surges: true, hr: false });

  const summary = useMemo(
    () => summarizeStreams(streams, {
      ftp: profile?.ftp || undefined,
      lthr: profile?.lthr || undefined,
      maxHr: profile?.max_hr || undefined,
      ebike: isEbike(activity),
    }),
    [streams, profile?.ftp, profile?.lthr, profile?.max_hr, activity],
  );
  const step = Math.max(1, Math.round((streams?.length ?? 0) / 1200));
  const series = useMemo(() => smoothedSeries(streams, smoothing, step), [streams, smoothing, step]);

  if (!streams || streams.length === 0 || !summary) return null;
  const hasPower = series.some((p) => p.watts !== undefined && p.watts > 0);
  const hasHr = series.some((p) => p.hr !== undefined);
  const blocks = summary.block_structure?.blocks ?? [];
  const efforts = summary.sustained_power_efforts?.efforts ?? [];
  const surges = summary.power_surges?.surges ?? [];
  const hrPeriods = summary.high_heart_rate_periods?.periods ?? [];
  const dist = summary.power_distribution;

  const areas: { key: string; x1: number; x2: number; fill: string }[] = [];
  const add = (key: Overlay, x1: number, x2: number) => {
    if (shown[key]) areas.push({ key: `${key}-${x1}`, x1, x2, fill: OVERLAYS.find((o) => o.key === key)!.fill });
  };
  blocks.filter((b) => b.role === 'hard').forEach((b) => add('blocks', b.start_min * 60, (b.start_min + b.duration_min) * 60));
  efforts.forEach((e) => add('efforts', e.start_min * 60, (e.start_min + e.duration_min) * 60));
  surges.forEach((s) => add('surges', s.start_min * 60, s.start_min * 60 + Math.max(s.seconds, 10)));
  hrPeriods.forEach((p) => add('hr', p.start_min * 60, (p.start_min + p.duration_min) * 60));

  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h3 className="text-sm font-semibold text-slate-300">Power & Heart Rate</h3>
          <select
            value={smoothing}
            onChange={(e) => setSmoothing(Number(e.target.value))}
            aria-label="Smoothing"
            className="rounded-lg bg-slate-900 border border-white/10 px-2 py-1 text-xs text-slate-300"
          >
            {SMOOTHING.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        {hasPower && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {OVERLAYS.map((o) => (
              <button
                key={o.key}
                onClick={() => setShown((prev) => ({ ...prev, [o.key]: !prev[o.key] }))}
                aria-pressed={shown[o.key]}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-all ${shown[o.key] ? `${o.chip} bg-white/10` : 'border-white/10 text-slate-500'}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
        <div className="w-full h-56 rounded-xl bg-slate-900/60 p-3 border border-white/10">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis
                dataKey="time"
                type="number"
                domain={[0, 'dataMax']}
                stroke="#64748B"
                tick={{ fontSize: 10 }}
                tickFormatter={(sec) => `${Math.floor(sec / 60)}m`}
              />
              {hasPower && <YAxis yAxisId="watts" stroke="#F59E0B" tick={{ fontSize: 10 }} unit="W" />}
              {hasHr && <YAxis yAxisId="hr" orientation="right" stroke="#F43F5E" tick={{ fontSize: 10 }} unit="bpm" domain={['dataMin - 5', 'dataMax + 5']} />}
              <Tooltip contentStyle={tooltipStyle} labelFormatter={(sec) => clock(Number(sec) / 60)} />
              {areas.map((a) => (
                <ReferenceArea key={a.key} yAxisId={hasPower ? 'watts' : 'hr'} x1={a.x1} x2={a.x2} fill={a.fill} fillOpacity={0.2} stroke="none" />
              ))}
              {hasPower && <Line yAxisId="watts" type="monotone" dataKey="watts" stroke="#F59E0B" dot={false} strokeWidth={1.5} name="Watts" connectNulls={false} isAnimationActive={false} />}
              {hasHr && <Line yAxisId="hr" type="monotone" dataKey="hr" stroke="#F43F5E" dot={false} strokeWidth={1.5} name="Heart rate" connectNulls={false} isAnimationActive={false} />}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {dist && (
        <div>
          <h3 className="text-sm font-semibold text-slate-300 mb-1">Time at Power</h3>
          <p className="text-[10px] text-slate-500 mb-2">
            {dist.coasting_minutes > 0 ? `Not pedalling (under 5 W): ${lengthLabel(dist.coasting_minutes)}. ` : ''}
            Median {dist.percentiles_watts_while_pedalling.p50} W while pedalling; 90th percentile {dist.percentiles_watts_while_pedalling.p90} W.
          </p>
          <div className="w-full h-44 rounded-xl bg-slate-900/60 p-3 border border-white/10">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dist.bins}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="watts" stroke="#64748B" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                <YAxis stroke="#64748B" tick={{ fontSize: 10 }} unit="m" />
                <Tooltip
                  contentStyle={tooltipStyle}
                  cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                  formatter={(value) => [`${value} min`, 'Time']}
                  labelFormatter={(label, items) => {
                    const bin = items?.[0]?.payload as { percent_ftp?: string; percent_of_ride?: number } | undefined;
                    return `${label} W${bin?.percent_ftp ? ` (${bin.percent_ftp}% FTP)` : ''} · ${bin?.percent_of_ride ?? 0}% of ride`;
                  }}
                />
                <Bar dataKey="minutes" fill="#F59E0B" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {(hasPower || hrPeriods.length > 0) && (
        <div>
          <h3 className="text-sm font-semibold text-slate-300 mb-1">Detected Efforts</h3>
          <p className="text-[10px] text-slate-500 mb-2">Found automatically from the recorded data. The AI coach assessment is given the same findings.</p>
          <div className="grid gap-2 md:grid-cols-2">
            {hasPower && summary.block_structure && (
              <ListSection
                title={`Interval structure${summary.block_structure.trend ? ` — ${summary.block_structure.trend}` : ''}`}
                criteria="Steps of 18%+ in average power between blocks of 45 s or more, judged against this ride"
                empty="No repeated changes in effort."
                rows={blocks.map((b) => ({ at: b.start_min, length: lengthLabel(b.duration_min), text: runText(b), tag: b.role.replace('_', ' ') }))}
              />
            )}
            {hasPower && (
              <ListSection
                title="Sustained efforts"
                criteria={profile?.ftp ? '30 s average at 88%+ of FTP for 3 min or more' : '30 s average 25% above the ride average for 3 min or more'}
                empty="None found."
                rows={efforts.map((e) => ({ at: e.start_min, length: lengthLabel(e.duration_min), text: runText(e) }))}
              />
            )}
            {hasPower && (
              <ListSection
                title="Power surges"
                criteria={profile?.ftp ? '5 s average at 150%+ of FTP' : '5 s average at 2.5× the ride average'}
                empty="None found."
                rows={surges.map((s) => ({ at: s.start_min, length: `${s.seconds} s`, text: `peak ${s.peak_5s_watts} W (5 s)` }))}
              />
            )}
            {hrPeriods.length > 0 && (
              <ListSection
                title="High heart rate"
                criteria={profile?.lthr ? '60 s average at 97%+ of threshold HR for 3 min or more' : '60 s average within 10% of your highest HR for 3 min or more'}
                empty="None found."
                rows={hrPeriods.map((p) => ({ at: p.start_min, length: lengthLabel(p.duration_min), text: runText(p) }))}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
};
