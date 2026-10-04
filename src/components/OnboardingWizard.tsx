import React, { useState } from 'react';
import { Mountain, Zap, ShieldAlert, RefreshCw, ChevronRight, CheckCircle2, HeartHandshake } from 'lucide-react';
import type { AthleteProfile, Goal } from '../types';
import { getStravaAuthUrl } from '../lib/strava';

interface OnboardingWizardProps {
  isOpen: boolean;
  onCompleteOnboarding: (profileData: AthleteProfile, goalData: Goal) => void;
  onSyncStrava: () => void;
  isSyncingStrava: boolean;
}

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({
  isOpen,
  onCompleteOnboarding,
  onSyncStrava,
  isSyncingStrava,
}) => {
  if (!isOpen) return null;

  const [step, setStep] = useState<number>(1);

  // Step 1 & 2: Profile State
  const [fullName, setFullName] = useState('Alex Mercer');
  const [ftp, setFtp] = useState(285);
  const [maxHr, setMaxHr] = useState(192);
  const [lthr, setLthr] = useState(172);
  const [weightKg, setWeightKg] = useState(70.5);

  const [injuryNotes, setInjuryNotes] = useState(
    'Left patellar tendonitis awareness on steep gradients >12%\nPosterior chain tightness post high-ascent skimo'
  );
  const [wedRoutine, setWedRoutine] = useState(
    'Mid-week Decompression: 20m hamstring mobility + isometric single-leg knee extensions'
  );
  const [sunRoutine, setSunRoutine] = useState(
    'Sunday Flushing: 45m Z1 spin (<120W, CAD >95) + active leg elevation'
  );

  // Step 3: Target Goal State
  const [goalName, setGoalName] = useState('Mount Baker Hill Climb (Artist Point Finish)');
  const [sportType] = useState<Goal['sport_type']>('cycling');
  const [targetDate, setTargetDate] = useState('2026-11-15');
  const [targetDist, setTargetDist] = useState(38.5);
  const [targetElev, setTargetElev] = useState(1340);
  const [targetPower, setTargetPower] = useState(280);
  const [goalNotes, setGoalNotes] = useState('Aiming for Sub-1:45:00. 260W lower highway, 285W upper switchbacks.');

  const handleFinish = () => {
    const profile: AthleteProfile = {
      id: `profile-${Date.now()}`,
      full_name: fullName,
      avatar_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=256&q=80',
      ftp: Number(ftp),
      max_hr: Number(maxHr),
      lthr: Number(lthr),
      weight_kg: Number(weightKg),
      injury_notes: injuryNotes.split('\n').filter(Boolean),
      recovery_routines: {
        wednesday: wedRoutine,
        sunday: sunRoutine,
      },
    };

    const goal: Goal = {
      id: `goal-${Date.now()}`,
      name: goalName,
      sport_type: sportType,
      target_date: targetDate,
      target_distance_km: Number(targetDist),
      target_elevation_m: Number(targetElev),
      target_power_watts: Number(targetPower),
      notes: goalNotes,
      priority: 'A_RACE',
    };

    onCompleteOnboarding(profile, goal);
  };

  const handleConnectStrava = () => {
    const url = getStravaAuthUrl();
    if (!url) {
      alert('Please enter your Strava Client ID from strava.com/settings/api, or click "Import Sample Activity Payload" to test the pipeline!');
      return;
    }
    window.location.href = url;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md overflow-y-auto">
      <div className="w-full max-w-2xl glass-panel rounded-3xl border border-cyan-500/30 p-6 sm:p-8 shadow-2xl space-y-6">
        
        {/* Wizard Progress Bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-cyan-400">
            <span className="flex items-center">
              <Mountain className="w-4 h-4 mr-1.5" /> Summit Onboarding Wizard
            </span>
            <span>Step {step} of 4</span>
          </div>

          <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-300"
              style={{ width: `${(step / 4) * 100}%` }}
            />
          </div>
        </div>

        {/* STEP 1: Athlete Physiology */}
        {step === 1 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-extrabold text-white">1. Athlete Profile & Physiology</h2>
              <p className="text-xs text-slate-400">Enter your core thresholds to calibrate TSS, Normalized Power, and zone distributions.</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-300">Full Name</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full mt-1 bg-slate-900 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-300">FTP (Watts)</label>
                  <input
                    type="number"
                    value={ftp}
                    onChange={(e) => setFtp(Number(e.target.value))}
                    className="w-full mt-1 bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm font-bold text-amber-400 focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-300">LTHR (BPM)</label>
                  <input
                    type="number"
                    value={lthr}
                    onChange={(e) => setLthr(Number(e.target.value))}
                    className="w-full mt-1 bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm font-bold text-rose-400 focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-300">Max HR (BPM)</label>
                  <input
                    type="number"
                    value={maxHr}
                    onChange={(e) => setMaxHr(Number(e.target.value))}
                    className="w-full mt-1 bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm font-bold text-slate-200 focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-300">Weight (kg)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={weightKg}
                    onChange={(e) => setWeightKg(Number(e.target.value))}
                    className="w-full mt-1 bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm font-bold text-cyan-400 focus:border-cyan-500"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-3">
              <button
                onClick={() => setStep(2)}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 text-slate-950 font-bold text-xs hover:opacity-90 flex items-center space-x-1.5"
              >
                <span>Next: Injury & Recovery</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: Injury Guardian & Decompression Routines */}
        {step === 2 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-extrabold text-white">2. Injury Awareness & Recovery Setup</h2>
              <p className="text-xs text-slate-400">Specify health considerations so your AI Coach protects knee joints and posterior chain.</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-amber-300 flex items-center mb-1">
                  <ShieldAlert className="w-4 h-4 mr-1 text-amber-400" /> Active Injury / Joint Awareness Notes (One per line)
                </label>
                <textarea
                  rows={3}
                  value={injuryNotes}
                  onChange={(e) => setInjuryNotes(e.target.value)}
                  placeholder="e.g. Left patellar tendonitis on >12% grade climbs"
                  className="w-full bg-slate-900 border border-white/10 rounded-xl p-3 text-xs text-slate-200 focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-emerald-300 flex items-center mb-1">
                  <HeartHandshake className="w-4 h-4 mr-1 text-emerald-400" /> Mid-Week Wednesday Decompression Routine
                </label>
                <input
                  type="text"
                  value={wedRoutine}
                  onChange={(e) => setWedRoutine(e.target.value)}
                  className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-emerald-300 flex items-center mb-1">
                  <HeartHandshake className="w-4 h-4 mr-1 text-emerald-400" /> Sunday Metabolic Flushing Routine
                </label>
                <input
                  type="text"
                  value={sunRoutine}
                  onChange={(e) => setSunRoutine(e.target.value)}
                  className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 focus:border-cyan-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-3">
              <button
                onClick={() => setStep(1)}
                className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-300"
              >
                Back
              </button>
              <button
                onClick={() => setStep(3)}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 text-slate-950 font-bold text-xs hover:opacity-90 flex items-center space-x-1.5"
              >
                <span>Next: Target Goal</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: Priority Goal Setup */}
        {step === 3 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-extrabold text-white">3. Priority Milestone Goal (e.g. Mount Baker)</h2>
              <p className="text-xs text-slate-400">Configure your key event target for real-time race readiness countdowns.</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-300">Goal Event Name</label>
                <input
                  type="text"
                  value={goalName}
                  onChange={(e) => setGoalName(e.target.value)}
                  className="w-full mt-1 bg-slate-900 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-300">Target Date</label>
                  <input
                    type="date"
                    value={targetDate}
                    onChange={(e) => setTargetDate(e.target.value)}
                    className="w-full mt-1 bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-300">Target Distance (km)</label>
                  <input
                    type="number"
                    value={targetDist}
                    onChange={(e) => setTargetDist(Number(e.target.value))}
                    className="w-full mt-1 bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs font-bold text-white focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-300">Target Elevation Gain (m)</label>
                  <input
                    type="number"
                    value={targetElev}
                    onChange={(e) => setTargetElev(Number(e.target.value))}
                    className="w-full mt-1 bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs font-bold text-white focus:border-cyan-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-amber-300">Target Power Effort (Watts)</label>
                <input
                  type="number"
                  value={targetPower}
                  onChange={(e) => setTargetPower(Number(e.target.value))}
                  className="w-full mt-1 bg-slate-900 border border-white/10 rounded-xl px-4 py-2.5 text-sm font-extrabold text-amber-400 focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-300">Strategy Notes</label>
                <input
                  type="text"
                  value={goalNotes}
                  onChange={(e) => setGoalNotes(e.target.value)}
                  className="w-full mt-1 bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-300 focus:border-cyan-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-3">
              <button
                onClick={() => setStep(2)}
                className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-300"
              >
                Back
              </button>
              <button
                onClick={() => setStep(4)}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 text-slate-950 font-bold text-xs hover:opacity-90 flex items-center space-x-1.5"
              >
                <span>Next: Strava Sync</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: Strava Integration & Launch */}
        {step === 4 && (
          <div className="space-y-5 text-center py-2">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-orange-500 to-amber-400 p-[2px] mx-auto">
              <div className="w-full h-full bg-slate-950 rounded-[14px] flex items-center justify-center">
                <RefreshCw className="w-6 h-6 text-orange-400" />
              </div>
            </div>

            <div>
              <h2 className="text-xl font-extrabold text-white">4. Connect Strava & Launch Summit</h2>
              <p className="text-xs text-slate-400 max-w-md mx-auto mt-1">
                Connect your Strava account to automatically ingest activities, parse streams, and compute TSS metrics.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 py-2">
              <button
                onClick={handleConnectStrava}
                className="w-full sm:w-auto px-5 py-3 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-bold text-xs shadow-lg shadow-orange-600/30 flex items-center justify-center space-x-2"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Authorize Strava OAuth</span>
              </button>

              <button
                onClick={onSyncStrava}
                disabled={isSyncingStrava}
                className="w-full sm:w-auto px-5 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-white/10 text-cyan-400 font-bold text-xs flex items-center justify-center space-x-2"
              >
                <Zap className="w-4 h-4" />
                <span>{isSyncingStrava ? 'Syncing Activity...' : 'Import Sample Activity Payload'}</span>
              </button>
            </div>

            <div className="pt-4 border-t border-white/10 flex items-center justify-between">
              <button
                onClick={() => setStep(3)}
                className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-300"
              >
                Back
              </button>
              <button
                onClick={handleFinish}
                className="px-8 py-3 rounded-xl bg-gradient-to-r from-emerald-500 via-cyan-500 to-blue-500 text-slate-950 font-extrabold text-xs shadow-lg shadow-emerald-500/20 hover:opacity-95 flex items-center space-x-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Complete Onboarding & Launch Dashboard</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
