import React, { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Clock3 } from 'lucide-react';
import type { Activity, SportType } from '../types';
import { getLocalDateString } from '../lib/trainingSessions';
import {
  cumulativeBySport, dayIndex, monthPeriod, previousMonth, yearPeriod,
  type Period, type ProgressMetric,
} from '../lib/progressSeries';

const SPORTS: { key: SportType; label: string; color: string }[] = [
  { key: 'cycling', label: 'Road Cycling', color: '#34D399' },
  { key: 'zwift', label: 'Zwift / Indoor', color: '#2DD4BF' },
  { key: 'skimo', label: 'Skimo', color: '#38BDF8' },
  { key: 'backcountry_skiing', label: 'Backcountry Ski', color: '#60A5FA' },
  { key: 'resort_skiing', label: 'Resort Ski', color: '#F472B6' },
  { key: 'scrambling', label: 'Scrambling', color: '#A78BFA' },
  { key: 'weighted_hiking', label: 'Weighted Hike', color: '#FBBF24' },
];

const METRICS: { key: ProgressMetric; title: string; unit: string }[] = [
  { key: 'miles', title: 'Distance', unit: 'mi' },
  { key: 'vertFeet', title: 'Vert', unit: 'ft' },
];

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

const fmt = (n: number) => Math.round(n).toLocaleString();

interface ProgressSectionProps {
  title: string;
  activities: Activity[];
  /** The period being tracked, and the one it can be compared against */
  current: Period;
  previous: Period;
  currentLabel: string;
  previousLabel: string;
  today: string;
  /** Tick positions (day numbers) and how to label a day number of the current period */
  ticks: number[];
  tickLabel: (day: number) => string;
  dateLabel: (day: number, which: 'current' | 'previous') => string;
}

const ProgressSection: React.FC<ProgressSectionProps> = ({
  title, activities, current, previous, currentLabel, previousLabel, today, ticks, tickLabel, dateLabel,
}) => {
  const [compare, setCompare] = useState(false);
  const seconds = useMemo(
    () => activities
      .filter((a) => { const d = getLocalDateString(new Date(a.start_date)); return d >= current.start && d < current.end; })
      .reduce((sum, a) => sum + (a.moving_time_seconds || a.duration_seconds || 0), 0),
    [activities, current],
  );

  const charts = METRICS.map((metric) => {
    const cur = cumulativeBySport(activities, current, metric.key, today);
    const prev = compare ? cumulativeBySport(activities, previous, metric.key) : undefined;
    const days = compare ? Math.max(current.days, previous.days) : current.days;
    const present = SPORTS.filter((s) => cur.sports.includes(s.key) || prev?.sports.includes(s.key));
    const rows = Array.from({ length: days }, (_, i) => {
      const row: Record<string, number | undefined> = { day: i + 1 };
      for (const s of present) {
        row[s.key] = cur.rows[i]?.[s.key];
        if (prev) row[`${s.key}_prev`] = prev.rows[i]?.[s.key];
      }
      return row;
    });
    return { metric, rows, present, totals: cur.totals, prevTotals: prev?.totals };
  });

  const nothing = charts.every((c) => c.present.length === 0);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-white">{title}</h3>
          <p className="text-xs text-slate-400">
            {currentLabel}
            {compare ? <> · dashed lines: {previousLabel}</> : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs text-slate-300">
            <Clock3 className="w-3.5 h-3.5 text-cyan-400" /> {formatHours(seconds)}
            <span className="text-slate-500">all sports</span>
          </span>
          <button
            type="button"
            aria-pressed={compare}
            onClick={() => setCompare((v) => !v)}
            className={`min-h-9 px-3 rounded-lg border text-xs font-semibold transition-all ${compare ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200' : 'border-white/10 text-slate-300 hover:bg-white/5'}`}
          >
            Compare with {previousLabel}
          </button>
        </div>
      </div>

      {nothing ? (
        <p className="py-6 text-center text-sm text-slate-400">No activities with distance or climbing in {currentLabel}{compare ? ` or ${previousLabel}` : ''}.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {charts.map(({ metric, rows, present, totals, prevTotals }) => (
            <div key={metric.key} className="space-y-2">
              <h4 className="text-xs font-semibold text-slate-300">{metric.title} ({metric.unit})</h4>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="day" type="number" domain={[1, rows.length]} ticks={ticks.filter((t) => t <= rows.length)} tickFormatter={tickLabel} stroke="#64748B" tick={{ fontSize: 11 }} />
                    <YAxis stroke="#64748B" tick={{ fontSize: 11 }} tickFormatter={(v: number) => v.toLocaleString()} width={52} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      content={({ payload, label }) => {
                        if (!payload?.length) return null;
                        const day = Number(label);
                        const byKey = new Map(payload.map((p) => [String(p.dataKey), p.value as number | undefined]));
                        return (
                          <div style={tooltipStyle} className="border px-2.5 py-1.5 text-slate-200 space-y-0.5">
                            <p className="font-semibold">{dateLabel(day, 'current')}{compare ? ` vs ${dateLabel(day, 'previous')}` : ''}</p>
                            {present.map((s) => {
                              const c = byKey.get(s.key);
                              const p = byKey.get(`${s.key}_prev`);
                              if (c === undefined && p === undefined) return null;
                              return (
                                <p key={s.key} className="flex items-center gap-1.5 tabular-nums">
                                  <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                                  {s.label}: {c !== undefined ? fmt(c) : '–'}{compare ? ` (${p !== undefined ? fmt(p) : '–'})` : ''} {metric.unit}
                                </p>
                              );
                            })}
                          </div>
                        );
                      }}
                    />
                    {present.map((s) => (
                      <Line key={s.key} type="stepAfter" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
                    ))}
                    {compare && present.map((s) => (
                      <Line key={`${s.key}_prev`} type="stepAfter" dataKey={`${s.key}_prev`} name={`${s.label} (${previousLabel})`} stroke={s.color} strokeOpacity={0.7} strokeWidth={1.75} strokeDasharray="5 4" dot={false} connectNulls={false} isAnimationActive={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
                {present.map((s) => (
                  <span key={s.key} className="inline-flex items-center gap-1.5 tabular-nums">
                    <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                    {s.label}: <span className="font-semibold text-slate-200">{fmt(totals[s.key] ?? 0)} {metric.unit}</span>
                    {prevTotals ? <span className="text-slate-500">({fmt(prevTotals[s.key] ?? 0)} in {previousLabel})</span> : null}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

interface ActivityTotalsProps {
  /** Every activity: the progress charts always cover the current year and month, whatever the list's date filter says */
  activities: Activity[];
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Cumulative distance and climbing per activity type: this year (optionally against last year), and this month (against last month). */
export const ActivityTotals: React.FC<ActivityTotalsProps> = ({ activities }) => {
  const today = getLocalDateString();
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const prev = previousMonth(year, month);

  const thisYear = yearPeriod(year);
  const lastYear = yearPeriod(year - 1);
  const thisMonth = monthPeriod(year, month);
  const lastMonth = monthPeriod(prev.year, prev.month);

  const monthLong = (y: number, m: number) => new Date(y, m - 1, 1).toLocaleDateString([], { month: 'long' });
  const monthTicks = Array.from({ length: 12 }, (_, i) => dayIndex(thisYear, `${year}-${String(i + 1).padStart(2, '0')}-01`));
  const dayDate = (y: number, m: number, day: number) => new Date(y, m - 1, day);

  return (
    <section className="rounded-2xl border border-white/10 bg-slate-900/40 p-4 sm:p-5 space-y-8" aria-label="Progress this year and this month">
      <ProgressSection
        title="This year"
        activities={activities}
        current={thisYear}
        previous={lastYear}
        currentLabel={String(year)}
        previousLabel={String(year - 1)}
        today={today}
        ticks={monthTicks}
        tickLabel={(day) => MONTH_SHORT[Math.max(0, monthTicks.filter((t) => t <= day).length - 1)] ?? ''}
        dateLabel={(day, which) => dayDate(which === 'current' ? year : year - 1, 1, day).toLocaleDateString([], { month: 'short', day: 'numeric' })}
      />
      <ProgressSection
        title="This month"
        activities={activities}
        current={thisMonth}
        previous={lastMonth}
        currentLabel={`${monthLong(year, month)} ${year}`}
        previousLabel={monthLong(prev.year, prev.month)}
        today={today}
        ticks={[1, 5, 10, 15, 20, 25, 30]}
        tickLabel={(day) => String(day)}
        dateLabel={(day, which) => dayDate(which === 'current' ? year : prev.year, which === 'current' ? month : prev.month, day).toLocaleDateString([], { month: 'short', day: 'numeric' })}
      />
    </section>
  );
};
