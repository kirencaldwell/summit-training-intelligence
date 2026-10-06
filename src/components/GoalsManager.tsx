import React, { useState } from 'react';
import type { Goal, GoalMilestone, PeriodizationPhase, SportType } from '../types';
import { formatFeetFromMeters, formatMilesFromKm, ftToM, kmToMi, mToFt, miToKm, roundTo } from '../lib/units';
import { Mountain, Bike, Footprints, Compass, Plus, CheckCircle2, Trash2, Calendar, Sparkles, Award, X, Layers, Flag, Bot, Pencil } from 'lucide-react';

interface GoalsManagerProps {
  goals: Goal[];
  onAddGoal: (goal: Goal) => Promise<void>;
  onUpdateGoal: (goalId: string, updates: Partial<Goal>) => Promise<void>;
  onCompleteGoal: (goalId: string, debriefNotes: string) => void;
  onDeleteGoal: (goalId: string) => void;
  /** Open the coach chat focused on this goal, optionally with a prompt prefilled */
  onDiscussGoal?: (goal: Goal, prompt?: string) => void;
}

interface PhaseDraft {
  name: string;
  focus: string;
  weeks: string;
  target_ctl: string;
  status: NonNullable<PeriodizationPhase['status']>;
}

interface MilestoneDraft {
  title: string;
  target_date: string;
  target_metric: string;
  completed: boolean;
}

export const GoalsManager: React.FC<GoalsManagerProps> = ({
  goals,
  onAddGoal,
  onUpdateGoal,
  onCompleteGoal,
  onDeleteGoal,
  onDiscussGoal,
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
  const [targetDistanceMi, setTargetDistanceMi] = useState<string>('');
  const [targetElevationFt, setTargetElevationFt] = useState<string>('');
  const [targetPowerWatts, setTargetPowerWatts] = useState<string>('');
  const [notes, setNotes] = useState('');
  // Phases and milestones are edited as strings and parsed on save
  const [phases, setPhases] = useState<PhaseDraft[]>([]);
  const [milestones, setMilestones] = useState<MilestoneDraft[]>([]);
  // When set, the goal form edits this goal instead of creating a new one
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);

  // Debrief Form State
  const [debriefNotesInput, setDebriefNotesInput] = useState('');

  const filteredGoals = goals.filter((g) => {
    if (filterStatus === 'ACTIVE') return g.status === 'ACTIVE';
    if (filterStatus === 'COMPLETED') return g.status === 'COMPLETED';
    return true;
  });

  const handleSubmitGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !objectiveSummary.trim()) return;

    const distanceKm = targetDistanceMi ? roundTo(miToKm(Number(targetDistanceMi)), 2) : undefined;
    const elevationM = targetElevationFt ? roundTo(ftToM(Number(targetElevationFt)), 2) : undefined;
    const powerWatts = targetPowerWatts ? Number(targetPowerWatts) : undefined;

    setIsSavingGoal(true);
    setGoalSaveError('');
    try {
      if (editingGoal) {
        // null (not undefined) so a cleared field is actually removed in the database
        const phaseList: PeriodizationPhase[] = phases
          .filter((p) => p.name.trim())
          .map((p) => ({
            name: p.name.trim(),
            focus: p.focus.trim(),
            weeks: Math.max(1, Math.round(Number(p.weeks)) || 1),
            target_ctl: p.target_ctl ? Number(p.target_ctl) : undefined,
            status: p.status,
          }));
        const milestoneList: GoalMilestone[] = milestones
          .filter((m) => m.title.trim())
          .map((m) => ({
            title: m.title.trim(),
            target_date: m.target_date || undefined,
            target_metric: m.target_metric.trim() || undefined,
            completed: m.completed,
          }));
        await onUpdateGoal(editingGoal.id, {
          name: name.trim(),
          sport_type: sportType,
          priority,
          objective_summary: objectiveSummary.trim(),
          timeframe_text: timeframeText.trim() || (targetDate ? `Target Date: ${targetDate}` : 'Flexible'),
          target_date: targetDate || null,
          target_distance_km: distanceKm ?? null,
          target_elevation_m: elevationM ?? null,
          target_power_watts: powerWatts ?? null,
          notes: notes.trim() || null,
          periodization_phases: phaseList,
          milestones: milestoneList,
        } as unknown as Partial<Goal>);
      } else {
        await onAddGoal({
          id: `goal-${Date.now()}`,
          name: name.trim(),
          sport_type: sportType,
          target_date: targetDate || undefined,
          timeframe_text: timeframeText.trim() || (targetDate ? `Target Date: ${targetDate}` : 'Flexible'),
          objective_summary: objectiveSummary.trim(),
          target_distance_km: distanceKm,
          target_elevation_m: elevationM,
          target_power_watts: powerWatts,
          notes: notes.trim() || undefined,
          priority,
          status: 'ACTIVE',
        });
      }
      closeGoalModal();
    } catch (err) {
      setGoalSaveError(err instanceof Error ? err.message : 'Goal could not be saved. Please try again.');
    } finally {
      setIsSavingGoal(false);
    }
  };

  const openEditGoal = (goal: Goal) => {
    setEditingGoal(goal);
    setGoalSaveError('');
    setName(goal.name);
    setSportType(goal.sport_type);
    setPriority(goal.priority);
    setTargetDate(goal.target_date ?? '');
    setTimeframeText(goal.timeframe_text ?? '');
    setObjectiveSummary(goal.objective_summary ?? '');
    setTargetDistanceMi(goal.target_distance_km ? String(roundTo(kmToMi(goal.target_distance_km), 2)) : '');
    setTargetElevationFt(goal.target_elevation_m ? String(Math.round(mToFt(goal.target_elevation_m))) : '');
    setTargetPowerWatts(goal.target_power_watts ? String(goal.target_power_watts) : '');
    setNotes(goal.notes ?? '');
    setPhases((goal.periodization_phases ?? []).map((p) => ({
      name: p.name,
      focus: p.focus ?? '',
      weeks: String(p.weeks ?? 1),
      target_ctl: p.target_ctl ? String(p.target_ctl) : '',
      status: p.status ?? 'UPCOMING',
    })));
    setMilestones((goal.milestones ?? []).map((m) => ({
      title: m.title,
      target_date: m.target_date ?? '',
      target_metric: m.target_metric ?? '',
      completed: Boolean(m.completed),
    })));
    setIsAddModalOpen(true);
  };

  const closeGoalModal = () => {
    setIsAddModalOpen(false);
    setEditingGoal(null);
    setGoalSaveError('');
    resetAddForm();
  };

  const resetAddForm = () => {
    setName('');
    setObjectiveSummary('');
    setTargetDate('');
    setTimeframeText('Flexible / Next Season');
    setTargetDistanceMi('');
    setTargetElevationFt('');
    setTargetPowerWatts('');
    setNotes('');
    setSportType('cycling');
    setPriority('A_RACE');
    setPhases([]);
    setMilestones([]);
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
          <p className="text-xs text-slate-400">High-level objectives, coach macrocycle strategies, and post-event completion debriefs</p>
        </div>

        <button
          onClick={() => { resetAddForm(); setEditingGoal(null); setIsAddModalOpen(true); }}
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
          const isCoachCreated = goal.creator === 'coach';

          return (
            <div
              key={goal.id}
              className={`glass-panel-interactive rounded-2xl p-6 flex flex-col justify-between space-y-4 ${
                isCompleted ? 'border-emerald-500/30 bg-emerald-950/10' : isCoachCreated ? 'border-amber-500/30 bg-gradient-to-b from-slate-900 via-slate-900/90 to-slate-950' : ''
              }`}
            >
              <div className="space-y-3">
                {/* Header Pills */}
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center space-x-2">
                    <span className={`text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-full border flex items-center ${getSportBadgeColor(goal.sport_type)}`}>
                      <IconComponent className="w-3 h-3 mr-1" />
                      {goal.sport_type.replace('_', ' ')}
                    </span>

                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-white/5">
                      {goal.priority.replace('_', ' ')}
                    </span>

                    {isCoachCreated && (
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                        <Bot className="w-3 h-3 text-amber-400" />
                        Coach's Strategy
                      </span>
                    )}
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
                        Dist: <strong className="text-white">{formatMilesFromKm(goal.target_distance_km)}</strong>
                      </span>
                    )}
                    {goal.target_elevation_m && (
                      <span className="px-2.5 py-1 rounded-lg bg-slate-900 border border-white/5 text-xs text-slate-300">
                        Elev: <strong className="text-white">{formatFeetFromMeters(goal.target_elevation_m)}</strong>
                      </span>
                    )}
                    {goal.target_power_watts && (
                      <span className="px-2.5 py-1 rounded-lg bg-slate-900 border border-white/5 text-xs text-slate-300">
                        Target Effort: <strong className="text-amber-400">{goal.target_power_watts} W</strong>
                      </span>
                    )}
                  </div>
                )}

                {/* Periodization Phases Roadmap if available */}
                {goal.periodization_phases && goal.periodization_phases.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-white/10">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300">
                      <Layers className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Periodization Phases ({goal.periodization_phases.length})</span>
                    </div>
                    <div className="space-y-1.5">
                      {goal.periodization_phases.map((phase, pIdx) => (
                        <div key={pIdx} className="rounded-lg bg-slate-950/70 p-2.5 border border-white/5 text-xs space-y-0.5">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-white text-[11px]">{phase.name}</span>
                            <span className="text-[10px] text-cyan-300 font-mono bg-cyan-500/10 px-1.5 py-0.5 rounded">
                              {phase.weeks} wks
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400">{phase.focus}</p>
                          {phase.target_ctl && (
                            <p className="text-[10px] text-emerald-400 font-mono">Target CTL: ~{phase.target_ctl}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Milestones if available */}
                {goal.milestones && goal.milestones.length > 0 && (
                  <div className="space-y-1 pt-2 border-t border-white/10">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300">
                      <Flag className="w-3.5 h-3.5 text-amber-400" />
                      <span>Checkpoints & Milestones</span>
                    </div>
                    <div className="space-y-1">
                      {goal.milestones.map((ms, mIdx) => (
                        <div key={mIdx} className="flex items-center justify-between text-xs bg-slate-950/50 p-2 rounded-lg border border-white/5">
                          <span className="text-slate-300 text-[11px]">{ms.title}</span>
                          {ms.target_metric && (
                            <span className="text-[10px] font-mono text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded">
                              {ms.target_metric}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
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
              <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-white/5">
                {onDiscussGoal && !isCompleted && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => onDiscussGoal(goal)}
                      className="min-h-10 inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-xs font-semibold transition-all"
                      title="Discuss or replan this goal with the AI coach"
                    >
                      <Bot className="w-3.5 h-3.5" />
                      <span>Discuss / Replan with Coach</span>
                    </button>
                    <button
                      onClick={() => onDiscussGoal(goal, `Build next week's training plan specifically aligned with my goal: ${goal.name}`)}
                      className="min-h-10 inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 text-xs font-semibold transition-all"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Plan Next Week</span>
                    </button>
                  </div>
                )}

                <div className="flex items-center space-x-2 ml-auto">
                  <button
                    onClick={() => openEditGoal(goal)}
                    className="min-h-10 flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 text-xs font-semibold transition-all"
                    title="Edit goal"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    <span>Edit</span>
                  </button>

                  {!isCompleted && (
                    <button
                      onClick={() => setDebriefModalGoal(goal)}
                      className="min-h-10 flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 text-xs font-semibold transition-all"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Mark Completed</span>
                    </button>
                  )}

                  <button
                    onClick={() => onDeleteGoal(goal.id)}
                    className="min-h-10 flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 text-xs font-medium transition-all"
                    title="Remove or deprioritize goal"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Remove</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* CREATE NEW GOAL MODAL */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md overflow-y-auto">
          <div className="w-full max-w-xl glass-panel rounded-3xl border border-cyan-500/30 p-6 shadow-2xl space-y-5 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h2 className="text-lg font-bold text-white flex items-center">
                {editingGoal
                  ? <><Pencil className="w-5 h-5 mr-1.5 text-cyan-400" /> Edit Goal Objective</>
                  : <><Plus className="w-5 h-5 mr-1.5 text-cyan-400" /> Add New Goal Objective</>}
              </h2>
              <button onClick={closeGoalModal} className="p-1 text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitGoal} className="space-y-4">
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
                  placeholder="e.g. Local hill climb, sub-1:45 finish"
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
                  placeholder="e.g. Sub-8 hour car-to-car single day push with a 25 lb pack, maintaining 1,800 ft/h VAM"
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
                  <label className="text-[11px] text-slate-400">Distance (mi)</label>
                  <input
                    type="number"
                    value={targetDistanceMi}
                    onChange={(e) => setTargetDistanceMi(e.target.value)}
                    className="w-full mt-1 bg-slate-900 border border-white/10 rounded-xl px-2 py-1.5 text-xs text-white"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-slate-400">Elevation Gain (ft)</label>
                  <input
                    type="number"
                    value={targetElevationFt}
                    onChange={(e) => setTargetElevationFt(e.target.value)}
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

              <div>
                <label className="text-xs font-semibold text-slate-300">Notes (Optional)</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full mt-1 bg-slate-900 border border-white/10 rounded-xl p-3 text-xs text-slate-200 focus:border-cyan-500"
                />
              </div>

              {editingGoal && (
                <>
                  {/* Periodization phases */}
                  <div className="space-y-2 border-t border-white/10 pt-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-300 flex items-center"><Layers className="w-3.5 h-3.5 mr-1 text-cyan-400" /> Periodization Phases</span>
                      <button
                        type="button"
                        onClick={() => setPhases((prev) => [...prev, { name: '', focus: '', weeks: '4', target_ctl: '', status: 'UPCOMING' }])}
                        className="text-xs font-semibold text-cyan-300 hover:text-cyan-200"
                      >
                        + Add phase
                      </button>
                    </div>
                    {phases.map((phase, i) => (
                      <div key={i} className="rounded-xl bg-slate-950/60 border border-white/5 p-2.5 space-y-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            placeholder="Phase name"
                            value={phase.name}
                            onChange={(e) => setPhases((prev) => prev.map((p, j) => j === i ? { ...p, name: e.target.value } : p))}
                            className="flex-1 min-w-0 bg-slate-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white"
                          />
                          <button
                            type="button"
                            onClick={() => setPhases((prev) => prev.filter((_, j) => j !== i))}
                            aria-label={`Remove phase ${phase.name || i + 1}`}
                            className="p-1 text-slate-400 hover:text-rose-300"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                        <input
                          type="text"
                          placeholder="Focus"
                          value={phase.focus}
                          onChange={(e) => setPhases((prev) => prev.map((p, j) => j === i ? { ...p, focus: e.target.value } : p))}
                          className="w-full bg-slate-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                        />
                        <div className="grid grid-cols-3 gap-2">
                          <label className="text-[10px] text-slate-400">
                            Weeks
                            <input
                              type="number"
                              min={1}
                              value={phase.weeks}
                              onChange={(e) => setPhases((prev) => prev.map((p, j) => j === i ? { ...p, weeks: e.target.value } : p))}
                              className="w-full mt-0.5 bg-slate-900 border border-white/10 rounded-lg px-2 py-1 text-xs text-white"
                            />
                          </label>
                          <label className="text-[10px] text-slate-400">
                            Target CTL
                            <input
                              type="number"
                              value={phase.target_ctl}
                              onChange={(e) => setPhases((prev) => prev.map((p, j) => j === i ? { ...p, target_ctl: e.target.value } : p))}
                              className="w-full mt-0.5 bg-slate-900 border border-white/10 rounded-lg px-2 py-1 text-xs text-white"
                            />
                          </label>
                          <label className="text-[10px] text-slate-400">
                            Status
                            <select
                              value={phase.status}
                              onChange={(e) => setPhases((prev) => prev.map((p, j) => j === i ? { ...p, status: e.target.value as PhaseDraft['status'] } : p))}
                              className="w-full mt-0.5 bg-slate-900 border border-white/10 rounded-lg px-1.5 py-1 text-xs text-white"
                            >
                              <option value="UPCOMING">Upcoming</option>
                              <option value="CURRENT">Current</option>
                              <option value="COMPLETED">Completed</option>
                            </select>
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Milestones */}
                  <div className="space-y-2 border-t border-white/10 pt-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-300 flex items-center"><Flag className="w-3.5 h-3.5 mr-1 text-amber-400" /> Checkpoints & Milestones</span>
                      <button
                        type="button"
                        onClick={() => setMilestones((prev) => [...prev, { title: '', target_date: '', target_metric: '', completed: false }])}
                        className="text-xs font-semibold text-cyan-300 hover:text-cyan-200"
                      >
                        + Add milestone
                      </button>
                    </div>
                    {milestones.map((ms, i) => (
                      <div key={i} className="rounded-xl bg-slate-950/60 border border-white/5 p-2.5 space-y-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={ms.completed}
                            onChange={(e) => setMilestones((prev) => prev.map((m, j) => j === i ? { ...m, completed: e.target.checked } : m))}
                            aria-label="Completed"
                            className="h-4 w-4 accent-cyan-500"
                          />
                          <input
                            type="text"
                            placeholder="Milestone"
                            value={ms.title}
                            onChange={(e) => setMilestones((prev) => prev.map((m, j) => j === i ? { ...m, title: e.target.value } : m))}
                            className="flex-1 min-w-0 bg-slate-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white"
                          />
                          <button
                            type="button"
                            onClick={() => setMilestones((prev) => prev.filter((_, j) => j !== i))}
                            aria-label={`Remove milestone ${ms.title || i + 1}`}
                            className="p-1 text-slate-400 hover:text-rose-300"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            type="date"
                            value={ms.target_date}
                            onChange={(e) => setMilestones((prev) => prev.map((m, j) => j === i ? { ...m, target_date: e.target.value } : m))}
                            className="bg-slate-900 border border-white/10 rounded-lg px-2 py-1 text-xs text-white"
                          />
                          <input
                            type="text"
                            placeholder="Target metric (e.g. 275 W)"
                            value={ms.target_metric}
                            onChange={(e) => setMilestones((prev) => prev.map((m, j) => j === i ? { ...m, target_metric: e.target.value } : m))}
                            className="bg-slate-900 border border-white/10 rounded-lg px-2 py-1 text-xs text-white"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="flex justify-end space-x-2 pt-3 border-t border-white/10">
                <button
                  type="button"
                  onClick={closeGoalModal}
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
                  {isSavingGoal ? 'Saving...' : editingGoal ? 'Save Changes' : 'Save Goal Objective'}
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
