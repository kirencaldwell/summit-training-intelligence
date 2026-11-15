import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Activity, TrainingSession } from '../types';
import { getLocalDateString } from '../lib/trainingSessions';
import { SPORT_COLORS, SPORT_LABELS, activitiesByDay, monthGrid, plannedByDay } from '../lib/profileStats';
import { formatMilesFromMeters } from '../lib/units';

interface ActivityCalendarProps {
  activities: Activity[];
  sessions: TrainingSession[];
  onOpenActivity: (activity: Activity) => void;
}

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const minutesText = (s: number) => {
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};

/** A month at a glance: a dot per sport on every day something was done, a ring on days with a planned session left. */
export const ActivityCalendar: React.FC<ActivityCalendarProps> = ({ activities, sessions, onOpenActivity }) => {
  const today = getLocalDateString();
  const [cursor, setCursor] = useState(() => ({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 }));
  const [selected, setSelected] = useState<string>(today);

  const byDay = useMemo(() => activitiesByDay(activities), [activities]);
  const planned = useMemo(() => plannedByDay(sessions), [sessions]);
  const grid = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);
  const monthKey = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}`;
  const activeDays = [...byDay.keys()].filter((d) => d.startsWith(monthKey)).length;
  const monthTitle = new Date(cursor.year, cursor.month, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });
  const step = (delta: number) => setCursor((c) => {
    const d = new Date(c.year, c.month + delta, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const isCurrentMonth = monthKey === today.slice(0, 7);

  const dayActivities = byDay.get(selected) ?? [];
  const daySessions = (planned.get(selected) ?? []).filter((s) => s.status === 'ACCEPTED');

  return (
    <section className="glass-panel rounded-2xl border border-white/10 p-4 sm:p-5 space-y-3" aria-label="Activity calendar">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-white">{monthTitle}</h2>
          <p className="text-[11px] text-slate-400">{activeDays} active {activeDays === 1 ? 'day' : 'days'}</p>
        </div>
        <div className="flex items-center gap-1">
          {!isCurrentMonth && (
            <button type="button" onClick={() => { setCursor({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 }); setSelected(today); }} className="min-h-9 px-2.5 rounded-lg text-xs font-semibold text-cyan-300 hover:bg-white/5">
              Today
            </button>
          )}
          <button type="button" onClick={() => step(-1)} aria-label="Previous month" className="min-h-9 min-w-9 inline-flex items-center justify-center rounded-lg border border-white/10 text-slate-300 hover:bg-white/5">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => step(1)} aria-label="Next month" className="min-h-9 min-w-9 inline-flex items-center justify-center rounded-lg border border-white/10 text-slate-300 hover:bg-white/5">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((d, i) => <span key={i} className="text-[10px] font-semibold text-slate-500">{d}</span>)}
        {grid.flat().map(({ date, inMonth }) => {
          const done = byDay.get(date) ?? [];
          const open = (planned.get(date) ?? []).some((s) => s.status === 'ACCEPTED');
          const sports = [...new Set(done.map((a) => a.sport_type))];
          const isToday = date === today;
          const isSelected = date === selected;
          return (
            <button
              key={date}
              type="button"
              onClick={() => setSelected(date)}
              aria-label={`${new Date(`${date}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}${done.length ? `, ${done.length} ${done.length === 1 ? 'activity' : 'activities'}` : ''}${open ? ', session planned' : ''}`}
              aria-pressed={isSelected}
              className={`min-h-12 rounded-lg border px-0.5 py-1 flex flex-col items-center justify-between transition-colors ${
                isSelected ? 'border-cyan-400/70 bg-cyan-500/10' : isToday ? 'border-white/40' : 'border-transparent hover:bg-white/5'
              } ${inMonth ? '' : 'opacity-35'}`}
            >
              <span className={`text-xs tabular-nums ${isToday ? 'font-extrabold text-white' : 'text-slate-300'}`}>{Number(date.slice(8, 10))}</span>
              <span className="flex h-2.5 items-center justify-center gap-0.5">
                {sports.slice(0, 3).map((s) => <span key={s} className="h-2 w-2 rounded-full" style={{ background: SPORT_COLORS[s] }} />)}
                {done.length === 0 && open && <span className="h-2 w-2 rounded-full border border-cyan-300" />}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
        {[...new Set(activities.map((a) => a.sport_type))].map((s) => (
          <span key={s} className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: SPORT_COLORS[s] }} />{SPORT_LABELS[s]}</span>
        ))}
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full border border-cyan-300" />planned</span>
      </div>

      <div className="border-t border-white/10 pt-3 space-y-1.5" aria-live="polite">
        <p className="text-xs font-semibold text-slate-300">
          {new Date(`${selected}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
        </p>
        {dayActivities.length === 0 && daySessions.length === 0 && <p className="text-xs text-slate-500">Nothing recorded or planned.</p>}
        {dayActivities.map((a) => (
          <button key={a.id} type="button" onClick={() => onOpenActivity(a)} className="w-full min-h-11 flex items-center gap-2.5 rounded-lg border border-white/10 bg-slate-900/50 px-3 text-left hover:bg-white/5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SPORT_COLORS[a.sport_type] }} />
            <span className="min-w-0 flex-1 truncate text-sm text-white">{a.title}</span>
            <span className="shrink-0 text-[11px] text-slate-400 tabular-nums">
              {minutesText(a.moving_time_seconds || a.duration_seconds)}{a.distance_meters > 0 ? ` · ${formatMilesFromMeters(a.distance_meters)}` : ''}
            </span>
          </button>
        ))}
        {daySessions.map((s) => (
          <div key={s.id} className="min-h-11 flex items-center gap-2.5 rounded-lg border border-dashed border-cyan-500/30 px-3">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-cyan-300" />
            <span className="min-w-0 flex-1 truncate text-sm text-slate-200">{s.title}</span>
            <span className="shrink-0 text-[11px] text-cyan-300">planned · {s.duration_minutes} min</span>
          </div>
        ))}
      </div>
    </section>
  );
};
