import React, { useState } from 'react';
import type { Goal, SportType } from '../types';
import { Mountain, Bike, Footprints, Compass, Plus, CheckCircle2, Trash2, Calendar, Sparkles, Award, X } from 'lucide-react';

interface GoalsManagerProps {
  goals: Goal[];
  onAddGoal: (goal: Goal) => Promise<void>;
  onCompleteGoal: (goalId: string, debriefNotes: string) => void;
  onDeleteGoal: (goalId: string) => void;
}

export const GoalsManager: React.FC<GoalsManagerProps> = ({
  goals,
  onAddGoal,
  onCompleteGoal,
  onDeleteGoal,
}) => {
  const [filterStatus, setFilterStatus] = useState<'ACTIVE' | 'COMPLETED' | 'ALL'>('ACTIVE');

  // Modal States
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isSavingGoal, setIsSavingGoal] = useState(false);
  const [goalSaveError, setGoalSaveError] = useState('');
  const [debriefModalGoal, setDebriefModalGoal] = useState<Goal | null>(null);

  // New Goal Form State
  const [name, setName] = useState('');
  const [sportType, setSportType] = useState<SportType | 'general'>('cycling');
  const [targetDate, setTargetDate] = useState('');
  const [timeframeText, setTimeframeText] = useState('Flexible / Next Season');
  const [objectiveSummary, setObjectiveSummary] = useState('');
  const [priority, setPriority] = useState<Goal['priority']>('A_RACE');
  const [targetDistanceKm, setTargetDistanceKm] = useState<string>('');
  const [targetElevationM, setTargetElevationM] = useState<string>('');
  const [targetPowerWatts, setTargetPowerWatts] = useState<string>('');
  const [notes, setNotes] = useState('');

  // Debrief Form State
  const [debriefNotesInput, setDebriefNotesInput] = useState('');

  const filteredGoals = goals.filter((g) => {
    if (filterStatus === 'ACTIVE') return g.status === 'ACTIVE';
    if (filterStatus === 'COMPLETED') return g.status === 'COMPLETED';
    return true;
  });

  const handleCreateGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !objectiveSummary.trim()) return;

    const newGoal: Goal = {
      id: `goal-${Date.now()}`,
      name: name.trim(),
      sport_type: sportType,
      target_date: targetDate || undefined,
      timeframe_text: timeframeText.trim() || (targetDate ? `Target Date: ${targetDate}` : 'Flexible'),
      objective_summary: objectiveSummary.trim(),
      target_distance_km: targetDistanceKm ? Number(targetDistanceKm) : undefined,
      target_elevation_m: targetElevationM ? Number(targetElevationM) : undefined,
      target_power_watts: targetPowerWatts ? Number(targetPowerWatts) : undefined,
      notes: notes.trim() || undefined,
      priority,
      status: 'ACTIVE',
    };

    setIsSavingGoal(true);
    setGoalSaveError('');
    try {
      await onAddGoal(newGoal);
      setIsAddModalOpen(false);
      resetAddForm();
    } catch (err) {
      setGoalSaveError(err instanceof Error ? err.message : 'Goal could not be saved. Please try again.');
    } finally {
      setIsSavingGoal(false);
    }
  };

  const resetAddForm = () => {
    setName('');
    setObjectiveSummary('');
    setTargetDate('');
    setTimeframeText('Flexible / Next Season');
    setTargetDistanceKm('');
    setTargetElevationM('');
    setTargetPowerWatts('');
    setNotes('');
  };

  const handleConfirmDebrief = () => {
    if (!debriefModalGoal) return;
    onCompleteGoal(debriefModalGoal.id, debriefNotesInput.trim() || 'Goal successfully completed!');
    setDebriefModalGoal(null);
    setDebriefNotesInput('');
  };

  const getSportIcon = (sport: SportType | 'general') => {
    switch (sport) {
      case 'cycling':
      case 'zwift': return Bike;
      case 'skimo':
      case 'backcountry_skiing': return Mountain;
      case 'scrambling': return Compass;
      case 'weighted_hiking': return Footprints;
      default: return Sparkles;
    }
  };

  const getSportBadgeColor = (sport: SportType | 'general') => {
    switch (sport) {
      case 'cycling':
      case 'zwift': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
      case 'skimo': return 'bg-sky-500/10 text-sky-400 border-sky-500/30';
      case 'backcountry_skiing': return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
      case 'scrambling': return 'bg-purple-500/10 text-purple-400 border-purple-500/30';
      case 'weighted_hiking': return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
      default: return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30';
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Actions Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight flex items-center">
            <Sparkles className="w-6 h-6 mr-2 text-cyan-400" /> Multi-Sport Goal Objectives & Milestones
          </h1>
          <p className="text-xs text-slate-400">High-level objectives, flexible timeframes, and post-event completion debriefs</p>
        </div>

        <button
          onClick={() => setIsAddModalOpen(true)}
          className="min-h-11 w-full sm:w-auto justify-center px-4 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 text-slate-950 font-bold text-xs hover:opacity-90 transition-all flex items-center space-x-1.5 shadow-lg shadow-cyan-500/20"
        >
          <Plus className="w-4 h-4" />
          <span>Add New Goal Objective</span>
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto border-b border-white/5 pb-2">
        <button
          onClick={() => setFilterStatus('ACTIVE')}
          className={`min-h-11 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
            filterStatus === 'ACTIVE'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Active Goals ({goals.filter((g) => g.status === 'ACTIVE').length})
        </button>

        <button
          onClick={() => setFilterStatus('COMPLETED')}
          className={`min-h-11 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
            filterStatus === 'COMPLETED'
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Hall of Fame ({goals.filter((g) => g.status === 'COMPLETED').length})
        </button>

        <button
          onClick={() => setFilterStatus('ALL')}
          className={`min-h-11 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
            filterStatus === 'ALL'
              ? 'bg-slate-800 text-slate-200 border border-white/10'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          All ({goals.length})
        </button>
      </div>

      {/* Goals Feed */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredGoals.map((goal) => {
          const IconComponent = getSportIcon(goal.sport_type);
          const isCompleted = goal.status === 'COMPLETED';

          return (
            <div
              key={goal.id}
              className={`glass-panel-interactive rounded-2xl p-6 flex flex-col justify-between space-y-4 ${
                isCompleted ? 'border-emerald-500/30 bg-emerald-950/10' : ''
              }`}
            >
              <div className="space-y-3">
                {/* Header Pills */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className={`text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-full border flex items-center ${getSportBadgeColor(goal.sport_type)}`}>
                      <IconComponent className="w-3 h-3 mr-1" />
                      {goal.sport_type.replace('_', ' ')}
                    </span>

                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-white/5">
                      {goal.priority.replace('_', ' ')}
                    </span>
                  </div>

                  {/* Timeframe or Date */}
                  <span className="text-xs text-cyan-400 font-mono flex items-center">
                    <Calendar className="w-3.5 h-3.5 mr-1" />
                    {goal.timeframe_text || goal.target_date || 'Flexible Timeframe'}
                  </span>
                </div>

                {/* Goal Title & High Level Objective */}
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                    <span>{goal.name}</span>
                    {isCompleted && <Award className="w-5 h-5 text-emerald-400 flex-shrink-0" />}
                  </h3>

                  <div className="p-3 rounded-xl bg-slate-900/80 border border-white/5 mt-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">High-Level Objective:</span>
                    <p className="text-sm font-semibold text-slate-200 mt-0.5 leading-snug">
                      "{goal.objective_summary}"
                    </p>
                  </div>
                </div>

                {/* Optional Metric Chips */}
                {(goal.target_distance_km || goal.target_elevation_m || goal.target_power_watts) && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {goal.target_distance_km && (
                      <span className="px-2.5 py-1 rounded-lg bg-slate-900 border border-white/5 text-xs text-slate-300">
                        Dist: <strong className="text-white">{goal.target_distance_km} km</strong>
                      </span>
                    )}
                    {goal.target_elevation_m && (
                      <span className="px-2.5 py-1 rounded-lg bg-slate-900 border border-white/5 text-xs text-slate-300">
                        Elev: <strong className="text-white">{goal.target_elevation_m} m</strong>
                      </span>
                    )}
                    {goal.target_power_watts && (
                      <span className="px-2.5 py-1 rounded-lg bg-slate-900 border border-white/5 text-xs text-slate-300">
                        Target Effort: <strong className="text-amber-400">{goal.target_power_watts} W</strong>
                      </span>
                    )}
                  </div>
                )}

                {/* Completed Debrief Card if finished */}
                {isCompleted && goal.debrief_notes && (
                  <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-200 space-y-1">
                    <span className="font-bold flex items-center text-emerald-400">
                      <CheckCircle2 className="w-4 h-4 mr-1 text-emerald-400" /> Post-Event Completion Debrief:
                    </span>
                    <p className="text-slate-300 leading-relaxed italic">{goal.debrief_notes}</p>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-white/5">
                {!isCompleted && (
                  <button
                    onClick={() => setDebriefModalGoal(goal)}
                    className="min-h-11 flex items-center space-x-1 px-3 py-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 text-xs font-semibold transition-all"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Mark Completed</span>
                  </button>
                )}

                <button
                  onClick={() => onDeleteGoal(goal.id)}
                  className="min-h-11 flex items-center space-x-1 px-3 py-2 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 text-xs font-medium transition-all"
                  title="Remove or deprioritize goal"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Remove</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* CREATE NEW GOAL MODAL */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md overflow-y-auto">
          <div className="w-full max-w-xl glass-panel rounded-3xl border border-cyan-500/30 p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h2 className="text-lg font-bold text-white flex items-center">
                <Plus className="w-5 h-5 mr-1.5 text-cyan-400" /> Add New Goal Objective
              </h2>
              <button onClick={() => setIsAddModalOpen(false)} className="p-1 text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateGoal} className="space-y-4">
              {goalSaveError && (
                <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
                  Goal was not saved: {goalSaveError}
                </p>
              )}
              <div>
                <label className="text-xs font-semibold text-slate-300">Goal Event / Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Mount Baker Car-to-Car Push, Artist Point Sub-1:45"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full mt-1 bg-slate-900 border border-white/10 rounded-xl px-4 py-2 text-sm text-white focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-cyan-300">High-Level Objective Summary (Text Target)</label>
                <textarea
                  rows={2}
                  required
                  placeholder="e.g. Sub-8 hour car-to-car single day push with 11kg pack, maintaining 550 m/h VAM"
                  value={objectiveSummary}
                  onChange={(e) => setObjectiveSummary(e.target.value)}
                  className="w-full mt-1 bg-slate-900 border border-white/10 rounded-xl p-3 text-xs text-slate-200 focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-300">Discipline / Sport</label>
                  <select
                    value={sportType}
                    onChange={(e) => setSportType(e.target.value as any)}
                    className="w-full mt-1 bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:border-cyan-500"
                  >
                    <option value="cycling">Road Cycling / Zwift</option>
                    <option value="skimo">Ski Mountaineering (Skimo)</option>
                    <option value="backcountry_skiing">Backcountry Skiing</option>
                    <option value="scrambling">Peak Scrambling</option>
                    <option value="weighted_hiking">Weighted Hiking</option>
                    <option value="general">General Endurance</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300">Priority Level</label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as any)}
                    className="w-full mt-1 bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:border-cyan-500"
                  >
                    <option value="A_RACE">A Priority Race / Expedition</option>
                    <option value="B_RACE">B Priority Event</option>
                    <option value="TRAINING_MILESTONE">Training Milestone</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-300">Flexible Timeframe Text</label>
                  <input
                    type="text"
                    placeholder="e.g. Spring 2027, Next Season"
                    value={timeframeText}
                    onChange={(e) => setTimeframeText(e.target.value)}
                    className="w-full mt-1 bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300">Specific Target Date (Optional)</label>
                  <input
                    type="date"
                    value={targetDate}
                    onChange={(e) => setTargetDate(e.target.value)}
                    className="w-full mt-1 bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:border-cyan-500"
                  />
                </div>
              </div>

              {/* Optional Numbers */}
              <div className="grid grid-cols-3 gap-2 pt-1">
                <div>
                  <label className="text-[11px] text-slate-400">Distance (km)</label>
                  <input
                    type="number"
                    value={targetDistanceKm}
                    onChange={(e) => setTargetDistanceKm(e.target.value)}
                    className="w-full mt-1 bg-slate-900 border border-white/10 rounded-xl px-2 py-1.5 text-xs text-white"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-slate-400">Elevation Gain (m)</label>
                  <input
                    type="number"
                    value={targetElevationM}
                    onChange={(e) => setTargetElevationM(e.target.value)}
                    className="w-full mt-1 bg-slate-900 border border-white/10 rounded-xl px-2 py-1.5 text-xs text-white"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-slate-400">Target Watts</label>
                  <input
                    type="number"
                    value={targetPowerWatts}
                    onChange={(e) => setTargetPowerWatts(e.target.value)}
                    className="w-full mt-1 bg-slate-900 border border-white/10 rounded-xl px-2 py-1.5 text-xs text-amber-400"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  disabled={isSavingGoal}
                  className="px-4 py-2 rounded-xl bg-white/5 text-xs font-semibold text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingGoal}
                  className="min-h-11 px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 text-slate-950 font-bold text-xs hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
                >
                  {isSavingGoal ? 'Saving...' : 'Save Goal Objective'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* COMPLETION & DEBRIEF MODAL */}
      {debriefModalGoal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md overflow-y-auto">
          <div className="w-full max-w-lg glass-panel rounded-3xl border border-emerald-500/30 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h2 className="text-lg font-bold text-white flex items-center">
                <Award className="w-5 h-5 mr-2 text-emerald-400" /> Goal Completion & Post-Event Debrief
              </h2>
              <button onClick={() => setDebriefModalGoal(null)} className="p-1 text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-300">
              Congratulations on finishing <strong>"{debriefModalGoal.name}"</strong>! Record your actual results, pacing, gear performance, and knee health observations.
            </p>

            <div>
              <label className="text-xs font-semibold text-emerald-300">Post-Event Debrief & Performance Reflections</label>
              <textarea
                rows={4}
                placeholder="e.g. Finished in 1h 42m (276W avg). Knee felt great using 34T chainring. Hydration pacing worked perfectly."
                value={debriefNotesInput}
                onChange={(e) => setDebriefNotesInput(e.target.value)}
                className="w-full mt-1 bg-slate-900 border border-white/10 rounded-xl p-3 text-xs text-slate-200 focus:border-emerald-500"
              />
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t border-white/10">
              <button
                onClick={() => setDebriefModalGoal(null)}
                className="px-4 py-2 rounded-xl bg-white/5 text-xs font-semibold text-slate-300"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDebrief}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 font-extrabold text-xs shadow-lg shadow-emerald-500/20"
              >
                Save Debrief & Archive to Hall of Fame
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
