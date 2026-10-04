import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Sparkles, Terminal, Activity, ShieldAlert, ChevronDown, ChevronUp, CalendarDays, Check, X } from 'lucide-react';
import type { AICoachMessage, TrainingSession, TrainingSessionStatus } from '../types';
import { coachEngine } from '../lib/ai/coachEngine';
import { getNextTrainingWeekStartDate } from '../lib/trainingSessions';

interface AICoachPanelProps {
  trainingSessions: TrainingSession[];
  isGeneratingWeeklyPlan: boolean;
  onGenerateWeeklyPlan: () => Promise<void>;
  onUpdateTrainingSession: (id: string, status: TrainingSessionStatus) => Promise<void>;
}

export const AICoachPanel: React.FC<AICoachPanelProps> = ({
  trainingSessions,
  isGeneratingWeeklyPlan,
  onGenerateWeeklyPlan,
  onUpdateTrainingSession,
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

How can I optimize your training load today?`,
      timestamp: '12:00 PM'
    }
  ]);

  const [inputQuery, setInputQuery] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [planError, setPlanError] = useState('');
  const [updatingSessionId, setUpdatingSessionId] = useState<string | null>(null);
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
    'Mount Baker Hill Climb readiness check',
    'Knee health & wind-down routine for tonight',
    'Analyze my recent Skimo vs Cycling TSS',
    'Suggest recovery workout based on current TSB'
  ];

  return (
    <div className="w-full max-w-5xl mx-auto glass-panel rounded-2xl border border-white/10 flex flex-col h-[750px] shadow-2xl overflow-hidden">
      
      {/* Header */}
      <div className="px-6 py-4 border-b border-white/10 bg-slate-950/60 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-400 p-[2px]">
            <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
              <Bot className="w-5 h-5 text-amber-400" />
            </div>
          </div>
          <div>
            <h2 className="text-sm font-bold text-white flex items-center space-x-2">
              <span>Summit Intelligence AI Coach</span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                Tool Calling Active
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
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-500 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
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
                    className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2.5 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
                  >
                    <Check className="w-3.5 h-3.5" /> Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSessionStatus(session, 'DECLINED')}
                    disabled={updatingSessionId === session.id}
                    aria-label={`Skip ${session.title}`}
                    title="Skip session"
                    className="inline-flex items-center justify-center rounded-md border border-white/10 px-2 py-1.5 text-slate-400 hover:text-white disabled:opacity-50"
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
            <span className="font-mono">Apex AI Engine querying Supabase database & calculating metrics...</span>
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
              className="flex-shrink-0 px-3 py-1 rounded-full bg-slate-900/90 hover:bg-white/10 border border-white/10 text-xs text-slate-300 hover:text-cyan-400 transition-all font-medium whitespace-nowrap"
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
            className="flex-1 bg-slate-900/90 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50"
          />
          <button
            type="submit"
            disabled={!inputQuery.trim() || isProcessing}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 font-bold hover:opacity-90 disabled:opacity-50 transition-all flex items-center space-x-1"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
