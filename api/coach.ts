/**
 * Vercel Serverless Function: /api/coach
 * Proxies user queries to Gemini, keeping the API key server-side only.
 * The client sends its pre-fetched training context; Gemini synthesizes the response.
 *
 * Usage: POST /api/coach
 * Body: { message: string, context?: CoachContext, fullData?: FullAthleteData, history?: Turn[], mode?: 'activity_assessment' }
 * With `fullData`, a cheaper Gemini model first plans a filter over it so only
 * relevant data reaches the main model.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';

// Claude responses with thinking + big plan JSON can take a while
export const config = { maxDuration: 60 };

// ---------------------------------------------------------------------------
// Provider abstraction. Gemini uses the server's GEMINI_API_KEY. Claude uses a key the
// athlete supplies in the app (sent per request in the x-anthropic-key header, never stored
// or logged), so nobody else can spend the account owner's Claude tokens.
// ---------------------------------------------------------------------------

const CLAUDE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5'];
const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';
// Small, cheap model for the data-filter planning step
const CLAUDE_FILTER_MODEL = 'claude-haiku-4-5';

type Turn = { role: 'user' | 'model'; text: string };

type Engine =
  | { provider: 'gemini'; genAI: GoogleGenerativeAI }
  | { provider: 'claude'; client: Anthropic; model: string };

interface CompleteRequest {
  system: string;
  turns?: Turn[];
  user: string;
  /** 'filter' = cheap JSON-planning model, 'main' = the coach */
  tier: 'main' | 'filter';
}

/** Prior turns must start with a user turn, alternate roles and end on a model turn (both APIs). */
function sanitizeTurns(history: unknown): Turn[] {
  const turns: Turn[] = [];
  if (Array.isArray(history)) {
    for (const h of history.slice(-20)) {
      if (!h || typeof h.text !== 'string' || (h.role !== 'user' && h.role !== 'model')) continue;
      const last = turns[turns.length - 1];
      if (last && last.role === h.role) last.text += `\n\n${h.text}`;
      else if (last || h.role === 'user') turns.push({ role: h.role, text: h.text });
    }
    if (turns.length && turns[turns.length - 1].role === 'user') turns.pop();
  }
  return turns;
}

function claudeText(response: { content: Array<{ type: string; text?: string }> }): string {
  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('')
    .trim();
}

async function complete(engine: Engine, req: CompleteRequest): Promise<string> {
  const turns = req.turns ?? [];

  if (engine.provider === 'gemini') {
    if (req.tier === 'filter') {
      const model = engine.genAI.getGenerativeModel({
        model: process.env.GEMINI_FILTER_MODEL || 'gemini-3.5-flash-lite',
        systemInstruction: req.system,
        generationConfig: { responseMimeType: 'application/json', temperature: 0 },
      });
      return (await model.generateContent(req.user)).response.text();
    }
    const model = engine.genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
      systemInstruction: req.system,
    });
    const chat = model.startChat({
      history: turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
    });
    return (await chat.sendMessage(req.user)).response.text();
  }

  const messages: Anthropic.MessageParam[] = [
    ...turns.map((t): Anthropic.MessageParam => ({ role: t.role === 'model' ? 'assistant' : 'user', content: t.text })),
    { role: 'user', content: req.user },
  ];

  if (req.tier === 'filter') {
    const response = await engine.client.messages.create({
      model: CLAUDE_FILTER_MODEL,
      max_tokens: 1024,
      temperature: 0,
      system: `${req.system}\n\nReturn only the raw JSON object: no markdown fences, no commentary.`,
      messages,
    });
    return claudeText(response);
  }

  const params = {
    model: engine.model,
    max_tokens: 16000,
    system: req.system,
    messages,
    // Thinking is always on for these models; medium keeps coaching replies responsive
    output_config: { effort: 'medium' as const },
  };

  let response;
  try {
    // Refusal fallback: if a safety classifier declines, the API re-runs on the server-defined fallback model
    response = await engine.client.beta.messages.create({
      ...params,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
  } catch (err) {
    // The fallback beta is an optimization; if it's not accepted for this key, retry without it
    if (err instanceof Anthropic.BadRequestError) {
      response = await engine.client.messages.create(params);
    } else {
      throw err;
    }
  }

  if (response.stop_reason === 'refusal') {
    throw new Error('Claude declined to answer this request. Try rephrasing it.');
  }
  return claudeText(response);
}

const ASSESSMENT_PROMPT = `You are Summit Intelligence, an elite endurance coach. The athlete just added a new activity. Write the coach's assessment of it, grounded ONLY in the JSON context provided (athlete profile, the activity, training load, active goals, and accepted/completed training sessions).

Cover, in this order, using short markdown sections:
**How it fits the plan** — compare against the accepted/completed sessions around that date and against the active goals and their phases. Say plainly whether it matched a planned session (and how closely: sport, duration, TSS, intensity), replaced one, or was unplanned. If there are no accepted sessions or no goals, say so; do not invent a plan or a goal.
**What stands out** — call out specific numbers from this activity (duration, TSS, IF, NP, HR, time in zones, VAM, elevation, pack weight, perceived exertion, discomfort ratings) and, for each, why it matters for fitness: what adaptation it drives (aerobic base, threshold, VO2, muscular endurance, climbing specific) and what it costs in fatigue. Use the CTL/ATL/TSB before and after to explain the load impact.
**Next steps** — 1 to 3 concrete suggestions for the next days given the load and the plan. Respect any injury notes in the profile.

Rules: be specific and quantitative, never generic; only reference data that is present, and state when something needed for a judgment is missing (for example no power data, no thresholds set). Keep it under 250 words. Do not output JSON or proposal blocks.

Units: the athlete uses imperial units. All distances, elevations, weights and speeds in the context are already imperial (distance_mi, elevation_gain_ft, weight_lb, pack_weight_lb, avg_vam_ft_per_hour). Write miles, feet, pounds and mph; never convert to metric.`;

const SYSTEM_PROMPT = `You are Summit Intelligence, an elite AI endurance coach specializing in multi-sport mountain athletes. You have deep expertise in:
- Road Cycling, Zwift indoor training, Skimo (ski mountaineering), Backcountry Skiing, Peak Scrambling, Weighted Hiking
- Training load management: CTL (fitness), ATL (fatigue), TSB (form), TSS, FTP-based power metrics
- Injury management — work only from the injuries and health notes the athlete has listed in their profile
- Units: the athlete uses imperial units. All data you receive is already imperial (distance_mi, elevation_gain_ft, weight_lb, pack_weight_lb, avg_vam_ft_per_hour) — respond in miles, feet, pounds and mph, never metric. (W/kg stays as the standard power-to-weight ratio.)
- Preparing for the specific goals and events the athlete has added; never assume a goal, injury, threshold or fitness level that is not in the provided data

The user will provide their current training data as JSON context, including their profile, current PMC metrics, recent activities, milestone readiness, and current scheduledTrainingSessions.

### Training Plan, Long-Term Goals & Workout Proposals:
When the user asks you to:
1. Create or set up a LONG-TERM goal, macro-cycle, or multi-week preparation plan (e.g. "Prepare for Mount Rainier in 12 weeks", "Build a macro plan to hit 300W FTP", "Set up a 3-month skimo racing goal"):
   -> Append a structured \`json:goal_proposal\` block at the end of your response:
\`\`\`json:goal_proposal
{
  "summary": "1-line summary of the long-term plan",
  "goal": {
    "name": "Goal Name (e.g. Mount Rainier Alpine Push)",
    "sport_type": "cycling" | "zwift" | "skimo" | "backcountry_skiing" | "scrambling" | "weighted_hiking" | "general",
    "target_date": "YYYY-MM-DD",
    "timeframe_text": "12-Week Progressive Build (Spring 2027)",
    "objective_summary": "Comprehensive description of the target objective",
    "target_distance_mi": 15,
    "target_elevation_ft": 9000,
    "target_power_watts": 285,
    "priority": "A_RACE",
    "status": "ACTIVE",
    "creator": "coach",
    "periodization_phases": [
      {
        "name": "Phase 1: Aerobic Base & Muscular Endurance",
        "focus": "Zone 2 foundation volume + low-cadence climbing force",
        "weeks": 4,
        "target_ctl": 75,
        "status": "CURRENT"
      },
      {
        "name": "Phase 2: Threshold & Vertical Ascent Overload",
        "focus": "Sweetspot climbing intervals + weekend vert volume",
        "weeks": 4,
        "target_ctl": 85,
        "status": "UPCOMING"
      },
      {
        "name": "Phase 3: Event-Specific Peak Simulation",
        "focus": "Simulated race pace / target gradient efforts",
        "weeks": 3,
        "target_ctl": 95,
        "status": "UPCOMING"
      },
      {
        "name": "Phase 4: Taper & Race Readiness",
        "focus": "50% volume reduction, maintain short sharp efforts, TSB >+10",
        "weeks": 1,
        "target_ctl": 88,
        "status": "UPCOMING"
      }
    ],
    "milestones": [
      { "title": "Mid-block 20m power test >275W", "target_date": "YYYY-MM-DD", "target_metric": "275W" },
      { "title": "6,500 ft vertical ascent simulation day", "target_date": "YYYY-MM-DD", "target_metric": "6500 ft vert" }
    ]
  }
}
\`\`\`

When the context includes a <focus_goal> block, the conversation is about that single goal. Keep every answer about it: how the athlete is tracking (use the milestone readiness, load and recent activities), what to change, and why. If the athlete asks to replan, adjust, re-time, or rebuild it, do NOT create a new goal: append a \`json:goal_proposal\` block as above with the COMPLETE updated goal (every field, including all phases and milestones, not just the changes), and add a top-level field "updates_goal_id" set to the focus_goal's id. Phase weeks must fit before the target date, and past/completed phases should keep status "COMPLETED". If they only want to discuss or are asking a question, answer in prose with no block.

2. Create, replan, or modify specific WEEKLY workout sessions (e.g. "plan next week", "replan Wednesday", "add weekend skimo"):
   -> Append a structured \`json:plan_proposal\` block at the end of your response:
\`\`\`json:plan_proposal
{
  "type": "CREATE" | "UPDATE" | "REPLACE_WEEK" | "DELETE",
  "summary": "Short 1-line description of the proposed changes",
  "weekStartDate": "YYYY-MM-DD",
  "sessions": [
    {
      "id": "draft-1",
      "week_start_date": "YYYY-MM-DD",
      "session_date": "YYYY-MM-DD",
      "title": "Workout Title",
      "sport_type": "cycling" | "zwift" | "skimo" | "backcountry_skiing" | "scrambling" | "weighted_hiking",
      "duration_minutes": 60,
      "focus": "Main focus (e.g. Sweetspot, Active Recovery, VAM Climbing)",
      "details": "Specific structured interval breakdown or instructions",
      "target_tss": 55,
      "status": "PROPOSED"
    }
  ]
}
\`\`\`

IMPORTANT RULES:
- Workout dates and days are NEVER permanently blocked or denied. Any day can be used, rescheduled, or replanned.
- If the user asks a general question without creating/modifying/replanning goals or workouts, do NOT include any json proposal block.
- Keep markdown coaching commentary concise and actionable (under 300 words).`;

// ---------------------------------------------------------------------------
// Step 1: a cheap model turns the user's request into a structured filter spec.
// We deliberately use a declarative spec (not model-written code) that the server
// executes deterministically against the full dataset.
// ---------------------------------------------------------------------------

interface FilterSpec {
  include_profile: boolean;
  include_pmc: boolean;
  include_goals: boolean;
  include_milestone: boolean;
  activities: {
    include: boolean;
    start_date?: string; // YYYY-MM-DD
    end_date?: string;
    sport_types?: string[];
    keywords?: string[]; // matched against title / gear notes / tags
    min_tss?: number;
    min_knee_discomfort?: number;
    sort_by?: 'date' | 'tss' | 'distance_mi' | 'elevation' | 'duration';
    limit?: number;
  };
  sessions: {
    include: boolean;
    start_date?: string;
    end_date?: string;
  };
}

const DEFAULT_SPEC: FilterSpec = {
  include_profile: true,
  include_pmc: true,
  include_goals: true,
  include_milestone: true,
  activities: { include: true, sort_by: 'date', limit: 8 },
  sessions: { include: true },
};

const FILTER_PROMPT = `You are a data-retrieval planner for an endurance coaching app. Given the athlete's message, decide which slices of their stored data a coach needs to answer well. Output ONLY a JSON object, no prose, with this shape:
{
  "include_profile": boolean,   // FTP, weight, HR zones, injuries, recovery routines
  "include_pmc": boolean,       // current CTL/ATL/TSB fitness-fatigue-form
  "include_goals": boolean,     // long-term goals and periodization phases
  "include_milestone": boolean, // readiness vs. the target event (20m power, days remaining)
  "activities": {
    "include": boolean,
    "start_date": "YYYY-MM-DD" | null,
    "end_date": "YYYY-MM-DD" | null,
    "sport_types": string[] | null,   // from: cycling, zwift, skimo, backcountry_skiing, scrambling, weighted_hiking
    "keywords": string[] | null,      // match activity title / gear notes / athlete tags
    "min_tss": number | null,
    "min_knee_discomfort": number | null, // 0-10
    "sort_by": "date" | "tss" | "distance_mi" | "elevation" | "duration",
    "limit": number                   // max activities, keep as small as the question allows (max 50)
  },
  "sessions": { "include": boolean, "start_date": "YYYY-MM-DD" | null, "end_date": "YYYY-MM-DD" | null }
}
Rules:
- Be selective: exclude anything irrelevant to the message. Planning or scheduling requests need sessions, goals, pmc and profile plus recent activities (last ~3 weeks).
- Questions about fatigue/readiness need pmc and recent activities. Injury questions need profile and activities with knee discomfort.
- Resolve relative dates ("last month", "this week") using today's date.
- If the message is vague, fall back to the most recent ~8 activities.`;

function asDate(v: unknown): string | undefined {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
}

function sanitizeSpec(raw: any): FilterSpec {
  const a = raw?.activities ?? {};
  const s = raw?.sessions ?? {};
  const strList = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0).map(x => x.toLowerCase()) : undefined;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const sortBy = ['date', 'tss', 'distance_mi', 'elevation', 'duration'].includes(a.sort_by) ? a.sort_by : 'date';
  return {
    include_profile: raw?.include_profile !== false,
    include_pmc: raw?.include_pmc !== false,
    include_goals: raw?.include_goals !== false,
    include_milestone: raw?.include_milestone !== false,
    activities: {
      include: a.include !== false,
      start_date: asDate(a.start_date),
      end_date: asDate(a.end_date),
      sport_types: strList(a.sport_types),
      keywords: strList(a.keywords),
      min_tss: num(a.min_tss),
      min_knee_discomfort: num(a.min_knee_discomfort),
      sort_by: sortBy,
      limit: Math.min(50, Math.max(1, Math.round(num(a.limit) ?? 8))),
    },
    sessions: { include: s.include !== false, start_date: asDate(s.start_date), end_date: asDate(s.end_date) },
  };
}

async function planFilter(engine: Engine, message: string): Promise<FilterSpec> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const raw = await complete(engine, {
      tier: 'filter',
      system: FILTER_PROMPT,
      user: `Today's date: ${today}\nAthlete message: ${message}`,
    });
    // Tolerate stray prose or fences around the JSON object
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    return sanitizeSpec(JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : raw));
  } catch (err) {
    // Filtering is an optimization — never fail the chat because of it.
    console.warn('Filter planning failed, using default spec:', err instanceof Error ? err.message : 'unknown error');
    return DEFAULT_SPEC;
  }
}

const inRange = (date: string | undefined, start?: string, end?: string) => {
  if (!date) return true;
  const d = date.slice(0, 10);
  return (!start || d >= start) && (!end || d <= end);
};

function applyFilter(spec: FilterSpec, data: any) {
  const out: Record<string, unknown> = {};
  const status = data.athleteStatus ?? {};

  if (spec.include_profile) out.profile = status.profile;
  if (spec.include_pmc) out.pmc = status.pmc;
  if (spec.include_profile) {
    out.injuries = status.injuries;
    out.routines = status.routines;
  }
  if (spec.include_goals) {
    out.goals = data.goals;
  }
  if (spec.include_milestone) out.milestoneReadiness = data.milestoneReadiness;

  if (spec.activities.include) {
    const f = spec.activities;
    const key = (a: any): number => {
      switch (f.sort_by) {
        case 'tss': return a.tss ?? 0;
        case 'distance_mi': return a.distance_mi ?? 0;
        case 'elevation': return a.elevation_gain_ft ?? 0;
        case 'duration': return a.duration_minutes ?? 0;
        default: return new Date(a.start_date).getTime() || 0;
      }
    };
    const matched = ((data.activities as any[]) ?? [])
      .filter(a => inRange(a.start_date, f.start_date, f.end_date))
      .filter(a => !f.sport_types?.length || f.sport_types.includes(String(a.sport_type).toLowerCase()))
      .filter(a => !f.keywords?.length || f.keywords.some(k => `${a.title ?? ''} ${a.gear_notes ?? ''} ${(a.tags ?? []).join(' ')}`.toLowerCase().includes(k)))
      .filter(a => f.min_tss === undefined || (a.tss ?? 0) >= f.min_tss)
      .filter(a => f.min_knee_discomfort === undefined || (a.knee_discomfort_level ?? 0) >= f.min_knee_discomfort)
      .sort((a, b) => key(b) - key(a));
    out.activities = { totalMatching: matched.length, items: matched.slice(0, f.limit) };
  }

  if (spec.sessions.include) {
    out.scheduledTrainingSessions = ((data.sessions as any[]) ?? []).filter(s =>
      inRange(s.session_date, spec.sessions.start_date, spec.sessions.end_date)
    );
  }
  return out;
}

function buildEngine(req: VercelRequest, res: VercelResponse): Engine | null {
  const body = req.body ?? {};

  if (body.provider === 'claude') {
    const header = req.headers['x-anthropic-key'];
    const apiKey = (Array.isArray(header) ? header[0] : header)?.trim();
    if (!apiKey || !apiKey.startsWith('sk-ant-')) {
      res.status(400).json({ error: 'Missing or invalid Anthropic API key. Add it in Coach Settings.' });
      return null;
    }
    const model = CLAUDE_MODELS.includes(body.claudeModel) ? body.claudeModel : DEFAULT_CLAUDE_MODEL;
    return { provider: 'claude', client: new Anthropic({ apiKey, maxRetries: 1 }), model };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'GEMINI_API_KEY not configured on server.' });
    return null;
  }
  return { provider: 'gemini', genAI: new GoogleGenerativeAI(apiKey) };
}

function sendError(res: VercelResponse, err: unknown) {
  if (err instanceof Anthropic.AuthenticationError) {
    return res.status(401).json({ error: 'Anthropic rejected your API key. Check it in Coach Settings.' });
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return res.status(403).json({ error: 'Your Anthropic key is not allowed to use this model. Try another model in Coach Settings.' });
  }
  if (err instanceof Anthropic.RateLimitError) {
    return res.status(429).json({ error: 'Anthropic rate limit reached. Wait a moment and try again.' });
  }
  if (err instanceof Anthropic.APIError) {
    return res.status(502).json({ error: `Claude API error (${err.status ?? 'network'}): ${err.message}` });
  }
  const message = err instanceof Error ? err.message : 'Failed to get a response from the coach.';
  // Log only the message: errors from the provider SDKs can carry request details
  console.error('Coach error:', message);
  return res.status(500).json({ error: message });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const engine = buildEngine(req, res);
  if (!engine) return;

  const { message, context, fullData, history, mode, focusGoal } = req.body;

  try {
    // Key check from the settings screen: a tiny, cheap call that proves the key works
    if (mode === 'ping') {
      if (engine.provider !== 'claude') return res.status(200).json({ ok: true });
      await engine.client.messages.create({
        model: CLAUDE_FILTER_MODEL,
        max_tokens: 8,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
      });
      return res.status(200).json({ ok: true });
    }

    if (!message) {
      return res.status(400).json({ error: 'Missing required field: message' });
    }

    // Single-shot activity assessment: the client sends a curated context, no chat history or filtering
    if (mode === 'activity_assessment') {
      if (!context) return res.status(400).json({ error: 'Missing required field: context' });
      const text = await complete(engine, {
        tier: 'main',
        system: ASSESSMENT_PROMPT,
        user: `<activity_context>\n${JSON.stringify(context, null, 2)}\n</activity_context>\n\n${message}`,
      });
      return res.status(200).json({ text });
    }

    // Step 1+2 (chat only): cheap model plans a filter, server applies it to the full dataset.
    // Callers that already send a curated `context` (e.g. weekly plan generation) skip this.
    let spec: FilterSpec | undefined;
    if (fullData) {
      spec = await planFilter(engine, message);
      if (focusGoal) {
        // Goal discussions always need the full picture: profile, load, goals, readiness, plan and recent training
        spec.include_profile = spec.include_pmc = spec.include_goals = spec.include_milestone = true;
        spec.sessions.include = true;
        spec.activities.include = true;
        spec.activities.limit = Math.max(spec.activities.limit ?? 0, 15);
      }
    }
    const filtered = spec ? applyFilter(spec, fullData) : context;
    const contextBlock = filtered
      ? `\n\n<athlete_context>\n${JSON.stringify(filtered, null, 2)}\n</athlete_context>\n\n`
      : '';
    const focusBlock = focusGoal
      ? `<focus_goal>\n${JSON.stringify(focusGoal, null, 2)}\n</focus_goal>\n\n`
      : '';

    const text = await complete(engine, {
      tier: 'main',
      system: SYSTEM_PROMPT,
      turns: sanitizeTurns(history),
      user: `${contextBlock}${focusBlock}User question: ${message}`,
    });

    return res.status(200).json({ text });
  } catch (err) {
    return sendError(res, err);
  }
}
