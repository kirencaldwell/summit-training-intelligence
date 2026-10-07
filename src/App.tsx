import { useState, useEffect, useRef } from 'react';
import type { User } from '@supabase/supabase-js';
import type { AICoachMessage, Activity, AthleteProfile, Goal, PMCDayPoint, PowerCurvePoint, ProposedPlanAction, TrainingSession, TrainingSessionStatus } from './types';
import { dataService, isSupabaseConfigured, supabase } from './lib/supabase';
import { calculatePMC, calculatePowerCurve, canImproveWithAi, hasPowerCurveData } from './lib/trainingMath';
import { addDaysToDateOnly, getCurrentTrainingWeekStartDate, getNextTrainingWeekStartDate } from './lib/trainingSessions';
import {
  parseCorosAuthCode,
  exchangeCorosCode,
  setCorosTokens,
  clearCorosTokens,
  syncCorosActivities,
  getStoredCorosClientId,
} from './lib/coros';

import { Navbar } from './components/Navbar';
import { DashboardOverview } from './components/DashboardOverview';
import { ActivityList } from './components/ActivityList';
import { PowerCurveChart } from './components/PowerCurveChart';
import { HeartRateDistributionPage } from './components/HeartRateDistributionPage';
import { AICoachPanel, INITIAL_COACH_MESSAGES } from './components/AICoachPanel';
import { ActivityDetailModal } from './components/ActivityDetailModal';
import { AthleteProfileModal } from './components/AthleteProfileModal';
import { DataSyncModal } from './components/StravaConnectModal';
import { GoalsManager } from './components/GoalsManager';
import { GoogleSignInScreen } from './components/GoogleSignInScreen';
import { coachEngine } from './lib/ai/coachEngine';
import { formatLbFromKg } from './lib/units';
import { collectTags, isEbike } from './lib/tags';

import { Mountain, Zap } from 'lucide-react';

const CURRENT_YEAR = new Date().getFullYear();

export function App() {
  // Coach chat lives here so it survives tab switches (the panel unmounts), and is mirrored to localStorage for reloads
  const [coachMessages, setCoachMessages] = useState<AICoachMessage[]>(() => {
    try {
      const saved = localStorage.getItem('summit-coach-messages');
      const parsed = saved ? JSON.parse(saved) : null;
      // Swap any previously saved greeting for the current one
      if (Array.isArray(parsed) && parsed.length) {
        return parsed.map((m: AICoachMessage) => (m.id === 'init-msg' ? INITIAL_COACH_MESSAGES[0] : m));
      }
    } catch { /* ignore corrupt/unavailable storage */ }
    return INITIAL_COACH_MESSAGES;
  });
  useEffect(() => {
    try { localStorage.setItem('summit-coach-messages', JSON.stringify(coachMessages)); } catch { /* ignore */ }
  }, [coachMessages]);

  const [activeTab, setActiveTab] = useState<'dashboard' | 'goals' | 'activities' | 'power' | 'heart-rate' | 'coach'>('dashboard');
  const [powerCurveYear, setPowerCurveYear] = useState<'all' | number>('all');
  const [dataMode] = useState<'local' | 'supabase'>(dataService.getMode());
  
  const [profile, setProfile] = useState<AthleteProfile | null>(null);
  const loadProfile = profile ? { ftp: profile.ftp, lthr: profile.lthr, weight_kg: profile.weight_kg } : undefined;
  const [activities, setActivities] = useState<Activity[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [trainingSessions, setTrainingSessions] = useState<TrainingSession[]>([]);
  const [isGeneratingWeeklyPlan, setIsGeneratingWeeklyPlan] = useState(false);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured);
  const [appError, setAppError] = useState('');

  // Goal the coach chat is focused on (set from the Goals tab), with an optional prompt to prefill
  const [coachFocus, setCoachFocus] = useState<{ goalId: string; prompt?: string } | null>(null);
  // AI training-load estimates: per-activity progress/errors, plus the bulk run over many activities
  const [estimatingIds, setEstimatingIds] = useState<string[]>([]);
  const [estimateErrors, setEstimateErrors] = useState<Record<string, string>>({});
  const [bulkEstimate, setBulkEstimate] = useState<{ running: boolean; done: number; total: number; failed: number; message?: string }>(
    { running: false, done: 0, total: 0, failed: 0 }
  );
  const bulkCancelRef = useRef(false);
  const [assessingIds, setAssessingIds] = useState<string[]>([]);
  const [assessmentErrors, setAssessmentErrors] = useState<Record<string, string>>({});
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState<boolean>(false);
  // After first sign-in, open the profile once so the athlete can enter their thresholds
  const hasPromptedProfileRef = useRef(false);
  const [profileNeedsSetup, setProfileNeedsSetup] = useState(false);
  const [isStravaModalOpen, setIsStravaModalOpen] = useState<boolean>(false);

  // Load active data
  const loadAppData = async () => {
    const p = await dataService.getProfile();
    const a = await dataService.getActivities();
    const g = await dataService.getGoals();
    const sessions = await dataService.getTrainingSessions();
    setProfile(p);
    // A profile with no thresholds means the athlete hasn't supplied their data yet: prompt once per visit
    if (!hasPromptedProfileRef.current && !p.ftp && !p.lthr && !p.max_hr && !p.weight_kg) {
      hasPromptedProfileRef.current = true;
      setProfileNeedsSetup(true);
      setIsProfileModalOpen(true);
    }
    setActivities(a);
    setGoals(g);
    setTrainingSessions(sessions);
  };

  const handleAddGoal = async (newGoal: Goal) => {
    const savedGoal = await dataService.addGoal(newGoal);
    setGoals((prev) => [savedGoal, ...prev.filter(g => g.id !== savedGoal.id)]);
  };

  // useCallback-free is fine here: the panel only runs this when a new prompt arrives
  const handleFocusPromptConsumed = () => setCoachFocus((prev) => (prev ? { ...prev, prompt: undefined } : prev));

  const handleUpdateGoal = async (goalId: string, updates: Partial<Goal>) => {
    const saved = await dataService.updateGoal(goalId, updates);
    if (!saved) throw new Error('Goal not found. It may have been deleted.');
    setGoals((prev) => prev.map((g) => (g.id === goalId ? { ...g, ...saved } : g)));
  };

  const handleAcceptProposedGoal = async (goal: Goal, updatesGoalId?: string) => {
    if (updatesGoalId) {
      // Replan of an existing goal: apply the coach's fields, keep its status, creator and debrief
      const changes: Partial<Goal> = {};
      const keys = [
        'name', 'sport_type', 'priority', 'objective_summary', 'timeframe_text', 'target_date',
        'target_distance_km', 'target_elevation_m', 'target_power_watts', 'notes',
        'periodization_phases', 'milestones',
      ] as const;
      for (const key of keys) {
        if (goal[key] !== undefined) (changes as Record<string, unknown>)[key] = goal[key];
      }
      await handleUpdateGoal(updatesGoalId, changes);
      return;
    }
    const savedGoal = await dataService.addGoal(goal);
    setGoals((prev) => [savedGoal, ...prev.filter(g => g.id !== savedGoal.id)]);
  };

  const handleCompleteGoal = async (goalId: string, debriefNotes: string) => {
    await dataService.completeGoal(goalId, debriefNotes);
    await loadAppData();
  };

  const handleDeleteGoal = async (goalId: string) => {
    await dataService.deleteGoal(goalId);
    setGoals((prev) => prev.filter(g => g.id !== goalId));
  };

  // Edit an activity's name, sport and tags; merge only the changed fields so loaded streams are kept
  const handleUpdateActivity = async (
    id: string,
    updates: Pick<Partial<Activity>, 'title' | 'sport_type' | 'tags' | 'effort_notes' | 'pack_weight_kg' | 'perceived_exertion'>
  ) => {
    const before = activities.find((a) => a.id === id);
    const notesChanged = 'effort_notes' in updates && (updates.effort_notes ?? '') !== (before?.effort_notes ?? '');
    const effortInputsChanged = notesChanged
      || ('pack_weight_kg' in updates && (updates.pack_weight_kg ?? null) !== (before?.pack_weight_kg ?? null))
      || ('perceived_exertion' in updates && (updates.perceived_exertion ?? null) !== (before?.perceived_exertion ?? null));
    const notesCleared = notesChanged && !updates.effort_notes?.trim();
    const ebikeChanged = Boolean(before) && 'tags' in updates && isEbike({ tags: updates.tags }) !== isEbike(before!);

    // Removing the description drops the AI estimate so the activity falls back to heart rate / baseline
    const toSave = notesCleared && before?.tss_source === 'ai'
      ? { ...updates, estimated_tss: null, estimated_if: null, tss_source: null, tss_confidence: null, tss_rationale: null, tss_estimated_at: null }
      : updates;
    const saved = await dataService.updateActivity(id, toSave as Partial<Activity>);
    const patch: Partial<Activity> = {
      title: saved.title,
      sport_type: saved.sport_type,
      tags: saved.tags ?? [],
      effort_notes: saved.effort_notes,
      pack_weight_kg: saved.pack_weight_kg,
      perceived_exertion: saved.perceived_exertion,
      estimated_tss: saved.estimated_tss,
      estimated_if: saved.estimated_if,
      tss_source: saved.tss_source,
      tss_confidence: saved.tss_confidence,
      tss_rationale: saved.tss_rationale,
      tss_estimated_at: saved.tss_estimated_at,
    };
    setActivities((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
    setSelectedActivity((prev) => (prev?.id === id ? { ...prev, ...patch } : prev));

    // Changed description (or pack / RPE alongside one): have the AI re-process it, then the curves update.
    // Switching e-bike on or off also invalidates an existing AI estimate or one based on notes.
    if (before && ((effortInputsChanged && saved.effort_notes?.trim()) || (ebikeChanged && !notesCleared && (before.tss_source === 'ai' || saved.effort_notes?.trim())))) {
      void handleEstimateActivity({ ...before, ...patch } as Activity);
    }
  };

  // Estimate an activity's training load from its notes and recorded data, and save it with the activity
  const handleEstimateActivity = async (activity: Activity, options: { fast?: boolean } = {}): Promise<{ ok: boolean; error?: string }> => {
    if (!profile) return { ok: false, error: 'Profile is not loaded yet.' };
    setEstimatingIds((prev) => [...prev, activity.id]);
    setEstimateErrors((prev) => ({ ...prev, [activity.id]: '' }));
    try {
      const estimate = await coachEngine.estimateActivityLoad(activity, profile, options);
      const saved = await dataService.updateActivity(activity.id, {
        estimated_tss: estimate.tss,
        estimated_if: estimate.intensityFactor,
        tss_source: 'ai',
        tss_confidence: estimate.confidence,
        tss_rationale: estimate.rationale,
        tss_estimated_at: new Date().toISOString(),
      });
      const patch: Partial<Activity> = {
        estimated_tss: saved.estimated_tss,
        estimated_if: saved.estimated_if,
        tss_source: saved.tss_source,
        tss_confidence: saved.tss_confidence,
        tss_rationale: saved.tss_rationale,
        tss_estimated_at: saved.tss_estimated_at,
      };
      setActivities((prev) => prev.map((a) => (a.id === activity.id ? { ...a, ...patch } : a)));
      setSelectedActivity((prev) => (prev?.id === activity.id ? { ...prev, ...patch } : prev));
      return { ok: true };
    } catch (err: any) {
      console.error('Load estimate failed:', err);
      const error = err?.message || 'Could not estimate training load.';
      setEstimateErrors((prev) => ({ ...prev, [activity.id]: error }));
      return { ok: false, error };
    } finally {
      setEstimatingIds((prev) => prev.filter((id) => id !== activity.id));
    }
  };

  const handleCancelBulkEstimate = () => { bulkCancelRef.current = true; };

  // Estimate every activity the AI can improve (no power, and no heart rate or with notes), a few at a time.
  // Each result is saved as it arrives, so a cancelled or failed run keeps its progress and can simply be run again.
  const handleBulkEstimate = async () => {
    if (!profile || bulkEstimate.running) return;
    const queue = activities.filter((a) => canImproveWithAi(a, loadProfile));
    if (queue.length === 0) return;

    bulkCancelRef.current = false;
    setBulkEstimate({ running: true, done: 0, total: queue.length, failed: 0 });
    let done = 0;
    let failed = 0;
    let fatal: string | undefined;
    let next = 0;

    const worker = async () => {
      while (!bulkCancelRef.current && !fatal) {
        const activity = queue[next++];
        if (!activity) return;
        let result: { ok: boolean; error?: string } = { ok: false };
        for (let attempt = 0; attempt < 3 && !bulkCancelRef.current && !fatal; attempt++) {
          result = await handleEstimateActivity(activity, { fast: true });
          if (result.ok) break;
          // A missing/rejected key or unconfigured server fails every call: stop instead of burning through the list
          if (/api key|coach settings|not configured|rejected/i.test(result.error ?? '')) {
            fatal = result.error;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 3000 * (attempt + 1)));
        }
        if (result.ok) done++;
        else failed++;
        setBulkEstimate({ running: true, done, total: queue.length, failed });
      }
    };

    await Promise.all([worker(), worker(), worker()]);
    setBulkEstimate({
      running: false,
      done,
      total: queue.length,
      failed,
      message: fatal ?? (bulkCancelRef.current ? 'Stopped. Progress is saved; run it again to continue.' : undefined),
    });
  };

  // The list query leaves out the heavy streams_data (map + time-series), so fetch it when an activity is opened
  const handleOpenActivity = (activity: Activity | null) => {
    setSelectedActivity(activity);
    if (!activity || (activity.streams_data && activity.streams_data.length > 0)) return;
    void dataService.getActivityById(activity.id)
      .then((full) => {
        if (!full?.streams_data?.length) return;
        setSelectedActivity((prev) => (prev?.id === full.id ? { ...prev, streams_data: full.streams_data } : prev));
      })
      .catch((err) => console.warn('Could not load activity streams:', err));
  };

  // Ask the coach how an activity fits the accepted plan and goals, and save it with the activity
  const handleAssessActivity = async (activity: Activity) => {
    setAssessingIds((prev) => [...prev, activity.id]);
    setAssessmentErrors((prev) => ({ ...prev, [activity.id]: '' }));
    try {
      const text = await coachEngine.assessActivity(activity);
      const saved = await dataService.updateActivity(activity.id, {
        coach_assessment: text,
        coach_assessment_at: new Date().toISOString(),
      });
      const patch = { coach_assessment: saved.coach_assessment, coach_assessment_at: saved.coach_assessment_at };
      setActivities((prev) => prev.map((a) => (a.id === activity.id ? { ...a, ...patch } : a)));
      setSelectedActivity((prev) => (prev?.id === activity.id ? { ...prev, ...patch } : prev));
    } catch (err: any) {
      console.error('Activity assessment failed:', err);
      setAssessmentErrors((prev) => ({ ...prev, [activity.id]: err?.message || 'Could not generate the assessment.' }));
    } finally {
      setAssessingIds((prev) => prev.filter((id) => id !== activity.id));
    }
  };

  const handleFitImport = (importedActivities: Activity[]) => {
    if (importedActivities.length > 0) {
      setActivities((prev) => [...importedActivities, ...prev]);
      setSelectedActivity(importedActivities[0]);
    }
  };

  // Existing activities that an import filled in (e.g. names and types from a Strava CSV)
  const handleActivitiesUpdated = (updated: Activity[]) => {
    const byId = new Map(updated.map((a) => [a.id, a]));
    setActivities((prev) => prev.map((a) => (byId.has(a.id) ? { ...a, ...byId.get(a.id)! , streams_data: a.streams_data } : a)));
    setSelectedActivity((prev) => (prev && byId.has(prev.id) ? { ...prev, ...byId.get(prev.id)!, streams_data: prev.streams_data } : prev));
  };

  const handleDeleteActivity = async (activity: Activity) => {
    await dataService.deleteActivity(activity.id);
    setActivities((prev) => prev.filter((item) => item.id !== activity.id));
    setSelectedActivity((prev) => prev?.id === activity.id ? null : prev);
  };

  const handleGenerateWeeklyPlan = async () => {
    setIsGeneratingWeeklyPlan(true);
    try {
      const weekStartDate = getNextTrainingWeekStartDate();
      const occupiedDates = trainingSessions
        .filter((session) => session.week_start_date === weekStartDate && session.status !== 'PROPOSED')
        .map((session) => session.session_date);
      const drafts = await coachEngine.generateWeeklyPlan(occupiedDates);
      const generatedWeekStartDate = drafts[0]?.week_start_date;
      if (!generatedWeekStartDate) throw new Error('There are no remaining workout days to propose for next week.');
      const proposed = await dataService.replaceProposedTrainingSessions(generatedWeekStartDate, drafts);
      setTrainingSessions((previous) => [
        ...previous.filter((session) => session.week_start_date !== generatedWeekStartDate || session.status !== 'PROPOSED'),
        ...proposed,
      ]);
    } finally {
      setIsGeneratingWeeklyPlan(false);
    }
  };

  const handleUpdateTrainingSession = async (id: string, status: TrainingSessionStatus) => {
    const updated = await dataService.updateTrainingSessionStatus(id, status);
    setTrainingSessions((previous) => previous.map((session) => session.id === id ? updated : session));
  };

  // Delete sessions from the dashboard. Each is removed from the screen only once the database has dropped it.
  const handleDeleteTrainingSessions = async (ids: string[]) => {
    const deleted: string[] = [];
    try {
      for (const id of ids) {
        await dataService.deleteTrainingSession(id);
        deleted.push(id);
      }
    } finally {
      const gone = new Set(deleted);
      setTrainingSessions((previous) => previous.filter((session) => !gone.has(session.id)));
    }
  };

  const handleAcceptProposedPlan = async (proposal: ProposedPlanAction) => {
    if (proposal.type === 'REPLACE_WEEK') {
      // Each week in the proposal is swapped wholesale (the database and the screen end up identical)
      const weeks = [...new Set(proposal.sessions.map((s) => s.week_start_date))];
      for (const week of weeks) {
        const weekEnd = addDaysToDateOnly(week, 6);
        const drafts = proposal.sessions
          .filter((s) => s.week_start_date === week)
          .map((s) => ({
            week_start_date: s.week_start_date,
            session_date: s.session_date,
            title: s.title,
            sport_type: s.sport_type,
            duration_minutes: s.duration_minutes,
            focus: s.focus,
            details: s.details,
            target_tss: s.target_tss,
          }));
        const accepted = await dataService.replaceWeekWithAcceptedSessions(week, drafts);
        setTrainingSessions((previous) => [
          ...previous.filter((session) =>
            session.status === 'COMPLETED'
            || (session.week_start_date !== week && (session.session_date < week || session.session_date > weekEnd))
          ),
          ...accepted,
        ]);
      }
    } else if (proposal.type === 'DELETE') {
      for (const session of proposal.sessions) {
        await dataService.deleteTrainingSession(session.id);
      }
      const deleteIds = new Set(proposal.sessions.map((s) => s.id));
      setTrainingSessions((previous) => previous.filter((s) => !deleteIds.has(s.id)));
    } else {
      // CREATE or UPDATE
      const toSave: TrainingSession[] = proposal.sessions.map((s) => ({
        ...s,
        status: 'ACCEPTED',
      }));
      const saved = await dataService.saveTrainingSessions(toSave);
      const savedIds = new Set(saved.map((s) => s.id));
      setTrainingSessions((previous) => [
        ...previous.filter((s) => !savedIds.has(s.id)),
        ...saved,
      ]);
    }
  };

  const handleSaveProfile = async (updated: Partial<AthleteProfile>) => {
    const newProfile = await dataService.updateProfile(updated);
    setProfile(newProfile);
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) setAppError(`Sign out failed: ${error.message}`);
    else clearCorosTokens();
  };

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true);
      void loadAppData().catch((err) => setAppError(err.message));
      return;
    }

    let active = true;
    const applyUser = (user: User | null) => {
      dataService.setAuthenticatedUser(user);
      setAuthUser(user);
      setAuthReady(true);
      if (!user) {
        setProfile(null);
        setActivities([]);
        setGoals([]);
        setAppError('');
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) applyUser(session?.user || null);
    });

    void supabase.auth.getSession()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setAppError(error.message);
        applyUser(data.session?.user || null);
      })
      .catch((err) => {
        if (!active) return;
        setAppError(err.message || 'Unable to restore your Google session.');
        setAuthReady(true);
      });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabase || !authUser) return;
    let active = true;
    dataService.setAuthenticatedUser(authUser);
    setAppError('');
    void loadAppData()
      .then(() => { if (active) setAppError(''); })
      .catch((err) => { if (active) setAppError(err.message || 'Unable to load your account data.'); });
    return () => { active = false; };
  }, [authUser]);

  useEffect(() => {
    if (!authReady || (isSupabaseConfigured && !authUser)) return;

    const params = new URLSearchParams(window.location.search);

    const corosCode = params.get('coros_code') || (params.has('scope') ? parseCorosAuthCode() : null);
    if (corosCode) {
      const clientId = getStoredCorosClientId();
      if (clientId) {
        exchangeCorosCode(corosCode, clientId)
          .then(({ accessToken, refreshToken }) => {
            setCorosTokens(accessToken, refreshToken);
            return syncCorosActivities(accessToken);
          })
          .then((newActivities) => {
            setActivities((prev) => [...newActivities, ...prev]);
          })
          .catch((err) => setAppError(`COROS sync failed: ${err.message}`));
      }
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [authReady, authUser]);

  if (isSupabaseConfigured && !authReady) {
    return (
      <div className="min-h-screen bg-summit-dark flex items-center justify-center text-cyan-400 font-mono text-sm">
        Checking Google sign-in...
      </div>
    );
  }

  if (isSupabaseConfigured && !authUser) {
    return <GoogleSignInScreen error={appError} />;
  }

  if (appError && authUser) {
    return (
      <div className="min-h-screen bg-summit-dark flex flex-col items-center justify-center gap-4 px-4 text-center text-slate-100">
        <h1 className="text-xl font-bold">Could not load your private training data</h1>
        <p className="max-w-xl text-sm text-rose-300">{appError}</p>
        <div className="flex gap-3">
          <button onClick={() => window.location.reload()} className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950">Retry</button>
          <button onClick={handleSignOut} className="rounded-lg border border-white/15 px-4 py-2 text-sm text-slate-200">Sign out</button>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-summit-dark flex items-center justify-center text-cyan-400 font-mono text-sm">
        Initializing Summit Multi-Sport Engine...
      </div>
    );
  }

  // Calculated engine series
  const pmcData: PMCDayPoint[] = calculatePMC(activities, 90, loadProfile);
  const powerCurveYears = Array.from(new Set([
    CURRENT_YEAR,
    ...activities
      .map((activity) => new Date(activity.start_date).getFullYear())
      .filter(Number.isFinite),
  ])).sort((a, b) => b - a);
  const powerCurveActivities = powerCurveYear === 'all'
    ? activities
    : activities.filter((activity) => new Date(activity.start_date).getFullYear() === powerCurveYear);
  const powerCurveData: PowerCurvePoint[] = calculatePowerCurve(powerCurveActivities, profile.weight_kg);
  const powerCurveActivityCount = powerCurveActivities.filter(hasPowerCurveData).length;
  // The dashboard lists every accepted session from this week onward, in date order, so it matches
  // whatever week the coach planned (not only the next one)
  const currentWeekStartDate = getCurrentTrainingWeekStartDate();
  const upcomingSessions = trainingSessions
    .filter((session) =>
      (session.status === 'ACCEPTED' || session.status === 'COMPLETED')
      && session.session_date >= currentWeekStartDate
    )
    .sort((a, b) => a.session_date.localeCompare(b.session_date));

  return (
    <div className="min-h-screen bg-summit-dark text-slate-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-slate-950">
      {/* Navigation Header */}
      <Navbar
        profile={profile}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        dataMode={dataMode}
        onSyncStrava={() => setIsStravaModalOpen(true)}
        onOpenProfile={() => setIsProfileModalOpen(true)}
        isAuthenticated={Boolean(authUser)}
        authEmail={authUser?.email || ''}
        onSignOut={handleSignOut}
      />

      {/* Main Content Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8 pb-28 md:pb-8 space-y-6">
        {activeTab === 'dashboard' && (
          <DashboardOverview
            profile={profile}
            goals={goals}
            activities={activities}
            pmcData={pmcData}
            powerCurve={powerCurveData}
            trainingSessions={upcomingSessions}
            onDeleteTrainingSessions={handleDeleteTrainingSessions}
            onOpenActivity={handleOpenActivity}
            onNavigateTab={setActiveTab}
            onOpenProfile={() => setIsProfileModalOpen(true)}
          />
        )}

        {activeTab === 'goals' && (
          <GoalsManager
            goals={goals}
            onAddGoal={handleAddGoal}
            onUpdateGoal={handleUpdateGoal}
            onCompleteGoal={handleCompleteGoal}
            onDeleteGoal={handleDeleteGoal}
            onDiscussGoal={(goal, prompt) => {
              setCoachFocus({ goalId: goal.id, prompt });
              setActiveTab('coach');
            }}
          />
        )}

        {activeTab === 'activities' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div>
                <h1 className="text-2xl font-extrabold text-white tracking-tight">Multi-Sport Activity Database</h1>
                <p className="text-xs text-slate-400">Road Cycling, Zwift, Skimo, Backcountry Skiing, Peak Scrambling & Weighted Hikes</p>
              </div>
              <span className="text-xs font-mono text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-3 py-1 rounded-full">
                {activities.length} Recorded Sessions
              </span>
            </div>

            <ActivityList
              activities={activities}
              profile={profile}
              onSelectActivity={handleOpenActivity}
              onDeleteActivity={handleDeleteActivity}
              bulkEstimate={bulkEstimate}
              onBulkEstimate={() => void handleBulkEstimate()}
              onCancelBulkEstimate={handleCancelBulkEstimate}
            />
          </div>
        )}

        {activeTab === 'power' && (
          <div className="space-y-6">
            <div className="border-b border-white/10 pb-4">
              <h1 className="text-2xl font-extrabold text-white tracking-tight">Power Duration Curve & Peak Analytics</h1>
              <p className="text-xs text-slate-400">Peak power outputs from recorded activity data, scaled for {formatLbFromKg(profile.weight_kg)} bodyweight</p>
            </div>

            <div className="glass-panel p-6 rounded-2xl border-white/10 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <h2 className="text-lg font-bold text-white flex items-center">
                  <Zap className="w-5 h-5 mr-2 text-amber-400" />
                  {powerCurveYear === 'all' ? 'Total Power Curve' : `${powerCurveYear} Power Curve`}
                </h2>
                <div className="flex items-center gap-3">
                  <label htmlFor="power-curve-year" className="text-xs text-slate-400">Period</label>
                  <select
                    id="power-curve-year"
                    value={powerCurveYear}
                    onChange={(event) => setPowerCurveYear(event.target.value === 'all' ? 'all' : Number(event.target.value))}
                    className="bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-amber-400 focus:outline-none"
                  >
                    <option value="all">All time</option>
                    {powerCurveYears.map((year) => <option key={year} value={year}>{year}</option>)}
                  </select>
                  <span className="text-xs font-bold text-amber-400 bg-amber-500/10 px-3 py-1.5 rounded-full border border-amber-500/20 whitespace-nowrap">
                    {profile.ftp}W FTP{profile.weight_kg > 0 ? ` (${(profile.ftp / profile.weight_kg).toFixed(2)} W/kg)` : ''}
                  </span>
                </div>
              </div>
              <p className="text-xs text-slate-400">
                {powerCurveActivityCount} of {powerCurveActivities.length} activities contain power data. The amber line is your best effort at each duration. Mean and median show how your typical activity compares: each activity contributes its own best effort for that duration, and longer durations only include activities long enough to have one.
              </p>
              <PowerCurveChart data={powerCurveData} />
            </div>

            {/* Peak Duration Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {powerCurveData.map((pt) => (
                <div key={pt.label} className="glass-panel p-4 rounded-xl border-white/10 space-y-1">
                  <span className="text-xs text-slate-400 uppercase font-semibold">{pt.label} Peak Power</span>
                  <p className="text-xl font-extrabold text-white">{pt.watts} W</p>
                  <p className="text-xs text-amber-400 font-bold">{pt.wattsPerKg} W/kg</p>
                  {pt.sampleCount > 0 && (
                    <p className="text-[11px] text-slate-400">
                      Mean {pt.meanWatts} W · Median {pt.medianWatts} W
                      <span className="text-slate-500"> · {pt.sampleCount} {pt.sampleCount === 1 ? 'activity' : 'activities'}</span>
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'heart-rate' && (
          <HeartRateDistributionPage activities={activities} profile={profile} />
        )}

        {activeTab === 'coach' && (
          <AICoachPanel
            messages={coachMessages}
            setMessages={setCoachMessages}
            trainingSessions={trainingSessions}
            isGeneratingWeeklyPlan={isGeneratingWeeklyPlan}
            onGenerateWeeklyPlan={handleGenerateWeeklyPlan}
            onUpdateTrainingSession={handleUpdateTrainingSession}
            onAcceptProposedPlan={handleAcceptProposedPlan}
            onAcceptProposedGoal={handleAcceptProposedGoal}
            focusGoal={coachFocus ? goals.find((g) => g.id === coachFocus.goalId) ?? null : null}
            focusPrompt={coachFocus?.prompt}
            onClearFocus={() => setCoachFocus(null)}
            onFocusPromptConsumed={handleFocusPromptConsumed}
          />
        )}
      </main>

      {/* Activity Detail Modal */}
      <ActivityDetailModal
        activity={selectedActivity}
        onClose={() => setSelectedActivity(null)}
        onAssess={handleAssessActivity}
        onUpdate={handleUpdateActivity}
        allTags={collectTags(activities)}
        isAssessing={selectedActivity ? assessingIds.includes(selectedActivity.id) : false}
        assessmentError={selectedActivity ? assessmentErrors[selectedActivity.id] : undefined}
        profile={profile}
        onEstimate={(activity) => void handleEstimateActivity(activity)}
        isEstimating={selectedActivity ? estimatingIds.includes(selectedActivity.id) : false}
        estimateError={selectedActivity ? estimateErrors[selectedActivity.id] : undefined}
      />

      {/* Athlete Profile & Settings Modal */}
      {isProfileModalOpen && (
        <AthleteProfileModal
          profile={profile}
          needsSetup={profileNeedsSetup}
          onClose={() => { setIsProfileModalOpen(false); setProfileNeedsSetup(false); }}
          onSaveProfile={handleSaveProfile}
        />
      )}

      {/* Unified Data Sources Modal */}
      <DataSyncModal
        isOpen={isStravaModalOpen}
        onClose={() => setIsStravaModalOpen(false)}
        onActivitiesImported={handleFitImport}
        onActivitiesUpdated={handleActivitiesUpdated}
      />

      {/* Modern Footer */}
      <footer className="w-full border-t border-white/10 bg-slate-950/80 py-6 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-slate-400">
          <div className="flex items-center space-x-2">
            <Mountain className="w-4 h-4 text-cyan-400" />
            <span className="font-bold text-slate-200">SUMMIT INTELLIGENCE</span>
            <span>— Multi-Sport Endurance & AI Coaching Platform</span>
          </div>

          <div className="flex items-center space-x-4">
            <span className="flex items-center text-slate-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400 mr-1.5 animate-pulse" />
              Multi-sport training data
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
export default App;
