import React from 'react';
import type { Activity, Goal, AthleteProfile, PMCDayPoint, PowerCurvePoint } from '../types';
import { Mountain, Zap, ShieldAlert, Calendar, ArrowUpRight, TrendingUp, Sparkles, ChevronRight, Activity as ActivityIcon } from 'lucide-react';
import { PerformanceManagementChart } from './PerformanceManagementChart';

interface DashboardOverviewProps {
  profile: AthleteProfile;
  goals: Goal[];
  activities: Activity[];
  pmcData: PMCDayPoint[];
  powerCurve: PowerCurvePoint[];
  onOpenActivity: (activity: Activity) => void;
  onNavigateTab: (tab: 'dashboard' | 'goals' | 'activities' | 'power' | 'coach') => void;
}

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({
  profile,
  goals,
  activities,
  pmcData,
  onOpenActivity,
  onNavigateTab,
}) => {
  const latestPmc = pmcData[pmcData.length - 1] || { ctl: 68, atl: 72, tsb: -4, tss: 0 };
  const bakerGoal = goals.find((g) => g.name.includes('Mount Baker')) || goals[0];

  // Days remaining calculation
  const daysRemaining = bakerGoal && bakerGoal.target_date
    ? Math.max(0, Math.ceil((new Date(bakerGoal.target_date).getTime() - new Date().getTime()) / (1000 * 3600 * 24)))
    : 42;

  // Recent 4 activities
  const recentActivities = activities.slice(0, 4);

  // Discipline totals
  const totalElevM = activities.reduce((acc, a) => acc + a.total_elevation_gain_m, 0);

  return (
    <div className="space-y-6">
      {/* Target Goal Milestone Hero Banner: Mount Baker Hill Climb */}
      {bakerGoal && (
        <div className="relative overflow-hidden rounded-3xl glass-panel border border-cyan-500/30 p-6 sm:p-8 bg-gradient-to-r from-slate-950 via-slate-900 to-cyan-950/60 shadow-2xl">
          <div className="absolute top-0 right-0 -mt-12 -mr-12 w-64 h-64 rounded-full bg-cyan-500/10 blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 left-1/3 -mb-12 w-64 h-64 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />

          <div className="relative z-10 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
            <div className="space-y-3 max-w-2xl">
              <div className="flex items-center space-x-2">
                <span className="text-xs font-extrabold px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 uppercase tracking-widest flex items-center">
                  <Sparkles className="w-3.5 h-3.5 mr-1" />
                  Upcoming Priority Goal
                </span>
                <span className="text-xs text-cyan-400 font-mono flex items-center">
                  <Calendar className="w-3.5 h-3.5 mr-1" />
                  {bakerGoal.target_date}
                </span>
              </div>

              <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                {bakerGoal.name}
              </h1>

              <p className="text-sm text-slate-300 leading-relaxed">
                <span className="text-amber-300 font-semibold">Objective:</span> "{bakerGoal.objective_summary || bakerGoal.notes}"
              </p>

              {/* Specs Pills */}
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <div className="px-3 py-1.5 rounded-xl bg-slate-900/80 border border-white/10 text-xs text-slate-200 font-medium">
                  Distance: <span className="font-bold text-white">{bakerGoal.target_distance_km} km</span>
                </div>
                <div className="px-3 py-1.5 rounded-xl bg-slate-900/80 border border-white/10 text-xs text-slate-200 font-medium">
                  Elevation Gain: <span className="font-bold text-white">{bakerGoal.target_elevation_m} m</span>
                </div>
                <div className="px-3 py-1.5 rounded-xl bg-slate-900/80 border border-white/10 text-xs text-slate-200 font-medium">
                  Target Power: <span className="font-bold text-amber-400">{bakerGoal.target_power_watts} W</span>
                </div>
              </div>
            </div>

            {/* Countdown Badge & Readiness */}
            <div className="flex flex-col items-center justify-center p-6 rounded-2xl bg-slate-900/80 border border-white/10 text-center w-full lg:w-72 shadow-lg">
              <span className="text-xs text-slate-400 uppercase font-semibold tracking-wider">Countdown</span>
              <div className="text-4xl font-black text-cyan-400 font-mono my-1">
                {daysRemaining} <span className="text-sm font-normal text-slate-400">days</span>
              </div>

              {/* Progress bar */}
              <div className="w-full mt-3 space-y-1">
                <div className="flex justify-between text-[11px] font-semibold text-slate-300">
                  <span>Race Readiness</span>
                  <span className="text-cyan-400 font-bold">98%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400 w-[98%]" />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PMC Key Performance Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* CTL Fitness */}
        <div className="glass-panel p-5 rounded-2xl border-white/10 space-y-1">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center">
            <TrendingUp className="w-4 h-4 mr-1 text-cyan-400" /> Chronic Load (CTL)
          </span>
          <div className="flex items-baseline space-x-2">
            <span className="text-3xl font-extrabold text-white">{latestPmc.ctl}</span>
            <span className="text-xs text-emerald-400 font-bold">+4 vs last wk</span>
          </div>
          <p className="text-[11px] text-slate-400">Base Fitness Index (42-day rolling avg)</p>
        </div>

        {/* ATL Fatigue */}
        <div className="glass-panel p-5 rounded-2xl border-white/10 space-y-1">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center">
            <Zap className="w-4 h-4 mr-1 text-rose-400" /> Acute Load (ATL)
          </span>
          <div className="flex items-baseline space-x-2">
            <span className="text-3xl font-extrabold text-white">{latestPmc.atl}</span>
            <span className="text-xs text-rose-400 font-bold">+8 high load</span>
          </div>
          <p className="text-[11px] text-slate-400">Current Fatigue (7-day rolling avg)</p>
        </div>

        {/* TSB Form */}
        <div className="glass-panel p-5 rounded-2xl border-white/10 space-y-1">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center">
            <ActivityIcon className="w-4 h-4 mr-1 text-amber-400" /> Training Form (TSB)
          </span>
          <div className="flex items-baseline space-x-2">
            <span className={`text-3xl font-extrabold ${latestPmc.tsb >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
              {latestPmc.tsb > 0 ? `+${latestPmc.tsb}` : latestPmc.tsb}
            </span>
            <span className="text-xs text-amber-400 font-bold">Productive Overload</span>
          </div>
          <p className="text-[11px] text-slate-400">Form Balance (CTL - ATL)</p>
        </div>

        {/* Total Elevation */}
        <div className="glass-panel p-5 rounded-2xl border-white/10 space-y-1">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center">
            <Mountain className="w-4 h-4 mr-1 text-sky-400" /> Multi-Sport Ascent
          </span>
          <div className="flex items-baseline space-x-2">
            <span className="text-3xl font-extrabold text-white">{totalElevM.toLocaleString()} m</span>
          </div>
          <p className="text-[11px] text-slate-400">Total Elevation Gain across {activities.length} sessions</p>
        </div>
      </div>

      {/* Injury Guardian & Decompression Notice Banner */}
      <div className="glass-panel p-5 rounded-2xl border-amber-500/30 bg-amber-500/5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-start space-x-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center flex-shrink-0 mt-0.5">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white flex items-center space-x-2">
              <span>Injury Awareness & Recovery Guardian</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">
                Left Patellar Tendon & Posterior Chain
              </span>
            </h3>
            <p className="text-xs text-slate-300 mt-1">
              <strong>Decompression Routine:</strong> {profile.recovery_routines.wednesday}
            </p>
          </div>
        </div>

        <button
          onClick={() => onNavigateTab('coach')}
          className="flex items-center space-x-1 px-4 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 text-xs font-bold transition-all whitespace-nowrap"
        >
          <span>Ask AI Coach</span>
          <ArrowUpRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Main Charts Section */}
      <div className="glass-panel p-6 rounded-2xl border-white/10 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">Performance Management Chart (PMC)</h2>
            <p className="text-xs text-slate-400">90-Day Exponential Load Profile & Form Balance</p>
          </div>
          <span className="text-xs font-mono text-cyan-400 bg-cyan-500/10 px-3 py-1 rounded-full border border-cyan-500/20">
            CTL / ATL / TSB Engine
          </span>
        </div>
        <PerformanceManagementChart data={pmcData} />
      </div>

      {/* Recent Activity Feed */}
      <div className="glass-panel p-6 rounded-2xl border-white/10 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">Recent Multi-Sport Activities</h2>
            <p className="text-xs text-slate-400">Road Cycling, Skimo, Peak Scrambles & Weighted Hikes</p>
          </div>
          <button
            onClick={() => onNavigateTab('activities')}
            className="flex items-center text-xs font-bold text-cyan-400 hover:text-cyan-300"
          >
            <span>View All Activities</span>
            <ChevronRight className="w-4 h-4 ml-0.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {recentActivities.map((act) => (
            <div
              key={act.id}
              onClick={() => onOpenActivity(act)}
              className="p-4 rounded-xl bg-slate-900/60 border border-white/5 hover:border-cyan-500/30 cursor-pointer transition-all flex items-center justify-between"
            >
              <div>
                <span className="text-[10px] font-bold uppercase text-cyan-400">
                  {act.sport_type.replace('_', ' ')}
                </span>
                <h4 className="text-sm font-bold text-white">{act.title}</h4>
                <p className="text-xs text-slate-400">
                  {(act.distance_meters / 1000).toFixed(1)} km | {act.total_elevation_gain_m}m gain | TSS: {act.training_stress_score || 'N/A'}
                </p>
              </div>
              <ArrowUpRight className="w-4 h-4 text-slate-500" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
