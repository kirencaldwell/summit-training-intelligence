/**
 * Reads the activities.csv from a Strava bulk export so imported files can pick up the names, types and
 * descriptions the athlete gave them in Strava. FIT/GPX files carry none of that.
 */
import type { Activity, SportType } from '../types';
import { EBIKE_TAG, normalizeTags } from './tags';

export interface StravaActivityMeta {
  activityId: string;
  name: string;
  type: string;
  description: string;
  privateNote: string;
  gear: string;
  commute: boolean;
}

export type StravaMetaIndex = Map<string, StravaActivityMeta>;

/** RFC 4180 parser: quoted fields may hold commas, doubled quotes and line breaks (descriptions do). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((cell) => cell !== '')) rows.push(row);
  return rows;
}

/** "activities/1234567.fit.gz", "1234567.gpx" and "1234567" all give "1234567". */
export function stravaFileKey(fileNameOrPath: string): string {
  const base = fileNameOrPath.split(/[\\/]/).pop() ?? fileNameOrPath;
  return base.replace(/\.gz$/i, '').replace(/\.(fit|gpx|tcx)$/i, '').trim();
}

export function parseStravaActivitiesCsv(text: string): StravaMetaIndex {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('That CSV has no activity rows.');

  // Strava repeats some headers (Distance, Elapsed Time, ...); the first occurrence of each name is the one we use
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => headers.indexOf(name);
  const idCol = col('activity id');
  const nameCol = col('activity name');
  const typeCol = col('activity type');
  if (idCol < 0 || nameCol < 0 || typeCol < 0) {
    throw new Error('This does not look like Strava\'s activities.csv (expected Activity ID, Activity Name and Activity Type columns).');
  }
  const descCol = col('activity description');
  const noteCol = col('activity private note');
  const gearCol = col('activity gear');
  const commuteCol = col('commute');
  const fileCol = col('filename');
  const get = (row: string[], i: number) => (i >= 0 ? (row[i] ?? '').trim() : '');

  const index: StravaMetaIndex = new Map();
  for (const row of rows.slice(1)) {
    const activityId = get(row, idCol);
    if (!activityId) continue;
    const meta: StravaActivityMeta = {
      activityId,
      name: get(row, nameCol),
      type: get(row, typeCol),
      description: get(row, descCol),
      privateNote: get(row, noteCol),
      gear: get(row, gearCol),
      commute: /^(true|yes|1)$/i.test(get(row, commuteCol)),
    };
    index.set(activityId, meta);
    const file = get(row, fileCol);
    if (file) index.set(stravaFileKey(file), meta);
  }
  return index;
}

export function lookupStravaMeta(index: StravaMetaIndex, fileNameOrId: string): StravaActivityMeta | undefined {
  return index.get(stravaFileKey(fileNameOrId));
}

/** Strava activity types onto the app's sport types. Undefined means "keep what the file says". */
export function mapStravaType(type: string): { sport?: SportType; ebike: boolean } {
  const t = type.toLowerCase().replace(/[^a-z]/g, '');
  const ebike = t.includes('ebike') || t === 'emountainbikeride';
  if (!t) return { ebike: false };
  if (t === 'virtualride') return { sport: 'zwift', ebike: false };
  if (t.includes('ride') || t.includes('bike') || t === 'handcycle' || t === 'velomobile') return { sport: 'cycling', ebike };
  if (t.includes('skimo') || t.includes('skimountaineering')) return { sport: 'skimo', ebike: false };
  if (t.includes('ski') || t === 'snowboard') return { sport: 'backcountry_skiing', ebike: false };
  if (t.includes('climb') || t === 'mountaineering') return { sport: 'scrambling', ebike: false };
  if (t === 'hike' || t === 'walk' || t === 'run' || t === 'trailrun' || t === 'snowshoe' || t === 'virtualrun') {
    return { sport: 'weighted_hiking', ebike: false };
  }
  return { ebike: false };
}

/** The fields to set on an activity from its Strava row. Existing user-entered notes and tags are kept. */
export function stravaMetaToPatch(meta: StravaActivityMeta, existing: Pick<Activity, 'tags' | 'effort_notes'>): Partial<Activity> {
  const patch: Partial<Activity> = {};
  if (meta.name) patch.title = meta.name;

  const { sport, ebike } = mapStravaType(meta.type);
  if (sport) patch.sport_type = sport;

  const tags = [...(existing.tags ?? [])];
  if (ebike) tags.push(EBIKE_TAG);
  if (meta.commute) tags.push('commute');
  if (ebike || meta.commute) patch.tags = normalizeTags(tags);

  // The description is exactly the kind of context the AI effort estimator uses
  if (!existing.effort_notes?.trim()) {
    const notes = [meta.description, meta.privateNote].filter(Boolean).join('\n\n');
    if (notes) patch.effort_notes = notes;
  }
  return patch;
}
