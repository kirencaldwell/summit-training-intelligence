/**
 * Intervals.icu import. Garmin Connect, COROS and Zwift can all send activities to Intervals.icu (free), and it has
 * a free API, so this pulls them from there. The athlete's API key stays in this browser and is sent to
 * /api/intervals with each request; the server forwards it to Intervals.icu without storing it.
 */
import type { Activity } from '../types';
import { dataService, isSupabaseConfigured, type IntegrationSettings } from './supabase';
import { parseFitFile, parseGpxFile } from './fitParser';
import { isDuplicateActivity } from './activityDuplicates';
import {
  activityFromCandidate,
  activityHas,
  applyCandidate,
  couldAdd,
  planImport,
  toCandidate,
  type IntervalsCandidate,
  type IntervalsRaw,
} from './intervalsMap';
import { mergeRecordings, recordingFields } from './mergeActivities';

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

// ---------------------------------------------------------------------------------------------------------
// Keeping the key with the athlete's account (Supabase) so every device they sign in on has it. This browser
// keeps a copy because the rest of the code reads it synchronously; the account's copy is the shared one.
// ---------------------------------------------------------------------------------------------------------

export type AccountKeyStatus =
  | { state: 'unknown' }
  | { state: 'saved' }
  | { state: 'unavailable'; detail: string }
  | { state: 'error'; detail: string };

let accountStatus: AccountKeyStatus = { state: 'unknown' };
export const getIntervalsAccountStatus = (): AccountKeyStatus => accountStatus;

type Reconciliation =
  | { action: 'none' }
  /** The account has nothing yet: upload this device's key (how an existing connection moves to the account) */
  | { action: 'push-local' }
  /** The account has a key that differs from this device's (or this device has none): take the account's */
  | { action: 'use-remote'; settings: IntervalsSettings }
  /** The athlete disconnected on another device: forget the key here too */
  | { action: 'clear-local' };

/**
 * Decides how this device's settings and the account's fit together. No account row means nothing was ever
 * saved; a row with an empty key means the athlete disconnected on purpose, which must not be undone by a
 * device that still has the old key.
 */
export function reconcileIntervalsSettings(local: IntervalsSettings | null, remote: IntegrationSettings | null): Reconciliation {
  if (remote === null) return local ? { action: 'push-local' } : { action: 'none' };
  if (remote.intervals_api_key === null) return local ? { action: 'clear-local' } : { action: 'none' };
  if (local && local.apiKey === remote.intervals_api_key && local.auto === remote.intervals_auto) return { action: 'none' };
  return { action: 'use-remote', settings: { apiKey: remote.intervals_api_key, auto: remote.intervals_auto, lastSyncAt: local?.lastSyncAt } };
}

type SettingsStore = Pick<typeof dataService, 'getIntegrationSettings' | 'saveIntegrationSettings'>;

function recordAccountError(err: unknown) {
  const detail = err instanceof Error ? err.message : 'Unknown error';
  // A missing table is a setup step; anything else (offline, expired session, permissions) is shown as a problem
  accountStatus = /integration_settings|schema cache|does not exist/i.test(detail) && !/permission|policy/i.test(detail)
    ? { state: 'unavailable', detail }
    : { state: 'error', detail };
}

/** Run once the app has loaded: bring this device in line with the account, in either direction. */
export async function syncIntervalsSettings(store: SettingsStore = dataService, enabled = isSupabaseConfigured): Promise<void> {
  if (!enabled) return;
  try {
    const remote = await store.getIntegrationSettings();
    const local = getIntervalsSettings();
    const outcome = reconcileIntervalsSettings(local, remote);
    if (outcome.action === 'use-remote') saveIntervalsSettings(outcome.settings);
    else if (outcome.action === 'clear-local') clearIntervalsSettings();
    else if (outcome.action === 'push-local' && local) {
      await store.saveIntegrationSettings({ intervals_api_key: local.apiKey, intervals_auto: local.auto });
    }
    accountStatus = { state: 'saved' };
  } catch (err) {
    console.warn('Intervals.icu settings could not be synced with the account:', err);
    recordAccountError(err);
  }
}

/** Saves (or, with null, disconnects) the key on the account. Never throws: the outcome is in the account status. */
export async function saveIntervalsToAccount(
  settings: IntervalsSettings | null,
  store: SettingsStore = dataService,
  enabled = isSupabaseConfigured,
): Promise<void> {
  if (!enabled) return;
  try {
    await store.saveIntegrationSettings(settings
      ? { intervals_api_key: settings.apiKey, intervals_auto: settings.auto }
      : { intervals_api_key: null });
    accountStatus = { state: 'saved' };
  } catch (err) {
    console.warn('Intervals.icu settings could not be saved to the account:', err);
    recordAccountError(err);
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
  /** New activities added to the log */
  imported: Activity[];
  /** Activities already in the log that gained something from another device's recording */
  updated: Activity[];
  /** Recordings that matched something already in the log and added nothing */
  alreadyHave: number;
  /** Workouts recorded on more than one device: the extra recordings were not counted again */
  duplicatesHandled: number;
  /** Swim, strength, yoga and other sports this app doesn't track */
  unsupported: number;
  /** Imported from the summary because the recording file wasn't available */
  summaryOnly: number;
  failed: { name: string; error: string }[];
  cancelled: boolean;
}

// What this browser remembers about activities it imported: which source was preferred for each (so a
// better recording that turns up later can take over), and which recordings were already merged.
const LEDGER_KEY = 'summit_intervals_ledger';
const LEDGER_MAX = 3000;
interface Ledger {
  /** saved activity id -> rank of the recording it is based on (0 Garmin, 1 other, 2 COROS) */
  ranks: Record<string, number>;
  /** Intervals.icu activity ids already merged into an activity */
  merged: string[];
}
function readLedger(): Ledger {
  try {
    const parsed = JSON.parse(localStorage.getItem(LEDGER_KEY) || '{}') as Partial<Ledger>;
    return { ranks: parsed.ranks && typeof parsed.ranks === 'object' ? parsed.ranks : {}, merged: Array.isArray(parsed.merged) ? parsed.merged : [] };
  } catch {
    return { ranks: {}, merged: [] };
  }
}
function writeLedger(ledger: Ledger): void {
  try {
    const keys = Object.keys(ledger.ranks);
    if (keys.length > LEDGER_MAX) for (const key of keys.slice(0, keys.length - LEDGER_MAX)) delete ledger.ranks[key];
    localStorage.setItem(LEDGER_KEY, JSON.stringify({ ranks: ledger.ranks, merged: ledger.merged.slice(-LEDGER_MAX) }));
  } catch {
    // Storage can be blocked; combining still works, it just won't remember which source was preferred
  }
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
  const usable = raw.map(toCandidate).filter((c): c is IntervalsCandidate => c !== null);

  // A copy: in local mode getActivities() returns the store's own list, which this function must not add to
  const existing = [...(await dataService.getActivities())];
  const plan = planImport(usable, existing);
  const ledger = readLedger();

  const result: SyncResult = {
    listed: raw.length,
    imported: [],
    updated: [],
    alreadyHave: 0,
    duplicatesHandled: 0,
    unsupported: raw.length - usable.length,
    summaryOnly: 0,
    failed: [],
    cancelled: false,
  };

  // Matches first (cheap, usually nothing to do), then new workouts
  const total = plan.matches.length + plan.groups.length;
  let done = 0;
  const step = async (name: string | undefined) => {
    options.onProgress?.({ done, total, name });
    // Let the browser paint progress between downloads
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const rethrowFatal = (err: unknown) => {
    // A rate limit or a rejected key will fail every download: stop instead of failing them all one by one
    if (err instanceof IntervalsError && (err.status === 401 || err.status === 429)) throw err;
  };

  for (const { candidate, existing: match } of plan.matches) {
    if (options.signal?.aborted) {
      result.cancelled = true;
      break;
    }
    await step(candidate.name);
    done += 1;
    // Only when this browser knows the saved activity came from a less preferred source does a better one take over
    const knownRank = ledger.ranks[match.id];
    const takesOver = knownRank !== undefined && candidate.rank < knownRank;
    // Skip the download unless this recording could add heart rate or power, or is the preferred source
    if (ledger.merged.includes(candidate.id) || !(takesOver || couldAdd(activityHas(match), candidate))) {
      result.alreadyHave += 1;
      continue;
    }
    try {
      const full = (await dataService.getActivityById(match.id)) ?? match;
      const { activity: incoming } = await buildActivity(candidate, options.apiKey);
      // A preferred recording becomes the base; the one already saved only fills what it lacks
      const merged = takesOver ? mergeRecordings(incoming, full) : mergeRecordings(full, incoming);
      const changed = takesOver || merged.filled.length > 0;
      if (changed) {
        const saved = await dataService.updateActivity(match.id, recordingFields(merged.activity));
        const index = existing.findIndex((e) => e.id === match.id);
        if (index >= 0) existing[index] = { ...existing[index], ...saved };
        result.updated.push(saved);
        result.duplicatesHandled += 1;
        if (takesOver) ledger.ranks[match.id] = candidate.rank;
      } else {
        result.alreadyHave += 1;
      }
      ledger.merged.push(candidate.id);
    } catch (err) {
      rethrowFatal(err);
      result.failed.push({ name: candidate.name || candidate.id, error: err instanceof Error ? err.message : 'Merge failed.' });
    }
  }

  for (const group of plan.groups) {
    if (result.cancelled || options.signal?.aborted) {
      result.cancelled = true;
      break;
    }
    await step(group.primary.name);
    done += 1;
    try {
      let { activity, fromFile } = await buildActivity(group.primary, options.apiKey);
      // Other devices' recordings of the same workout: fold in what the primary lacks, count it once
      for (const extra of group.extras) {
        result.duplicatesHandled += 1;
        ledger.merged.push(extra.id);
        // Only worth downloading if it has heart rate or power that the activity built so far lacks
        if (!couldAdd(activityHas(activity), extra)) continue;
        try {
          const { activity: other } = await buildActivity(extra, options.apiKey);
          activity = mergeRecordings(activity, other).activity;
        } catch (err) {
          rethrowFatal(err);
          // The extra recording is optional; the primary is still worth saving
        }
      }
      // A recording without a UTC start couldn't be matched earlier; check again with the real start time
      if (existing.some((e) => isDuplicateActivity(activity, e))) {
        result.alreadyHave += 1;
        continue;
      }
      const saved = await dataService.addActivity(activity);
      existing.push(saved);
      result.imported.push(saved);
      ledger.ranks[saved.id] = group.primary.rank;
      ledger.merged.push(group.primary.id);
      if (!fromFile) result.summaryOnly += 1;
    } catch (err) {
      rethrowFatal(err);
      result.failed.push({ name: group.primary.name || group.primary.id, error: err instanceof Error ? err.message : 'Import failed.' });
    }
  }

  writeLedger(ledger);
  options.onProgress?.({ done: total, total });
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
  if (result.updated.length) parts.push(`${result.updated.length} improved with data from a second device`);
  if (result.duplicatesHandled) parts.push(`${result.duplicatesHandled} duplicate recording${result.duplicatesHandled === 1 ? '' : 's'} from other devices counted once`);
  if (result.alreadyHave) parts.push(`${result.alreadyHave} already in your log`);
  if (result.unsupported) parts.push(`${result.unsupported} of other sports skipped`);
  if (result.summaryOnly) parts.push(`${result.summaryOnly} imported without a recording file (no map or charts)`);
  if (result.failed.length) parts.push(`${result.failed.length} failed`);
  if (result.cancelled) parts.push('stopped early');
  return `${parts.join(', ')}.`;
}
