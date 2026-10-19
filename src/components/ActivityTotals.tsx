import React, { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Clock3 } from 'lucide-react';
import type { Activity, SportType } from '../types';
import { getLocalDateString } from '../lib/trainingSessions';
import {
  cumulativeBySport, dayIndex, monthPeriod, yearPeriod,
  type Period, type ProgressMetric,
} from '../lib/progressSeries';

const SPORTS: { key: SportType; label: string; color: string }[] = [
  { key: 'cycling', label: 'Road Cycling', color: '#34D399' },
  { key: 'zwift', label: 'Zwift / Indoor', color: '#E2E8F0' },
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

interface PeriodChoice {
  period: Period;
  /** Short name used in the legend and tooltip: "2026" or "Oct" */
  label: string;
}

interface ProgressChartsProps {
  activities: Activity[];
  a: PeriodChoice;
  /** The period to compare against, drawn dashed. Undefined: just the first */
  b?: PeriodChoice;
  today: string;
  ticks: number[];
  tickLabel: (day: number) => string;
  dateLabel: (day: number, which: 'a' | 'b') => string;
  /** Sports switched off by the athlete: left out of the lines, the legend and the axis range */
  hidden: SportType[];
}

const secondsIn = (activities: Activity[], period: Period) =>
  activities
    .filter((x) => { const d = getLocalDateString(new Date(x.start_date)); return d >= period.start && d < period.end; })
    .reduce((sum, x) => sum + (x.moving_time_seconds || x.duration_seconds || 0), 0);

const ProgressCharts: React.FC<ProgressChartsProps> = ({ activities, a, b, today, ticks, tickLabel, dateLabel, hidden }) => {
  const charts = METRICS.map((metric) => {
    const first = cumulativeBySport(activities, a.period, metric.key, today);
    const second = b ? cumulativeBySport(activities, b.period, metric.key, today) : undefined;
    const days = Math.max(a.period.days, b?.period.days ?? 0);
    const present = SPORTS.filter((s) => (first.sports.includes(s.key) || second?.sports.includes(s.key)) && !hidden.includes(s.key));
    const rows = Array.from({ length: days }, (_, i) => {
      const row: Record<string, number | undefined> = { day: i + 1 };
      for (const s of present) {
        row[s.key] = first.rows[i]?.[s.key];
        if (second) row[`${s.key}_b`] = second.rows[i]?.[s.key];
      }
      return row;
    });
    return { metric, rows, present, totals: first.totals, totalsB: second?.totals };
  });
  const nothing = charts.every((c) => c.present.length === 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-300">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-5 border-t-2 border-slate-200" /> {a.label}</span>
        {b && <span className="inline-flex items-center gap-1.5"><span className="inline-block w-5 border-t-2 border-dashed border-slate-300" /> {b.label}</span>}
        <span className="inline-flex items-center gap-1.5 text-slate-400">
          <Clock3 className="w-3.5 h-3.5 text-cyan-400" /> {formatHours(secondsIn(activities, a.period))}{b ? ` vs ${formatHours(secondsIn(activities, b.period))}` : ''} all sports
        </span>
      </div>

      {nothing ? (
        <p className="py-6 text-center text-sm text-slate-400">
          {hidden.length > 0 ? 'Every activity type with data here is switched off. Turn one back on above.' : `No activities with distance or climbing in ${a.label}${b ? ` or ${b.label}` : ''}.`}
        </p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {charts.map(({ metric, rows, present, totals, totalsB }) => (
            <div key={metric.key} className="space-y-2">
              <h4 className="text-xs font-semibold text-slate-300">{metric.title} ({metric.unit})</h4>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="day" type="number" domain={[1, rows.length]} ticks={ticks.filter((t) => t <= rows.length)} tickFormatter={tickLabel} stroke="#64748B" tick={{ fontSize: 11 }} />
                    <YAxis stroke="#64748B" tick={{ fontSize: 11 }} tickFormatter={(v: number) => v.toLocaleString()} width={52} domain={[0, 'auto']} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      content={({ payload, label }) => {
                        if (!payload?.length) return null;
                        const day = Number(label);
                        const byKey = new Map(payload.map((p) => [String(p.dataKey), p.value as number | undefined]));
                        return (
                          <div style={tooltipStyle} className="border px-2.5 py-1.5 text-slate-200 space-y-0.5">
                            <p className="font-semibold">{dateLabel(day, 'a')}{b ? ` vs ${dateLabel(day, 'b')}` : ''}</p>
                            {present.map((s) => {
                              const c = byKey.get(s.key);
                              const p = byKey.get(`${s.key}_b`);
                              if (c === undefined && p === undefined) return null;
                              return (
                                <p key={s.key} className="flex items-center gap-1.5 tabular-nums">
                                  <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                                  {s.label}: {c !== undefined ? fmt(c) : '–'}{b ? ` (${p !== undefined ? fmt(p) : '–'})` : ''} {metric.unit}
                                </p>
                              );
                            })}
                          </div>
                        );
                      }}
                    />
                    {present.map((s) => (
                      <Line key={s.key} type="stepAfter" dataKey={s.key} name={`${s.label} (${a.label})`} stroke={s.color} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
                    ))}
                    {b && present.map((s) => (
                      <Line key={`${s.key}_b`} type="stepAfter" dataKey={`${s.key}_b`} name={`${s.label} (${b.label})`} stroke={s.color} strokeOpacity={0.7} strokeWidth={1.75} strokeDasharray="5 4" dot={false} connectNulls={false} isAnimationActive={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
                {present.map((s) => (
                  <span key={s.key} className="inline-flex items-center gap-1.5 tabular-nums">
                    <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                    {s.label}: <span className="font-semibold text-slate-200">{fmt(totals[s.key] ?? 0)} {metric.unit}</span>
                    {totalsB ? <span className="text-slate-500">({fmt(totalsB[s.key] ?? 0)} in {b!.label})</span> : null}
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
  /** Every activity: the progress charts cover the periods picked here, whatever the list's date filter says */
  activities: Activity[];
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const selectClass = 'min-h-9 rounded-lg bg-slate-900 border border-white/10 px-2.5 py-1.5 text-xs font-semibold text-slate-100 focus:border-cyan-400 focus:outline-none';

interface MonthChoice { year: number; month: number }

/** A month dropdown and a year dropdown. Months that have not started yet are not offered. */
const MonthPicker: React.FC<{
  label: string;
  value: MonthChoice | null;
  years: number[];
  thisYear: number;
  thisMonth: number;
  onChange: (next: MonthChoice | null) => void;
  /** Adds a "None" entry, for the side that is optional */
  allowNone?: boolean;
}> = ({ label, value, years, thisYear, thisMonth, onChange, allowNone }) => {
  const year = value?.year ?? thisYear;
  const monthsIn = (y: number) => Array.from({ length: y === thisYear ? thisMonth : 12 }, (_, i) => i + 1);
  return (
    <span className="inline-flex items-center gap-1.5">
      <select
        aria-label={label}
        value={value?.month ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : { year, month: Number(e.target.value) })}
        className={selectClass}
      >
        {allowNone && <option value="">None</option>}
        {monthsIn(year).map((m) => <option key={m} value={m}>{MONTH_LONG[m - 1]}</option>)}
      </select>
      {value && (
        <select
          aria-label={`${label} year`}
          value={value.year}
          onChange={(e) => {
            const y = Number(e.target.value);
            onChange({ year: y, month: Math.min(value.month, monthsIn(y).length) });
          }}
          className={selectClass}
        >
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      )}
    </span>
  );
};

/**
 * Cumulative distance and climbing per activity type, for two years or two months side by side. Yearly mode picks
 * two years; monthly mode picks two months, each with its own year.
 */
export const ActivityTotals: React.FC<ActivityTotalsProps> = ({ activities }) => {
  const today = getLocalDateString();
  const thisYear = Number(today.slice(0, 4));
  const thisMonth = Number(today.slice(5, 7));

  const [hidden, setHidden] = useState<SportType[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('summit_totals_hidden_sports') || '[]');
      return Array.isArray(saved) ? saved.filter((k): k is SportType => SPORTS.some((s) => s.key === k)) : [];
    } catch {
      return [];
    }
  });
  const setHiddenSaved = (next: SportType[]) => {
    setHidden(next);
    try {
      localStorage.setItem('summit_totals_hidden_sports', JSON.stringify(next));
    } catch {
      // Not remembered across visits
    }
  };
  const toggleSport = (key: SportType) => setHiddenSaved(hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key]);

  // Years to choose from: every year with an activity, plus this one
  const years = useMemo(() => {
    const set = new Set<number>([thisYear]);
    for (const x of activities) set.add(new Date(x.start_date).getFullYear());
    return [...set].filter((y) => y <= thisYear).sort((p, q) => q - p);
  }, [activities, thisYear]);

  const [mode, setMode] = useState<'year' | 'month'>('year');
  const [yearA, setYearA] = useState(thisYear);
  const [yearB, setYearB] = useState<number | null>(years.includes(thisYear - 1) ? thisYear - 1 : null);
  // Each side picks its own month and year, so any month can be compared with any other (January against last December, May 2025 against May 2026)
  const [monthA, setMonthA] = useState<MonthChoice>({ year: thisYear, month: thisMonth });
  const [monthB, setMonthB] = useState<MonthChoice | null>(
    thisMonth > 1 ? { year: thisYear, month: thisMonth - 1 } : years.includes(thisYear - 1) ? { year: thisYear - 1, month: 12 } : null,
  );

  const sportsWithData = SPORTS.filter((s) => activities.some((x) => x.sport_type === s.key));

  let choiceA: PeriodChoice;
  let choiceB: PeriodChoice | undefined;
  let ticks: number[];
  let tickLabel: (day: number) => string;
  let dateLabel: (day: number, which: 'a' | 'b') => string;
  if (mode === 'year') {
    choiceA = { period: yearPeriod(yearA), label: String(yearA) };
    choiceB = yearB !== null ? { period: yearPeriod(yearB), label: String(yearB) } : undefined;
    const monthStarts = Array.from({ length: 12 }, (_, i) => dayIndex(yearPeriod(2023), `2023-${String(i + 1).padStart(2, '0')}-01`));
    ticks = monthStarts;
    tickLabel = (day) => MONTH_SHORT[Math.max(0, monthStarts.filter((t) => t <= day).length - 1)] ?? '';
    dateLabel = (day, which) => new Date(which === 'a' ? yearA : yearB ?? yearA, 0, day).toLocaleDateString([], { month: 'short', day: 'numeric' });
  } else {
    choiceA = { period: monthPeriod(monthA.year, monthA.month), label: `${MONTH_SHORT[monthA.month - 1]} ${monthA.year}` };
    choiceB = monthB ? { period: monthPeriod(monthB.year, monthB.month), label: `${MONTH_SHORT[monthB.month - 1]} ${monthB.year}` } : undefined;
    ticks = [1, 5, 10, 15, 20, 25, 30];
    tickLabel = (day) => String(day);
    dateLabel = (day, which) => {
      const m = which === 'a' ? monthA : monthB ?? monthA;
      return new Date(m.year, m.month - 1, day).toLocaleDateString([], { month: 'short', day: 'numeric' });
    };
  }
  return (
    <section className="rounded-2xl border border-white/10 bg-slate-900/40 p-4 sm:p-5 space-y-4" aria-label="Progress comparison">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-white">Progress</h2>
          <p className="text-xs text-slate-400">Running total of distance and climbing for the periods you pick.</p>
        </div>
        <div className="inline-flex rounded-lg border border-white/10 p-0.5" role="group" aria-label="Comparison type">
          {(['year', 'month'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`min-h-8 px-3 rounded-md text-xs font-semibold transition-all ${mode === m ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              {m === 'year' ? 'Yearly' : 'Monthly'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {mode === 'year' ? (
          <>
            <select aria-label="Year" value={yearA} onChange={(e) => setYearA(Number(e.target.value))} className={selectClass}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <span className="text-xs text-slate-500">compared with</span>
            <select aria-label="Compare with year" value={yearB ?? ''} onChange={(e) => setYearB(e.target.value === '' ? null : Number(e.target.value))} className={selectClass}>
              <option value="">None</option>
              {years.filter((y) => y !== yearA).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </>
        ) : (
          <>
            <MonthPicker label="Month" value={monthA} years={years} thisYear={thisYear} thisMonth={thisMonth} onChange={(next) => next && setMonthA(next)} />
            <span className="text-xs text-slate-500">compared with</span>
            <MonthPicker label="Compare with month" value={monthB} years={years} thisYear={thisYear} thisMonth={thisMonth} onChange={setMonthB} allowNone />
          </>
        )}
      </div>

      {sportsWithData.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Activity types shown">
          <span className="text-xs text-slate-400">Show:</span>
          {sportsWithData.map((s) => {
            const on = !hidden.includes(s.key);
            return (
              <button
                key={s.key}
                type="button"
                aria-pressed={on}
                onClick={() => toggleSport(s.key)}
                className={`min-h-8 inline-flex items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-all ${on ? 'border-white/20 bg-white/5 text-slate-100' : 'border-white/10 text-slate-500 line-through'}`}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: on ? s.color : 'transparent', border: `1.5px solid ${s.color}` }} />
                {s.label}
              </button>
            );
          })}
          {hidden.length > 0 && (
            <button type="button" onClick={() => setHiddenSaved([])} className="text-xs font-semibold text-cyan-300 hover:underline">Show all</button>
          )}
        </div>
      )}

      <ProgressCharts
        activities={activities}
        a={choiceA}
        b={choiceB}
        today={today}
        ticks={ticks}
        tickLabel={tickLabel}
        dateLabel={dateLabel}
        hidden={hidden}
      />
    </section>
  );
};
