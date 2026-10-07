import React, { useState } from 'react';
import type { Activity, Goal, AthleteProfile, PMCDayPoint, PowerCurvePoint, TrainingSession } from '../types';
import { Zap, Calendar, ArrowUpRight, TrendingUp, Sparkles, ChevronRight, Activity as ActivityIcon, CalendarDays, Clock3, Trash2 } from 'lucide-react';
import { PerformanceManagementChart } from './PerformanceManagementChart';
import { formatFeetFromMeters, formatMilesFromKm, formatMilesFromMeters } from '../lib/units';
import { resolveTss } from '../lib/trainingMath';

interface DashboardOverviewProps {
  profile: AthleteProfile;
  goals: Goal[];
  activities: Activity[];
  pmcData: PMCDayPoint[];
  powerCurve: PowerCurvePoint[];
  trainingSessions: TrainingSession[];
  onOpenActivity: (activity: Activity) => void;
  onNavigateTab: (tab: 'dashboard' | 'goals' | 'activities' | 'power' | 'heart-rate' | 'coach') => void;
  onOpenProfile?: () => void;
  onDeleteTrainingSessions?: (ids: string[]) => Promise<void>;
}

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({
  profile,
  goals,
  activities,
  pmcData,
  powerCurve,
  trainingSessions,
  onOpenActivity,
  onNavigateTab,
  onOpenProfile,
  onDeleteTrainingSessions,
}) => {
  // Deleting asks for a second click: either one session (by id) or everything not yet completed
  const [confirmDelete, setConfirmDelete] = useState<string | 'all' | null>(null);
  const [deletingIds, setDeletingIds] = useState<string[]>([]);
  const [deleteError, setDeleteError] = useState('');
  const pendingSessions = trainingSessions.filter((session) => session.status !== 'COMPLETED');

  const deleteSessions = async (ids: string[]) => {
    if (!onDeleteTrainingSessions || ids.length === 0) return;
    setDeleteError('');
    setDeletingIds(ids);
    try {
      await onDeleteTrainingSessions(ids);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'The sessions could not be deleted.');
    } finally {
      setDeletingIds([]);
      setConfirmDelete(null);
    }
  };

  const latestPmc = pmcData[pmcData.length - 1] || { ctl: 0, atl: 0, tsb: 0, tss: 0, date: '' };
  const previousWeekPmc = pmcData[Math.max(0, pmcData.length - 8)] || latestPmc;
  const hasTrainingLoad = activities.some((activity) => resolveTss(activity, profile).tss > 0);
  const weeklyDelta = (current: number, previous: number) => {
    const delta = Math.round((current - previous) * 10) / 10;
    return `${delta > 0 ? '+' : ''}${delta} vs last week`;
  };
  const formLabel = latestPmc.tsb < -20
    ? 'High fatigue'
    : latestPmc.tsb > 15
    ? 'Fresh'
    : hasTrainingLoad ? 'Building' : 'No load data';
  const priorityGoal = goals.find((g) => g.status === 'ACTIVE') || goals[0];

  // Days remaining calculation (only when the goal has a target date)
  const daysRemaining = priorityGoal?.target_date
    ? Math.max(0, Math.ceil((new Date(priorityGoal.target_date).getTime() - new Date().getTime()) / (1000 * 3600 * 24)))
    : null;

  // Readiness: best 20m power vs the goal's target power, when both are known
  const best20m = powerCurve.find((p) => p.label === '20m')?.watts || 0;
  const readinessPct = priorityGoal?.target_power_watts && best20m > 0
    ? Math.min(100, Math.round((best20m / priorityGoal.target_power_watts) * 100))
    : null;

  // Recent 4 activities
  const recentActivities = activities.slice(0, 4);


  return (
    <div className="space-y-6">
      {/* Missing thresholds: point the athlete to their profile */}
      {onOpenProfile && (!profile.lthr || !profile.ftp || !profile.weight_kg) && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-4">
          <p className="text-xs text-cyan-100 leading-relaxed">
            <span className="font-semibold text-white">Finish your profile.</span>{' '}
            Add your {[!profile.lthr && 'LTHR', !profile.ftp && 'FTP', !profile.weight_kg && 'weight'].filter(Boolean).join(', ')} so training load, fitness and fatigue are calculated accurately.
          </p>
          <button
            type="button"
            onClick={onOpenProfile}
            className="min-h-10 flex-shrink-0 px-4 py-2 rounded-xl bg-cyan-500 text-slate-950 text-xs font-bold hover:opacity-90"
          >
            Open profile
          </button>
        </div>
      )}

      {/* Target Goal Milestone Hero Banner */}
      {priorityGoal && (
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
                {priorityGoal.target_date && (
                  <span className="text-xs text-cyan-400 font-mono flex items-center">
                    <Calendar className="w-3.5 h-3.5 mr-1" />
                    {priorityGoal.target_date}
                  </span>
                )}
              </div>

              <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                {priorityGoal.name}
              </h1>

              <p className="text-sm text-slate-300 leading-relaxed">
                {(priorityGoal.objective_summary || priorityGoal.notes) && (
                  <><span className="text-amber-300 font-semibold">Objective:</span> "{priorityGoal.objective_summary || priorityGoal.notes}"</>
                )}
              </p>

              {/* Specs Pills */}
              <div className="flex flex-wrap items-center gap-3 pt-1">
                {!!priorityGoal.target_distance_km && (
                  <div className="px-3 py-1.5 rounded-xl bg-slate-900/80 border border-white/10 text-xs text-slate-200 font-medium">
                    Distance: <span className="font-bold text-white">{formatMilesFromKm(priorityGoal.target_distance_km)}</span>
                  </div>
                )}
                {!!priorityGoal.target_elevation_m && (
                  <div className="px-3 py-1.5 rounded-xl bg-slate-900/80 border border-white/10 text-xs text-slate-200 font-medium">
                    Elevation Gain: <span className="font-bold text-white">{formatFeetFromMeters(priorityGoal.target_elevation_m)}</span>
                  </div>
                )}
                {!!priorityGoal.target_power_watts && (
                  <div className="px-3 py-1.5 rounded-xl bg-slate-900/80 border border-white/10 text-xs text-slate-200 font-medium">
                    Target Power: <span className="font-bold text-amber-400">{priorityGoal.target_power_watts} W</span>
                  </div>
                )}
              </div>
            </div>

            {/* Countdown Badge & Readiness */}
            <div className="flex flex-col items-center justify-center p-6 rounded-2xl bg-slate-900/80 border border-white/10 text-center w-full lg:w-72 shadow-lg">
              <span className="text-xs text-slate-400 uppercase font-semibold tracking-wider">Countdown</span>
              <div className="text-4xl font-black text-cyan-400 font-mono my-1">
                {daysRemaining ?? '—'} {daysRemaining !== null && <span className="text-sm font-normal text-slate-400">days</span>}
              </div>

              {/* Progress bar: best 20m power vs goal target power */}
              {readinessPct !== null && (
                <div className="w-full mt-3 space-y-1">
                  <div className="flex justify-between text-[11px] font-semibold text-slate-300">
                    <span>Power Readiness</span>
                    <span className="text-cyan-400 font-bold">{readinessPct}%</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400" style={{ width: `${readinessPct}%` }} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* PMC Key Performance Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {/* CTL Fitness */}
        <div className="glass-panel p-5 rounded-2xl border-white/10 space-y-1">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center">
            <TrendingUp className="w-4 h-4 mr-1 text-cyan-400" /> Chronic Load (CTL)
          </span>
          <div className="flex items-baseline space-x-2">
            <span className="text-3xl font-extrabold text-white">{latestPmc.ctl}</span>
            <span className="text-xs text-emerald-400 font-bold">{hasTrainingLoad ? weeklyDelta(latestPmc.ctl, previousWeekPmc.ctl) : 'No TSS history'}</span>
          </div>
          <p className="text-[11px] text-slate-400">Calculated from activity TSS (42-day load)</p>
        </div>

        {/* ATL Fatigue */}
        <div className="glass-panel p-5 rounded-2xl border-white/10 space-y-1">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center">
            <Zap className="w-4 h-4 mr-1 text-rose-400" /> Acute Load (ATL)
          </span>
          <div className="flex items-baseline space-x-2">
            <span className="text-3xl font-extrabold text-white">{latestPmc.atl}</span>
            <span className="text-xs text-rose-400 font-bold">{hasTrainingLoad ? weeklyDelta(latestPmc.atl, previousWeekPmc.atl) : 'No TSS history'}</span>
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
            <span className="text-xs text-amber-400 font-bold">{formLabel}</span>
          </div>
          <p className="text-[11px] text-slate-400">Form Balance (CTL - ATL)</p>
        </div>
      </div>

      <section className="border-b border-white/10 pb-6 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-cyan-400" /> Upcoming Training Sessions
            </h2>
            <p className="text-xs text-slate-400 mt-1">Scheduled & accepted workouts from your AI Coach</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {onDeleteTrainingSessions && pendingSessions.length > 0 && (
              confirmDelete === 'all' ? (
                <span className="inline-flex items-center gap-2 text-xs">
                  <span className="text-rose-300">Delete {pendingSessions.length} upcoming {pendingSessions.length === 1 ? 'session' : 'sessions'}?</span>
                  <button
                    type="button"
                    disabled={deletingIds.length > 0}
                    onClick={() => void deleteSessions(pendingSessions.map((s) => s.id))}
                    className="min-h-9 px-3 rounded-lg bg-rose-500/20 border border-rose-500/40 font-semibold text-rose-200 hover:bg-rose-500/30 disabled:opacity-50"
                  >
                    {deletingIds.length > 0 ? 'Deleting…' : 'Delete'}
                  </button>
                  <button type="button" onClick={() => setConfirmDelete(null)} className="min-h-9 px-2 font-semibold text-slate-400 hover:text-white">
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete('all')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-xs font-semibold text-slate-300 hover:text-rose-300 hover:border-rose-500/30 transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete all
                </button>
              )
            )}
            <button
              type="button"
              onClick={() => onNavigateTab('coach')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20 transition-all"
            >
              <Sparkles className="w-3.5 h-3.5" /> Replan with Coach
            </button>
            <button
              type="button"
              onClick={() => onNavigateTab('coach')}
              className="text-xs font-semibold text-slate-400 hover:text-white px-2 py-1.5"
            >
              Review weekly plan
            </button>
          </div>
        </div>

        {deleteError && (
          <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{deleteError}</p>
        )}

        {trainingSessions.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {trainingSessions.map((session) => (
              <article key={session.id} className="rounded-lg border border-white/10 bg-slate-900/50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase text-cyan-300">
                      {new Date(`${session.session_date}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
                      {' · '}{session.sport_type.replace('_', ' ')}
                    </p>
                    <h3 className="mt-1 text-sm font-bold text-white">{session.title}</h3>
                    <p className="mt-1 text-xs text-slate-400">{session.focus}</p>
                  </div>
                  <span className={`shrink-0 text-[10px] font-semibold ${session.status === 'COMPLETED' ? 'text-emerald-300' : 'text-cyan-300'}`}>
                    {session.status === 'COMPLETED' ? 'Completed' : 'Accepted'}
                  </span>
                </div>
                <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-300">
                  <Clock3 className="w-3.5 h-3.5 text-slate-500" /> {session.duration_minutes} min
                  {session.target_tss != null && <span className="ml-2 text-amber-300">{session.target_tss} TSS</span>}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">{session.details}</p>
                {onDeleteTrainingSessions && (
                  <div className="mt-3 flex justify-end">
                    {confirmDelete === session.id ? (
                      <span className="inline-flex items-center gap-2 text-xs">
                        <span className="text-rose-300">Delete this session?</span>
                        <button
                          type="button"
                          disabled={deletingIds.includes(session.id)}
                          onClick={() => void deleteSessions([session.id])}
                          className="min-h-9 px-3 rounded-lg bg-rose-500/20 border border-rose-500/40 font-semibold text-rose-200 hover:bg-rose-500/30 disabled:opacity-50"
                        >
                          {deletingIds.includes(session.id) ? 'Deleting…' : 'Delete'}
                        </button>
                        <button type="button" onClick={() => setConfirmDelete(null)} className="min-h-9 px-2 font-semibold text-slate-400 hover:text-white">
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(session.id)}
                        aria-label={`Delete ${session.title}`}
                        title="Delete this session"
                        className="min-h-9 min-w-9 inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-rose-300 hover:bg-white/5"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-white/10 px-4 py-5 text-sm text-slate-400">
            No accepted sessions yet. Generate a weekly plan in the AI Coach and accept sessions individually.
          </div>
        )}
      </section>

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
                  {formatMilesFromMeters(act.distance_meters)} | {formatFeetFromMeters(act.total_elevation_gain_m)} gain | TSS: {(() => {
                    const load = resolveTss(act, profile);
                    return load.tss > 0 ? `${load.source === 'power' ? '' : '~'}${Math.round(load.tss)}` : 'N/A';
                  })()}
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
