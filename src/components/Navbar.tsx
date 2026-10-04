import React from 'react';
import { Activity, Mountain, ShieldCheck, Zap, User, Upload, Sparkles, RefreshCw, LogOut } from 'lucide-react';
import type { AthleteProfile } from '../types';

interface NavbarProps {
  profile: AthleteProfile;
  activeTab: 'dashboard' | 'goals' | 'activities' | 'power' | 'coach';
  setActiveTab: (tab: 'dashboard' | 'goals' | 'activities' | 'power' | 'coach') => void;
  dataMode: 'demo' | 'supabase';
  onToggleDataMode: () => void;
  onSyncStrava: () => void;
  isSyncingStrava: boolean;
  onOpenProfile: () => void;
  onOpenOnboarding: () => void;
  isAuthenticated?: boolean;
  authEmail?: string;
  onSignOut?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  profile,
  activeTab,
  setActiveTab,
  dataMode,
  onToggleDataMode,
  onSyncStrava,
  isSyncingStrava,
  onOpenProfile,
  onOpenOnboarding,
  isAuthenticated = false,
  authEmail,
  onSignOut,
}) => {
  return (
    <header className="sticky top-0 z-40 w-full glass-panel border-b border-white/10 bg-summit-dark/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setActiveTab('dashboard')}>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 via-blue-600 to-amber-400 p-[2px] shadow-lg shadow-cyan-500/20">
              <div className="w-full h-full bg-summit-dark rounded-[10px] flex items-center justify-center">
                <Mountain className="w-5 h-5 text-cyan-400" />
              </div>
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
                  SUMMIT
                </span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  INTELLIGENCE
                </span>
              </div>
              <p className="text-[10px] text-slate-400 tracking-wider uppercase font-medium">Multi-Sport Endurance Engine</p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="hidden md:flex items-center space-x-1 bg-slate-900/60 p-1.5 rounded-xl border border-white/5">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'dashboard'
                  ? 'bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Activity className="w-4 h-4" />
              <span>Dashboard</span>
            </button>

            <button
              onClick={() => setActiveTab('goals')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'goals'
                  ? 'bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Sparkles className="w-4 h-4 text-cyan-400" />
              <span>Goals & Objectives</span>
            </button>

            <button
              onClick={() => setActiveTab('activities')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'activities'
                  ? 'bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Mountain className="w-4 h-4" />
              <span>Activities</span>
            </button>

            <button
              onClick={() => setActiveTab('power')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'power'
                  ? 'bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Zap className="w-4 h-4" />
              <span>Power & Analytics</span>
            </button>

            <button
              onClick={() => setActiveTab('coach')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all relative ${
                activeTab === 'coach'
                  ? 'bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-amber-300 border border-amber-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <ShieldCheck className="w-4 h-4 text-amber-400" />
              <span>AI Coach</span>
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
              </span>
            </button>
          </nav>

          {/* Controls & Athlete Badge */}
          <div className="flex items-center space-x-3">
            {/* Setup Wizard Button */}
            <button
              onClick={onOpenOnboarding}
              className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-xs font-semibold transition-all"
              title="Run Initial Setup Wizard"
            >
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              <span className="hidden sm:inline">Setup Wizard</span>
            </button>

            {/* Import Data Button */}
            <button
              onClick={onSyncStrava}
              disabled={isSyncingStrava}
              className="hidden sm:flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 border border-cyan-500/30 text-xs font-semibold transition-all"
            >
              {isSyncingStrava ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )}
              <span>{isSyncingStrava ? 'Importing...' : 'Import Data'}</span>
            </button>

            {isAuthenticated ? (
              <div className="flex items-center gap-2">
                <span className="hidden xl:inline text-xs text-slate-400 max-w-40 truncate">{authEmail}</span>
                <button
                  onClick={() => onSignOut?.()}
                  title="Sign out"
                  aria-label="Sign out"
                  className="p-2 rounded-lg border border-white/10 text-slate-300 hover:text-white hover:bg-white/5"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={onToggleDataMode}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ${
                  dataMode === 'supabase'
                    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                    : 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                }`}
                title="Click to toggle between Supabase Live DB and Demo Mode"
              >
                {dataMode === 'supabase' ? 'Supabase DB' : 'Demo Mode'}
              </button>
            )}

            {/* Profile Avatar */}
            <button
              onClick={onOpenProfile}
              className="flex items-center space-x-2 p-1 rounded-xl glass-panel-interactive border-white/10"
            >
              <img
                src={profile.avatar_url}
                alt={profile.full_name}
                className="w-8 h-8 rounded-lg object-cover ring-2 ring-cyan-500/40"
              />
              <span className="hidden lg:inline-block text-xs font-semibold text-slate-200">
                {profile.ftp}W FTP
              </span>
              <User className="w-4 h-4 text-slate-400 lg:hidden" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
