/**
 * What the coach carries from one conversation to the next, kept small on purpose: durable notes (injuries,
 * preferences, constraints) and the recent findings of its own assessments. Chat, weekly planning and assessments
 * read this instead of the raw history, so continuity costs a few hundred tokens rather than a long transcript.
 */
export type AssessmentVerdict = 'on_plan' | 'partly' | 'off_plan' | 'unplanned';

export interface AssessmentFinding {
  topic: string;
  detail: string;
  /** The measured numbers the finding rests on, quoted from the data the coach was given */
  evidence: string;
}

export interface StructuredAssessment {
  verdict: AssessmentVerdict;
  headline: string;
  findings: AssessmentFinding[];
  next_steps: string[];
  /** Durable facts the coach suggests keeping; the athlete decides */
  remember: string[];
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/**
 * Reads an assessment the model wrote as JSON. Returns null for anything else (older plain-text assessments), so
 * callers fall back to showing the text. The reply is only data: strings are cut to length and nothing is run.
 */
export function parseStructuredAssessment(raw: string | undefined | null): StructuredAssessment | null {
  if (!raw) return null;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let value: any;
  try { value = JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
  if (!value || typeof value !== 'object' || !Array.isArray(value.findings)) return null;
  const findings: AssessmentFinding[] = [];
  for (const f of value.findings.slice(0, 6)) {
    const topic = str(f?.topic, 60);
    const detail = str(f?.detail, 500);
    if (!topic || !detail) continue;
    findings.push({ topic, detail, evidence: str(f?.evidence, 300) });
  }
  const headline = str(value.headline, 300);
  if (!headline && findings.length === 0) return null;
  const verdict: AssessmentVerdict = ['on_plan', 'partly', 'off_plan', 'unplanned'].includes(value.verdict) ? value.verdict : 'unplanned';
  const list = (v: unknown, n: number, max: number) =>
    (Array.isArray(v) ? v : []).map((x) => str(x, max)).filter(Boolean).slice(0, n);
  return { verdict, headline, findings, next_steps: list(value.next_steps, 4, 300), remember: list(value.remember, 2, 200) };
}

export interface MemoryNote {
  id: string;
  text: string;
  at: string;
  from: 'athlete' | 'coach';
}

export interface MemoryFinding extends AssessmentFinding {
  date: string;
  source: 'activity' | 'session';
  /** What was assessed, e.g. the activity or session title */
  about: string;
  /** The activity or session id, so re-assessing replaces rather than duplicates */
  ref: string;
}

export interface CoachMemory {
  v: 1;
  notes: MemoryNote[];
  findings: MemoryFinding[];
  updated_at?: string;
}

export const EMPTY_MEMORY: CoachMemory = { v: 1, notes: [], findings: [] };
export const MAX_FINDINGS = 12;
export const MAX_NOTES = 20;

/** Tidies whatever was stored (or synced from another device) into a valid memory. */
export function readMemory(raw: unknown): CoachMemory {
  const m = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const notes = (Array.isArray(m.notes) ? m.notes : [])
    .map((n: any): MemoryNote | null => {
      const text = str(n?.text, 240);
      return text ? { id: str(n?.id, 40) || text.slice(0, 20), text, at: str(n?.at, 40), from: n?.from === 'coach' ? 'coach' : 'athlete' } : null;
    })
    .filter((n): n is MemoryNote => n !== null)
    .slice(-MAX_NOTES);
  const findings = (Array.isArray(m.findings) ? m.findings : [])
    .map((f: any): MemoryFinding | null => {
      const topic = str(f?.topic, 60);
      const detail = str(f?.detail, 500);
      const ref = str(f?.ref, 60);
      if (!topic || !detail || !ref) return null;
      return { topic, detail, evidence: str(f?.evidence, 300), date: str(f?.date, 10), source: f?.source === 'session' ? 'session' : 'activity', about: str(f?.about, 100), ref };
    })
    .filter((f): f is MemoryFinding => f !== null)
    .slice(-MAX_FINDINGS);
  return { v: 1, notes, findings, updated_at: typeof m.updated_at === 'string' ? m.updated_at : undefined };
}

/** Adds an assessment's findings to the memory, replacing any earlier ones for the same activity or session. */
export function addFindings(
  memory: CoachMemory,
  assessment: StructuredAssessment,
  from: { source: 'activity' | 'session'; ref: string; about: string; date: string },
): CoachMemory {
  const kept = memory.findings.filter((f) => f.ref !== from.ref);
  const added: MemoryFinding[] = assessment.findings.slice(0, 3).map((f) => ({ ...f, ...from }));
  return { ...memory, findings: [...kept, ...added].slice(-MAX_FINDINGS), updated_at: new Date().toISOString() };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Suggestions the athlete has not already saved. */
export function newSuggestions(memory: CoachMemory, suggestions: string[]): string[] {
  const have = memory.notes.map((n) => norm(n.text));
  return suggestions.filter((s) => {
    const n = norm(s);
    return n && !have.some((h) => h === n || h.includes(n) || n.includes(h));
  });
}

export function addNote(memory: CoachMemory, text: string, from: MemoryNote['from']): CoachMemory {
  const clean = str(text, 240);
  if (!clean || newSuggestions(memory, [clean]).length === 0) return memory;
  const note: MemoryNote = { id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, text: clean, at: new Date().toISOString(), from };
  return { ...memory, notes: [...memory.notes, note].slice(-MAX_NOTES), updated_at: new Date().toISOString() };
}

export const removeNote = (memory: CoachMemory, id: string): CoachMemory =>
  ({ ...memory, notes: memory.notes.filter((n) => n.id !== id), updated_at: new Date().toISOString() });

export const clearFindings = (memory: CoachMemory): CoachMemory =>
  ({ ...memory, findings: [], updated_at: new Date().toISOString() });

/** The few hundred tokens the coach reads: durable notes and the latest findings. Undefined when there is nothing. */
export function memoryForAI(memory: CoachMemory | undefined) {
  if (!memory || (memory.notes.length === 0 && memory.findings.length === 0)) return undefined;
  return {
    notes: memory.notes.map((n) => n.text),
    recent_findings: memory.findings.slice(-8).map((f) => ({ date: f.date, about: f.about, topic: f.topic, detail: f.detail, evidence: f.evidence || undefined })),
  };
}
