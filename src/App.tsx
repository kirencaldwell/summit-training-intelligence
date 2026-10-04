import { useState, useEffect } from 'react';
import type { Activity, AthleteProfile, Goal, PMCDayPoint, PowerCurvePoint } from './types';
import { dataService } from './lib/supabase';
import { triggerMockStravaSync } from './lib/strava';
import { calculatePMC, calculatePowerCurve } from './lib/trainingMath';

import { Navbar } from './components/Navbar';
import { DashboardOverview } from './components/DashboardOverview';
import { ActivityList } from './components/ActivityList';
import { PowerCurveChart } from './components/PowerCurveChart';
import { AICoachPanel } from './components/AICoachPanel';
import { ActivityDetailModal } from './components/ActivityDetailModal';
import { AthleteProfileModal } from './components/AthleteProfileModal';
import { OnboardingWizard } from './components/OnboardingWizard';
import { StravaConnectModal } from './components/StravaConnectModal';
import { GoalsManager } from './components/GoalsManager';
import { parseStravaAuthCode } from './lib/strava';

import { Mountain, Zap } from 'lucide-react';


export function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'goals' | 'activities' | 'power' | 'coach'>('dashboard');
  const [dataMode, setDataMode] = useState<'demo' | 'supabase'>(dataService.getMode());
  
  const [profile, setProfile] = useState<AthleteProfile | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);

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
    setProfile(p);
    setActivities(a);
    setGoals(g);
  };

  useEffect(() => {
    loadAppData();

    // Detect Strava OAuth redirect code
    const code = parseStravaAuthCode();
    if (code) {
      handleSyncStrava();
      // Clean query string from browser URL bar
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [dataMode]);

  const handleAddGoal = async (newGoal: Goal) => {
    await dataService.addGoal(newGoal);
    setGoals((prev) => [newGoal, ...prev]);
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
    await dataService.updateProfile(newProfile);
    setProfile(newProfile);
    setGoals((prev) => [newGoal, ...prev.filter(g => g.id !== newGoal.id)]);
    setIsOnboardingOpen(false);
  };

  const handleToggleDataMode = () => {
    const nextMode = dataMode === 'demo' ? 'supabase' : 'demo';
    dataService.setMode(nextMode);
    setDataMode(nextMode);
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

  if (!profile) {
    return (
      <div className="min-h-screen bg-summit-dark flex items-center justify-center text-cyan-400 font-mono text-sm">
        Initializing Summit Multi-Sport Engine...
      </div>
    );
  }

  // Calculated engine series
  const pmcData: PMCDayPoint[] = calculatePMC(activities, 90);
  const powerCurveData: PowerCurvePoint[] = calculatePowerCurve(activities, profile.weight_kg);

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
            />
          </div>
        )}

        {activeTab === 'power' && (
          <div className="space-y-6">
            <div className="border-b border-white/10 pb-4">
              <h1 className="text-2xl font-extrabold text-white tracking-tight">Power Duration Curve & Peak Analytics</h1>
              <p className="text-xs text-slate-400">Peak power outputs across durations (1s to 2h) scaled for {profile.weight_kg}kg bodyweight</p>
            </div>

            <div className="glass-panel p-6 rounded-2xl border-white/10 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white flex items-center">
                  <Zap className="w-5 h-5 mr-2 text-amber-400" /> Multi-Sport Power Curve
                </h2>
                <span className="text-xs font-bold text-amber-400 bg-amber-500/10 px-3 py-1 rounded-full border border-amber-500/20">
                  {profile.ftp}W FTP ({ (profile.ftp / profile.weight_kg).toFixed(2) } W/kg)
                </span>
              </div>
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
          <AICoachPanel />
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

      {/* Strava Connect & OAuth Config Modal */}
      <StravaConnectModal
        isOpen={isStravaModalOpen}
        onClose={() => setIsStravaModalOpen(false)}
        onImportSample={handleSyncStrava}
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
