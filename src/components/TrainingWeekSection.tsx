import React, { useState } from 'react';
import type { Activity, TrainingSession } from '../types';
import { Sparkles, CalendarDays, Clock3, Trash2, Check, RotateCcw, Bot, RefreshCw, Link2 } from 'lucide-react';
import { SessionCompleteModal } from './SessionCompleteModal';
import { getLocalDateString, getWeekStartDate } from '../lib/trainingSessions';
import { AssessmentText } from './ActivityDetailModal';

export type AppTab = 'dashboard' | 'goals' | 'activities' | 'training' | 'performance' | 'coach';

export interface TrainingWeekSectionProps {
  trainingSessions: TrainingSession[];
  activities: Activity[];
  onOpenActivity: (activity: Activity) => void;
  onNavigateTab: (tab: AppTab) => void;
  onDeleteTrainingSessions?: (ids: string[]) => Promise<void>;
  /** Marks a session complete and links the activities that did it; synced is false when the links could only be kept on this device */
  onCompleteTrainingSession?: (id: string, activityIds: string[]) => Promise<{ synced: boolean }>;
  onReopenTrainingSession?: (id: string) => Promise<void>;
  /** Asks the coach to assess a completed session from its linked activities; synced is false when it could only be kept on this device */
  onAssessTrainingSession?: (id: string) => Promise<{ synced: boolean }>;
  /** Scores a completed session against its plan (software only); synced is false when it could only be kept on this device */
  onScoreTrainingSession?: (id: string) => Promise<{ synced: boolean }>;
  /** Sessions being scored right now */
  scoringSessionIds?: string[];
  /** 'plan' (default): the open sessions with the plan header and actions. 'log': one past week's sessions inside the training log */
  variant?: 'plan' | 'log';
  /** Every session, so the activity picker can flag activities already linked elsewhere */
  allSessions?: TrainingSession[];
}

/** The accepted sessions of the current and coming weeks: mark complete, link activities, assess, delete. */
export const TrainingWeekSection: React.FC<TrainingWeekSectionProps> = ({
  trainingSessions,
  activities,
  onOpenActivity,
  onNavigateTab,
  onDeleteTrainingSessions,
  onCompleteTrainingSession,
  onReopenTrainingSession,
  onAssessTrainingSession,
  onScoreTrainingSession,
  scoringSessionIds = [],
  variant = 'plan',
  allSessions,
}) => {
  const today = getLocalDateString();
  const [completing, setCompleting] = useState<TrainingSession | null>(null);
  const [sessionNotice, setSessionNotice] = useState('');
  const [assessingSessionId, setAssessingSessionId] = useState<string | null>(null);
  const [assessErrors, setAssessErrors] = useState<Record<string, string>>({});

  const scoreSession = async (id: string) => {
    if (!onScoreTrainingSession) return;
    setAssessErrors((prev) => ({ ...prev, [id]: '' }));
    try {
      const { synced } = await onScoreTrainingSession(id);
      setSessionNotice(synced ? '' : 'The score is saved on this device only until the database is updated (run the latest supabase/schema.sql).');
    } catch (err) {
      setAssessErrors((prev) => ({ ...prev, [id]: err instanceof Error ? err.message : 'The session could not be scored.' }));
    }
  };

  const assessSession = async (id: string) => {
    if (!onAssessTrainingSession) return;
    setAssessingSessionId(id);
    setAssessErrors((prev) => ({ ...prev, [id]: '' }));
    try {
      const { synced } = await onAssessTrainingSession(id);
      setSessionNotice(synced ? '' : 'The assessment is saved on this device only until the database is updated (run the latest supabase/schema.sql).');
    } catch (err) {
      setAssessErrors((prev) => ({ ...prev, [id]: err instanceof Error ? err.message : 'The assessment could not be generated.' }));
    } finally {
      setAssessingSessionId(null);
    }
  };
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

  return (
      <section className={variant === 'plan' ? 'border-b border-white/10 pb-6 space-y-3' : 'space-y-3'}>
        {variant === 'plan' && (
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-cyan-400" /> This week
            </h2>
            <p className="text-xs text-slate-400 mt-1">Sessions still to do. Completed ones move to the training log below.</p>
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
        )}

        {completing && onCompleteTrainingSession && (
          <SessionCompleteModal
            session={completing}
            activities={activities}
            sessions={allSessions ?? trainingSessions}
            onCancel={() => setCompleting(null)}
            onConfirm={async (ids) => {
              const { synced } = await onCompleteTrainingSession(completing.id, ids);
              setCompleting(null);
              setSessionNotice(synced ? '' : 'Marked complete. The activity links are saved on this device only until the database is updated (run the latest supabase/schema.sql).');
            }}
          />
        )}
        {sessionNotice && (
          <p role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">{sessionNotice}</p>
        )}
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
                  <span className={`shrink-0 text-[10px] font-semibold ${session.status === 'COMPLETED' ? 'text-emerald-300' : session.session_date < today ? 'text-amber-300' : 'text-cyan-300'}`}>
                    {session.status === 'COMPLETED' ? 'Completed' : session.session_date < today ? (variant === 'log' && session.session_date < getWeekStartDate(today) ? 'Missed' : 'Not done yet') : 'Planned'}
                  </span>
                </div>
                <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-300">
                  <Clock3 className="w-3.5 h-3.5 text-slate-500" /> {session.duration_minutes} min
                  {session.target_tss != null && <span className="ml-2 text-amber-300">{session.target_tss} TSS</span>}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">{session.details}</p>
                {session.status === 'COMPLETED' && (session.completed_activity_ids?.length ?? 0) > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {session.completed_activity_ids!.map((id) => {
                      const linked = activities.find((a) => a.id === id);
                      return linked ? (
                        <button
                          key={id}
                          type="button"
                          onClick={() => onOpenActivity(linked)}
                          className="max-w-full truncate rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] text-emerald-200 hover:bg-emerald-500/20"
                          title="Open this activity"
                        >
                          {linked.title}
                        </button>
                      ) : null;
                    })}
                  </div>
                )}
                {session.status === 'COMPLETED' && (session.completed_activity_ids?.length ?? 0) === 0 && onAssessTrainingSession && (
                  <p className="mt-3 text-[11px] text-slate-500">Link the activities that did this session (Edit links) to get a coach assessment.</p>
                )}
                {session.status === 'COMPLETED' && (session.completed_activity_ids?.length ?? 0) > 0 && (
                  <SessionScoreBlock
                    session={session}
                    scoring={scoringSessionIds.includes(session.id)}
                    onScore={onScoreTrainingSession ? () => void scoreSession(session.id) : undefined}
                    hasAssessment={Boolean(session.coach_assessment)}
                  />
                )}
                {assessErrors[session.id] && <p role="alert" className="mt-2 text-xs text-rose-400">{assessErrors[session.id]}</p>}
                {session.status === 'COMPLETED' && session.coach_assessment && (
                  <details open className="mt-3 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
                    <summary className="cursor-pointer text-xs font-semibold text-cyan-300 flex items-center gap-1.5">
                      <Bot className="w-3.5 h-3.5" /> Coach assessment
                      {session.coach_assessment_at && (
                        <span className="font-normal text-slate-500"> · {new Date(session.coach_assessment_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                      )}
                    </summary>
                    <div className="mt-2"><AssessmentText text={session.coach_assessment} /></div>
                  </details>
                )}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-1">
                    {session.status === 'COMPLETED' ? (
                      <>
                        {onAssessTrainingSession && (
                          <button
                            type="button"
                            disabled={assessingSessionId === session.id || (session.completed_activity_ids?.length ?? 0) === 0}
                            onClick={() => void assessSession(session.id)}
                            title={(session.completed_activity_ids?.length ?? 0) === 0 ? 'Link the activities that did this session to enable the assessment' : 'Ask the coach to assess this session from its linked activities'}
                            className="min-h-9 inline-flex items-center gap-1.5 px-3 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {session.coach_assessment ? <RefreshCw className={`w-3.5 h-3.5 ${assessingSessionId === session.id ? 'animate-spin' : ''}`} /> : <Bot className="w-3.5 h-3.5" />}
                            {assessingSessionId === session.id ? 'Assessing…' : session.coach_assessment ? 'Regenerate assessment' : 'Generate assessment'}
                          </button>
                        )}
                        {onCompleteTrainingSession && (
                          <button
                            type="button"
                            onClick={() => setCompleting(session)}
                            className="min-h-9 inline-flex items-center gap-1.5 px-2 text-xs font-semibold text-slate-400 hover:text-white"
                          >
                            <Link2 className="w-3.5 h-3.5" /> Edit links
                          </button>
                        )}
                        {onReopenTrainingSession && (
                          <button
                            type="button"
                            onClick={() => void onReopenTrainingSession(session.id)}
                            className="min-h-9 inline-flex items-center gap-1.5 px-2 text-xs font-semibold text-slate-400 hover:text-white"
                          >
                            <RotateCcw className="w-3.5 h-3.5" /> Mark not done
                          </button>
                        )}
                      </>
                    ) : (
                      onCompleteTrainingSession && (
                        <button
                          type="button"
                          onClick={() => setCompleting(session)}
                          className="min-h-9 inline-flex items-center gap-1.5 px-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20"
                        >
                          <Check className="w-3.5 h-3.5" /> Mark complete
                        </button>
                      )
                    )}
                  </span>
                {onDeleteTrainingSessions && (
                  <div className="flex justify-end">
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
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-white/10 px-4 py-5 text-sm text-slate-400">
            {variant === 'plan'
              ? 'Nothing left to do this week. Generate the next week in the AI Coach, or see what you did in the training log below.'
              : 'No planned sessions this week.'}
          </div>
        )}
      </section>
  );
};

/** Dashboard preview: the next sessions still to do, with a link to the full plan. */
export const NextSessionsPreview: React.FC<{ sessions: TrainingSession[]; onNavigateTab: (tab: AppTab) => void }> = ({ sessions, onNavigateTab }) => {
  const next = sessions.filter((s) => s.status !== 'COMPLETED').slice(0, 3);
  const doneThisWeek = sessions.filter((s) => s.status === 'COMPLETED').length;
  return (
    <section className="border-b border-white/10 pb-6 space-y-3">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-cyan-400" /> Up next
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            {sessions.length === 0
              ? 'No accepted sessions yet.'
              : `${doneThisWeek} of ${sessions.length} planned ${sessions.length === 1 ? 'session' : 'sessions'} done.`}
          </p>
        </div>
        <button type="button" onClick={() => onNavigateTab('training')} className="text-xs font-semibold text-cyan-300 hover:underline">
          Open training plan
        </button>
      </div>
      {next.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {next.map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => onNavigateTab('training')}
              className="text-left rounded-lg border border-white/10 bg-slate-900/50 p-3 hover:bg-white/5"
            >
              <p className="text-[10px] font-semibold uppercase text-cyan-300">
                {new Date(`${session.session_date}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                {' · '}{session.sport_type.replace('_', ' ')}
              </p>
              <p className="mt-1 text-sm font-bold text-white">{session.title}</p>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
                <Clock3 className="w-3.5 h-3.5" /> {session.duration_minutes} min
                {session.target_tss != null && <span className="ml-1 text-amber-300">{session.target_tss} TSS</span>}
              </p>
            </button>
          ))}
        </div>
      )}
    </section>
  );
};

const VERDICT_STYLE: Record<NonNullable<TrainingSession['auto_score']>['verdict'], { box: string; text: string; label: string }> = {
  on_plan: { box: 'border-emerald-500/30 bg-emerald-500/10', text: 'text-emerald-200', label: 'On plan' },
  partly: { box: 'border-amber-500/30 bg-amber-500/10', text: 'text-amber-200', label: 'Partly on plan' },
  off_plan: { box: 'border-rose-500/30 bg-rose-500/10', text: 'text-rose-200', label: 'Off plan' },
  unmeasured: { box: 'border-white/10 bg-white/5', text: 'text-slate-300', label: 'Not measurable' },
};
const ITEM_MARK: Record<'met' | 'partial' | 'missed' | 'info', { mark: string; color: string }> = {
  met: { mark: '✓', color: 'text-emerald-400' },
  partial: { mark: '~', color: 'text-amber-400' },
  missed: { mark: '✗', color: 'text-rose-400' },
  info: { mark: '–', color: 'text-slate-500' },
};

/** The software verdict on a completed session: how the linked activities matched the plan, no AI involved. */
const SessionScoreBlock: React.FC<{ session: TrainingSession; scoring: boolean; onScore?: () => void; hasAssessment: boolean }> = ({ session, scoring, onScore, hasAssessment }) => {
  const linked = session.completed_activity_ids ?? [];
  const score = session.auto_score;
  // A score from a different set of linked activities is out of date
  const current = score && score.activity_ids.length === linked.length && score.activity_ids.every((id) => linked.includes(id));
  if (scoring) return <p role="status" className="mt-3 text-[11px] text-slate-400">Scoring against the plan…</p>;
  if (!score || !current) {
    return onScore ? (
      <button type="button" onClick={onScore} className="mt-3 min-h-9 inline-flex items-center gap-1.5 px-3 rounded-lg border border-white/10 text-xs font-semibold text-slate-300 hover:text-white hover:bg-white/5">
        <Check className="w-3.5 h-3.5" /> Score against the plan
      </button>
    ) : null;
  }
  const style = VERDICT_STYLE[score.verdict];
  return (
    <details open={score.verdict !== 'on_plan'} className={`mt-3 rounded-lg border p-3 ${style.box}`}>
      <summary className={`cursor-pointer text-xs font-semibold ${style.text}`}>{score.headline}</summary>
      <ul className="mt-2 space-y-1">
        {score.items.map((item, i) => (
          <li key={i} className="flex gap-2 text-[11px] leading-snug text-slate-300">
            <span className={`shrink-0 font-bold ${ITEM_MARK[item.status].color}`} aria-label={item.status}>{ITEM_MARK[item.status].mark}</span>
            <span><span className="font-semibold text-slate-200">{item.label}.</span> {item.detail}</span>
          </li>
        ))}
      </ul>
      {(score.verdict === 'partly' || score.verdict === 'off_plan') && !hasAssessment && (
        <p className="mt-2 text-[11px] text-slate-400">Want the why? Generate the coach assessment below.</p>
      )}
    </details>
  );
};
