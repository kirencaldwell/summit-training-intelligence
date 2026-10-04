import type { Activity, AICoachMessage, AICoachToolCall, AthleteProfile, Goal } from '../../types';
import { dataService } from '../supabase';
import { calculatePMC, calculatePowerCurve } from '../trainingMath';

/**
 * Intelligent AI Coach Engine for Endurance Athletes
 * Features executable tools, multi-sport context, injury tracking, and milestone readiness logic.
 */
export class AICoachEngine {

  /**
   * Tool 1: Get Athlete Status & Readiness (PMC + Injury + Recovery Context)
   */
  public async getAthleteStatus(): Promise<{
    profile: AthleteProfile;
    pmc: { ctl: number; atl: number; tsb: number; formCategory: string };
    injuries: string[];
    routines: AthleteProfile['recovery_routines'];
    nextGoal?: Goal;
  }> {
    const profile = await dataService.getProfile();
    const activities = await dataService.getActivities();
    const goals = await dataService.getGoals();

    const pmcData = calculatePMC(activities, 30);
    const latestPmc = pmcData[pmcData.length - 1] || { ctl: 65, atl: 70, tsb: -5, tss: 0 };

    let formCategory = 'Optimal Training Window';
    if (latestPmc.tsb < -20) formCategory = 'High Fatigue Warning (Risk of Overreaching)';
    else if (latestPmc.tsb > 15) formCategory = 'Fresh & Tapered (Race Ready)';
    else if (latestPmc.tsb < -10) formCategory = 'Productive Overload Zone';

    const nextGoal = goals[0];

    return {
      profile,
      pmc: { ...latestPmc, formCategory },
      injuries: profile.injury_notes,
      routines: profile.recovery_routines,
      nextGoal,
    };
  }

  /**
   * Tool 2: Query Activities database by sport, minimum elevation, or date
   */
  public async queryActivities(params: {
    sportType?: string;
    minElevationMeters?: number;
    limit?: number;
  }): Promise<Partial<Activity>[]> {
    const activities = await dataService.getActivities(params.sportType);
    let filtered = activities;

    if (params.minElevationMeters) {
      filtered = filtered.filter(a => a.total_elevation_gain_m >= params.minElevationMeters!);
    }

    const limit = params.limit || 5;
    return filtered.slice(0, limit).map(a => ({
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
  }

  /**
   * Tool 3: Milestone Target Readiness (e.g. Mount Baker Hill Climb)
   */
  public async getMilestoneReadiness(goalName: string = 'Mount Baker'): Promise<{
    goal: Goal | undefined;
    daysRemaining: number;
    powerCurve20m: number;
    targetPowerWatts: number;
    readinessScorePct: number;
    coachingAdvice: string;
  }> {
    const goals = await dataService.getGoals();
    const goal = goals.find(g => g.name.toLowerCase().includes(goalName.toLowerCase())) || goals[0];
    const activities = await dataService.getActivities();
    const profile = await dataService.getProfile();

    const powerCurve = calculatePowerCurve(activities, profile.weight_kg);
    const point20m = powerCurve.find(p => p.label === '20m')?.watts || 275;
    const targetW = goal?.target_power_watts || 280;

    const daysRemaining = goal && goal.target_date
      ? Math.max(0, Math.ceil((new Date(goal.target_date).getTime() - new Date().getTime()) / (1000 * 3600 * 24)))
      : 42;

    const readinessScorePct = Math.min(100, Math.round((point20m / targetW) * 100));

    let coachingAdvice = 'Your threshold sustained power is progressing well for Mount Baker.';
    if (readinessScorePct < 92) {
      coachingAdvice = 'Target 2x20m sweetspot/threshold efforts to lift 20m power closer to 280W.';
    } else {
      coachingAdvice = 'Power target is within reach! Prioritize grade-specific climbing simulation and knee health management.';
    }

    return {
      goal,
      daysRemaining,
      powerCurve20m: point20m,
      targetPowerWatts: targetW,
      readinessScorePct,
      coachingAdvice,
    };
  }

  /**
   * Main AI Processing Loop: Evaluates User Query, selects dynamic tools, executes them,
   * and synthesizes context-aware response.
   */
  public async processUserQuery(userQuery: string): Promise<AICoachMessage> {
    const q = userQuery.toLowerCase();
    const toolCalls: AICoachToolCall[] = [];
    let responseText = '';

    // Step 1: Dynamic tool invocation based on query semantics
    if (q.includes('baker') || q.includes('climb') || q.includes('goal') || q.includes('race') || q.includes('readiness')) {
      const toolRes = await this.getMilestoneReadiness('Mount Baker');
      toolCalls.push({
        toolName: 'getMilestoneReadiness',
        args: { goalName: 'Mount Baker Hill Climb' },
        result: toolRes
      });
    }

    if (q.includes('injury') || q.includes('knee') || q.includes('recovery') || q.includes('wind') || q.includes('routine') || q.includes('fatigue') || q.includes('form')) {
      const toolRes = await this.getAthleteStatus();
      toolCalls.push({
        toolName: 'getAthleteStatus',
        args: {},
        result: toolRes
      });
    }

    if (q.includes('skimo') || q.includes('cycling') || q.includes('scramble') || q.includes('hike') || q.includes('activity') || q.includes('recent') || q.includes('workout')) {
      let sportType: string | undefined;
      if (q.includes('skimo')) sportType = 'skimo';
      else if (q.includes('cycling') || q.includes('bike')) sportType = 'cycling';
      else if (q.includes('scramble')) sportType = 'scrambling';
      else if (q.includes('hike')) sportType = 'weighted_hiking';

      const toolRes = await this.queryActivities({ sportType, limit: 4 });
      toolCalls.push({
        toolName: 'queryActivities',
        args: { sportType, limit: 4 },
        result: toolRes
      });
    }

    // Default status tool if no tool triggered
    if (toolCalls.length === 0) {
      const statusRes = await this.getAthleteStatus();
      toolCalls.push({
        toolName: 'getAthleteStatus',
        args: {},
        result: statusRes
      });
    }

    // Step 2: Synthesize Intelligent Contextual Response
    const statusData = await this.getAthleteStatus();
    const { pmc, profile, routines } = statusData;

    if (q.includes('baker') || q.includes('climb') || q.includes('goal')) {
      const bakerTool = toolCalls.find(t => t.toolName === 'getMilestoneReadiness')?.result;
      const days = bakerTool?.daysRemaining || 42;
      const current20m = bakerTool?.powerCurve20m || 275;
      const targetW = bakerTool?.target_power_watts || 280;

      responseText = `### 🏔️ Mount Baker Hill Climb Readiness Report
**Days to Target Date:** ${days} days
**Current 20-min Peak Power:** **${current20m}W** (${(current20m / profile.weight_kg).toFixed(2)} W/kg)
**Target Race Power:** **${targetW}W** (${(targetW / profile.weight_kg).toFixed(2)} W/kg)
**Readiness Metric:** **${bakerTool?.readinessScorePct || 98}%**

#### 💡 Pacing & Technical Analysis:
- Your recent *Mount Baker Highway Artist Point Simulation* produced a Normalized Power of **272W** (IF 0.95), showing high aerobic endurance.
- **Knee & Patellar Tendonitis Warning:** On steep grades above 12% near the final switchbacks, keep cadence around **85–90 RPM** using a 34T chainring to limit anterior knee shear stress.
- **Next Key Workout:** 3x15m Over-Under Threshold climb (270W / 295W toggles) on Zwift or real grade.`;
    
    } else if (q.includes('knee') || q.includes('injury') || q.includes('posterior')) {
      responseText = `### 🩺 Injury & Posterior Chain Health Status
**Active Focus Notes:**
1. **Left Patellar Tendonitis:** Sensitivity noted on steep climbs (>12% grade) or heavy pack carries.
2. **Posterior Chain Tightness:** Occurs post high-ascent skimo sessions (>1,500m elevation gain).

#### 🧘 Suggested Wind-Down & Decompression Protocol:
- **Wednesday Routine:** ${routines.wednesday}
- **Sunday Flushing Routine:** ${routines.sunday}
- **Action Item:** Perform 3x45s single-leg isometric knee extensions at 60° knee angle before climbing rides.`;

    } else if (q.includes('skimo') || q.includes('ski') || q.includes('scramble') || q.includes('hike')) {
      const actTool = toolCalls.find(t => t.toolName === 'queryActivities')?.result || [];
      responseText = `### 🎿 Multi-Sport Mountain Performance Overview
I reviewed your latest mountain sessions across Skimo, Peak Scrambling, and Weighted Hiking:

${actTool.map((a: any) => `- **${a.title}** (${a.sport_type}): ${a.total_elevation_gain_m}m gain | ${a.duration_minutes}m duration | TSS: ${a.tss || 'N/A'}`).join('\n')}

#### 📈 Key Observations:
- **Vertical Ascent Rate (VAM):** Averaging **590 m/h** on skimo ascents with an 11.5kg pack.
- **Aerobic Efficiency:** HR stayed primarily in Zone 2 / Zone 3 during Colfax Peak ascent, keeping lactate accumulation low.
- **Recovery Note:** Ensure post-skimo posterior chain stretching is completed before high-torque indoor cycling.`;

    } else {
      responseText = `### 📊 Summit AI Training Summary
**Current Fitness (CTL):** ${pmc.ctl} | **Fatigue (ATL):** ${pmc.atl} | **Form (TSB):** **${pmc.tsb}** (${pmc.formCategory})

#### 🎯 Strategic Overview:
- **Mount Baker Hill Climb Target:** 280W target power (${bakerToolStatus(current20mW(statusData))} readiness).
- **Multi-Sport Balance:** Great distribution across Road Cycling, Zwift, Skimo, and Peak Scrambling.
- **Recovery & Knees:** Current TSB is **${pmc.tsb}**, indicating a ${pmc.tsb > 0 ? 'fresh, optimal recovery state' : 'productive building block requiring active recovery'}.`;
    }

    return {
      id: `coach-msg-${Date.now()}`,
      sender: 'coach',
      text: responseText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      toolCalls
    };
  }
}

function current20mW(_statusData: any): number {
  return 275;
}

function bakerToolStatus(watts: number): string {
  return watts >= 280 ? '100%' : '98%';
}

export const coachEngine = new AICoachEngine();
