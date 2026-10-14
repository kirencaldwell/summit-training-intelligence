import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Mountain } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine,
  ScatterChart, Scatter, ZAxis,
} from 'recharts';
import type { Activity, SportType } from '../types';
import { dataService } from '../lib/supabase';
import { MUNTER_SPORTS, MUNTER_VERSION, estimateMunter, spread, type MunterParams, type Spread } from '../lib/munter';
import { kmhToMph, mToFt } from '../lib/units';

interface TravelPaceViewProps {
  activities: Activity[];
  onOpenActivity: (activity: Activity) => void;
}

type ParamKey = 'ascent' | 'descent' | 'flat' | 'units' | 'best30' | 'stopped' | 'breaks';

interface ParamMeta {
  key: ParamKey;
  label: string;
  short: string;
  unit: string;
  /** Value in display units, or undefined when this activity has no estimate. withBreaks leaves stopped time in the pace */
  value: (p: MunterParams, withBreaks: boolean) => number | undefined;
  /** Whether the moving-only / with-breaks switch applies */
  breakSensitive?: boolean;
  decimals: number;
  /** What it measures, and the Munter rule-of-thumb to compare with */
  help: string;
}

const PARAMS: ParamMeta[] = [
  {
    key: 'ascent', label: 'Ascent rate', short: 'Up', unit: 'ft/h', decimals: 0,
    breakSensitive: true,
    value: (p, wb) => { const v = wb ? p.ascent_mh_with_breaks : p.ascent_mh; return v !== undefined ? mToFt(v) : undefined; },
    help: 'Height gained per moving hour on climbing ground (8%+ grade). Munter planning values are about 300 m/h (1,000 ft/h) on foot and 400 m/h (1,300 ft/h) on skis.',
  },
  {
    key: 'descent', label: 'Descent rate', short: 'Down', unit: 'ft/h', decimals: 0,
    breakSensitive: true,
    value: (p, wb) => { const v = wb ? p.descent_mh_with_breaks : p.descent_mh; return v !== undefined ? mToFt(v) : undefined; },
    help: 'Height lost per moving hour on descending ground (8%+ grade). Commonly cited planning values are about 500 m/h (1,600 ft/h) on foot and 1,000 m/h (3,300 ft/h) on skis.',
  },
  {
    key: 'flat', label: 'Flat speed', short: 'Flat', unit: 'mph', decimals: 1,
    breakSensitive: true,
    value: (p, wb) => { const v = wb ? p.flat_kmh_with_breaks : p.flat_kmh; return v !== undefined ? kmhToMph(v) : undefined; },
    help: 'Speed on level ground (under 5% grade). The usual planning value is about 4 km/h (2.5 mph).',
  },
  {
    key: 'units', label: 'Effort units per hour', short: 'Units/h', unit: '', decimals: 1,
    breakSensitive: true,
    value: (p, wb) => (wb ? p.effort_units_per_hour_with_breaks : p.effort_units_per_hour),
    help: 'Munter effort units per moving hour: kilometres plus height gained in hundreds of metres, over moving time. About 4 is a typical planning pace; higher is faster.',
  },
  {
    key: 'best30', label: 'Best 30 min climb', short: 'Best 30m', unit: 'ft/h', decimals: 0,
    value: (p) => (p.best_30min_climb_mh !== undefined ? mToFt(p.best_30min_climb_mh) : undefined),
    help: 'Your biggest height gain over any 30 minutes of the activity, as a rate. It shows your sustained climbing ceiling rather than your average.',
  },
  {
    key: 'stopped', label: 'Time stopped', short: 'Stopped', unit: '%', decimals: 0,
    value: (p) => p.stopped_percent,
    help: 'The share of each activity spent standing still: breaks, waiting, photo stops. A pace that leaves this out is how fast you move; one that keeps it in is how fast you get anywhere.',
  },
  {
    key: 'breaks', label: 'Break lengths', short: 'Breaks', unit: 'min', decimals: 0,
    value: () => undefined,
    help: 'Every break of a minute or more, pooled across your activities. A stop counts when you are below about 1 km/h (or the recording shows a paused timer with no movement).',
  },
];

const BREAK_BINS = [
  { label: '1–2', from: 1, to: 2 },
  { label: '2–5', from: 2, to: 5 },
  { label: '5–10', from: 5, to: 10 },
  { label: '10–20', from: 10, to: 20 },
  { label: '20–30', from: 20, to: 30 },
  { label: '30+', from: 30, to: Infinity },
];

const SPORT_META: Partial<Record<SportType, { label: string; color: string }>> = {
  weighted_hiking: { label: 'Hiking', color: '#34d399' },
  skimo: { label: 'Ski mountaineering', color: '#38bdf8' },
  backcountry_skiing: { label: 'Backcountry skiing', color: '#a78bfa' },
};

const fmt = (v: number, decimals: number) => v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/** Bins of a round width, about 8-14 of them, covering the data. */
function histogram(values: number[], lo: number, hi: number, binWidth: number) {
  const start = Math.floor(lo / binWidth) * binWidth;
  const count = Math.max(1, Math.ceil((hi - start) / binWidth) + (hi % binWidth === 0 ? 1 : 0));
  const bins = Array.from({ length: count }, (_, i) => ({ from: start + i * binWidth, to: start + (i + 1) * binWidth, count: 0 }));
  for (const v of values) bins[Math.min(count - 1, Math.max(0, Math.floor((v - start) / binWidth)))].count++;
  return bins;
}
function niceWidth(range: number) {
  const raw = range / 10;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const norm = raw / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
}

const tooltipStyle = { backgroundColor: 'rgba(15, 23, 42, 0.95)', borderColor: 'rgba(255, 255, 255, 0.15)', borderRadius: '0.5rem', fontSize: '11px' };

export const TravelPaceView: React.FC<TravelPaceViewProps> = ({ activities, onOpenActivity }) => {
  const [params, setParams] = useState<Record<string, MunterParams>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [selected, setSelected] = useState<ParamKey>('ascent');
  // A Munter pace includes breaks; moving-only shows how fast you go when you are actually going
  const [withBreaks, setWithBreaks] = useState(true);
  const cancelled = useRef(false);

  const eligible = useMemo(
    () => activities.filter((a) => MUNTER_SPORTS.includes(a.sport_type) && (a.moving_time_seconds || a.duration_seconds) >= 20 * 60),
    [activities],
  );

  useEffect(() => {
    let live = true;
    dataService.getMunterParams()
      .then((p) => { if (live) { setParams(p); setLoaded(true); } })
      .catch((err) => { if (live) { setError(err instanceof Error ? err.message : 'Could not load travel parameters.'); setLoaded(true); } });
    return () => { live = false; };
  }, []);

  // Estimate whatever has not been estimated yet (needs each activity's full track, so it runs in the background with progress)
  const missingKey = useMemo(
    () => eligible.filter((a) => !params[a.id] || params[a.id].v < MUNTER_VERSION).map((a) => a.id).join(','),
    [eligible, params],
  );
  const running = useRef(false);
  useEffect(() => {
    if (!loaded || running.current || !missingKey) return;
    const ids = missingKey.split(',');
    running.current = true;
    cancelled.current = false;
    setProgress({ done: 0, total: ids.length });
    (async () => {
      let synced = true;
      for (let i = 0; i < ids.length; i++) {
        if (cancelled.current) break;
        const id = ids[i];
        try {
          const full = await dataService.getActivityById(id);
          // No usable track still gets a marker, so it is not fetched again on every visit
          const estimate = estimateMunter(full?.streams_data) ?? { v: MUNTER_VERSION, up_minutes: 0, down_minutes: 0, flat_minutes: 0, moving_minutes: 0 };
          const result = await dataService.saveMunterParams(id, estimate);
          synced = synced && result.synced;
          if (!cancelled.current) setParams((prev) => ({ ...prev, [id]: estimate }));
        } catch (err) {
          console.warn('Travel parameter estimate failed:', err);
          if (!cancelled.current) setError(err instanceof Error ? err.message : 'An estimate failed.');
        }
        if (!cancelled.current) setProgress({ done: i + 1, total: ids.length });
      }
      if (!cancelled.current && !synced) setNotice('Estimates are saved on this device only until the database is updated (run the latest supabase/schema.sql).');
      running.current = false;
      if (!cancelled.current) setProgress(null);
    })();
  }, [loaded, missingKey]);
  useEffect(() => () => { cancelled.current = true; running.current = false; }, []);

  const meta = PARAMS.find((p) => p.key === selected)!;

  // Activities with an estimate for the selected parameter, grouped by sport
  const rows = useMemo(
    () => eligible
      .map((a) => ({ activity: a, p: params[a.id] }))
      .filter((r): r is { activity: Activity; p: MunterParams } => Boolean(r.p) && r.p.moving_minutes > 0),
    [eligible, params],
  );
  const bySport = useMemo(() => {
    const groups = MUNTER_SPORTS.map((sport) => {
      const items = rows
        .filter((r) => r.activity.sport_type === sport)
        .map((r) => ({ ...r, value: meta.value(r.p, withBreaks), other: meta.breakSensitive ? meta.value(r.p, !withBreaks) : undefined }))
        .filter((r): r is typeof r & { value: number } => r.value !== undefined);
      const otherStats = meta.breakSensitive ? spread(items.flatMap((i) => (i.other !== undefined ? [i.other] : []))) : undefined;
      return { sport, items, stats: spread(items.map((i) => i.value)) as Spread | undefined, otherStats };
    });
    return groups.filter((g) => g.items.length > 0);
  }, [rows, meta, withBreaks]);

  // Every break of a minute or more, pooled by sport
  const breakGroups = useMemo(() => MUNTER_SPORTS.map((sport) => {
    const mine = rows.filter((r) => r.activity.sport_type === sport);
    const breaks = mine.flatMap((r) => r.p.breaks_min ?? []);
    return { sport, breaks, activities: mine.length, stoppedStats: spread(mine.flatMap((r) => (r.p.stopped_percent !== undefined ? [r.p.stopped_percent] : []))) };
  }).filter((g) => g.breaks.length > 0), [rows]);

  const allValues = bySport.flatMap((g) => g.items.map((i) => i.value));
  const lo = allValues.length ? Math.min(...allValues) : 0;
  const hi = allValues.length ? Math.max(...allValues) : 0;
  const binWidth = niceWidth(Math.max(hi - lo, 1e-6));

  const times = rows.map((r) => new Date(r.activity.start_date).getTime());
  const spanDays = times.length ? (Math.max(...times) - Math.min(...times)) / 86400000 : 0;
  const analyzing = progress !== null;

  return (
    <div className="space-y-6">
      <header className="border-b border-white/10 pb-5">
        <h1 className="text-xl sm:text-2xl font-extrabold text-white flex items-center gap-2">
          <Mountain className="w-6 h-6 text-emerald-400" /> Travel Pace
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          How fast you climb, descend and cover flat ground on foot and on skis: your Munter travel parameters, estimated from each activity's recorded track. Each pace can be shown with breaks included (as a Munter plan counts it) or with moving time only.
        </p>
      </header>

      {analyzing && (
        <div className="rounded-xl border border-white/10 bg-slate-900/50 p-4" role="status">
          <p className="text-sm text-slate-200">Estimating travel parameters: {progress!.done} of {progress!.total} activities</p>
          <div className="mt-2 h-2 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${(progress!.done / Math.max(1, progress!.total)) * 100}%` }} />
          </div>
        </div>
      )}
      {error && <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">{notice}</p>}

      {eligible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-sm text-slate-400">
          No hiking, ski mountaineering or backcountry skiing activities of 20 minutes or more yet. Import some activities with altitude and GPS or speed data.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Travel parameter">
            {PARAMS.map((p) => (
              <button
                key={p.key}
                role="tab"
                aria-selected={selected === p.key}
                onClick={() => setSelected(p.key)}
                className={`min-h-9 px-3 rounded-lg text-xs font-semibold border transition-all ${selected === p.key ? 'bg-emerald-500/15 text-emerald-200 border-emerald-500/40' : 'text-slate-400 border-white/10 hover:text-white hover:bg-white/5'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {meta.breakSensitive && (
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-lg border border-white/10 p-0.5" role="group" aria-label="Breaks">
                {([[true, 'Including breaks'], [false, 'Moving time only']] as [boolean, string][]).map(([wb, label]) => (
                  <button
                    key={label}
                    aria-pressed={withBreaks === wb}
                    onClick={() => setWithBreaks(wb)}
                    className={`min-h-8 px-3 rounded-md text-xs font-semibold transition-all ${withBreaks === wb ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-500">
                {withBreaks
                  ? 'Stopped time stays in, as in a Munter plan: your real pace including breaks.'
                  : 'Stopped time is left out: how fast you go with no breaks at all.'}
              </p>
            </div>
          )}
          <p className="text-xs text-slate-400">{meta.help}</p>

          {selected === 'breaks' ? (
            breakGroups.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-sm text-slate-400">
                {analyzing ? 'Working through your activities…' : 'No breaks of a minute or more found in your activities yet.'}
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {breakGroups.map(({ sport, breaks, activities: n, stoppedStats }) => {
                  const sm = SPORT_META[sport]!;
                  const lengths = spread(breaks)!;
                  const bins = BREAK_BINS.map((b) => ({ label: b.label, count: breaks.filter((x) => x >= b.from && x < b.to).length }));
                  const long = breaks.filter((x) => x >= 10).length;
                  return (
                    <section key={sport} className="glass-panel rounded-2xl border border-white/10 p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h2 className="text-sm font-bold text-white flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ background: sm.color }} /> {sm.label}
                          </h2>
                          <p className="text-[11px] text-slate-500">{breaks.length} breaks in {n} {n === 1 ? 'activity' : 'activities'}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-extrabold text-white tabular-nums">{fmt(lengths.median, 0)}<span className="text-xs font-semibold text-slate-400"> min</span></p>
                          <p className="text-[11px] text-slate-400">median break · typical range {fmt(lengths.p25, 0)}–{fmt(lengths.p75, 0)}</p>
                        </div>
                      </div>
                      <div className="h-40">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={bins} barCategoryGap={2}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                            <XAxis dataKey="label" stroke="#64748B" tick={{ fontSize: 10 }} unit=" min" />
                            <YAxis stroke="#64748B" tick={{ fontSize: 10 }} allowDecimals={false} width={24} />
                            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.05)' }} formatter={(v) => [`${v} ${Number(v) === 1 ? 'break' : 'breaks'}`, '']} />
                            <Bar dataKey="count" fill={sm.color} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Longest {fmt(lengths.max, 0)} min · {long} of {breaks.length} ({Math.round((long / breaks.length) * 100)}%) last 10 minutes or more.
                        {stoppedStats ? ` A typical activity is ${fmt(stoppedStats.median, 0)}% stopped time.` : ''}
                      </p>
                    </section>
                  );
                })}
              </div>
            )
          ) : bySport.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-sm text-slate-400">
              {analyzing ? 'Working through your activities…' : `None of your activities has enough ${meta.label.toLowerCase()} to estimate yet (this needs steady climbing, descending or flat travel with altitude and distance data).`}
            </div>
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                {bySport.map(({ sport, items, stats, otherStats }) => {
                  const sm = SPORT_META[sport]!;
                  const bins = histogram(items.map((i) => i.value), lo, hi, binWidth);
                  const unit = meta.unit ? ` ${meta.unit}` : '';
                  return (
                    <section key={sport} className="glass-panel rounded-2xl border border-white/10 p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h2 className="text-sm font-bold text-white flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ background: sm.color }} /> {sm.label}
                          </h2>
                          <p className="text-[11px] text-slate-500">{stats!.n} {stats!.n === 1 ? 'activity' : 'activities'}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-extrabold text-white tabular-nums">{fmt(stats!.median, meta.decimals)}<span className="text-xs font-semibold text-slate-400">{unit}</span></p>
                          <p className="text-[11px] text-slate-400">median · typical range {fmt(stats!.p25, meta.decimals)}–{fmt(stats!.p75, meta.decimals)}</p>
                          {otherStats && (
                            <p className="text-[11px] text-slate-500">{withBreaks ? 'Moving only' : 'With breaks'}: {fmt(otherStats.median, meta.decimals)}{unit}</p>
                          )}
                        </div>
                      </div>
                      <div className="h-40">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={bins} barCategoryGap={2}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                            <XAxis
                              dataKey="from"
                              stroke="#64748B"
                              tick={{ fontSize: 10 }}
                              tickFormatter={(v) => fmt(v, meta.decimals)}
                              interval="preserveStartEnd"
                            />
                            <YAxis stroke="#64748B" tick={{ fontSize: 10 }} allowDecimals={false} width={24} />
                            <Tooltip
                              contentStyle={tooltipStyle}
                              cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                              labelFormatter={(from) => `${fmt(Number(from), meta.decimals)}–${fmt(Number(from) + binWidth, meta.decimals)}${unit}`}
                              formatter={(v) => [`${v} ${Number(v) === 1 ? 'activity' : 'activities'}`, '']}
                            />
                            <Bar dataKey="count" fill={sm.color} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                            <ReferenceLine x={Math.floor(stats!.median / binWidth) * binWidth} stroke="#fff" strokeDasharray="4 3" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Slowest {fmt(stats!.min, meta.decimals)} · fastest {fmt(stats!.max, meta.decimals)}{unit}. The dashed line marks the median.
                      </p>
                    </section>
                  );
                })}
              </div>

              <section className="glass-panel rounded-2xl border border-white/10 p-4 space-y-2">
                <h2 className="text-sm font-bold text-white">{meta.label} over time</h2>
                <p className="text-[11px] text-slate-500">Click a point to open that activity.</p>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis
                        dataKey="t"
                        type="number"
                        scale="time"
                        domain={['dataMin', 'dataMax']}
                        stroke="#64748B"
                        tick={{ fontSize: 10 }}
                        tickFormatter={(t) => new Date(t).toLocaleDateString([], spanDays > 180 ? { month: 'short', year: '2-digit' } : { month: 'short', day: 'numeric' })}
                      />
                      <YAxis dataKey="value" type="number" stroke="#64748B" tick={{ fontSize: 10 }} width={44} domain={['auto', 'auto']} tickFormatter={(v) => fmt(v, meta.decimals)} />
                      <ZAxis range={[50, 50]} />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        cursor={{ strokeDasharray: '3 3' }}
                        formatter={(v, name) => (name === 'value' ? [`${fmt(Number(v), meta.decimals)}${meta.unit ? ` ${meta.unit}` : ''}`, meta.label] : [v, name])}
                        labelFormatter={() => ''}
                        content={({ payload }) => {
                          const d = payload?.[0]?.payload as { title: string; t: number; value: number } | undefined;
                          if (!d) return null;
                          return (
                            <div style={tooltipStyle} className="border px-2.5 py-1.5 text-slate-200">
                              <p className="font-semibold">{d.title}</p>
                              <p>{new Date(d.t).toLocaleDateString()} · {fmt(d.value, meta.decimals)}{meta.unit ? ` ${meta.unit}` : ''}</p>
                            </div>
                          );
                        }}
                      />
                      {bySport.map(({ sport, items }) => (
                        <Scatter
                          key={sport}
                          name={SPORT_META[sport]!.label}
                          data={items.map((i) => ({ t: new Date(i.activity.start_date).getTime(), value: i.value, title: i.activity.title, activity: i.activity }))}
                          fill={SPORT_META[sport]!.color}
                          isAnimationActive={false}
                          shape={(props: unknown) => {
                            const { cx, cy, fill, payload } = props as { cx?: number; cy?: number; fill?: string; payload?: { activity: Activity; title: string } };
                            if (cx === undefined || cy === undefined || !payload) return <g />;
                            return (
                              <g style={{ cursor: 'pointer' }} onClick={() => onOpenActivity(payload.activity)}>
                                {/* A larger invisible target makes small dots easy to hit */}
                                <circle cx={cx} cy={cy} r={12} fill="transparent" />
                                <circle cx={cx} cy={cy} r={5} fill={fill} stroke="#0F172A" strokeWidth={1.5} />
                              </g>
                            );
                          }}
                        />
                      ))}
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-wrap gap-3 text-[11px] text-slate-400">
                  {bySport.map(({ sport }) => (
                    <span key={sport} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: SPORT_META[sport]!.color }} />{SPORT_META[sport]!.label}</span>
                  ))}
                </div>
              </section>
            </>
          )}

          <section className="glass-panel rounded-2xl border border-white/10 p-4">
            <h2 className="text-sm font-bold text-white mb-2">Activities</h2>
            {rows.length === 0 ? (
              <p className="text-xs text-slate-500">No estimates yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
                      <th className="py-1.5 pr-3 font-semibold">Date</th>
                      <th className="py-1.5 pr-3 font-semibold">Activity</th>
                      {PARAMS.filter((p) => p.key !== 'breaks' && p.key !== 'best30').map((p) => <th key={p.key} className="py-1.5 pr-3 font-semibold text-right whitespace-nowrap">{p.short}{p.unit ? ` (${p.unit})` : ''}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {[...rows]
                      .sort((a, b) => b.activity.start_date.localeCompare(a.activity.start_date))
                      .slice(0, 40)
                      .map(({ activity, p }) => (
                        <tr key={activity.id} onClick={() => onOpenActivity(activity)} className="border-t border-white/5 cursor-pointer hover:bg-white/5">
                          <td className="py-1.5 pr-3 text-slate-400 whitespace-nowrap">{new Date(activity.start_date).toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' })}</td>
                          <td className="py-1.5 pr-3 text-slate-200 max-w-[14rem] truncate">
                            <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: SPORT_META[activity.sport_type]?.color }} />
                            {activity.title}
                          </td>
                          {PARAMS.filter((m) => m.key !== 'breaks' && m.key !== 'best30').map((m) => {
                            const v = m.value(p, withBreaks);
                            return <td key={m.key} className="py-1.5 pr-3 text-right tabular-nums text-slate-300">{v !== undefined ? fmt(v, m.decimals) : '–'}</td>;
                          })}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-[10px] text-slate-500">
              A dash means that part of the terrain was too short in the activity to measure (under 10 minutes climbing, 5 minutes descending or 5 minutes flat).
            </p>
          </section>
        </>
      )}
    </div>
  );
};
