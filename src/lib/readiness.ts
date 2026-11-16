import { CorosError, listCorosTools, queryCoros, type CorosTool } from './coros';
import { addDaysToDateOnly, getLocalDateString } from './trainingSessions';

/**
 * Sleep and recovery from COROS, for the coach. The tools' replies are read defensively: the raw text of every reply is
 * kept next to the figures picked out of it, so what the app understood can always be checked against what COROS said.
 */
export interface ReadinessFacts {
  sleep_hours?: number;
  sleep_score?: number;
  hrv_ms?: number;
  hrv_baseline_ms?: number;
  resting_hr?: number;
  recovery_pct?: number;
  /** Words COROS used for a status or trend ("Low", "Balanced"...), as found */
  notes: string[];
}

export interface ReadinessSnapshot {
  date: string;
  fetched_at: string;
  /** What each tool answered (cut to a length the coach can read) */
  raw: Record<string, string>;
  facts: ReadinessFacts;
  /** Tools that failed, with why */
  errors: Record<string, string>;
}

const STORE_KEY = 'summit_readiness';
const TOOLS_KEY = 'summit_coros_tools';
const KEEP_DAYS = 45;
const RAW_CAP = 8000;

/** The COROS queries worth asking, in order; only those the server actually offers are called. */
export const READINESS_TOOLS = ['queryRecoveryStatus', 'querySleepOverview', 'querySleepHrv', 'queryRestingHeartRate', 'queryDailyHealthData', 'queryTrainingLoadAssessment'];

// ── Storage ────────────────────────────────────────────────────────────────────────────────────────────

export function readSnapshots(): Record<string, ReadinessSnapshot> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveSnapshot(s: ReadinessSnapshot) {
  try {
    const all = readSnapshots();
    all[s.date] = s;
    const keep = Object.keys(all).sort().slice(-KEEP_DAYS);
    localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(keep.map((k) => [k, all[k]]))));
  } catch { /* storage unavailable: the snapshot lasts for this visit only */ }
}

export const snapshotFor = (date = getLocalDateString()): ReadinessSnapshot | undefined => readSnapshots()[date];

// ── Reading what COROS says ───────────────────────────────────────────────────────────────────────────

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

const dateKeys = /^(date|day|happenday|calendarday|dt|time|timestamp|start_?time)$/i;
const compact = (d: string) => d.replace(/-/g, '');

/** The value of a record's date field as YYYYMMDD, when it has one. */
function recordDay(rec: Record<string, unknown>): string | undefined {
  for (const [k, v] of Object.entries(rec)) {
    if (!dateKeys.test(k)) continue;
    if (typeof v === 'string' && /\d{4}-?\d{2}-?\d{2}/.test(v)) return compact(/\d{4}-?\d{2}-?\d{2}/.exec(v)![0]);
    if (typeof v === 'number' && v > 19000101 && v < 21001231) return String(v);
    if (typeof v === 'number' && v > 1e9) return compact(getLocalDateString(new Date(v > 1e12 ? v : v * 1000)));
  }
  return undefined;
}

interface Leaf { key: string; path: string; value: unknown }

/** Flattens a reply into key/value leaves; lists of dated records keep only today's (else the latest) record. */
function leaves(value: unknown, today: string, path = '', out: Leaf[] = [], depth = 0): Leaf[] {
  if (out.length > 600 || depth > 7) return out;
  if (Array.isArray(value)) {
    const objs = value.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object' && !Array.isArray(x));
    const dated = objs.map((o) => ({ o, day: recordDay(o) })).filter((x) => x.day);
    if (dated.length > 0) {
      const t = compact(today);
      const exact = dated.find((x) => x.day === t);
      const pick = exact ?? dated.sort((a, b) => (a.day! < b.day! ? 1 : -1))[0];
      return leaves(pick.o, today, path, out, depth + 1);
    }
    value.slice(0, 40).forEach((x, i) => leaves(x, today, `${path}[${i}]`, out, depth + 1));
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) leaves(v, today, path ? `${path}.${k}` : k, out, depth + 1);
    return out;
  }
  out.push({ key: path.split('.').pop() ?? path, path, value });
  return out;
}

const hoursFrom = (v: number): number | undefined => {
  // Seconds, minutes or hours: whichever reading gives a believable night
  const h = v > 1500 ? v / 3600 : v > 24 ? v / 60 : v;
  return h >= 2 && h <= 14 ? Math.round(h * 10) / 10 : undefined;
};

/** Picks the figures the coach needs out of everything COROS replied. */
export function extractReadiness(raw: Record<string, string>, today = getLocalDateString()): ReadinessFacts {
  const facts: ReadinessFacts = { notes: [] };
  const set = <K extends keyof ReadinessFacts>(k: K, v: ReadinessFacts[K]) => { if (facts[k] === undefined && v !== undefined) facts[k] = v; };
  for (const text of Object.values(raw)) {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { parsed = undefined; }
    if (parsed !== undefined) {
      for (const { path, key, value } of leaves(parsed, today)) {
        const name = `${path}`.toLowerCase();
        const n = num(value);
        if (n !== undefined) {
          if (/hrv|rmssd|heartratevariability/.test(name) && /baseline|normal|usual|mean|weekly|7.?day|seven/.test(name)) { if (n >= 5 && n <= 300) set('hrv_baseline_ms', Math.round(n)); }
          else if (/hrv|rmssd|heartratevariability/.test(name) && !/min|max|range|status|level|trend/.test(name)) { if (n >= 5 && n <= 300) set('hrv_ms', Math.round(n)); }
          else if (/sleep/.test(name) && /score|quality/.test(name)) { if (n >= 0 && n <= 100) set('sleep_score', Math.round(n)); }
          else if (/sleep/.test(name) && /(duration|total|time|hours|minutes|seconds|length)/.test(name) && !/(deep|light|rem|awake|nap|start|end|bed|wake)/.test(name)) { set('sleep_hours', hoursFrom(n)); }
          else if (/(rest(ing)?_?(hr|heart)|rhr|restingheartrate)/.test(name)) { if (n >= 30 && n <= 110) set('resting_hr', Math.round(n)); }
          else if (/recover/.test(name) && !/(time|hour|minute|second|remain|full)/.test(name)) { if (n >= 0 && n <= 100) set('recovery_pct', Math.round(n)); }
        } else if (typeof value === 'string' && value.length > 0 && value.length <= 40 && /(status|state|level|label|trend|evaluation|assessment)/.test(key.toLowerCase()) && /(hrv|sleep|recover|fatigue|readiness|stamina)/.test(name)) {
          if (!facts.notes.includes(`${key}: ${value}`) && facts.notes.length < 6) facts.notes.push(`${key}: ${value}`);
        }
      }
    } else {
      // Plain text: look for the usual labels followed by a number
      const m = (re: RegExp) => { const x = re.exec(text); return x ? num(x[1]) : undefined; };
      const hrv = m(/\bHRV\b[^0-9\n]{0,20}(\d{2,3})/i); if (hrv && hrv >= 5 && hrv <= 300) set('hrv_ms', hrv);
      const rhr = m(/resting\s*(?:heart\s*rate|hr)[^0-9\n]{0,20}(\d{2,3})/i); if (rhr && rhr >= 30 && rhr <= 110) set('resting_hr', rhr);
      const rec = m(/recovery[^0-9\n]{0,20}(\d{1,3})\s*%/i); if (rec !== undefined && rec <= 100) set('recovery_pct', rec);
    }
  }
  return facts;
}

// ── Asking COROS ──────────────────────────────────────────────────────────────────────────────────────

/** Arguments for a query from its published schema: date ranges as the tool describes them, nothing it does not take. */
export function argsFor(tool: CorosTool, range: { start: string; end: string; today: string }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, p] of Object.entries(tool.inputSchema?.properties ?? {})) {
    const dashed = /yyyy-MM-dd/i.test(p?.description ?? '');
    const fmt = (d: string) => (dashed ? d : compact(d));
    if (/^(start|from|begin)/i.test(name) || /start.?date/i.test(name)) out[name] = fmt(range.start);
    else if (/^(end|to)(date|day)?$/i.test(name) || /end.?date/i.test(name)) out[name] = fmt(range.end);
    else if (/^(date|day)$/i.test(name) || /^(query|target)?(date|day)$/i.test(name)) out[name] = fmt(range.today);
  }
  return out;
}

async function corosTools(): Promise<CorosTool[]> {
  try {
    const cached = JSON.parse(localStorage.getItem(TOOLS_KEY) || 'null') as { at: number; tools: CorosTool[] } | null;
    if (cached && Date.now() - cached.at < 24 * 3600 * 1000 && Array.isArray(cached.tools)) return cached.tools;
  } catch { /* fetch below */ }
  const tools = await listCorosTools();
  try { localStorage.setItem(TOOLS_KEY, JSON.stringify({ at: Date.now(), tools })); } catch { /* not cached */ }
  return tools;
}

/** Fetches today's sleep and recovery from COROS and keeps the snapshot. Throws CorosError when not connected. */
export async function refreshReadiness(today = getLocalDateString()): Promise<ReadinessSnapshot> {
  const tools = await corosTools();
  const wanted = READINESS_TOOLS.map((name) => tools.find((t) => t.name === name)).filter((t): t is CorosTool => Boolean(t));
  if (wanted.length === 0) throw new CorosError('COROS did not offer any sleep or recovery queries this app knows.');
  const range = { start: addDaysToDateOnly(today, -13), end: today, today };
  const results = await queryCoros(wanted.map((t) => ({ tool: t.name, args: argsFor(t, range) })));
  const raw: Record<string, string> = {};
  const errors: Record<string, string> = {};
  for (const r of results) {
    if (r.ok) raw[r.tool] = r.text.slice(0, RAW_CAP); else errors[r.tool] = r.text.slice(0, 300);
  }
  const snapshot: ReadinessSnapshot = { date: today, fetched_at: new Date().toISOString(), raw, facts: extractReadiness(raw, today), errors };
  saveSnapshot(snapshot);
  return snapshot;
}

/** One line for the coach and the brief: "Slept 6.4 h, HRV 48 ms (baseline 62), recovery 41%". */
export function readinessLine(f: ReadinessFacts): string {
  const parts: string[] = [];
  if (f.sleep_hours !== undefined) parts.push(`slept ${f.sleep_hours} h${f.sleep_score !== undefined ? ` (score ${f.sleep_score})` : ''}`);
  else if (f.sleep_score !== undefined) parts.push(`sleep score ${f.sleep_score}`);
  if (f.hrv_ms !== undefined) parts.push(`HRV ${f.hrv_ms} ms${f.hrv_baseline_ms !== undefined ? ` (baseline ${f.hrv_baseline_ms})` : ''}`);
  if (f.resting_hr !== undefined) parts.push(`resting HR ${f.resting_hr}`);
  if (f.recovery_pct !== undefined) parts.push(`recovery ${f.recovery_pct}%`);
  return parts.join(', ');
}
