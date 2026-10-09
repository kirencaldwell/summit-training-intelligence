/**
 * Intervals.icu import. Garmin Connect, COROS and Zwift can all send activities to Intervals.icu (free), and it has
 * a free API, so this pulls them from there. The athlete's API key stays in this browser and is sent to
 * /api/intervals with each request; the server forwards it to Intervals.icu without storing it.
 */
import type { Activity } from '../types';
import { dataService } from './supabase';
import { parseFitFile, parseGpxFile } from './fitParser';
import { isDuplicateActivity } from './activityDuplicates';
import { activityFromCandidate, applyCandidate, planImport, toCandidate, type IntervalsCandidate, type IntervalsRaw } from './intervalsMap';

const STORAGE_KEY = 'summit_intervals_settings';
/** The sync checks again when the app comes back into view, at most this often */
export const AUTO_SYNC_MIN_INTERVAL_MS = 15 * 60 * 1000;
/** Automatic syncs look back this far from the last one, so a missed day is still caught */
const AUTO_OVERLAP_DAYS = 3;
const FIRST_SYNC_DAYS = 30;
const MAX_AUTO_DAYS = 60;
const LIST_WINDOW_DAYS = 180;
const DAY_MS = 24 * 3600 * 1000;

// Only the fields the importer reads, so a long history doesn't produce a huge response
const LIST_FIELDS = [
  'id', 'name', 'type', 'start_date', 'start_date_local', 'distance', 'moving_time', 'elapsed_time',
  'total_elevation_gain', 'average_heartrate', 'max_heartrate', 'icu_average_watts', 'icu_weighted_avg_watts',
  'source', 'device_name', 'external_id', 'description', 'commute',
].join(',');

export interface IntervalsSettings {
  apiKey: string;
  /** Pull new activities automatically when the app opens or comes back into view */
  auto: boolean;
  lastSyncAt?: string;
}

export function getIntervalsSettings(): IntervalsSettings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<IntervalsSettings>;
    if (typeof saved.apiKey !== 'string' || !saved.apiKey.trim()) return null;
    return { apiKey: saved.apiKey.trim(), auto: saved.auto !== false, lastSyncAt: typeof saved.lastSyncAt === 'string' ? saved.lastSyncAt : undefined };
  } catch {
    return null;
  }
}

export function saveIntervalsSettings(settings: IntervalsSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be blocked; the connection then lasts for this session only
  }
}

export function clearIntervalsSettings(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export class IntervalsError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'IntervalsError';
    this.status = status;
  }
}

async function request(path: string, params: Record<string, string>, apiKey: string): Promise<Response> {
  const query = new URLSearchParams({ path, ...params });
  let res: Response;
  try {
    res = await fetch(`/api/intervals?${query}`, { headers: { 'x-intervals-key': apiKey } });
  } catch {
    throw new IntervalsError('Could not reach the app server. Check your connection and try again.', 0);
  }
  if (res.ok) return res;

  let message = '';
  try {
    message = String((await res.json())?.error ?? '');
  } catch {
    // not JSON
  }
  if (!message) {
    message = res.status === 404
      ? 'The Intervals.icu connection endpoint is not available here (it only runs on the deployed app).'
      : `Intervals.icu request failed (${res.status}).`;
  }
  throw new IntervalsError(message, res.status);
}

const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Activities between two dates (YYYY-MM-DD), fetched in half-year windows to keep each response small. */
export async function listIntervalsActivities(apiKey: string, oldest: string, newest: string): Promise<IntervalsRaw[]> {
  const out: IntervalsRaw[] = [];
  const end = new Date(`${newest}T00:00:00`);
  let windowStart = new Date(`${oldest}T00:00:00`);
  while (windowStart <= end) {
    const windowEnd = new Date(Math.min(end.getTime(), windowStart.getTime() + LIST_WINDOW_DAYS * DAY_MS));
    const res = await request('athlete/0/activities', { oldest: isoDate(windowStart), newest: isoDate(windowEnd), fields: LIST_FIELDS }, apiKey);
    const body = await res.json();
    if (!Array.isArray(body)) throw new IntervalsError('Intervals.icu returned something unexpected instead of a list of activities.', 502);
    out.push(...(body as IntervalsRaw[]));
    windowStart = new Date(windowEnd.getTime() + DAY_MS);
  }
  // Newest first, like the API
  return out.sort((a, b) => String(b.start_date ?? b.start_date_local ?? '').localeCompare(String(a.start_date ?? a.start_date_local ?? '')));
}

/** Checks the key by asking for today's activities. Throws a readable error if it is wrong. */
export async function testIntervalsKey(apiKey: string): Promise<void> {
  const today = isoDate(new Date());
  await listIntervalsActivities(apiKey, today, today);
}

type Recording = { kind: 'fit' | 'fit-gz' | 'gpx'; bytes: ArrayBuffer };

function sniff(bytes: ArrayBuffer): Recording['kind'] | null {
  const view = new Uint8Array(bytes);
  if (view.length >= 2 && view[0] === 0x1f && view[1] === 0x8b) return 'fit-gz';
  if (view.length >= 12 && String.fromCharCode(...view.slice(8, 12)) === '.FIT') return 'fit';
  const head = new TextDecoder().decode(view.slice(0, 400)).toLowerCase();
  return head.includes('<gpx') ? 'gpx' : null;
}

async function downloadRecording(apiKey: string, id: string): Promise<Recording | null> {
  const res = await request(`activity/${encodeURIComponent(id)}/file`, {}, apiKey);
  const bytes = await res.arrayBuffer();
  const kind = sniff(bytes);
  return kind ? { kind, bytes } : null;
}

/** One activity ready to save: parsed from its recording when possible, otherwise built from its summary. */
async function buildActivity(c: IntervalsCandidate, apiKey: string): Promise<{ activity: Activity; fromFile: boolean }> {
  try {
    const recording = await downloadRecording(apiKey, c.id);
    if (recording) {
      const name = `${c.id}.${recording.kind === 'fit' ? 'fit' : recording.kind === 'fit-gz' ? 'fit.gz' : 'gpx'}`;
      const file = new File([recording.bytes], name);
      const parsed = recording.kind === 'gpx' ? await parseGpxFile(file) : await parseFitFile(file);
      return { activity: applyCandidate(parsed, c), fromFile: true };
    }
  } catch (err) {
    // A rate limit or a rejected key will fail every download: don't quietly turn them all into summaries
    if (err instanceof IntervalsError && (err.status === 401 || err.status === 429)) throw err;
    // Missing, oversized or unreadable recording: fall back to the summary below
  }
  return { activity: applyCandidate(activityFromCandidate(c), c), fromFile: false };
}

export interface SyncProgress {
  done: number;
  total: number;
  name?: string;
}

export interface SyncResult {
  /** Activities found at Intervals.icu in the range */
  listed: number;
  imported: Activity[];
  alreadyHave: number;
  droppedDuplicates: number;
  /** COROS copies skipped because a Garmin (or other) recording of the same workout was kept */
  droppedCoros: number;
  /** Swim, strength, yoga and other sports this app doesn't track */
  unsupported: number;
  /** Imported from the summary because the recording file wasn't available */
  summaryOnly: number;
  failed: { name: string; error: string }[];
  cancelled: boolean;
}

let syncRunning = false;
export const isIntervalsSyncRunning = () => syncRunning;

export async function syncFromIntervals(options: {
  apiKey: string;
  /** Start of the range, YYYY-MM-DD */
  oldest: string;
  newest?: string;
  onProgress?: (progress: SyncProgress) => void;
  signal?: AbortSignal;
}): Promise<SyncResult> {
  // Two syncs at once (say automatic and manual) would each import the same new activity
  if (syncRunning) throw new IntervalsError('A sync is already running.', 409);
  syncRunning = true;
  try {
    return await runSync(options);
  } finally {
    syncRunning = false;
  }
}

async function runSync(options: {
  apiKey: string;
  oldest: string;
  newest?: string;
  onProgress?: (progress: SyncProgress) => void;
  signal?: AbortSignal;
}): Promise<SyncResult> {
  const raw = await listIntervalsActivities(options.apiKey, options.oldest, options.newest ?? isoDate(new Date(Date.now() + DAY_MS)));
  const candidates = raw.map(toCandidate);
  const usable = candidates.filter((c): c is IntervalsCandidate => c !== null);

  const existing = await dataService.getActivities();
  const plan = planImport(usable, existing);

  const result: SyncResult = {
    listed: raw.length,
    imported: [],
    alreadyHave: plan.alreadyHave,
    droppedDuplicates: plan.droppedDuplicates,
    droppedCoros: plan.droppedCoros,
    unsupported: raw.length - usable.length,
    summaryOnly: 0,
    failed: [],
    cancelled: false,
  };

  for (const [index, candidate] of plan.toImport.entries()) {
    if (options.signal?.aborted) {
      result.cancelled = true;
      break;
    }
    options.onProgress?.({ done: index, total: plan.toImport.length, name: candidate.name });
    // Let the browser paint progress between downloads
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      const { activity, fromFile } = await buildActivity(candidate, options.apiKey);
      // Candidates without a UTC start couldn't be matched earlier; check again with the real start time
      if (existing.some((e) => isDuplicateActivity(activity, e))) {
        result.alreadyHave += 1;
        continue;
      }
      const saved = await dataService.addActivity(activity);
      existing.push(saved);
      result.imported.push(saved);
      if (!fromFile) result.summaryOnly += 1;
    } catch (err) {
      if (err instanceof IntervalsError && (err.status === 401 || err.status === 429)) throw err;
      result.failed.push({ name: candidate.name || candidate.id, error: err instanceof Error ? err.message : 'Import failed.' });
    }
  }
  options.onProgress?.({ done: plan.toImport.length, total: plan.toImport.length });
  return result;
}

/** Where an automatic sync should start: shortly before the last one, within the last two months. */
export function autoSyncStart(settings: IntervalsSettings, now = new Date()): string {
  const last = settings.lastSyncAt ? new Date(settings.lastSyncAt).getTime() : NaN;
  const earliest = now.getTime() - MAX_AUTO_DAYS * DAY_MS;
  const from = Number.isFinite(last)
    ? Math.max(earliest, last - AUTO_OVERLAP_DAYS * DAY_MS)
    : now.getTime() - FIRST_SYNC_DAYS * DAY_MS;
  return isoDate(new Date(from));
}

export function autoSyncDue(settings: IntervalsSettings | null, now = Date.now()): boolean {
  if (!settings || !settings.auto) return false;
  const last = settings.lastSyncAt ? new Date(settings.lastSyncAt).getTime() : 0;
  return !(now - last < AUTO_SYNC_MIN_INTERVAL_MS);
}

/** "Imported 3 activities" plus anything worth knowing, for a notice or status line. */
export function describeSync(result: SyncResult): string {
  const parts = [`Imported ${result.imported.length} ${result.imported.length === 1 ? 'activity' : 'activities'}`];
  if (result.alreadyHave) parts.push(`${result.alreadyHave} already in your log`);
  if (result.droppedDuplicates) {
    parts.push(`${result.droppedDuplicates} duplicate${result.droppedDuplicates === 1 ? '' : 's'} skipped${result.droppedCoros ? ` (${result.droppedCoros} COROS ${result.droppedCoros === 1 ? 'copy' : 'copies'}, keeping Garmin)` : ''}`);
  }
  if (result.unsupported) parts.push(`${result.unsupported} of other sports skipped`);
  if (result.summaryOnly) parts.push(`${result.summaryOnly} imported without a recording file (no map or charts)`);
  if (result.failed.length) parts.push(`${result.failed.length} failed`);
  if (result.cancelled) parts.push('stopped early');
  return `${parts.join(', ')}.`;
}
