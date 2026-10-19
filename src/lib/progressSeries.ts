import type { Activity, SportType } from '../types';
import { kmToMi, mToFt } from './units';
import { getLocalDateString } from './trainingSessions';

export type ProgressMetric = 'miles' | 'vertFeet';

export interface Period {
  /** First day of the period, YYYY-MM-DD */
  start: string;
  /** Day after the last day, YYYY-MM-DD */
  end: string;
  /** Number of days in the period */
  days: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const daysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate();
const daysInYear = (y: number) => (daysInMonth(y, 2) === 29 ? 366 : 365);

export const yearPeriod = (year: number): Period => ({ start: ymd(year, 1, 1), end: ymd(year + 1, 1, 1), days: daysInYear(year) });
export const monthPeriod = (year: number, month: number): Period => {
  const ny = month === 12 ? year + 1 : year;
  const nm = month === 12 ? 1 : month + 1;
  return { start: ymd(year, month, 1), end: ymd(ny, nm, 1), days: daysInMonth(year, month) };
};
/** The month before (year, month) */
export const previousMonth = (year: number, month: number) => (month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 });

/** 1-based day number inside a period for a YYYY-MM-DD date. */
export const dayIndex = (period: Period, date: string) =>
  Math.round((new Date(`${date}T12:00:00Z`).getTime() - new Date(`${period.start}T12:00:00Z`).getTime()) / 86400000) + 1;

/**
 * Running total per sport through a period: one row per day (1..days), each holding the cumulative miles or feet
 * of climbing so far. Days after `through` (a date inside the period, normally today) are undefined, so the line
 * for a period still in progress stops at today.
 */
export function cumulativeBySport(
  activities: Activity[],
  period: Period,
  metric: ProgressMetric,
  through?: string,
): { rows: (Record<string, number | undefined>)[]; totals: Partial<Record<SportType, number>>; sports: SportType[] } {
  const perDay = new Map<number, Partial<Record<SportType, number>>>();
  const sports = new Set<SportType>();
  for (const a of activities) {
    const date = getLocalDateString(new Date(a.start_date));
    if (date < period.start || date >= period.end) continue;
    const value = metric === 'miles' ? kmToMi(a.distance_meters / 1000) : mToFt(a.total_elevation_gain_m || 0);
    if (!(value > 0)) continue;
    const day = dayIndex(period, date);
    const bucket = perDay.get(day) ?? {};
    bucket[a.sport_type] = (bucket[a.sport_type] ?? 0) + value;
    perDay.set(day, bucket);
    sports.add(a.sport_type);
  }
  const lastDay = through && through >= period.start && through < period.end ? dayIndex(period, through) : through && through >= period.end ? period.days : through ? 0 : period.days;
  const running: Partial<Record<SportType, number>> = {};
  const rows: (Record<string, number | undefined>)[] = [];
  for (let day = 1; day <= period.days; day++) {
    const row: Record<string, number | undefined> = { day };
    const bucket = perDay.get(day);
    if (bucket) for (const s of Object.keys(bucket) as SportType[]) running[s] = (running[s] ?? 0) + bucket[s]!;
    for (const s of sports) row[s] = day <= lastDay ? Math.round((running[s] ?? 0) * 10) / 10 : undefined;
    rows.push(row);
  }
  return { rows, totals: running, sports: [...sports] };
}
