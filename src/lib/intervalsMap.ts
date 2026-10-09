/**
 * Turning Intervals.icu activity records into candidates for import, and choosing which to keep when the same
 * workout arrives from more than one device (a Garmin and a COROS recording the same ride).
 * Pure functions: nothing here touches the network or the database.
 */
import type { Activity, SportType } from '../types';
import { EBIKE_TAG, normalizeTags } from './tags';
import { mapStravaType } from './stravaCsv';
import { isDuplicateActivity } from './activityDuplicates';

/** A raw activity object from the Intervals.icu API. Field names are read defensively. */
export type IntervalsRaw = Record<string, unknown>;

export interface IntervalsCandidate {
  id: string;
  name: string;
  type: string;
  sport: SportType;
  ebike: boolean;
  commute: boolean;
  /** ISO start time in UTC when the API gave one, otherwise undefined */
  start?: string;
  elapsedSeconds: number;
  movingSeconds: number;
  distanceM: number;
  elevationM: number;
  avgHr?: number;
  maxHr?: number;
  avgWatts?: number;
  normalizedWatts?: number;
  description: string;
  /** Where Intervals.icu got it from (source and device text), lower-cased, for ranking */
  origin: string;
  /** Lower is preferred: 0 Garmin, 1 anything else, 2 COROS */
  rank: number;
}

const num = (value: unknown): number | undefined => {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};
const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const GARMIN = /garmin|fenix|forerunner|\bedge\b|venu|vivoactive|enduro|instinct|epix|tacx/;
const COROS = /coros|vertix|apex|pace\s?\d|dura\b/;

/** Garmin first, COROS last: the athlete prefers their Garmin recording when both exist. */
export function sourceRank(origin: string): number {
  if (COROS.test(origin)) return 2;
  if (GARMIN.test(origin)) return 0;
  return 1;
}

/** Null for records that can't be used: no id, an unsupported sport (swim, strength, yoga...), or no time. */
export function toCandidate(raw: IntervalsRaw): IntervalsCandidate | null {
  const id = str(raw.id) || (num(raw.id) !== undefined ? String(raw.id) : '');
  if (!id) return null;

  const type = str(raw.type);
  const { sport, ebike } = mapStravaType(type);
  if (!sport) return null;

  const movingSeconds = num(raw.moving_time) ?? num(raw.icu_recording_time) ?? 0;
  const elapsedSeconds = num(raw.elapsed_time) ?? movingSeconds;
  if (!(elapsedSeconds > 0 || movingSeconds > 0)) return null;

  const startRaw = str(raw.start_date);
  const start = startRaw && !Number.isNaN(Date.parse(startRaw)) ? new Date(startRaw).toISOString() : undefined;
  const origin = [raw.source, raw.device_name, raw.external_id].map(str).join(' ').toLowerCase();

  return {
    id,
    name: str(raw.name),
    type,
    sport,
    ebike,
    commute: raw.commute === true,
    start,
    elapsedSeconds: elapsedSeconds || movingSeconds,
    movingSeconds: movingSeconds || elapsedSeconds,
    distanceM: num(raw.distance) ?? 0,
    elevationM: num(raw.total_elevation_gain) ?? 0,
    avgHr: num(raw.average_heartrate),
    maxHr: num(raw.max_heartrate),
    avgWatts: num(raw.icu_average_watts) ?? num(raw.average_watts),
    normalizedWatts: num(raw.icu_weighted_avg_watts) ?? num(raw.weighted_average_watts),
    description: str(raw.description),
    origin,
    rank: sourceRank(origin),
  };
}

/** The candidate as an Activity-shaped record, enough for the duplicate check. */
function asActivity(c: IntervalsCandidate): Activity | null {
  if (!c.start) return null;
  return {
    id: `icu-${c.id}`,
    title: c.name,
    sport_type: c.sport,
    start_date: c.start,
    duration_seconds: c.elapsedSeconds,
    moving_time_seconds: c.movingSeconds,
    distance_meters: c.distanceM,
    total_elevation_gain_m: c.elevationM,
  } as Activity;
}

export interface ImportPlan {
  toImport: IntervalsCandidate[];
  /** Already in the log (from any earlier import) */
  alreadyHave: number;
  /** A second copy of a workout in this batch, dropped in favour of the preferred device's recording */
  droppedDuplicates: number;
  /** Of those, how many were COROS copies dropped because a Garmin (or other) recording exists */
  droppedCoros: number;
}

/**
 * Decides what to import. Candidates that match something already logged are skipped. Of the rest, copies of
 * the same workout are collapsed to one, keeping the most preferred source (Garmin over others over COROS).
 * A candidate without a UTC start time can't be matched here; the importer checks it again once parsed.
 */
export function planImport(candidates: IntervalsCandidate[], existing: Activity[]): ImportPlan {
  let alreadyHave = 0;
  const fresh: IntervalsCandidate[] = [];
  for (const candidate of candidates) {
    const record = asActivity(candidate);
    if (record && existing.some((e) => isDuplicateActivity(record, e))) alreadyHave += 1;
    else fresh.push(candidate);
  }

  // Preferred sources first; the sort is stable so equal ranks keep their original (newest first) order
  const ordered = [...fresh].sort((a, b) => a.rank - b.rank);
  const kept: IntervalsCandidate[] = [];
  let droppedDuplicates = 0;
  let droppedCoros = 0;
  for (const candidate of ordered) {
    const record = asActivity(candidate);
    const twin = record ? kept.find((k) => {
      const other = asActivity(k);
      return other ? isDuplicateActivity(record, other) : false;
    }) : undefined;
    if (twin) {
      droppedDuplicates += 1;
      if (candidate.rank === 2 && twin.rank < 2) droppedCoros += 1;
    } else {
      kept.push(candidate);
    }
  }

  // Back to chronological order for importing, newest first as the API returns them
  const order = new Map(candidates.map((c, i) => [c.id, i]));
  kept.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return { toImport: kept, alreadyHave, droppedDuplicates, droppedCoros };
}

/** An activity built from the list record alone, for when the recording file can't be fetched or read. */
export function activityFromCandidate(c: IntervalsCandidate): Activity {
  const hasPower = (c.avgWatts ?? 0) > 0;
  const activity: Activity = {
    id: crypto.randomUUID(),
    title: c.name || `${c.type} ${(c.start ?? '').slice(0, 10)}`.trim(),
    sport_type: c.sport,
    start_date: c.start ?? new Date().toISOString(),
    duration_seconds: Math.round(c.elapsedSeconds),
    moving_time_seconds: Math.round(c.movingSeconds),
    distance_meters: Math.round(c.distanceM),
    total_elevation_gain_m: Math.round(c.elevationM),
    avg_hr: c.avgHr ? Math.round(c.avgHr) : undefined,
    max_hr: c.maxHr ? Math.round(c.maxHr) : undefined,
    avg_power: hasPower ? Math.round(c.avgWatts!) : undefined,
    normalized_power: hasPower && c.normalizedWatts ? Math.round(c.normalizedWatts) : undefined,
  } as Activity;
  return activity;
}

/** Name, sport, tags and notes from Intervals.icu laid over an activity parsed from its recording. */
export function applyCandidate(activity: Activity, c: IntervalsCandidate): Activity {
  const tags = [...(activity.tags ?? [])];
  if (c.ebike) tags.push(EBIKE_TAG);
  if (c.commute) tags.push('commute');
  return {
    ...activity,
    title: c.name || activity.title,
    sport_type: c.sport,
    tags: tags.length ? normalizeTags(tags) : activity.tags,
    effort_notes: activity.effort_notes?.trim() ? activity.effort_notes : c.description || activity.effort_notes,
  };
}
