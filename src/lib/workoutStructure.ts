/**
 * A planned session as structured steps (exercises with sets, reps and load; or intervals), instead of one block of
 * text. The AI only converts the coach's text into this shape; software validates it, and nothing in it is executed.
 */
import type { TrainingSession } from '../types';

export interface WorkoutItem {
  name: string;
  sets?: number;
  reps?: number;
  /** For timed work: seconds per set (or per effort) */
  duration_s?: number;
  distance_m?: number;
  /** Free text as the coach wrote it: "135 lb", "bodyweight", "Zone 2", "250 W", "RPE 7" */
  load?: string;
  rest_s?: number;
  notes?: string;
}

export interface WorkoutBlock {
  title: string;
  /** How many times the whole block is repeated (a circuit) */
  rounds?: number;
  items: WorkoutItem[];
}

export interface StructuredWorkout {
  name: string;
  kind: 'strength' | 'endurance';
  notes?: string;
  blocks: WorkoutBlock[];
}

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const whole = (v: unknown, min: number, max: number): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : undefined;
};

/** Reads the model's reply. Null unless there is at least one block with at least one named item. */
export function parseWorkout(raw: string): StructuredWorkout | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  let r: any;
  try { r = JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : raw); } catch { return null; }
  if (!r || typeof r !== 'object' || !Array.isArray(r.blocks)) return null;
  const blocks: WorkoutBlock[] = [];
  for (const b of r.blocks.slice(0, 12)) {
    if (!b || !Array.isArray(b.items)) continue;
    const items: WorkoutItem[] = [];
    for (const i of b.items.slice(0, 30)) {
      const name = text(i?.name, 80);
      if (!name) continue;
      const item: WorkoutItem = { name };
      const sets = whole(i.sets, 1, 20), reps = whole(i.reps, 1, 200), dur = whole(i.duration_s, 1, 36000), dist = whole(i.distance_m, 1, 500000), rest = whole(i.rest_s, 0, 1800);
      if (sets) item.sets = sets;
      if (reps) item.reps = reps;
      if (dur) item.duration_s = dur;
      if (dist) item.distance_m = dist;
      if (rest !== undefined) item.rest_s = rest;
      const load = text(i.load, 40), notes = text(i.notes, 200);
      if (load) item.load = load;
      if (notes) item.notes = notes;
      items.push(item);
    }
    if (items.length === 0) continue;
    const rounds = whole(b.rounds, 2, 20);
    blocks.push({ title: text(b.title, 60) || 'Main', ...(rounds ? { rounds } : {}), items });
  }
  if (blocks.length === 0) return null;
  const notes = text(r.notes, 300);
  return { name: text(r.name, 80) || 'Workout', kind: r.kind === 'strength' ? 'strength' : 'endurance', ...(notes ? { notes } : {}), blocks };
}

/** One line for an item, as written on a whiteboard: "Back squat  4 × 6 @ 135 lb · rest 2:00" */
export function itemLine(i: WorkoutItem): string {
  const amount = i.sets && i.reps ? `${i.sets} × ${i.reps}` : i.sets && i.duration_s ? `${i.sets} × ${fmtSeconds(i.duration_s)}` : i.reps ? `${i.reps} reps` : i.duration_s ? fmtSeconds(i.duration_s) : i.distance_m ? `${Math.round(i.distance_m)} m` : '';
  return [amount, i.load ? `@ ${i.load}` : ''].filter(Boolean).join(' ');
}
export const fmtSeconds = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`);

// Kept on this device, tied to the session text it was made from (an edited session needs a fresh one)
const KEY = 'summit_workout_structures';
const hashOf = (s: Pick<TrainingSession, 'title' | 'focus' | 'details' | 'duration_minutes'>) => [s.title, s.focus, s.details, s.duration_minutes].join('\u0001');

export function storedWorkout(session: TrainingSession): StructuredWorkout | undefined {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || '{}');
    const e = all[session.id];
    return e && e.hash === hashOf(session) ? (e.workout as StructuredWorkout) : undefined;
  } catch { return undefined; }
}
export function storeWorkout(session: TrainingSession, workout: StructuredWorkout) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || '{}');
    all[session.id] = { hash: hashOf(session), workout, at: Date.now() };
    const keep = Object.entries(all).sort((a: any, b: any) => b[1].at - a[1].at).slice(0, 80);
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(keep)));
  } catch { /* not kept */ }
}
