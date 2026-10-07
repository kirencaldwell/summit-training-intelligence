import type { PMCDayPoint } from '../types';

export type PmcPreset = '30' | '90' | '180' | '365' | '730' | 'all';

export const PMC_PRESETS: { id: PmcPreset; label: string; days: number | null }[] = [
  { id: '30', label: '30d', days: 30 },
  { id: '90', label: '90d', days: 90 },
  { id: '180', label: '6mo', days: 180 },
  { id: '365', label: '1y', days: 365 },
  { id: '730', label: '2y', days: 730 },
  { id: 'all', label: 'All', days: null },
];

export const DEFAULT_PMC_PRESET: PmcPreset = '90';

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Picks the part of a daily CTL/ATL/TSB series to chart: either the last N days or an explicit From/To range
 * (which takes precedence). The series is computed from the first activity, so values are accurate whatever
 * the window; days before the athlete had any load are dropped so the chart starts where the data does.
 */
export function selectPmcRange(
  series: PMCDayPoint[],
  options: { preset: PmcPreset; from?: string; to?: string },
): PMCDayPoint[] {
  if (series.length === 0) return [];
  const firstWithLoad = series.findIndex((p) => p.ctl > 0 || p.atl > 0 || p.tss > 0);
  if (firstWithLoad < 0) return [];
  const loaded = series.slice(firstWithLoad);

  const { preset, from, to } = options;
  if (from || to) {
    return loaded.filter((p) => (!from || p.date >= from) && (!to || p.date <= to));
  }
  const days = PMC_PRESETS.find((p) => p.id === preset)?.days;
  if (!days) return loaded;
  const cutoff = addDays(loaded[loaded.length - 1].date, -days);
  return loaded.filter((p) => p.date >= cutoff);
}

/** "Last 90 days", "Last 2 years", "Mar 3, 2025 to today" ... for the chart subtitle. */
export function describePmcRange(options: { preset: PmcPreset; from?: string; to?: string }): string {
  const { preset, from, to } = options;
  if (from || to) {
    const fmt = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    if (from && to) return `${fmt(from)} to ${fmt(to)}`;
    return from ? `Since ${fmt(from)}` : `Through ${fmt(to!)}`;
  }
  switch (preset) {
    case '30': return 'Last 30 days';
    case '90': return 'Last 90 days';
    case '180': return 'Last 6 months';
    case '365': return 'Last year';
    case '730': return 'Last 2 years';
    default: return 'All time';
  }
}
