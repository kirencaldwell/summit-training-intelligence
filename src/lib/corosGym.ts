/**
 * Gym workouts on COROS. COROS's official MCP takes only running and cycling workouts, so strength workouts go through
 * the COROS Training Hub web API (via /api/corosgym). The AI only matches exercise names to COROS's own list; software
 * checks every name against that list and converts the numbers.
 */
import type { StructuredWorkout } from './workoutStructure';

const AUTH_KEY = 'summit_coros_gym_auth';
export interface GymAuth { accessToken: string; userId: string; region: 'us' | 'eu' }

export function readGymAuth(): GymAuth | null {
  try {
    const a = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
    return a && typeof a.accessToken === 'string' && typeof a.userId === 'string' ? { accessToken: a.accessToken, userId: a.userId, region: a.region === 'us' ? 'us' : 'eu' } : null;
  } catch { return null; }
}
export function clearGymAuth() { try { localStorage.removeItem(AUTH_KEY); } catch { /* ignore */ } }

async function post<T>(action: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/corosgym?action=${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && data?.error === 'unauthorized') { clearGymAuth(); throw new Error('The COROS sign-in has expired. Sign in again.'); }
    throw new Error(typeof data?.error === 'string' ? data.error : `COROS request failed (HTTP ${res.status}).`);
  }
  return data as T;
}

/** The password goes to the server once to get a token and is not kept anywhere; only the token is stored on this device. */
export async function gymLogin(email: string, password: string, region: 'us' | 'eu'): Promise<GymAuth> {
  const auth = await post<GymAuth>('login', { email, password, region });
  try { localStorage.setItem(AUTH_KEY, JSON.stringify(auth)); } catch { /* signed in for this visit only */ }
  return auth;
}

export interface GymExercise { source: string; name: string; sets?: number; reps?: number; duration_s?: number; weight_kg?: number; /** The same load in pounds, as the athlete wrote it, for display */ weight_lb?: number; rest_s?: number }
export interface GymPlan { exercises: GymExercise[]; unmatched: string[] }

interface CatalogName { n: string; m: string; q: string }
let catalogNames: CatalogName[] | undefined;
async function loadCatalogNames(): Promise<CatalogName[]> {
  if (catalogNames) return catalogNames;
  const res = await fetch('/coros-exercise-names.json');
  if (!res.ok) throw new Error('The COROS exercise list could not be loaded.');
  catalogNames = (await res.json()) as CatalogName[];
  return catalogNames;
}
export async function gymExerciseNames(): Promise<string[]> {
  return (await loadCatalogNames()).map((e) => e.n);
}

// What the athlete's own notes say they have; the list is cut to those (plus bodyweight) when the notes say anything
const EQUIPMENT_WORDS: [RegExp, string[]][] = [
  [/dumbbell|\bdb\b/i, ['Dumbbells']],
  [/barbell|squat rack|power rack|olympic/i, ['Barbells']],
  [/kettlebell|\bkb\b/i, ['Kettlebell']],
  [/\bbands?\b|resistance band/i, ['Bands']],
  [/bench/i, ['Bench']],
  [/medicine ball|med ball/i, ['Medicine Ball']],
  [/bosu/i, ['Bosu Ball']],
  [/exercise ball|swiss ball|stability ball/i, ['Exercise Ball']],
  [/foam roll/i, ['Foam Roller']],
];
const FULL_GYM = /full gym|commercial gym|gym membership|\bgym equipment|machines?|cables?/i;

/** COROS exercise names the athlete can do with what they have; every name when their notes don't say. */
export async function exercisesForAthlete(notes: string): Promise<string[]> {
  const all = await loadCatalogNames();
  if (FULL_GYM.test(notes)) return all.map((e) => e.n);
  const allowed = new Set<string>(['Bodyweight']);
  let any = false;
  for (const [re, kinds] of EQUIPMENT_WORDS) if (re.test(notes)) { any = true; kinds.forEach((k) => allowed.add(k)); }
  if (!any) return all.map((e) => e.n);
  const known = new Set(['Dumbbells', 'Gym Equipment', 'Medicine Ball', 'Barbells', 'Bosu Ball', 'Kettlebell', 'Bench', 'Bands', 'Exercise Ball', 'Foam Roller', 'Bodyweight']);
  return all.filter((e) => e.q.split(',').map((k) => k.trim()).filter(Boolean).every((k) => allowed.has(k) || !known.has(k))).map((e) => e.n);
}

const num = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : undefined);

/** Reads the coach's matches; keeps only exercises whose name exists in COROS's list, and converts pounds to kilograms. */
export function parseGymPlan(raw: string, list: string[]): GymPlan | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  let r: any;
  try { r = JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : raw); } catch { return null; }
  if (!r || !Array.isArray(r.exercises)) return null;
  const byLower = new Map(list.map((n) => [n.toLowerCase(), n]));
  const exercises: GymExercise[] = [];
  const unmatched: string[] = [];
  for (const e of r.exercises.slice(0, 30)) {
    const source = typeof e?.source === 'string' ? e.source.trim().slice(0, 80) : '';
    const exact = typeof e?.name === 'string' ? byLower.get(e.name.trim().toLowerCase()) : undefined;
    if (!exact) { if (source) unmatched.push(source); continue; }
    const item: GymExercise = { source: source || exact, name: exact };
    const sets = num(e.sets, 1, 20), reps = num(e.reps, 1, 200), dur = num(e.duration_s, 1, 3600), rest = num(e.rest_s, 0, 600);
    if (sets) item.sets = sets;
    if (dur && !reps) item.duration_s = dur; else if (reps) item.reps = reps;
    if (rest !== undefined) item.rest_s = rest;
    if (typeof e.weight_lb === 'number' && e.weight_lb > 0 && e.weight_lb <= 1000) { item.weight_kg = Math.round(e.weight_lb * 0.45359237 * 100) / 100; item.weight_lb = Math.round(e.weight_lb * 10) / 10; }
    exercises.push(item);
  }
  return exercises.length ? { exercises, unmatched } : null;
}

export function sendGymWorkout(workout: StructuredWorkout, plan: GymPlan): Promise<{ ok: boolean; duration: number; totalSets: number; trainingLoad: number }> {
  const auth = readGymAuth();
  if (!auth) return Promise.reject(new Error('Sign in to COROS first.'));
  return post('send', { auth, name: workout.name.slice(0, 60), overview: (workout.notes ?? '').slice(0, 300), exercises: plan.exercises.map(({ source: _s, weight_lb: _w, ...e }) => e) });
}
