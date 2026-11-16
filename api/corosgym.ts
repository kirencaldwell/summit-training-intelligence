/**
 * Puts a gym (strength) workout on the athlete's COROS account through the COROS Training Hub web API.
 * COROS's official MCP only takes running and cycling workouts, so this uses the same private API the COROS web app
 * uses (unofficial and undocumented, so it can change). Method and exercise catalog follow the MIT-licensed
 * rowlando/coros-workout-mcp project.
 *
 * Sign-in: the email and password are used once, in this request, to get a token; they are never stored or logged.
 * Only the token goes back to the athlete's browser. Logging in this way ends the athlete's COROS web session.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'node:crypto';

const HOSTS = { us: 'https://teamapi.coros.com', eu: 'https://teameuapi.coros.com' } as const;
type Region = keyof typeof HOSTS;
const TIMEOUT_MS = 20_000;
const DEFAULT_SOURCE_URL = 'https://d31oxp44ddzkyk.cloudfront.net/source/source_default/0/2fbd46e17bc54bc5873415c9fa767bdc.jpg';

interface Auth { accessToken: string; userId: string; region: Region }
interface CatalogExercise { id: string; name: string; codeName: string; [k: string]: any }

let catalog: CatalogExercise[] | undefined;
async function loadCatalog(req: VercelRequest): Promise<CatalogExercise[]> {
  if (catalog) return catalog;
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '');
  const proto = String(req.headers['x-forwarded-proto'] ?? 'https').split(',')[0];
  const res = await fetch(`${proto}://${host}/coros-exercises.json`);
  if (!res.ok) throw new Error('The COROS exercise list could not be loaded.');
  catalog = (await res.json()) as CatalogExercise[];
  return catalog;
}

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try { return await fetch(url, { ...init, signal: controller.signal }); } finally { clearTimeout(timer); }
}

async function api(auth: Auth, path: string, body: unknown): Promise<any> {
  const res = await timedFetch(`${HOSTS[auth.region]}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', accesstoken: auth.accessToken, yfheader: JSON.stringify({ userId: auth.userId }) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`COROS answered HTTP ${res.status}.`);
  const data = await res.json().catch(() => null);
  if (!data || data.result !== '0000') {
    const message = String(data?.message || data?.result || 'unknown error');
    if (/token|login|auth|expire/i.test(message)) throw new Error('unauthorized');
    throw new Error(`COROS refused it: ${message}`);
  }
  return data;
}

async function login(req: VercelRequest, res: VercelResponse) {
  const { email, password, region } = (req.body ?? {}) as { email?: unknown; password?: unknown; region?: unknown };
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) return res.status(400).json({ error: 'Enter your COROS email and password.' });
  const r: Region = region === 'us' ? 'us' : 'eu';
  try {
    const response = await timedFetch(`${HOSTS[r]}/account/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: email.slice(0, 200), accountType: 2, pwd: createHash('md5').update(password.slice(0, 200)).digest('hex') }),
    });
    const data: any = await response.json().catch(() => null);
    if (!data || data.result !== '0000') return res.status(401).json({ error: `COROS did not accept that sign-in${data?.message ? `: ${String(data.message).slice(0, 120)}` : ''}. Check the region (US or Europe) too.` });
    return res.status(200).json({ accessToken: String(data.data.accessToken), userId: String(data.data.userId), region: r });
  } catch {
    return res.status(502).json({ error: 'COROS could not be reached.' });
  }
}

interface ExerciseInput { name: string; sets?: number; reps?: number; duration_s?: number; weight_kg?: number; rest_s?: number }
const clampInt = (v: unknown, min: number, max: number): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : undefined);

function exercisePayload(e: CatalogExercise, sortNo: number, o: ExerciseInput) {
  let targetType = e.targetType, targetValue = e.targetValue;
  if (o.reps !== undefined) { targetType = 3; targetValue = o.reps; } else if (o.duration_s !== undefined) { targetType = 2; targetValue = o.duration_s; }
  let intensityType = e.intensityType, intensityValue = e.intensityValue;
  if (o.weight_kg !== undefined) { intensityType = 1; intensityValue = Math.round(o.weight_kg * 1000); }
  return {
    access: 0, animationId: e.animationId ?? 0, coverUrlArrStr: e.coverUrlArrStr, createTimestamp: e.createTimestamp, defaultOrder: 0,
    equipment: e.equipment, exerciseType: e.exerciseType, id: sortNo, intensityCustom: 0, intensityType, intensityValue, isDefaultAdd: 0, isGroup: false,
    isIntensityPercent: false, muscle: e.muscle, muscleRelevance: e.muscleRelevance || [], name: e.codeName, overview: e.overview, part: e.part,
    restType: 1, restValue: o.rest_s ?? e.restValue, sets: o.sets ?? e.sets, sortNo, sourceUrl: e.sourceUrl, sportType: 4, status: 1, targetType, targetValue,
    thumbnailUrl: e.thumbnailUrl, userId: 0, videoInfos: e.videoInfos, videoUrl: e.videoUrl, videoUrlArrStr: e.videoUrlArrStr, nameText: e.name,
    desc: e.desc, descText: e.desc, partText: e.partText, muscleText: e.muscleText, secondaryMuscleText: e.secondaryMuscleText, equipmentText: e.equipmentText,
    groupId: '', originId: e.id, targetDisplayUnit: 0, hrType: 0, intensityValueExtend: 0, intensityMultiplier: 0, intensityPercent: 0, intensityPercentExtend: 0, intensityDisplayUnit: '6',
  };
}

function workoutPayload(name: string, overview: string, exercises: unknown[]) {
  return {
    access: 1, authorId: '0', createTimestamp: 0, distance: 0, duration: 0, essence: 0, estimatedType: 0, estimatedValue: 0, exerciseNum: 0, exercises,
    headPic: '', id: '0', idInPlan: '0', name, nickname: '', originEssence: 0, overview, pbVersion: 2, planIdIndex: 0, poolLength: 2500, profile: '', referExercise: { intensityType: 1, hrType: 0, valueType: 1 },
    sex: 0, shareUrl: '', simple: false, sourceUrl: DEFAULT_SOURCE_URL, sportType: 4, star: 0, subType: 65535, targetType: 0, targetValue: 0, thirdPartyId: 0, totalSets: 0, trainingLoad: 0,
    type: 0, unit: 0, userId: '0', version: 0, videoCoverUrl: '', videoUrl: '', fastIntensityTypeName: 'weight', poolLengthId: 1, poolLengthUnit: 2, sourceId: '425868133463670784',
  };
}

const first = (d: Record<string, unknown>, ...keys: string[]) => { for (const k of keys) { const v = d[k]; if (typeof v === 'number' && Number.isFinite(v)) return v; } return 0; };

async function send(req: VercelRequest, res: VercelResponse) {
  const body = (req.body ?? {}) as { auth?: Partial<Auth>; name?: unknown; overview?: unknown; exercises?: unknown };
  const a = body.auth;
  if (!a || typeof a.accessToken !== 'string' || typeof a.userId !== 'string') return res.status(401).json({ error: 'unauthorized' });
  const auth: Auth = { accessToken: a.accessToken, userId: a.userId, region: a.region === 'us' ? 'us' : 'eu' };
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 60) : '';
  const overview = typeof body.overview === 'string' ? body.overview.trim().slice(0, 300) : '';
  const list = Array.isArray(body.exercises) ? (body.exercises as ExerciseInput[]).slice(0, 30) : [];
  if (!name || list.length === 0) return res.status(400).json({ error: 'The workout needs a name and at least one exercise.' });
  try {
    const cat = await loadCatalog(req);
    const byName = new Map(cat.map((e) => [e.name.toLowerCase(), e]));
    const payloads = list.map((raw, i) => {
      const e = byName.get(String(raw?.name ?? '').trim().toLowerCase());
      if (!e) throw new Error(`"${String(raw?.name).slice(0, 60)}" is not a COROS exercise.`);
      return exercisePayload(e, i + 1, {
        name: e.name, sets: clampInt(raw.sets, 1, 20), reps: clampInt(raw.reps, 1, 200), duration_s: clampInt(raw.duration_s, 1, 3600),
        weight_kg: typeof raw.weight_kg === 'number' && raw.weight_kg >= 0 && raw.weight_kg <= 500 ? raw.weight_kg : undefined, rest_s: clampInt(raw.rest_s, 0, 600),
      });
    });
    const calc = await api(auth, '/training/program/calculate', workoutPayload(name, overview, payloads));
    const src = (calc?.data ?? {}) as Record<string, unknown>;
    const duration = first(src, 'planDuration', 'duration'), totalSets = first(src, 'planSets', 'totalSets'), trainingLoad = first(src, 'planTrainingLoad', 'trainingLoad');
    await api(auth, '/training/program/add', { ...workoutPayload(name, overview, payloads), duration, totalSets, distance: '0', sets: totalSets, pitch: 0 });
    return res.status(200).json({ ok: true, duration, totalSets, trainingLoad });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not send the workout.';
    if (message === 'unauthorized') return res.status(401).json({ error: 'unauthorized' });
    return res.status(502).json({ error: message });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' });
  const action = String(req.query?.action ?? '');
  if (action === 'login') return login(req, res);
  if (action === 'send') return send(req, res);
  return res.status(400).json({ error: 'Unknown action.' });
}
