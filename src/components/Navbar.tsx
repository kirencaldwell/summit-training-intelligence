import React, { useEffect, useRef, useState } from 'react';
import { Activity, Mountain, ShieldCheck, Zap, User, Upload, Sparkles, LogOut, MoreHorizontal, HeartPulse } from 'lucide-react';
import type { AthleteProfile } from '../types';

interface NavbarProps {
  profile: AthleteProfile;
  activeTab: 'dashboard' | 'goals' | 'activities' | 'power' | 'heart-rate' | 'coach';
  setActiveTab: (tab: 'dashboard' | 'goals' | 'activities' | 'power' | 'heart-rate' | 'coach') => void;
  dataMode: 'local' | 'supabase';
  onSyncStrava: () => void;
  onOpenProfile: () => void;
  isAuthenticated?: boolean;
  authEmail?: string;
  onSignOut?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  profile,
  activeTab,
  setActiveTab,
  dataMode,
  onSyncStrava,
  onOpenProfile,
  isAuthenticated = false,
  authEmail,
  onSignOut,
}) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const desktopMenuRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isProfileMenuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (desktopMenuRef.current?.contains(target) || mobileMenuRef.current?.contains(target)) return;
      setIsProfileMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsProfileMenuOpen(false); };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isProfileMenuOpen]);

  const profileMenu = (
    <div role="menu" className="absolute right-0 top-full mt-2 w-60 z-50 rounded-xl border border-white/10 bg-slate-900 shadow-xl shadow-black/40 p-1.5">
      {isAuthenticated && authEmail && (
        <div className="px-3 py-2 text-xs text-slate-400 truncate border-b border-white/5 mb-1" title={authEmail}>{authEmail}</div>
      )}
      <button
        type="button"
        role="menuitem"
        onClick={() => { setIsProfileMenuOpen(false); onOpenProfile(); }}
        className="w-full min-h-10 flex items-center gap-2 px-3 rounded-lg text-sm text-slate-200 hover:bg-white/5 text-left"
      >
        <User className="w-4 h-4" /> Athlete profile & settings
      </button>
      {isAuthenticated && (
        <button
          type="button"
          role="menuitem"
          onClick={() => { setIsProfileMenuOpen(false); onSignOut?.(); }}
          className="w-full min-h-10 flex items-center gap-2 px-3 rounded-lg text-sm text-slate-200 hover:bg-white/5 text-left"
        >
          <LogOut className="w-4 h-4" /> Sign out
        </button>
      )}
    </div>
  );
  const tabs = [
    { id: 'dashboard' as const, label: 'Home', icon: Activity },
    { id: 'goals' as const, label: 'Goals', icon: Sparkles },
    { id: 'activities' as const, label: 'Activities', icon: Mountain },
    { id: 'power' as const, label: 'Power', icon: Zap },
    { id: 'heart-rate' as const, label: 'HR Zones', icon: HeartPulse },
    { id: 'coach' as const, label: 'Coach', icon: ShieldCheck },
  ];

  return (
    <>
    <header className="sticky top-0 z-40 w-full glass-panel border-b border-white/10 bg-summit-dark/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between min-h-14 md:h-16">
          {/* Logo */}
          <button type="button" className="flex items-center space-x-2 sm:space-x-3 text-left" onClick={() => setActiveTab('dashboard')} aria-label="Summit home">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-tr from-cyan-500 via-blue-600 to-amber-400 p-[2px] shadow-lg shadow-cyan-500/20">
              <div className="w-full h-full bg-summit-dark rounded-[10px] flex items-center justify-center">
                <Mountain className="w-5 h-5 text-cyan-400" />
              </div>
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-extrabold text-base sm:text-lg tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
                  SUMMIT
                </span>
                <span className="hidden sm:inline text-xs font-semibold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  INTELLIGENCE
                </span>
              </div>
              <p className="hidden sm:block text-[10px] text-slate-400 tracking-wider uppercase font-medium">Multi-Sport Endurance Engine</p>
            </div>
          </button>

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
              onClick={() => setActiveTab('heart-rate')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'heart-rate'
                  ? 'bg-gradient-to-r from-rose-500/20 to-orange-500/20 text-rose-300 border border-rose-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <HeartPulse className="w-4 h-4 text-rose-400" />
              <span>Heart Rate</span>
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
          <div className="hidden md:flex items-center space-x-2 lg:space-x-3">
            {/* Import Data Button */}
            <button
              onClick={onSyncStrava}
              className="flex min-h-10 items-center space-x-1.5 px-3 py-2 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 border border-cyan-500/30 text-xs font-semibold transition-all"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Import Data</span>
            </button>

            {!isAuthenticated && (
              <span
                className="min-h-10 flex items-center px-2.5 py-2 rounded-lg text-xs font-semibold border bg-slate-500/10 text-slate-300 border-white/10"
                title="Data is stored only in this browser. Configure Supabase to sync across devices."
              >
                {dataMode === 'supabase' ? 'Supabase DB' : 'Local storage'}
              </span>
            )}

            {/* Profile Avatar + account menu */}
            <div className="relative" ref={desktopMenuRef}>
            <button
              type="button"
              onClick={() => setIsProfileMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={isProfileMenuOpen}
              aria-label="Profile menu"
              className="min-h-10 flex items-center space-x-2 p-1 rounded-xl glass-panel-interactive border-white/10"
            >
              {profile.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt={profile.full_name}
                  className="w-8 h-8 rounded-lg object-cover ring-2 ring-cyan-500/40"
                />
              ) : (
                <span className="w-8 h-8 rounded-lg bg-slate-800 ring-2 ring-cyan-500/40 flex items-center justify-center">
                  <User className="w-4 h-4 text-slate-400" />
                </span>
              )}
              {profile.ftp > 0 && (
                <span className="hidden lg:inline-block text-xs font-semibold text-slate-200">
                  {profile.ftp}W FTP
                </span>
              )}
              <User className="w-4 h-4 text-slate-400 lg:hidden" />
            </button>
            {isProfileMenuOpen && profileMenu}
            </div>
          </div>
        </div>

        <div className="md:hidden flex items-center justify-end gap-2 pb-2">
          <div className="relative" ref={mobileMenuRef}>
            <button
              type="button"
              onClick={() => setIsProfileMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={isProfileMenuOpen}
              aria-label="Profile menu"
              title="Profile"
              className="min-h-11 min-w-11 flex items-center justify-center rounded-lg border border-white/10 bg-white/5"
            >
              {profile.avatar_url
                ? <img src={profile.avatar_url} alt="" className="w-7 h-7 rounded-md object-cover" />
                : <User className="w-5 h-5 text-slate-400" />}
            </button>
            {isProfileMenuOpen && profileMenu}
          </div>
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen((open) => !open)}
            aria-label={isMobileMenuOpen ? 'Close more actions' : 'Open more actions'}
            aria-expanded={isMobileMenuOpen}
            className="min-h-11 min-w-11 flex items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-200"
          >
            <MoreHorizontal className="w-5 h-5" />
          </button>
        </div>

        {isMobileMenuOpen && (
          <div className="md:hidden grid grid-cols-2 gap-2 pb-3">
            <button type="button" onClick={() => { onSyncStrava(); setIsMobileMenuOpen(false); }} className="min-h-11 flex items-center justify-center gap-2 rounded-lg border border-cyan-500/25 bg-cyan-500/10 px-3 text-xs font-semibold text-cyan-200">
              <Upload className="w-4 h-4" />
              Import data
            </button>
            {!isAuthenticated && (
              <span className="min-h-11 col-span-2 flex items-center justify-center rounded-lg border border-white/10 px-3 text-xs font-semibold text-slate-300">
                {dataMode === 'supabase' ? 'Supabase DB' : 'Local storage'}
              </span>
            )}
          </div>
        )}
      </div>

      </header>

      <nav aria-label="Primary navigation" className="md:hidden fixed bottom-0 inset-x-0 z-50 grid grid-cols-5 border-t border-white/10 bg-slate-950/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
        {tabs.map(({ id, label, icon: Icon }) => {
          const selected = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => { setActiveTab(id); setIsMobileMenuOpen(false); }}
              aria-current={selected ? 'page' : undefined}
              className={`min-h-[60px] flex flex-col items-center justify-center gap-1 px-1 text-[10px] font-semibold ${selected ? id === 'coach' ? 'text-amber-300' : 'text-cyan-300' : 'text-slate-400'}`}
            >
              <Icon className="w-5 h-5" />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
};
