/**
 * Combining two recordings of the same workout (for example a Garmin bike computer and a COROS watch worn on
 * one ride) into a single activity. The base ("primary") recording wins every conflict: its time, distance,
 * track and numbers stay as they are. From the other recording only what the base is missing is added, such as
 * heart rate, power, cadence or elevation, so the result is never double counted and never worse than the base.
 */
import type { Activity, MetricStreamPoint } from '../types';

type StreamField = 'hr' | 'watts' | 'cadence';

/** The recording-derived fields; everything else (title, tags, notes, ratings...) belongs to the athlete. */
export const RECORDING_FIELDS = [
  'start_date', 'duration_seconds', 'moving_time_seconds', 'distance_meters', 'total_elevation_gain_m',
  'avg_power', 'max_power', 'normalized_power', 'intensity_factor', 'training_stress_score',
  'avg_hr', 'max_hr', 'avg_cadence', 'max_speed_kmh', 'avg_vam_mh',
  'time_in_hr_zones', 'time_in_power_zones', 'power_curve_best_efforts', 'map_summary_polyline', 'streams_data',
] as const satisfies readonly (keyof Activity)[];

export interface MergeResult {
  activity: Activity;
  /** What was added from the other recording, in plain words ("heart rate", "power"...). Empty when nothing was. */
  filled: string[];
}

const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const hasStreamValue = (streams: MetricStreamPoint[] | undefined, field: StreamField) =>
  Boolean(streams?.some((p) => typeof p[field] === 'number' && (field === 'cadence' ? (p[field] as number) >= 0 : (p[field] as number) > 0)));

const hasPower = (a: Activity) => positive(a.avg_power) || positive(a.normalized_power) || hasStreamValue(a.streams_data, 'watts');
const hasHr = (a: Activity) => positive(a.avg_hr) || hasStreamValue(a.streams_data, 'hr');
const hasCadence = (a: Activity) => positive(a.avg_cadence) || hasStreamValue(a.streams_data, 'cadence');

/** Typical gap between samples, in the units of their `time`. */
function sampleStep(streams: MetricStreamPoint[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < Math.min(streams.length, 50); i++) {
    const gap = streams[i].time - streams[i - 1].time;
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return 1;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

/** The sample closest to `time`, if it is within `tolerance`. `streams` must be sorted by time. */
function nearest(streams: MetricStreamPoint[], time: number, tolerance: number): MetricStreamPoint | undefined {
  let low = 0;
  let high = streams.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (streams[mid].time < time) low = mid + 1;
    else high = mid;
  }
  let best = streams[low];
  if (low > 0 && Math.abs(streams[low - 1].time - time) < Math.abs(best.time - time)) best = streams[low - 1];
  return best && Math.abs(best.time - time) <= tolerance ? best : undefined;
}

/**
 * Copies one stream field from the other recording onto the base's samples, lining the two up by clock time.
 * Returns null when too little of the base could be matched for the result to be trustworthy.
 */
function fillStreamField(
  base: MetricStreamPoint[],
  other: MetricStreamPoint[],
  offsetSeconds: number,
  field: StreamField,
): MetricStreamPoint[] | null {
  const sortedOther = [...other].sort((a, b) => a.time - b.time);
  const tolerance = Math.max(sampleStep(base), sampleStep(sortedOther), 5) * 1.5;
  let hits = 0;
  const merged = base.map((point) => {
    if (point[field] !== undefined) return point;
    const match = nearest(sortedOther, point.time + offsetSeconds, tolerance);
    const value = match?.[field];
    if (value === undefined) return point;
    hits += 1;
    return { ...point, [field]: value };
  });
  return hits >= Math.max(5, Math.floor(base.length * 0.2)) ? merged : null;
}

export function mergeRecordings(primary: Activity, secondary: Activity): MergeResult {
  const out: Activity = { ...primary };
  const filled: string[] = [];
  const offsetSeconds = (new Date(primary.start_date).getTime() - new Date(secondary.start_date).getTime()) / 1000;
  const alignable = Number.isFinite(offsetSeconds);
  let streams = primary.streams_data;

  // A base with no track or charts at all (imported from a summary) takes the other recording's
  if ((!streams || streams.length === 0) && secondary.streams_data && secondary.streams_data.length > 0) {
    streams = secondary.streams_data;
    if (!out.map_summary_polyline && secondary.map_summary_polyline) out.map_summary_polyline = secondary.map_summary_polyline;
    filled.push('map and charts');
  }
  const ownStreams = streams === primary.streams_data;

  const fillGroup = (label: string, field: StreamField, copy: () => void) => {
    copy();
    if (ownStreams && alignable && streams && streams.length > 0 && secondary.streams_data?.length) {
      const merged = fillStreamField(streams, secondary.streams_data, offsetSeconds, field);
      if (merged) streams = merged;
    }
    filled.push(label);
  };

  if (!hasPower(primary) && hasPower(secondary)) {
    fillGroup('power', 'watts', () => {
      for (const key of ['avg_power', 'max_power', 'normalized_power', 'intensity_factor', 'training_stress_score', 'time_in_power_zones', 'power_curve_best_efforts'] as const) {
        if (secondary[key] !== undefined) (out as unknown as Record<string, unknown>)[key] = secondary[key];
      }
    });
  }
  if (!hasHr(primary) && hasHr(secondary)) {
    fillGroup('heart rate', 'hr', () => {
      for (const key of ['avg_hr', 'max_hr', 'time_in_hr_zones'] as const) {
        if (secondary[key] !== undefined) (out as unknown as Record<string, unknown>)[key] = secondary[key];
      }
    });
  }
  if (!hasCadence(primary) && hasCadence(secondary)) {
    fillGroup('cadence', 'cadence', () => {
      if (secondary.avg_cadence !== undefined) out.avg_cadence = secondary.avg_cadence;
    });
  }
  if (!positive(primary.total_elevation_gain_m) && positive(secondary.total_elevation_gain_m)) {
    out.total_elevation_gain_m = secondary.total_elevation_gain_m;
    if (secondary.avg_vam_mh !== undefined && !positive(out.avg_vam_mh)) out.avg_vam_mh = secondary.avg_vam_mh;
    filled.push('elevation');
  }

  if (streams !== primary.streams_data) out.streams_data = streams;
  return { activity: out, filled };
}

/** The recording-derived fields of an activity, for updating a saved activity without touching the athlete's edits. */
export function recordingFields(activity: Activity): Partial<Activity> {
  const fields: Partial<Activity> = {};
  for (const key of RECORDING_FIELDS) {
    if (activity[key] !== undefined) (fields as Record<string, unknown>)[key] = activity[key];
  }
  return fields;
}
