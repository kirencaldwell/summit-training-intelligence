import type { Activity, SportType, TrainingSession } from '../types';
import { addDaysToDateOnly, getLocalDateString, getWeekStartDate } from './trainingSessions';
import { isEbike } from './tags';

/** Everything on the Profile page that is worked out from the athlete's activities, with no AI. */
export const SPORT_COLORS: Record<SportType, string> = {
  cycling: '#34D399', zwift: '#E2E8F0', skimo: '#38BDF8', backcountry_skiing: '#60A5FA',
  resort_skiing: '#F472B6', scrambling: '#A78BFA', weighted_hiking: '#FBBF24', workout: '#FB923C',
};
export const SPORT_LABELS: Record<SportType, string> = {
  cycling: 'Road cycling', zwift: 'Zwift / indoor', skimo: 'Skimo', backcountry_skiing: 'Backcountry ski',
  resort_skiing: 'Resort ski', scrambling: 'Scrambling', weighted_hiking: 'Weighted hike', workout: 'Workout / gym',
};

/** The athlete's own calendar day an activity belongs to (a UTC date puts an evening activity on the next day). */
export const dayOf = (a: Pick<Activity, 'start_date'>) => getLocalDateString(new Date(a.start_date));
const seconds = (a: Activity) => a.moving_time_seconds || a.duration_seconds || 0;

export function activitiesByDay(activities: Activity[]): Map<string, Activity[]> {
  const out = new Map<string, Activity[]>();
  for (const a of activities) {
    const day = dayOf(a);
    const list = out.get(day);
    if (list) list.push(a); else out.set(day, [a]);
  }
  for (const list of out.values()) list.sort((x, y) => x.start_date.localeCompare(y.start_date));
  return out;
}

export interface YearSummary {
  year: number;
  activities: number;
  seconds: number;
  distanceM: number;
  vertM: number;
  activeDays: number;
  bySport: { sport: SportType; count: number; seconds: number }[];
}

export function yearSummary(activities: Activity[], year: number): YearSummary {
  const mine = activities.filter((a) => Number(dayOf(a).slice(0, 4)) === year);
  const bySport = new Map<SportType, { count: number; seconds: number }>();
  for (const a of mine) {
    const s = bySport.get(a.sport_type) ?? { count: 0, seconds: 0 };
    s.count += 1;
    s.seconds += seconds(a);
    bySport.set(a.sport_type, s);
  }
  return {
    year,
    activities: mine.length,
    seconds: mine.reduce((n, a) => n + seconds(a), 0),
    distanceM: mine.reduce((n, a) => n + (a.distance_meters || 0), 0),
    vertM: mine.reduce((n, a) => n + (a.total_elevation_gain_m || 0), 0),
    activeDays: new Set(mine.map(dayOf)).size,
    bySport: [...bySport.entries()].map(([sport, v]) => ({ sport, ...v })).sort((a, b) => b.seconds - a.seconds),
  };
}

/** The weeks (Monday first) that cover a month, each with seven dates and whether each falls in the month. */
export function monthGrid(year: number, month: number): { date: string; inMonth: boolean }[][] {
  const first = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const start = getWeekStartDate(first);
  const weeks: { date: string; inMonth: boolean }[][] = [];
  for (let w = 0; w < 6; w++) {
    const row = Array.from({ length: 7 }, (_, i) => {
      const date = addDaysToDateOnly(start, w * 7 + i);
      return { date, inMonth: Number(date.slice(5, 7)) === month + 1 };
    });
    if (w >= 4 && !row.some((d) => d.inMonth)) break;
    weeks.push(row);
  }
  return weeks;
}

/** Sessions still to do, by day, for the calendar's planned markers. */
export function plannedByDay(sessions: TrainingSession[]): Map<string, TrainingSession[]> {
  const out = new Map<string, TrainingSession[]>();
  for (const s of sessions) {
    if (s.status !== 'ACCEPTED' && s.status !== 'COMPLETED') continue;
    const list = out.get(s.session_date);
    if (list) list.push(s); else out.set(s.session_date, [s]);
  }
  return out;
}

export interface Streaks {
  /** Consecutive days with an activity, counting back from today (or from yesterday if today has none yet) */
  currentDays: number;
  longestDays: number;
  /** Consecutive weeks (Monday to Sunday) with at least `perWeek` active days, counting back from this week */
  currentWeeks: number;
}

export function streaks(days: Set<string>, today = getLocalDateString(), perWeek = 3): Streaks {
  let current = 0;
  let cursor = days.has(today) ? today : addDaysToDateOnly(today, -1);
  while (days.has(cursor)) { current += 1; cursor = addDaysToDateOnly(cursor, -1); }

  const sorted = [...days].sort();
  let longest = 0;
  let run = 0;
  let prev = '';
  for (const d of sorted) {
    run = prev && addDaysToDateOnly(prev, 1) === d ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = d;
  }

  const activeInWeek = (weekStart: string) => Array.from({ length: 7 }, (_, i) => addDaysToDateOnly(weekStart, i)).filter((d) => days.has(d)).length;
  let weeks = 0;
  let week = getWeekStartDate(today);
  // The week in progress counts if it already qualifies; otherwise the streak is judged on the weeks before it
  if (activeInWeek(week) < perWeek) week = addDaysToDateOnly(week, -7);
  while (activeInWeek(week) >= perWeek) { weeks += 1; week = addDaysToDateOnly(week, -7); }
  return { currentDays: current, longestDays: longest, currentWeeks: weeks };
}

/** Hours of moving time per week for the last `count` weeks, oldest first, ending with the week in progress. */
export function weeklyHours(activities: Activity[], today = getLocalDateString(), count = 12): { weekStart: string; hours: number; active: number }[] {
  const thisWeek = getWeekStartDate(today);
  const starts = Array.from({ length: count }, (_, i) => addDaysToDateOnly(thisWeek, -7 * (count - 1 - i)));
  const index = new Map(starts.map((s, i) => [s, i]));
  const out = starts.map((weekStart) => ({ weekStart, hours: 0, days: new Set<string>() }));
  for (const a of activities) {
    const day = dayOf(a);
    const slot = index.get(getWeekStartDate(day));
    if (slot === undefined) continue;
    out[slot].hours += seconds(a) / 3600;
    out[slot].days.add(day);
  }
  return out.map((w) => ({ weekStart: w.weekStart, hours: Math.round(w.hours * 10) / 10, active: w.days.size }));
}

export interface PersonalBest {
  label: string;
  value: string;
  activity: Activity;
}

const POWER_LABELS: [string, string][] = [['5s', '5 s power'], ['1m', '1 min power'], ['5m', '5 min power'], ['20m', '20 min power'], ['1h', '60 min power']];

/** Bests across the athlete's own rides and outings (e-bike rides never count). */
export function personalBests(activities: Activity[], formatters: { distance: (m: number) => string; vert: (m: number) => string; duration: (s: number) => string }): PersonalBest[] {
  const own = activities.filter((a) => !isEbike(a));
  const out: PersonalBest[] = [];
  for (const [key, label] of POWER_LABELS) {
    let best: { watts: number; activity: Activity } | undefined;
    for (const a of own) {
      const w = a.power_curve_best_efforts?.[key];
      if (typeof w === 'number' && w > 0 && (!best || w > best.watts)) best = { watts: w, activity: a };
    }
    if (best) out.push({ label, value: `${Math.round(best.watts)} W`, activity: best.activity });
  }
  const pick = (label: string, score: (a: Activity) => number, show: (a: Activity) => string, pool = own) => {
    let best: Activity | undefined;
    for (const a of pool) if (score(a) > 0 && (!best || score(a) > score(best))) best = a;
    if (best) out.push({ label, value: show(best), activity: best });
  };
  // Moving time, so a backpacking trip's nights in camp and long breaks do not count
  pick('Longest moving time', (a) => seconds(a), (a) => formatters.duration(seconds(a)));
  pick('Longest distance', (a) => a.distance_meters || 0, (a) => formatters.distance(a.distance_meters));
  pick('Most vert in a day', (a) => a.total_elevation_gain_m || 0, (a) => formatters.vert(a.total_elevation_gain_m));
  return out;
}
