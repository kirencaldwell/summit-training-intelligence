import type { Activity, AICoachMessage, AICoachToolCall, AthleteProfile, Goal, TrainingSession } from '../../types';
import { dataService } from '../supabase';
import { calculatePMC, calculatePowerCurve } from '../trainingMath';

// ---------------------------------------------------------------------------
// Local data tools — gather context to send to the server-side Gemini proxy
// ---------------------------------------------------------------------------

async function gatherAthleteContext(goalName: string = 'Mount Baker') {
  const [profileRes, activitiesRes, goalsRes, sessionsRes] = await Promise.allSettled([
    dataService.getProfile(),
    dataService.getActivities(),
    dataService.getGoals(),
    dataService.getTrainingSessions(),
  ]);

  const profile: AthleteProfile = profileRes.status === 'fulfilled' ? profileRes.value : {
    id: 'local-athlete',
    full_name: 'Endurance Athlete',
    ftp: 285,
    max_hr: 192,
    lthr: 172,
    weight_kg: 70.5,
    injury_notes: ['Left patellar tendonitis (active awareness on >12% grades)', 'Posterior chain tightness'],
    recovery_routines: {
      wednesday: 'Decompression Night (Mid-week reset: foam roll, hamstring stretch, isometric knee extensions)',
      sunday: 'Decompression Night (End-of-week reset: full lower body mobility, hip flexor release, light walk)',
    },
  };

  const activities: Activity[] = activitiesRes.status === 'fulfilled' ? activitiesRes.value : [];
  const goals: Goal[] = goalsRes.status === 'fulfilled' ? goalsRes.value : [];
  const trainingSessions: TrainingSession[] = sessionsRes.status === 'fulfilled' ? sessionsRes.value : [];

  const pmcData = calculatePMC(activities, 30);
  const latestPmc = pmcData[pmcData.length - 1] || { ctl: 65, atl: 70, tsb: -5, tss: 0 };

  let formCategory = 'Optimal Training Window';
  if (latestPmc.tsb < -20) formCategory = 'High Fatigue Warning (Risk of Overreaching)';
  else if (latestPmc.tsb > 15) formCategory = 'Fresh & Tapered (Race Ready)';
  else if (latestPmc.tsb < -10) formCategory = 'Productive Overload Zone';

  const statusData = {
    profile,
    pmc: { ...latestPmc, formCategory },
    injuries: profile.injury_notes,
    routines: profile.recovery_routines,
    nextGoal: goals[0],
  };

  const recentActivities = activities.slice(0, 8).map(a => ({
    id: a.id,
    title: a.title,
    sport_type: a.sport_type,
    start_date: a.start_date,
    duration_minutes: Math.round(a.duration_seconds / 60),
    distance_km: Number((a.distance_meters / 1000).toFixed(1)),
    total_elevation_gain_m: a.total_elevation_gain_m,
    normalized_power: a.normalized_power,
    intensity_factor: a.intensity_factor,
    tss: a.training_stress_score,
    avg_hr: a.avg_hr,
    knee_discomfort_level: a.knee_discomfort_level,
  }));

  const goal = goals.find(g => g.name.toLowerCase().includes(goalName.toLowerCase())) || goals[0];
  const powerCurve = calculatePowerCurve(activities, profile.weight_kg);
  const point20m = powerCurve.find(p => p.label === '20m')?.watts || 275;
  const targetW = goal?.target_power_watts || 280;

  const daysRemaining =
    goal && goal.target_date
      ? Math.max(
          0,
          Math.ceil(
            (new Date(goal.target_date).getTime() - new Date().getTime()) / (1000 * 3600 * 24)
          )
        )
      : 42;

  const readinessScorePct = Math.min(100, Math.round((point20m / targetW) * 100));
  const coachingAdvice =
    readinessScorePct < 92
      ? 'Target 2x20m sweetspot/threshold efforts to lift 20m power closer to target.'
      : 'Power target is within reach! Prioritize grade-specific climbing simulation and knee health management.';

  const milestoneData = { goal, daysRemaining, powerCurve20m: point20m, targetPowerWatts: targetW, readinessScorePct, coachingAdvice };

  return { statusData, recentActivities, milestoneData, trainingSessions };
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
  public async processUserQuery(userQuery: string): Promise<AICoachMessage> {
    const toolCalls: AICoachToolCall[] = [];

    // Gather all local context in a single unified step
    const { statusData, recentActivities, milestoneData, trainingSessions } = await gatherAthleteContext('Mount Baker');

    toolCalls.push(
      { toolName: 'getAthleteStatus', args: {}, result: statusData },
      { toolName: 'queryActivities', args: { limit: 8 }, result: recentActivities },
      { toolName: 'getMilestoneReadiness', args: { goalName: 'Mount Baker' }, result: milestoneData }
    );

    // POST to /api/coach — key stays server-side, never in the browser bundle
    const res = await fetch('/api/coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: userQuery,
        context: {
          athleteStatus: statusData,
          recentActivities,
          milestoneReadiness: milestoneData,
          scheduledTrainingSessions: trainingSessions.slice(0, 10),
        },
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown server error' }));
      throw new Error(err.error || `Server returned ${res.status}`);
    }

    const { text } = await res.json();

    return {
      id: `coach-msg-${Date.now()}`,
      sender: 'coach',
      text: text || 'No response received. Please try again.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      toolCalls,
    };
  }

  /** Generate a proposed weekly training plan via Gemini */
  public async generateWeeklyPlan(occupiedDates: string[]): Promise<TrainingSession[]> {
    const { statusData, recentActivities, milestoneData } = await gatherAthleteContext('Mount Baker');

    const nextMonday = getNextMonday();

    const res = await fetch('/api/coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `Generate a structured weekly training plan as a JSON array.
Return ONLY a valid JSON array of TrainingSession objects with these exact fields:
{ id, week_start_date, session_date, title, sport_type, duration_minutes, focus, details, target_tss, status }
- week_start_date and session_date must be ISO date strings (YYYY-MM-DD) for next week (starting ${nextMonday})
- sport_type must be one of: cycling, zwift, skimo, backcountry_skiing, scrambling, weighted_hiking
- status must be "PROPOSED"
- Avoid these already-occupied dates: ${occupiedDates.join(', ') || 'none'}
- Plan 4-5 sessions across the week balancing training load with recovery
- Consider the athlete's current fitness, fatigue, injuries, and upcoming goals
Return only the JSON array, no markdown, no explanation.`,
        context: {
          athleteStatus: statusData,
          recentActivities,
          milestoneReadiness: milestoneData,
        },
        mode: 'json',
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown server error' }));
      throw new Error(err.error || `Server returned ${res.status}`);
    }

    const { text } = await res.json();

    // Extract JSON array from the response (strip markdown fences if Gemini includes them)
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('Could not parse weekly plan from AI response.');

    const sessions: TrainingSession[] = JSON.parse(jsonMatch[0]);
    return sessions;
  }
}

export const coachEngine = new GeminiCoachEngine();
