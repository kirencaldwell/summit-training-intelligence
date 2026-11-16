/**
 * Editing one planned session with the coach: the athlete says what they want changed, the coach rewrites the session,
 * software keeps it within sane bounds and the athlete decides whether to apply it. The AI's reply is data only.
 */
import type { TrainingSession } from '../types';
import type { SessionEdit } from './morningCheck';

export interface SessionEditProposal {
  edit: SessionEdit;
  /** What the coach says about the change, in its own words */
  reply: string;
  /** Software notes on the result, for example a much harder session */
  warnings: string[];
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[ \t]+/g, ' ').trim().slice(0, max) : '');
const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : undefined);

export function parseSessionEdit(original: TrainingSession, raw: string): SessionEditProposal | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  let r: any;
  try { r = JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : raw); } catch { return null; }
  if (!r || typeof r !== 'object') return null;
  const warnings: string[] = [];
  const minutes = Math.max(10, Math.min(480, int(r.duration_minutes) ?? original.duration_minutes));
  const tssRaw = int(r.target_tss);
  const tss = tssRaw === undefined ? original.target_tss : Math.max(0, Math.min(400, tssRaw));
  const edit: SessionEdit = {
    title: text(r.title, 100) || original.title,
    duration_minutes: minutes,
    target_tss: tss,
    focus: text(r.focus, 80) || original.focus,
    details: text(r.details, 2500) || original.details,
  };
  if (original.target_tss && tss !== undefined && tss > original.target_tss * 1.3 && tss - original.target_tss >= 15) warnings.push(`Harder than planned: ${original.target_tss} → ${tss} TSS.`);
  if (minutes > original.duration_minutes * 1.3 && minutes - original.duration_minutes >= 20) warnings.push(`Longer than planned: ${original.duration_minutes} → ${minutes} min.`);
  const same = edit.title === original.title && edit.duration_minutes === original.duration_minutes && edit.target_tss === original.target_tss && edit.focus === original.focus && edit.details === original.details;
  return { edit, reply: text(r.reply, 500) || (same ? 'No change was needed.' : 'Here is the updated session.'), warnings: same ? [] : warnings };
}

export const isSameEdit = (a: SessionEdit, b: SessionEdit) =>
  a.title === b.title && a.duration_minutes === b.duration_minutes && a.target_tss === b.target_tss && a.focus === b.focus && a.details === b.details;
