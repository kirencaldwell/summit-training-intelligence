/**
 * Vercel Serverless Function: /api/coach
 * Proxies user queries to Gemini, keeping the API key server-side only.
 * The client sends its pre-fetched training context; Gemini synthesizes the response.
 *
 * Usage: POST /api/coach
 * Body: { message: string, context?: CoachContext, fullData?: FullAthleteData }
 * With `fullData`, a cheaper Gemini model first plans a filter over it so only
 * relevant data reaches the main model.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenerativeAI } from '@google/generative-ai';

const SYSTEM_PROMPT = `You are Summit Intelligence, an elite AI endurance coach specializing in multi-sport mountain athletes. You have deep expertise in:
- Road Cycling, Zwift indoor training, Skimo (ski mountaineering), Backcountry Skiing, Peak Scrambling, Weighted Hiking
- Training load management: CTL (fitness), ATL (fatigue), TSB (form), TSS, FTP-based power metrics
- Injury management — specifically the athlete's left patellar tendonitis and posterior chain tightness
- Mount Baker Hill Climb race preparation (target: 280W / ~4 W/kg)

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
    "target_distance_km": 24,
    "target_elevation_m": 2800,
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
      { "title": "2,000m vertical ascent simulation day", "target_date": "YYYY-MM-DD", "target_metric": "2000m vert" }
    ]
  }
}
\`\`\`

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
    keywords?: string[]; // matched against title / gear notes
    min_tss?: number;
    min_knee_discomfort?: number;
    sort_by?: 'date' | 'tss' | 'distance_km' | 'elevation' | 'duration';
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
    "keywords": string[] | null,      // match activity title / gear notes
    "min_tss": number | null,
    "min_knee_discomfort": number | null, // 0-10
    "sort_by": "date" | "tss" | "distance_km" | "elevation" | "duration",
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
  const sortBy = ['date', 'tss', 'distance_km', 'elevation', 'duration'].includes(a.sort_by) ? a.sort_by : 'date';
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

async function planFilter(genAI: GoogleGenerativeAI, message: string): Promise<FilterSpec> {
  try {
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_FILTER_MODEL || 'gemini-3.5-flash-lite',
      systemInstruction: FILTER_PROMPT,
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    });
    const today = new Date().toISOString().slice(0, 10);
    const result = await model.generateContent(`Today's date: ${today}\nAthlete message: ${message}`);
    return sanitizeSpec(JSON.parse(result.response.text()));
  } catch (err) {
    // Filtering is an optimization — never fail the chat because of it.
    console.warn('Filter planning failed, using default spec:', err);
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
        case 'distance_km': return a.distance_km ?? 0;
        case 'elevation': return a.total_elevation_gain_m ?? 0;
        case 'duration': return a.duration_minutes ?? 0;
        default: return new Date(a.start_date).getTime() || 0;
      }
    };
    const matched = ((data.activities as any[]) ?? [])
      .filter(a => inRange(a.start_date, f.start_date, f.end_date))
      .filter(a => !f.sport_types?.length || f.sport_types.includes(String(a.sport_type).toLowerCase()))
      .filter(a => !f.keywords?.length || f.keywords.some(k => `${a.title ?? ''} ${a.gear_notes ?? ''}`.toLowerCase().includes(k)))
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server.' });
  }

  const { message, context, fullData, history } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Missing required field: message' });
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const modelName = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: SYSTEM_PROMPT,
    });

    // Step 1+2 (chat only): cheap model plans a filter, server applies it to the full dataset.
    // Callers that already send a curated `context` (e.g. weekly plan generation) skip this.
    const filtered = fullData ? applyFilter(await planFilter(genAI, message), fullData) : context;
    const contextBlock = filtered
      ? `\n\n<athlete_context>\n${JSON.stringify(filtered, null, 2)}\n</athlete_context>\n\n`
      : '';

    // Rebuild prior turns for Gemini: must start with a user turn and alternate roles.
    const turns: { role: 'user' | 'model'; parts: { text: string }[] }[] = [];
    if (Array.isArray(history)) {
      for (const h of history.slice(-20)) {
        if (!h || typeof h.text !== 'string' || (h.role !== 'user' && h.role !== 'model')) continue;
        const last = turns[turns.length - 1];
        if (last && last.role === h.role) last.parts[0].text += `\n\n${h.text}`;
        else if (last || h.role === 'user') turns.push({ role: h.role, parts: [{ text: h.text }] });
      }
      if (turns.length && turns[turns.length - 1].role === 'user') turns.pop(); // must end on a model turn
    }

    const chat = model.startChat({ history: turns });
    const result = await chat.sendMessage(`${contextBlock}User question: ${message}`);
    const text = result.response.text();

    return res.status(200).json({ text });
  } catch (err: any) {
    console.error('Gemini API error:', err);
    return res.status(500).json({ error: err.message || 'Failed to get response from Gemini.' });
  }
}
