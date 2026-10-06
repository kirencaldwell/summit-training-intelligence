import type { Activity, AICoachMessage, AICoachToolCall, AthleteProfile, Goal, ProposedGoalAction, ProposedPlanAction, TrainingSession } from '../../types';
import { dataService } from '../supabase';
import { calculatePMC, calculatePowerCurve } from '../trainingMath';
import { coachRequestExtras } from '../coachSettings';
import { ftToM, kgToLb, kmToMi, mToFt, miToKm, roundTo } from '../units';

// The athlete works in imperial units. Data is stored metric, so everything sent to the model
// is converted here and named with its unit; the model's proposals are converted back below.
/** POST to /api/coach with the active provider's settings (Gemini via the server key, or the athlete's own Claude key). */
async function postCoach(body: Record<string, unknown>): Promise<string> {
  const extras = coachRequestExtras();
  const res = await fetch('/api/coach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extras.headers },
    body: JSON.stringify({ ...body, ...extras.body }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown server error' }));
    throw new Error(err.error || `Server returned ${res.status}`);
  }
  const { text } = await res.json();
  return text ?? '';
}

const kmToMiRounded = (km?: number) => (km ? roundTo(kmToMi(km), 1) : undefined);
const mToFtRounded = (m?: number) => (m ? Math.round(mToFt(m)) : undefined);

function goalForAI(goal?: Goal) {
  if (!goal) return goal;
  const { target_distance_km, target_elevation_m, ...rest } = goal;
  return {
    ...rest,
    target_distance_mi: kmToMiRounded(target_distance_km),
    target_elevation_ft: mToFtRounded(target_elevation_m),
  };
}

function profileForAI(profile: AthleteProfile | null) {
  if (!profile) return profile;
  const { weight_kg, ...rest } = profile;
  return { ...rest, weight_lb: weight_kg ? roundTo(kgToLb(weight_kg), 1) : null };
}

/** Imperial distance / climb / load fields for an activity. */
function activityUnitsForAI(a: Activity) {
  return {
    distance_mi: roundTo(kmToMi(a.distance_meters / 1000), 1),
    elevation_gain_ft: Math.round(mToFt(a.total_elevation_gain_m)),
  };
}

// ---------------------------------------------------------------------------
// Local data tools — gather context to send to the server-side Gemini proxy
// ---------------------------------------------------------------------------

function extractProposals(rawText: string, focusGoalId?: string): {
  cleanText: string;
  proposedPlan?: ProposedPlanAction;
  proposedGoal?: ProposedGoalAction;
} {
  if (!rawText) return { cleanText: '' };

  let cleanText = rawText;
  let proposedPlan: ProposedPlanAction | undefined;
  let proposedGoal: ProposedGoalAction | undefined;

  // Extract Goal proposal
  const goalRegex = /```(?:json:goal_proposal|json)\s*(\{[\s\S]*?"goal"[\s\S]*?\})\s*```/i;
  const goalMatch = rawText.match(goalRegex);
  if (goalMatch) {
    try {
      const parsed = JSON.parse(goalMatch[1]) as { summary?: string; goal: Goal; updates_goal_id?: string };
      if (parsed.goal && parsed.goal.name) {
        parsed.goal.id = parsed.goal.id || `goal-coach-${Date.now()}`;
        parsed.goal.status = parsed.goal.status || 'ACTIVE';
        parsed.goal.priority = parsed.goal.priority || 'A_RACE';
        parsed.goal.creator = 'coach';
        // The model proposes imperial targets; store metric like every other goal
        const imperial = parsed.goal as Goal & { target_distance_mi?: number; target_elevation_ft?: number };
        if (Number(imperial.target_distance_mi) > 0) {
          imperial.target_distance_km = roundTo(miToKm(Number(imperial.target_distance_mi)), 2);
        }
        if (Number(imperial.target_elevation_ft) > 0) {
          imperial.target_elevation_m = roundTo(ftToM(Number(imperial.target_elevation_ft)), 2);
        }
        delete imperial.target_distance_mi;
        delete imperial.target_elevation_ft;
        proposedGoal = {
          goal: parsed.goal,
          summary: parsed.summary || parsed.goal.objective_summary,
          // Only trust an update that targets the goal being discussed; anything else is a new goal
          updatesGoalId: focusGoalId && parsed.updates_goal_id === focusGoalId ? focusGoalId : undefined,
        };
        cleanText = cleanText.replace(goalMatch[0], '').trim();
      }
    } catch (err) {
      console.warn('Could not parse goal_proposal JSON block:', err);
    }
  }

  // Extract Plan proposal
  const planRegex = /```(?:json:plan_proposal|json)\s*(\{[\s\S]*?"sessions"[\s\S]*?\})\s*```/i;
  const planMatch = cleanText.match(planRegex);
  if (planMatch) {
    try {
      const parsed = JSON.parse(planMatch[1]) as ProposedPlanAction;
      if (Array.isArray(parsed.sessions) && parsed.sessions.length > 0) {
        parsed.sessions = parsed.sessions.map((s, idx) => ({
          id: s.id || `draft-${Date.now()}-${idx}`,
          week_start_date: s.week_start_date || getNextMonday(),
          session_date: s.session_date || getNextMonday(),
          title: s.title || 'Training Session',
          sport_type: s.sport_type || 'cycling',
          duration_minutes: Number(s.duration_minutes) || 60,
          focus: s.focus || 'Endurance Training',
          details: s.details || '',
          target_tss: s.target_tss ? Number(s.target_tss) : undefined,
          status: 'PROPOSED',
        }));
        proposedPlan = parsed;
        cleanText = cleanText.replace(planMatch[0], '').trim();
      }
    } catch (err) {
      console.warn('Could not parse plan_proposal JSON block:', err);
    }
  }

  return { cleanText, proposedPlan, proposedGoal };
}

async function gatherAthleteContext(focusGoalId?: string) {
  const [profileRes, activitiesRes, goalsRes, sessionsRes] = await Promise.allSettled([
    dataService.getProfile(),
    dataService.getActivities(),
    dataService.getGoals(),
    dataService.getTrainingSessions(),
  ]);

  const profile: AthleteProfile | null = profileRes.status === 'fulfilled' ? profileRes.value : null;

  const activities: Activity[] = activitiesRes.status === 'fulfilled' ? activitiesRes.value : [];
  const goals: Goal[] = goalsRes.status === 'fulfilled' ? goalsRes.value : [];
  const trainingSessions: TrainingSession[] = sessionsRes.status === 'fulfilled' ? sessionsRes.value : [];

  const pmcData = calculatePMC(activities, 30);
  const latestPmc = pmcData[pmcData.length - 1] || { ctl: 0, atl: 0, tsb: 0, tss: 0 };

  let formCategory = 'Optimal Training Window';
  if (latestPmc.tsb < -20) formCategory = 'High Fatigue Warning (Risk of Overreaching)';
  else if (latestPmc.tsb > 15) formCategory = 'Fresh & Tapered (Race Ready)';
  else if (latestPmc.tsb < -10) formCategory = 'Productive Overload Zone';

  const statusData = {
    profile: profileForAI(profile),
    pmc: { ...latestPmc, formCategory },
    injuries: profile?.injury_notes ?? [],
    routines: profile?.recovery_routines,
    nextGoal: goalForAI(goals[0]),
  };

  const recentActivities = activities.slice(0, 8).map(a => ({
    id: a.id,
    title: a.title,
    sport_type: a.sport_type,
    start_date: a.start_date,
    duration_minutes: Math.round(a.duration_seconds / 60),
    ...activityUnitsForAI(a),
    normalized_power: a.normalized_power,
    intensity_factor: a.intensity_factor,
    tss: a.training_stress_score,
    avg_hr: a.avg_hr,
    knee_discomfort_level: a.knee_discomfort_level,
  }));

  // A goal under discussion takes the place of the default priority goal in the readiness numbers
  const goal = (focusGoalId && goals.find(g => g.id === focusGoalId)) || goals.find(g => g.status === 'ACTIVE') || goals[0];
  const powerCurve = calculatePowerCurve(activities, profile?.weight_kg || undefined);
  const power20m = powerCurve.find(p => p.label === '20m')?.watts || 0;
  const targetW = goal?.target_power_watts || 0;

  const daysRemaining =
    goal?.target_date
      ? Math.max(
          0,
          Math.ceil(
            (new Date(goal.target_date).getTime() - new Date().getTime()) / (1000 * 3600 * 24)
          )
        )
      : null;

  const readinessScorePct = targetW > 0 && power20m > 0 ? Math.min(100, Math.round((power20m / targetW) * 100)) : null;
  const coachingAdvice =
    readinessScorePct === null
      ? null
      : readinessScorePct < 92
      ? 'Target 2x20m sweetspot/threshold efforts to lift 20m power closer to target.'
      : 'Power target is within reach! Prioritize event-specific simulation and injury management.';

  const milestoneData = { goal: goalForAI(goal), daysRemaining, powerCurve20m: power20m || null, targetPowerWatts: targetW || null, readinessScorePct, coachingAdvice };

  // Full (compact) dataset — the server filters this down to what the question needs
  const allActivities = activities.map(a => ({
    id: a.id,
    title: a.title,
    sport_type: a.sport_type,
    start_date: a.start_date,
    duration_minutes: Math.round(a.duration_seconds / 60),
    ...activityUnitsForAI(a),
    avg_power: a.avg_power,
    normalized_power: a.normalized_power,
    intensity_factor: a.intensity_factor,
    tss: a.training_stress_score,
    avg_hr: a.avg_hr,
    max_hr: a.max_hr,
    avg_vam_ft_per_hour: mToFtRounded(a.avg_vam_mh),
    pack_weight_lb: a.pack_weight_kg ? roundTo(kgToLb(a.pack_weight_kg), 1) : undefined,
    perceived_exertion: a.perceived_exertion,
    knee_discomfort_level: a.knee_discomfort_level,
    gear_notes: a.gear_notes,
    tags: a.tags,
  }));

  const focusGoal = focusGoalId && goal?.id === focusGoalId ? goalForAI(goal) : undefined;

  return { statusData, recentActivities, milestoneData, trainingSessions, allActivities, goals: goals.map(goalForAI), focusGoal };
}

/** Returns the next Monday as a YYYY-MM-DD string */
function getNextMonday(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((1 + 7 - d.getDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Gemini-powered Coach Engine (proxied through /api/coach serverless function)
// ---------------------------------------------------------------------------

class GeminiCoachEngine {
  /** Chat with the AI coach — key lives on the server, never in the bundle */
  public async processUserQuery(
    userQuery: string,
    previousMessages: AICoachMessage[] = [],
    focusGoalId?: string
  ): Promise<AICoachMessage> {
    const toolCalls: AICoachToolCall[] = [];

    // Gather all local context in a single unified step
    const { statusData, recentActivities, milestoneData, trainingSessions, allActivities, goals, focusGoal } =
      await gatherAthleteContext(focusGoalId);

    toolCalls.push(
      { toolName: 'getAthleteStatus', args: {}, result: statusData },
      { toolName: 'queryActivities', args: { limit: 8 }, result: recentActivities },
      { toolName: 'getMilestoneReadiness', args: {}, result: milestoneData }
    );

    // POST to /api/coach — provider keys never ship in the bundle (Gemini's lives on the server;
    // Claude uses the athlete's own key from Coach Settings, sent per request)
    const text = await postCoach({
      message: userQuery,
      // The goal being discussed/replanned, with its readiness, so the coach stays on it
      focusGoal: focusGoal ? { ...focusGoal, milestone_readiness: { ...milestoneData, goal: undefined } } : undefined,
      // Prior turns so the model keeps the conversation context (greeting/system/error msgs excluded)
      history: previousMessages
        .filter((m) => (m.sender === 'user' || m.sender === 'coach') && m.id !== 'init-msg' && !m.id.startsWith('err-'))
        .slice(-20)
        .map((m) => ({ role: m.sender === 'user' ? 'user' : 'model', text: m.text })),
      // Server-side cheap model filters this down before the main model sees it
      fullData: {
        athleteStatus: statusData,
        activities: allActivities,
        goals,
        milestoneReadiness: milestoneData,
        sessions: trainingSessions,
      },
    });

    const { cleanText, proposedPlan, proposedGoal } = extractProposals(text || '', focusGoal?.id);

    return {
      id: `coach-msg-${Date.now()}`,
      sender: 'coach',
      text: cleanText || 'No response received. Please try again.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      toolCalls,
      proposedPlan,
      proposedGoal,
    };
  }

  /**
   * Assess how a newly added activity fits the athlete's accepted training plan and goals.
   * Returns markdown; the caller persists it with the activity.
   */
  public async assessActivity(activity: Activity): Promise<string> {
    const [profile, activities, goals, sessions] = await Promise.all([
      dataService.getProfile(),
      dataService.getActivities(),
      dataService.getGoals(),
      dataService.getTrainingSessions(),
    ]);

    const dateOf = (iso: string) => iso.slice(0, 10);
    const activityDate = dateOf(activity.start_date);
    const dayMs = 24 * 3600 * 1000;
    const startMs = new Date(activity.start_date).getTime();

    // Make sure the activity itself is part of the load calculation even if the list is stale
    const withActivity = activities.some((a) => a.id === activity.id) ? activities : [activity, ...activities];
    const pmc = calculatePMC(withActivity, 120);
    const dayBefore = new Date(startMs - dayMs).toISOString().slice(0, 10);
    const pmcAfter = pmc.find((p) => p.date === activityDate);
    const pmcBefore = pmc.find((p) => p.date === dayBefore);

    const tssWithin = (days: number) =>
      Math.round(
        withActivity
          .filter((a) => {
            const t = new Date(a.start_date).getTime();
            return t <= startMs && t > startMs - days * dayMs;
          })
          .reduce((sum, a) => sum + (a.training_stress_score || 0), 0)
      );

    const compact = (a: Activity) => ({
      date: dateOf(a.start_date),
      title: a.title,
      sport_type: a.sport_type,
      duration_minutes: Math.round(a.duration_seconds / 60),
      ...activityUnitsForAI(a),
      tss: a.training_stress_score,
    });

    const context = {
      today: new Date().toISOString().slice(0, 10),
      profile: {
        ftp: profile.ftp || null,
        lthr: profile.lthr || null,
        max_hr: profile.max_hr || null,
        weight_lb: profile.weight_kg ? roundTo(kgToLb(profile.weight_kg), 1) : null,
        injury_notes: profile.injury_notes,
      },
      activity: {
        ...compact(activity),
        moving_time_minutes: Math.round(activity.moving_time_seconds / 60),
        avg_power: activity.avg_power,
        max_power: activity.max_power,
        normalized_power: activity.normalized_power,
        intensity_factor: activity.intensity_factor,
        avg_hr: activity.avg_hr,
        max_hr: activity.max_hr,
        avg_cadence: activity.avg_cadence,
        avg_vam_ft_per_hour: mToFtRounded(activity.avg_vam_mh),
        time_in_hr_zones_seconds: activity.time_in_hr_zones,
        time_in_power_zones_seconds: activity.time_in_power_zones,
        pack_weight_lb: activity.pack_weight_kg ? roundTo(kgToLb(activity.pack_weight_kg), 1) : undefined,
        perceived_exertion: activity.perceived_exertion,
        knee_discomfort_level: activity.knee_discomfort_level,
        gear_notes: activity.gear_notes,
        tags: activity.tags,
      },
      training_load: {
        before_activity: pmcBefore ? { ctl: pmcBefore.ctl, atl: pmcBefore.atl, tsb: pmcBefore.tsb } : null,
        after_activity: pmcAfter ? { ctl: pmcAfter.ctl, atl: pmcAfter.atl, tsb: pmcAfter.tsb, day_tss: pmcAfter.tss } : null,
        tss_last_7_days_including_this: tssWithin(7),
        tss_last_28_days_including_this: tssWithin(28),
      },
      active_goals: goals
        .filter((g) => g.status === 'ACTIVE')
        .map((g) => ({
          name: g.name,
          sport_type: g.sport_type,
          target_date: g.target_date,
          objective_summary: g.objective_summary,
          target_distance_mi: kmToMiRounded(g.target_distance_km),
          target_elevation_ft: mToFtRounded(g.target_elevation_m),
          target_power_watts: g.target_power_watts,
          periodization_phases: g.periodization_phases,
        })),
      // Only plans the athlete accepted count; proposed/declined sessions are not the plan
      accepted_training_sessions: sessions
        .filter((s) => (s.status === 'ACCEPTED' || s.status === 'COMPLETED')
          && Math.abs(new Date(`${s.session_date}T12:00:00Z`).getTime() - startMs) <= 7 * dayMs)
        .map((s) => ({
          date: s.session_date,
          title: s.title,
          sport_type: s.sport_type,
          duration_minutes: s.duration_minutes,
          focus: s.focus,
          details: s.details,
          target_tss: s.target_tss,
          status: s.status,
        })),
      previous_activities_28_days: withActivity
        .filter((a) => a.id !== activity.id && new Date(a.start_date).getTime() < startMs && new Date(a.start_date).getTime() >= startMs - 28 * dayMs)
        .slice(0, 20)
        .map(compact),
    };

    const text = await postCoach({
      mode: 'activity_assessment',
      message: 'Write the coach assessment for this new activity.',
      context,
    });
    if (!text) throw new Error('The coach returned an empty assessment.');
    return String(text).trim();
  }

  /** Generate or replan a proposed weekly training plan via the active coach model */
  public async generateWeeklyPlan(
    _occupiedDates: string[] = [],
    customInstructions?: string
  ): Promise<TrainingSession[]> {
    const { statusData, recentActivities, milestoneData, trainingSessions } = await gatherAthleteContext();

    const nextMonday = getNextMonday();
    const promptMessage = customInstructions
      ? `Generate a structured weekly training plan as a JSON array for next week (starting ${nextMonday}).
User replanning instructions / adjustments: "${customInstructions}"
Return ONLY a valid JSON array of TrainingSession objects with these exact fields:
{ id, week_start_date, session_date, title, sport_type, duration_minutes, focus, details, target_tss, status }
- week_start_date and session_date must be ISO date strings (YYYY-MM-DD)
- sport_type must be one of: cycling, zwift, skimo, backcountry_skiing, scrambling, weighted_hiking
- status must be "PROPOSED"
- Dates are flexible and open for replanning; plan 4-5 sessions across the week balancing training load with recovery
- Consider the athlete's current fitness, fatigue, injuries, and upcoming goals
Return only the JSON array, no markdown, no explanation.`
      : `Generate a structured weekly training plan as a JSON array.
Return ONLY a valid JSON array of TrainingSession objects with these exact fields:
{ id, week_start_date, session_date, title, sport_type, duration_minutes, focus, details, target_tss, status }
- week_start_date and session_date must be ISO date strings (YYYY-MM-DD) for next week (starting ${nextMonday})
- sport_type must be one of: cycling, zwift, skimo, backcountry_skiing, scrambling, weighted_hiking
- status must be "PROPOSED"
- Dates are flexible; plan 4-5 sessions across the week balancing training load with recovery
- Consider the athlete's current fitness, fatigue, injuries, and upcoming goals
Return only the JSON array, no markdown, no explanation.`;

    const text = await postCoach({
      message: promptMessage,
      context: {
        athleteStatus: statusData,
        recentActivities,
        milestoneReadiness: milestoneData,
        scheduledTrainingSessions: trainingSessions,
      },
      mode: 'json',
    });

    // Extract JSON array from the response (strip markdown fences if the model includes them)
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('Could not parse weekly plan from AI response.');

    const sessions: TrainingSession[] = JSON.parse(jsonMatch[0]);
    return sessions;
  }
}

export const coachEngine = new GeminiCoachEngine();
