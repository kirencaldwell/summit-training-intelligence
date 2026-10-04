import { useState, useEffect } from 'react';
import type { User } from '@supabase/supabase-js';
import type { Activity, AthleteProfile, Goal, PMCDayPoint, PowerCurvePoint, TrainingSession, TrainingSessionStatus } from './types';
import { dataService, isSupabaseConfigured, supabase } from './lib/supabase';
import { triggerMockStravaSync, parseStravaAuthCode } from './lib/strava';
import { calculatePMC, calculatePowerCurve, hasPowerCurveData } from './lib/trainingMath';
import { addDaysToDateOnly, getNextTrainingWeekStartDate } from './lib/trainingSessions';
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
import { AICoachPanel } from './components/AICoachPanel';
import { ActivityDetailModal } from './components/ActivityDetailModal';
import { AthleteProfileModal } from './components/AthleteProfileModal';
import { OnboardingWizard } from './components/OnboardingWizard';
import { DataSyncModal } from './components/StravaConnectModal';
import { GoalsManager } from './components/GoalsManager';
import { GoogleSignInScreen } from './components/GoogleSignInScreen';
import { coachEngine } from './lib/ai/coachEngine';

import { Mountain, Zap } from 'lucide-react';

const CURRENT_YEAR = new Date().getFullYear();

export function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'goals' | 'activities' | 'power' | 'coach'>('dashboard');
  const [powerCurveYear, setPowerCurveYear] = useState<'all' | number>('all');
  const [dataMode, setDataMode] = useState<'demo' | 'supabase'>(dataService.getMode());
  
  const [profile, setProfile] = useState<AthleteProfile | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [trainingSessions, setTrainingSessions] = useState<TrainingSession[]>([]);
  const [isGeneratingWeeklyPlan, setIsGeneratingWeeklyPlan] = useState(false);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured);
  const [appError, setAppError] = useState('');

  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState<boolean>(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState<boolean>(false);
  const [isStravaModalOpen, setIsStravaModalOpen] = useState<boolean>(false);
  const [isSyncingStrava, setIsSyncingStrava] = useState<boolean>(false);

  // Load active data
  const loadAppData = async () => {
    const p = await dataService.getProfile();
    const a = await dataService.getActivities();
    const g = await dataService.getGoals();
    const sessions = await dataService.getTrainingSessions();
    setProfile(p);
    setActivities(a);
    setGoals(g);
    setTrainingSessions(sessions);
  };

  const handleAddGoal = async (newGoal: Goal) => {
    const savedGoal = await dataService.addGoal(newGoal);
    setGoals((prev) => [savedGoal, ...prev]);
  };

  const handleCompleteGoal = async (goalId: string, debriefNotes: string) => {
    await dataService.completeGoal(goalId, debriefNotes);
    await loadAppData();
  };

  const handleDeleteGoal = async (goalId: string) => {
    await dataService.deleteGoal(goalId);
    setGoals((prev) => prev.filter(g => g.id !== goalId));
  };

  const handleCompleteOnboarding = async (newProfile: AthleteProfile, newGoal: Goal) => {
    const savedProfile = await dataService.updateProfile(newProfile);
    const savedGoal = await dataService.addGoal(newGoal);
    setProfile(savedProfile);
    setGoals((prev) => [savedGoal, ...prev.filter(g => g.id !== savedGoal.id)]);
    setIsOnboardingOpen(false);
  };

  const handleToggleDataMode = () => {
    const nextMode = dataMode === 'demo' ? 'supabase' : 'demo';
    dataService.setMode(nextMode);
    setDataMode(nextMode);
  };

  const handleFitImport = (importedActivities: Activity[]) => {
    if (importedActivities.length > 0) {
      setActivities((prev) => [...importedActivities, ...prev]);
      setSelectedActivity(importedActivities[0]);
    }
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

  const handleSyncStrava = async () => {
    setIsSyncingStrava(true);
    try {
      const newAct = await triggerMockStravaSync();
      await loadAppData();
      setSelectedActivity(newAct);
    } catch (err) {
      console.error('Strava Sync Failed:', err);
    } finally {
      setIsSyncingStrava(false);
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
    const stravaCode = params.has('scope') ? parseStravaAuthCode() : null;
    if (stravaCode) {
      window.history.replaceState({}, document.title, window.location.pathname);
      void handleSyncStrava();
      return;
    }

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
  const pmcData: PMCDayPoint[] = calculatePMC(activities, 90);
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
  const upcomingWeekStartDate = getNextTrainingWeekStartDate();
  const upcomingWeekEndDate = addDaysToDateOnly(upcomingWeekStartDate, 6);
  const upcomingSessions = trainingSessions.filter((session) =>
    (session.status === 'ACCEPTED' || session.status === 'COMPLETED')
    && session.session_date >= upcomingWeekStartDate
    && session.session_date <= upcomingWeekEndDate
  );

  return (
    <div className="min-h-screen bg-summit-dark text-slate-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-slate-950">
      {/* Navigation Header */}
      <Navbar
        profile={profile}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        dataMode={dataMode}
        onToggleDataMode={handleToggleDataMode}
        onSyncStrava={() => setIsStravaModalOpen(true)}
        isSyncingStrava={isSyncingStrava}
        onOpenProfile={() => setIsProfileModalOpen(true)}
        onOpenOnboarding={() => setIsOnboardingOpen(true)}
        isAuthenticated={Boolean(authUser)}
        authEmail={authUser?.email || ''}
        onSignOut={handleSignOut}
      />

      {/* Main Content Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {activeTab === 'dashboard' && (
          <DashboardOverview
            profile={profile}
            goals={goals}
            activities={activities}
            pmcData={pmcData}
            powerCurve={powerCurveData}
            trainingSessions={upcomingSessions}
            onOpenActivity={setSelectedActivity}
            onNavigateTab={setActiveTab}
          />
        )}

        {activeTab === 'goals' && (
          <GoalsManager
            goals={goals}
            onAddGoal={handleAddGoal}
            onCompleteGoal={handleCompleteGoal}
            onDeleteGoal={handleDeleteGoal}
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
              onSelectActivity={setSelectedActivity}
              onDeleteActivity={handleDeleteActivity}
            />
          </div>
        )}

        {activeTab === 'power' && (
          <div className="space-y-6">
            <div className="border-b border-white/10 pb-4">
              <h1 className="text-2xl font-extrabold text-white tracking-tight">Power Duration Curve & Peak Analytics</h1>
              <p className="text-xs text-slate-400">Peak power outputs from recorded activity data, scaled for {profile.weight_kg}kg bodyweight</p>
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
                    {profile.ftp}W FTP ({(profile.ftp / profile.weight_kg).toFixed(2)} W/kg)
                  </span>
                </div>
              </div>
              <p className="text-xs text-slate-400">
                {powerCurveActivityCount} of {powerCurveActivities.length} activities contain power data. Curves combine best efforts across the selected period.
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
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'coach' && (
          <AICoachPanel
            trainingSessions={trainingSessions}
            isGeneratingWeeklyPlan={isGeneratingWeeklyPlan}
            onGenerateWeeklyPlan={handleGenerateWeeklyPlan}
            onUpdateTrainingSession={handleUpdateTrainingSession}
          />
        )}
      </main>

      {/* Activity Detail Modal */}
      <ActivityDetailModal
        activity={selectedActivity}
        onClose={() => setSelectedActivity(null)}
      />

      {/* Athlete Profile & Settings Modal */}
      <AthleteProfileModal
        profile={profile}
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        onSaveProfile={handleSaveProfile}
      />

      {/* Onboarding Wizard Setup Modal */}
      <OnboardingWizard
        isOpen={isOnboardingOpen}
        onCompleteOnboarding={handleCompleteOnboarding}
        onSyncStrava={handleSyncStrava}
        isSyncingStrava={isSyncingStrava}
      />

      {/* Unified Data Sources Modal */}
      <DataSyncModal
        isOpen={isStravaModalOpen}
        onClose={() => setIsStravaModalOpen(false)}
        onActivitiesImported={handleFitImport}
        isSyncing={isSyncingStrava}
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
              Supabase & Strava Sync Ready
            </span>
            <span>•</span>
            <span className="text-amber-400 font-semibold">Mount Baker Hill Climb Target: 280W</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
export default App;
