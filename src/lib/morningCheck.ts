import type { TrainingSession } from '../types';
import type { ReadinessFacts, ReadinessSnapshot } from './readiness';
import { getLocalDateString } from './trainingSessions';

/**
 * The morning check: how recovered the athlete is today (worked out in software from COROS's sleep, HRV, resting heart
 * rate and recovery against their own norms), and what that allows. The coach only ever writes an easier version of
 * today's session; the limits here decide whether an easier session is wanted at all and how far it may go.
 */
export type ReadinessLevel = 'good' | 'low' | 'poor' | 'unknown';

export interface ReadinessAssessment {
  level: ReadinessLevel;
  /** Points of concern: 0-1 good, 2-3 low, 4 or more poor */
  concern: number;
  /** In plain words, for the athlete and the coach */
  reasons: string[];
  /** How many separate signals could be judged */
  signals: number;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : undefined;
};

/** Judges today's facts against the athlete's own recent days (`history`: earlier snapshots, any order). */
export function assessReadiness(facts: ReadinessFacts, history: ReadinessSnapshot[] = [], today = getLocalDateString()): ReadinessAssessment {
  const past = history.filter((s) => s.date < today).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14);
  let concern = 0;
  let signals = 0;
  const reasons: string[] = [];
  const flag = (points: number, text: string) => { concern += points; reasons.push(text); };

  if (facts.sleep_hours !== undefined) {
    signals += 1;
    if (facts.sleep_hours < 5) flag(2, `only ${facts.sleep_hours} h of sleep`);
    else if (facts.sleep_hours < 6) flag(1, `${facts.sleep_hours} h of sleep, short`);
  }
  if (facts.sleep_score !== undefined) {
    signals += 1;
    if (facts.sleep_score < 50) flag(2, `a poor sleep score (${facts.sleep_score})`);
    else if (facts.sleep_score < 65) flag(1, `a middling sleep score (${facts.sleep_score})`);
  }
  if (facts.hrv_ms !== undefined) {
    const own = median(past.map((s) => s.facts.hrv_ms).filter((v): v is number => v !== undefined));
    const base = facts.hrv_baseline_ms ?? (past.length >= 5 ? own : undefined);
    if (base) {
      signals += 1;
      const ratio = facts.hrv_ms / base;
      if (ratio < 0.75) flag(2, `HRV ${facts.hrv_ms} ms, well under your usual ${Math.round(base)}`);
      else if (ratio < 0.88) flag(1, `HRV ${facts.hrv_ms} ms, under your usual ${Math.round(base)}`);
    }
  }
  if (facts.resting_hr !== undefined) {
    const own = median(past.map((s) => s.facts.resting_hr).filter((v): v is number => v !== undefined));
    if (past.length >= 5 && own !== undefined) {
      signals += 1;
      const up = facts.resting_hr - own;
      if (up >= 8) flag(2, `resting heart rate ${facts.resting_hr}, ${Math.round(up)} above your usual`);
      else if (up >= 5) flag(1, `resting heart rate ${facts.resting_hr}, ${Math.round(up)} above your usual`);
    }
  }
  if (facts.recovery_pct !== undefined) {
    signals += 1;
    if (facts.recovery_pct < 30) flag(2, `recovery only ${facts.recovery_pct}%`);
    else if (facts.recovery_pct < 50) flag(1, `recovery ${facts.recovery_pct}%`);
  }
  // COROS's own words, when no figure said as much
  if (signals === 0 || concern === 0) {
    const bad = facts.notes.find((n) => /(low|poor|bad|tired|fatigu|exhaust|strained|overreach)/i.test(n.split(':')[1] ?? ''));
    if (bad) { signals += 1; flag(2, `COROS rates it as ${bad.split(':')[1].trim().toLowerCase()}`); }
  }

  const level: ReadinessLevel = signals === 0 ? 'unknown' : concern >= 4 ? 'poor' : concern >= 2 ? 'low' : 'good';
  return { level, concern, reasons, signals };
}

/** How far the session may be eased at each level: the least and the most that count as a real adjustment. */
export const EASE_LIMITS: Record<'low' | 'poor', { scale: number; floorScale: number }> = {
  low: { scale: 0.75, floorScale: 0.55 },
  poor: { scale: 0.5, floorScale: 0.2 },
};

export interface SessionEdit {
  title: string;
  duration_minutes: number;
  target_tss?: number;
  focus: string;
  details: string;
}

export interface ProposedEdit extends SessionEdit {
  /** keep: no change wanted; ease: the same session, lighter; rest: only a short easy spin or walk */
  decision: 'keep' | 'ease' | 'rest';
  reason: string;
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : undefined);

/**
 * Turns the coach's reply into an edit that is safe to apply: never longer or harder than the original, never
 * a different sport, within what the level allows. A reply that does not ease enough is eased by the level's default.
 * Returns null when no change is wanted (or the reply was unusable).
 */
export function validateEdit(original: TrainingSession, raw: string, level: 'low' | 'poor'): ProposedEdit | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  let r: any;
  try { r = JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : raw); } catch { return null; }
  if (!r || typeof r !== 'object') return null;
  const decision: ProposedEdit['decision'] = r.decision === 'rest' ? 'rest' : r.decision === 'ease' ? 'ease' : 'keep';
  if (decision === 'keep') return null;

  const limits = EASE_LIMITS[level];
  const origTss = original.target_tss ?? Math.round(original.duration_minutes * 0.8);
  const origMin = original.duration_minutes;
  // Rest is the easiest a session can get: a short, very light spin or walk
  let minutes = decision === 'rest' ? Math.min(30, origMin) : int(r.duration_minutes) ?? Math.round(origMin * limits.scale);
  let tss = decision === 'rest' ? Math.round(origTss * 0.1) : int(r.target_tss) ?? Math.round(origTss * limits.scale);
  minutes = Math.max(15, Math.min(origMin, minutes));
  tss = Math.max(0, Math.min(origTss, tss));
  if (decision === 'ease') {
    // Not eased enough to matter: use the level's default; eased past the floor: stop at the floor
    if (tss > origTss * 0.9 && minutes > origMin * 0.9) { tss = Math.round(origTss * limits.scale); minutes = Math.max(15, Math.round(origMin * limits.scale)); }
    tss = Math.max(tss, Math.round(origTss * limits.floorScale));
  }
  const details = text(r.details, 1200) || original.details;
  return {
    decision,
    title: text(r.title, 100) || original.title,
    duration_minutes: minutes,
    target_tss: original.target_tss === undefined && !int(r.target_tss) ? undefined : tss,
    focus: text(r.focus, 80) || original.focus,
    details,
    reason: text(r.reason, 400) || 'Easier today because of how recovered you are.',
  };
}

// ── What was done, kept on this device ──────────────────────────────────────────────────────────────────

export interface MorningRecord {
  /** The day this was decided */
  date: string;
  session_id: string;
  level: ReadinessLevel;
  reasons: string[];
  /** The coach's reason in a sentence or two */
  reason: string;
  /** applied: the session was changed (undo possible); proposed: waiting for the athlete; kept/undone: no change stands */
  status: 'applied' | 'proposed' | 'kept' | 'undone';
  original: SessionEdit;
  proposed: SessionEdit;
}

const RECORDS_KEY = 'summit_morning_records';
const AUTO_KEY = 'summit_morning_auto';
const CHECKED_KEY = 'summit_morning_checked';

export function readRecords(): Record<string, MorningRecord> {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECORDS_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeRecord(record: MorningRecord) {
  try {
    const all = readRecords();
    all[record.session_id] = record;
    const keep = Object.values(all).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40);
    localStorage.setItem(RECORDS_KEY, JSON.stringify(Object.fromEntries(keep.map((r) => [r.session_id, r]))));
  } catch { /* storage unavailable: the change itself is saved with the session */ }
}

export const recordFor = (sessionId: string, date = getLocalDateString()): MorningRecord | undefined => {
  const r = readRecords()[sessionId];
  return r && r.date === date ? r : undefined;
};

/** Whether tweaks are applied by themselves (the default) or only suggested. */
export const morningAutoApply = (): boolean => {
  try { return localStorage.getItem(AUTO_KEY) !== 'off'; } catch { return true; }
};
export function setMorningAutoApply(on: boolean) {
  try { if (on) localStorage.removeItem(AUTO_KEY); else localStorage.setItem(AUTO_KEY, 'off'); } catch { /* ignore */ }
}

/** The check runs once a day on this device. */
export const morningCheckedToday = (date = getLocalDateString()): boolean => {
  try { return localStorage.getItem(CHECKED_KEY) === date; } catch { return false; }
};
export function markMorningChecked(date = getLocalDateString()) {
  try { localStorage.setItem(CHECKED_KEY, date); } catch { /* ignore */ }
}

/** The sessions today's check applies to: planned for today, accepted, not yet done. */
export const sessionsForToday = (sessions: TrainingSession[], today = getLocalDateString()) =>
  sessions.filter((s) => s.session_date === today && s.status === 'ACCEPTED');

export const sessionEdit = (s: Pick<TrainingSession, 'title' | 'duration_minutes' | 'target_tss' | 'focus' | 'details'>): SessionEdit => ({
  title: s.title, duration_minutes: s.duration_minutes, target_tss: s.target_tss, focus: s.focus, details: s.details,
});
