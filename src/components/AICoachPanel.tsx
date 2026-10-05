import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Sparkles, Terminal, Activity, ShieldAlert, ChevronDown, ChevronUp, CalendarDays, Check, X, Zap, Award, Flag, Layers } from 'lucide-react';
import type { AICoachMessage, Goal, ProposedGoalAction, ProposedPlanAction, TrainingSession, TrainingSessionStatus } from '../types';
import { coachEngine } from '../lib/ai/coachEngine';
import { getNextTrainingWeekStartDate } from '../lib/trainingSessions';

interface AICoachPanelProps {
  trainingSessions: TrainingSession[];
  isGeneratingWeeklyPlan: boolean;
  onGenerateWeeklyPlan: () => Promise<void>;
  onUpdateTrainingSession: (id: string, status: TrainingSessionStatus) => Promise<void>;
  onAcceptProposedPlan?: (proposal: ProposedPlanAction) => Promise<void>;
  onAcceptProposedGoal?: (goal: Goal) => Promise<void>;
}

export const AICoachPanel: React.FC<AICoachPanelProps> = ({
  trainingSessions,
  isGeneratingWeeklyPlan,
  onGenerateWeeklyPlan,
  onUpdateTrainingSession,
  onAcceptProposedPlan,
  onAcceptProposedGoal,
}) => {
  const [messages, setMessages] = useState<AICoachMessage[]>([
    {
      id: 'init-msg',
      sender: 'coach',
      text: `### 🏔️ Summit AI Coach Ready
Welcome back! I am monitoring your multi-sport endurance metrics across **Road Cycling, Skimo, Backcountry Skiing, Peak Scrambling, and Weighted Hiking**.

#### ⚡ Current Snapshot:
- **Mount Baker Hill Climb Goal:** 280W target (98% readiness)
- **Knee & Posterior Chain Status:** Active awareness on steep gradients >12%.
- **Decompression Night Protocol:** Mid-week hamstring mobility + isometric knee extensions.

I can build **multi-week periodized macro plans**, set up **Coach's Goals**, and adapt your **weekly workouts** on demand. How can I optimize your training today?`,
      timestamp: '12:00 PM'
    }
  ]);

  const [inputQuery, setInputQuery] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [planError, setPlanError] = useState('');
  const [updatingSessionId, setUpdatingSessionId] = useState<string | null>(null);
  const [planActionMsgId, setPlanActionMsgId] = useState<string | null>(null);
  const [goalActionMsgId, setGoalActionMsgId] = useState<string | null>(null);
  const [expandedToolLogs, setExpandedToolLogs] = useState<Record<string, boolean>>({});
  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isProcessing]);

  const handleSendMessage = async (textToSend?: string) => {
    const query = textToSend || inputQuery;
    if (!query.trim() || isProcessing) return;

    const userMsg: AICoachMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: query,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setInputQuery('');
    setIsProcessing(true);

    try {
      // Execute AI Coach tool calling engine
      const coachResponse = await coachEngine.processUserQuery(query);
      setMessages((prev) => [...prev, coachResponse]);
    } catch (err) {
      console.error('AI Coach Error:', err);
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          sender: 'coach',
          text: 'I encountered an issue connecting to the activity database. Please try again.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleToolLogs = (msgId: string) => {
    setExpandedToolLogs((prev) => ({ ...prev, [msgId]: !prev[msgId] }));
  };

  const handleAcceptPlanProposal = async (msgId: string, proposal: ProposedPlanAction) => {
    setPlanActionMsgId(msgId);
    setPlanError('');
    try {
      if (onAcceptProposedPlan) {
        await onAcceptProposedPlan(proposal);
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId && m.proposedPlan
            ? { ...m, proposedPlan: { ...m.proposedPlan, isAccepted: true, isDeclined: false } }
            : m
        )
      );
    } catch (err: any) {
      setPlanError(err?.message || 'The proposed plan could not be applied.');
    } finally {
      setPlanActionMsgId(null);
    }
  };

  const handleDeclinePlanProposal = (msgId: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId && m.proposedPlan
          ? { ...m, proposedPlan: { ...m.proposedPlan, isDeclined: true, isAccepted: false } }
          : m
      )
    );
  };

  const handleAcceptGoalProposal = async (msgId: string, goalAction: ProposedGoalAction) => {
    setGoalActionMsgId(msgId);
    setPlanError('');
    try {
      if (onAcceptProposedGoal) {
        await onAcceptProposedGoal(goalAction.goal);
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId && m.proposedGoal
            ? { ...m, proposedGoal: { ...m.proposedGoal, isAccepted: true, isDeclined: false } }
            : m
        )
      );
    } catch (err: any) {
      setPlanError(err?.message || 'The coach goal could not be saved.');
    } finally {
      setGoalActionMsgId(null);
    }
  };

  const handleDeclineGoalProposal = (msgId: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId && m.proposedGoal
          ? { ...m, proposedGoal: { ...m.proposedGoal, isDeclined: true, isAccepted: false } }
          : m
      )
    );
  };

  const handleGenerateWeeklyPlan = async () => {
    setPlanError('');
    try {
      await onGenerateWeeklyPlan();
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : 'The weekly plan could not be saved.');
    }
  };

  const handleSessionStatus = async (session: TrainingSession, status: TrainingSessionStatus) => {
    setUpdatingSessionId(session.id);
    setPlanError('');
    try {
      await onUpdateTrainingSession(session.id, status);
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : 'The session could not be updated.');
    } finally {
      setUpdatingSessionId(null);
    }
  };

  const nextWeekStartDate = getNextTrainingWeekStartDate();
  const proposedSessions = trainingSessions.filter(
    (session) => session.status === 'PROPOSED' && session.week_start_date === nextWeekStartDate
  );

  const quickPrompts = [
    'Set up 12-week Mount Rainier alpine preparation plan',
    'Create 8-week FTP boost block to 300W',
    'Plan next week with skimo & climbing focus',
    'Replan this week for knee recovery'
  ];

  return (
    <div className="w-full max-w-5xl mx-auto glass-panel rounded-2xl border border-white/10 flex flex-col h-[min(750px,calc(100dvh-9rem))] min-h-[560px] shadow-2xl overflow-hidden">
      
      {/* Header */}
      <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-white/10 bg-slate-950/60 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-400 p-[2px]">
            <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
              <Bot className="w-5 h-5 text-amber-400" />
            </div>
          </div>
          <div>
            <h2 className="text-sm font-bold text-white flex items-center space-x-2">
              <span>Summit Intelligence AI Coach</span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center gap-1">
                <Zap className="w-2.5 h-2.5" />
                Gemini Flash
              </span>
            </h2>
            <p className="text-[11px] text-slate-400">Contextual multi-sport database integration & injury guardian</p>
          </div>
        </div>

        {/* Quick Context Chips */}
        <div className="hidden md:flex items-center space-x-2 text-xs">
          <div className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <Activity className="w-3.5 h-3.5" />
            <span>Multi-Sport Context</span>
          </div>
          <div className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400">
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Knee Guardian</span>
          </div>
        </div>
      </div>

      {/* Individually accepted weekly proposals */}
      <section className="border-b border-white/10 bg-slate-950/35 px-5 py-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-cyan-400" /> Next Week's Sessions
            </h3>
            <p className="text-[11px] text-slate-400 mt-1">Review and accept each workout separately.</p>
          </div>
          <button
            type="button"
            onClick={() => void handleGenerateWeeklyPlan()}
            disabled={isGeneratingWeeklyPlan}
            className="min-h-11 inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-500 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
          >
            <Sparkles className={`w-3.5 h-3.5 ${isGeneratingWeeklyPlan ? 'animate-pulse' : ''}`} />
            {isGeneratingWeeklyPlan ? 'Building plan...' : 'Generate weekly plan'}
          </button>
        </div>

        {planError && <p role="alert" className="text-xs text-rose-300">{planError}</p>}

        {proposedSessions.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
            {proposedSessions.map((session) => (
              <article key={session.id} className="rounded-lg border border-white/10 bg-slate-900/70 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase text-cyan-300">
                      {new Date(`${session.session_date}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                      {' · '}{session.sport_type.replace('_', ' ')}
                    </p>
                    <h4 className="mt-1 text-sm font-bold text-white">{session.title}</h4>
                    <p className="mt-1 text-xs text-slate-400">{session.duration_minutes} min · {session.focus}</p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-300">{session.details}</p>
                  </div>
                  <span className="shrink-0 text-[10px] text-amber-300">{session.target_tss ?? '—'} TSS</span>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void handleSessionStatus(session, 'ACCEPTED')}
                    disabled={updatingSessionId === session.id}
                    className="min-h-11 inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
                  >
                    <Check className="w-3.5 h-3.5" /> Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSessionStatus(session, 'DECLINED')}
                    disabled={updatingSessionId === session.id}
                    aria-label={`Skip ${session.title}`}
                    title="Skip session"
                    className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-md border border-white/10 text-slate-400 hover:text-white disabled:opacity-50"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-500">No proposed sessions. Generate a plan to review workouts for next week.</p>
        )}
      </section>

      {/* Message Feed */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-gradient-to-b from-slate-950/40 via-summit-dark/60 to-slate-950/40">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex items-start space-x-3 ${
              msg.sender === 'user' ? 'flex-row-reverse space-x-reverse' : ''
            }`}
          >
            {/* Avatar */}
            <div
              className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
                msg.sender === 'user'
                  ? 'bg-cyan-500 text-slate-950 font-bold'
                  : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
              }`}
            >
              {msg.sender === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
            </div>

            {/* Content Bubble */}
            <div className={`max-w-2xl space-y-2`}>
              <div
                className={`p-4 rounded-2xl text-sm leading-relaxed ${
                  msg.sender === 'user'
                    ? 'bg-cyan-500/10 border border-cyan-500/30 text-cyan-50 text-right rounded-tr-none'
                    : 'glass-panel border-white/10 text-slate-200 rounded-tl-none'
                }`}
              >
                {/* Formatted Markdown Render */}
                <div className="prose prose-invert prose-sm max-w-none space-y-2">
                  {msg.text.split('\n\n').map((paragraph, pIdx) => (
                    <div key={pIdx}>
                      {paragraph.startsWith('### ') ? (
                        <h3 className="text-base font-bold text-amber-300 mt-1 mb-2">{paragraph.replace('### ', '')}</h3>
                      ) : paragraph.startsWith('#### ') ? (
                        <h4 className="text-sm font-semibold text-cyan-300 mt-2 mb-1">{paragraph.replace('#### ', '')}</h4>
                      ) : (
                        <p className="whitespace-pre-line text-slate-300">{paragraph}</p>
                      )}
                    </div>
                  ))}
                </div>

                <div className={`mt-2 text-[10px] text-slate-400 ${msg.sender === 'user' ? 'text-right' : 'text-left'}`}>
                  {msg.timestamp}
                </div>
              </div>

              {/* Proposal Card embedded in chat if AI generated/modified workouts */}
              {msg.proposedPlan && msg.proposedPlan.sessions.length > 0 && (
                <div className="rounded-2xl border border-cyan-500/30 bg-slate-900/95 p-4 shadow-2xl space-y-3">
                  {/* Header */}
                  <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-7 h-7 rounded-lg bg-cyan-500/20 text-cyan-400 flex items-center justify-center flex-shrink-0">
                        <CalendarDays className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-bold text-cyan-300 uppercase tracking-wider">
                            {msg.proposedPlan.type === 'REPLACE_WEEK'
                              ? 'Proposed Weekly Training Plan'
                              : msg.proposedPlan.type === 'UPDATE'
                              ? 'Proposed Workout Modification'
                              : msg.proposedPlan.type === 'DELETE'
                              ? 'Proposed Workout Removal'
                              : 'Proposed New Workout'}
                          </span>
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/10 text-slate-300">
                            {msg.proposedPlan.sessions.length} {msg.proposedPlan.sessions.length === 1 ? 'session' : 'sessions'}
                          </span>
                        </div>
                        {msg.proposedPlan.summary && (
                          <p className="text-xs text-slate-300 mt-0.5">{msg.proposedPlan.summary}</p>
                        )}
                      </div>
                    </div>
                    {msg.proposedPlan.isAccepted ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-1 rounded-full shrink-0">
                        <Check className="w-3.5 h-3.5" /> Added to Schedule
                      </span>
                    ) : msg.proposedPlan.isDeclined ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 bg-white/5 border border-white/10 px-2.5 py-1 rounded-full shrink-0">
                        <X className="w-3.5 h-3.5" /> Declined
                      </span>
                    ) : null}
                  </div>

                  {/* Sessions List */}
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {msg.proposedPlan.sessions.map((session, sIdx) => (
                      <div key={session.id || sIdx} className="rounded-xl border border-white/10 bg-slate-950/70 p-3 text-xs space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-white text-sm">{session.title}</span>
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/20 capitalize">
                                {session.sport_type.replace('_', ' ')}
                              </span>
                            </div>
                            <p className="text-[11px] font-medium text-slate-400 mt-1">
                              {new Date(`${session.session_date}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                              {' · '}{session.duration_minutes} min
                              {session.target_tss ? ` · ${session.target_tss} TSS` : ''}
                              {session.focus ? ` · Focus: ${session.focus}` : ''}
                            </p>
                          </div>
                          {session.target_tss && (
                            <span className="shrink-0 text-[11px] font-bold text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded">
                              {session.target_tss} TSS
                            </span>
                          )}
                        </div>
                        {session.details && (
                          <p className="text-slate-300 text-[11px] leading-relaxed bg-slate-900/90 p-2.5 rounded-lg border border-white/5 font-mono">
                            {session.details}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Action Buttons if not yet accepted/declined */}
                  {!msg.proposedPlan.isAccepted && !msg.proposedPlan.isDeclined && (
                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/10">
                      <button
                        type="button"
                        onClick={() => handleAcceptPlanProposal(msg.id, msg.proposedPlan!)}
                        disabled={planActionMsgId === msg.id}
                        className="min-h-10 inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-400 transition-all disabled:opacity-50 shadow-lg shadow-cyan-500/20"
                      >
                        <Check className="w-4 h-4" />
                        {planActionMsgId === msg.id
                          ? 'Applying to Schedule...'
                          : msg.proposedPlan.sessions.length > 1
                          ? `Accept & Add ${msg.proposedPlan.sessions.length} Workouts to Dashboard`
                          : 'Accept Workout & Add to Dashboard'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setInputQuery('Please replan this schedule with adjustments: ');
                        }}
                        disabled={planActionMsgId === msg.id}
                        className="min-h-10 inline-flex items-center justify-center gap-1.5 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3.5 py-2 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20 transition-all disabled:opacity-50"
                      >
                        <Sparkles className="w-3.5 h-3.5" /> Replan / Tweak
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeclinePlanProposal(msg.id)}
                        disabled={planActionMsgId === msg.id}
                        className="min-h-10 inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/10 px-3.5 py-2 text-xs font-semibold text-slate-400 hover:text-white hover:bg-white/5 transition-all disabled:opacity-50"
                      >
                        <X className="w-4 h-4" /> Decline
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Long-Term Goal & Periodization Proposal Card */}
              {msg.proposedGoal && (
                <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-b from-slate-900 via-slate-900/95 to-slate-950 p-5 shadow-2xl space-y-4">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-400 p-[2px] flex-shrink-0">
                        <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
                          <Award className="w-4 h-4 text-amber-400" />
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-amber-300 uppercase tracking-wider">
                            Coach's Long-Term Strategy & Goal
                          </span>
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20">
                            Macrocycle Plan
                          </span>
                        </div>
                        <h4 className="text-base font-extrabold text-white mt-0.5">
                          {msg.proposedGoal.goal.name}
                        </h4>
                      </div>
                    </div>
                    {msg.proposedGoal.isAccepted ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 px-3 py-1 rounded-full shrink-0">
                        <Check className="w-3.5 h-3.5" /> Added to Active Goals
                      </span>
                    ) : msg.proposedGoal.isDeclined ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 bg-white/5 border border-white/10 px-3 py-1 rounded-full shrink-0">
                        <X className="w-3.5 h-3.5" /> Declined
                      </span>
                    ) : null}
                  </div>

                  {/* Objective & Target Specs */}
                  <div className="space-y-2 text-xs">
                    <p className="text-slate-300 leading-relaxed bg-slate-950/60 p-3 rounded-xl border border-white/5">
                      <span className="text-amber-300 font-semibold">Objective:</span> {msg.proposedGoal.goal.objective_summary}
                    </p>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {msg.proposedGoal.goal.target_date && (
                        <div className="px-2.5 py-1 rounded-lg bg-slate-800/80 border border-white/10 text-slate-300 text-[11px] flex items-center gap-1">
                          <CalendarDays className="w-3 h-3 text-cyan-400" /> Target Date: <span className="font-bold text-white">{msg.proposedGoal.goal.target_date}</span>
                        </div>
                      )}
                      {msg.proposedGoal.goal.timeframe_text && (
                        <div className="px-2.5 py-1 rounded-lg bg-slate-800/80 border border-white/10 text-slate-300 text-[11px]">
                          Timeframe: <span className="font-bold text-white">{msg.proposedGoal.goal.timeframe_text}</span>
                        </div>
                      )}
                      {msg.proposedGoal.goal.target_power_watts && (
                        <div className="px-2.5 py-1 rounded-lg bg-slate-800/80 border border-white/10 text-amber-300 text-[11px]">
                          Target Power: <span className="font-bold text-white">{msg.proposedGoal.goal.target_power_watts}W</span>
                        </div>
                      )}
                      {msg.proposedGoal.goal.target_elevation_m && (
                        <div className="px-2.5 py-1 rounded-lg bg-slate-800/80 border border-white/10 text-sky-300 text-[11px]">
                          Target Vert: <span className="font-bold text-white">{msg.proposedGoal.goal.target_elevation_m}m</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Periodization Phases Breakdown */}
                  {msg.proposedGoal.goal.periodization_phases && msg.proposedGoal.goal.periodization_phases.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-white/10">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300">
                        <Layers className="w-3.5 h-3.5 text-cyan-400" />
                        <span>Periodization Roadmap ({msg.proposedGoal.goal.periodization_phases.length} Phases)</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {msg.proposedGoal.goal.periodization_phases.map((phase, pIdx) => (
                          <div key={pIdx} className="rounded-xl border border-white/5 bg-slate-950/70 p-3 text-xs space-y-1">
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-bold text-white text-[11px]">{phase.name}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/20 font-semibold">
                                {phase.weeks} wks
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-400 leading-snug">{phase.focus}</p>
                            {phase.target_ctl && (
                              <p className="text-[10px] text-emerald-400 font-mono">Target CTL: ~{phase.target_ctl}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Key Milestones */}
                  {msg.proposedGoal.goal.milestones && msg.proposedGoal.goal.milestones.length > 0 && (
                    <div className="space-y-1.5 pt-2 border-t border-white/10">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300">
                        <Flag className="w-3.5 h-3.5 text-amber-400" />
                        <span>Target Milestones</span>
                      </div>
                      <div className="space-y-1">
                        {msg.proposedGoal.goal.milestones.map((ms, mIdx) => (
                          <div key={mIdx} className="flex items-center justify-between text-xs bg-slate-950/50 p-2 rounded-lg border border-white/5">
                            <span className="text-slate-300">{ms.title}</span>
                            {ms.target_metric && (
                              <span className="text-[10px] font-mono text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                                {ms.target_metric}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Action Buttons if not yet accepted/declined */}
                  {!msg.proposedGoal.isAccepted && !msg.proposedGoal.isDeclined && (
                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/10">
                      <button
                        type="button"
                        onClick={() => handleAcceptGoalProposal(msg.id, msg.proposedGoal!)}
                        disabled={goalActionMsgId === msg.id}
                        className="min-h-10 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2 text-xs font-bold text-slate-950 hover:opacity-90 transition-all disabled:opacity-50 shadow-lg shadow-orange-500/20"
                      >
                        <Award className="w-4 h-4" />
                        {goalActionMsgId === msg.id ? 'Saving Goal...' : 'Accept & Set as Priority Goal'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeclineGoalProposal(msg.id)}
                        disabled={goalActionMsgId === msg.id}
                        className="min-h-10 inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/10 px-3.5 py-2 text-xs font-semibold text-slate-400 hover:text-white hover:bg-white/5 transition-all disabled:opacity-50"
                      >
                        <X className="w-4 h-4" /> Decline
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Tool Execution Logs if any */}
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="rounded-xl bg-slate-950/80 border border-white/10 p-3 text-xs text-slate-300 space-y-2">
                  <button
                    onClick={() => toggleToolLogs(msg.id)}
                    className="flex items-center justify-between w-full font-mono text-[11px] text-amber-400 hover:text-amber-300"
                  >
                    <span className="flex items-center">
                      <Terminal className="w-3.5 h-3.5 mr-1.5" />
                      Executed Database Tools ({msg.toolCalls.length})
                    </span>
                    {expandedToolLogs[msg.id] ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>

                  {expandedToolLogs[msg.id] && (
                    <div className="space-y-2 pt-2 border-t border-white/5 font-mono text-[11px]">
                      {msg.toolCalls.map((tc, idx) => (
                        <div key={idx} className="p-2 rounded bg-slate-900 border border-white/5 space-y-1">
                          <div className="text-cyan-400 font-semibold">⚡ fn: {tc.toolName}</div>
                          <div className="text-slate-400">args: {JSON.stringify(tc.args)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {isProcessing && (
          <div className="flex items-center space-x-3 text-xs text-amber-400">
            <div className="w-8 h-8 rounded-xl bg-amber-500/20 flex items-center justify-center animate-pulse">
              <Sparkles className="w-4 h-4 text-amber-400" />
            </div>
            <span className="font-mono">Gemini AI querying training database & reasoning...</span>
          </div>
        )}
        <div ref={chatBottomRef} />
      </div>

      {/* Quick Prompts & Input Controls */}
      <div className="p-4 border-t border-white/10 bg-slate-950/80 space-y-3">
        {/* Chips */}
        <div className="flex items-center space-x-2 overflow-x-auto pb-1 scrollbar-none">
          {quickPrompts.map((prompt, pIdx) => (
            <button
              key={pIdx}
              onClick={() => handleSendMessage(prompt)}
              disabled={isProcessing}
              className="min-h-10 flex-shrink-0 px-3 py-2 rounded-full bg-slate-900/90 hover:bg-white/10 border border-white/10 text-xs text-slate-300 hover:text-cyan-400 transition-all font-medium whitespace-nowrap"
            >
              {prompt}
            </button>
          ))}
        </div>

        {/* Input Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="flex items-center space-x-2"
        >
          <input
            type="text"
            placeholder="Ask AI Coach about Mount Baker prep, knee routines, skimo VAM, or recovery..."
            value={inputQuery}
            onChange={(e) => setInputQuery(e.target.value)}
            disabled={isProcessing}
            className="min-h-11 flex-1 min-w-0 bg-slate-900/90 border border-white/10 rounded-xl px-4 py-2.5 text-base sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50"
          />
          <button
            type="submit"
            disabled={!inputQuery.trim() || isProcessing}
            aria-label="Send message"
            className="min-h-11 min-w-11 flex items-center justify-center rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 font-bold hover:opacity-90 disabled:opacity-50 transition-all"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
