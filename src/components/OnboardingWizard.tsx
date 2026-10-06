import React, { useState } from 'react';
import { Mountain, ShieldAlert, Upload, ChevronRight, CheckCircle2, HeartHandshake } from 'lucide-react';
import type { AthleteProfile, Goal } from '../types';
import { ftToM, lbToKg, miToKm, roundTo } from '../lib/units';

interface OnboardingWizardProps {
  onCompleteOnboarding: (profileData: AthleteProfile, goalData: Goal | null) => void;
}

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({
  onCompleteOnboarding,
}) => {
  const [step, setStep] = useState<number>(1);

  // Step 1 & 2: Profile State (everything is supplied by the athlete — no defaults)
  const [fullName, setFullName] = useState('');
  const [ftp, setFtp] = useState('');
  const [maxHr, setMaxHr] = useState('');
  const [lthr, setLthr] = useState('');
  const [weightLb, setWeightLb] = useState('');

  const [injuryNotes, setInjuryNotes] = useState('');
  const [wedRoutine, setWedRoutine] = useState('');
  const [sunRoutine, setSunRoutine] = useState('');

  // Step 3: Target Goal State (optional)
  const [goalName, setGoalName] = useState('');
  const [sportType] = useState<Goal['sport_type']>('cycling');
  const [targetDate, setTargetDate] = useState('');
  const [targetDist, setTargetDist] = useState('');
  const [targetElev, setTargetElev] = useState('');
  const [targetPower, setTargetPower] = useState('');
  const [goalNotes, setGoalNotes] = useState('');

  const isPositive = (v: string) => Number(v) > 0;
  const isProfileValid =
    fullName.trim() !== '' && isPositive(ftp) && isPositive(lthr) && isPositive(maxHr) && isPositive(weightLb);
  const optionalNumber = (v: string, convert: (n: number) => number = (n) => n) =>
    (isPositive(v) ? roundTo(convert(Number(v)), 2) : undefined);

  const handleFinish = () => {
    const profile: AthleteProfile = {
      id: `profile-${Date.now()}`,
      full_name: fullName.trim(),
      ftp: Number(ftp),
      max_hr: Number(maxHr),
      lthr: Number(lthr),
      weight_kg: roundTo(lbToKg(Number(weightLb)), 2),
      injury_notes: injuryNotes.split('\n').map((n) => n.trim()).filter(Boolean),
      recovery_routines: {
        wednesday: wedRoutine,
        sunday: sunRoutine,
      },
    };

    // The goal is optional: only create one if the athlete named it
    const goal: Goal | null = goalName.trim()
      ? {
          id: `goal-${Date.now()}`,
          name: goalName.trim(),
          sport_type: sportType,
          target_date: targetDate || undefined,
          timeframe_text: targetDate ? `Target Date: ${targetDate}` : undefined,
          objective_summary: goalNotes || goalName.trim(),
          target_distance_km: optionalNumber(targetDist, miToKm),
          target_elevation_m: optionalNumber(targetElev, ftToM),
          target_power_watts: optionalNumber(targetPower),
          notes: goalNotes,
          priority: 'A_RACE',
          status: 'ACTIVE',
        }
      : null;

    onCompleteOnboarding(profile, goal);
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
                  placeholder="Your name"
                  className="w-full mt-1 bg-slate-900 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-300">FTP (Watts)</label>
                  <input
                    type="number"
                    value={ftp}
                    onChange={(e) => setFtp(e.target.value)}
                    placeholder="e.g. 250"
                    className="w-full mt-1 bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm font-bold text-amber-400 focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-300">LTHR (BPM)</label>
                  <input
                    type="number"
                    value={lthr}
                    onChange={(e) => setLthr(e.target.value)}
                    placeholder="e.g. 165"
                    className="w-full mt-1 bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm font-bold text-rose-400 focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-300">Max HR (BPM)</label>
                  <input
                    type="number"
                    value={maxHr}
                    onChange={(e) => setMaxHr(e.target.value)}
                    placeholder="e.g. 185"
                    className="w-full mt-1 bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm font-bold text-slate-200 focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-300">Weight (lb)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={weightLb}
                    onChange={(e) => setWeightLb(e.target.value)}
                    placeholder="e.g. 155"
                    className="w-full mt-1 bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm font-bold text-cyan-400 focus:border-cyan-500"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-3">
              <button
                onClick={() => setStep(2)}
                disabled={!isProfileValid}
                title={isProfileValid ? undefined : 'Enter your name, FTP, LTHR, max HR and weight to continue'}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 text-slate-950 font-bold text-xs hover:opacity-90 flex items-center space-x-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
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
                  placeholder="Optional. e.g. Knee pain on steep descents"
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
                  placeholder="Optional"
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
                  placeholder="Optional"
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
              <h2 className="text-xl font-extrabold text-white">3. Priority Milestone Goal (optional)</h2>
              <p className="text-xs text-slate-400">Name your key event for countdowns and readiness tracking, or skip this and add goals later.</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-300">Goal Event Name</label>
                <input
                  type="text"
                  value={goalName}
                  onChange={(e) => setGoalName(e.target.value)}
                  placeholder="e.g. Local hill climb, ski traverse"
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
                  <label className="text-xs font-medium text-slate-300">Target Distance (mi)</label>
                  <input
                    type="number"
                    value={targetDist}
                    onChange={(e) => setTargetDist(e.target.value)}
                    className="w-full mt-1 bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs font-bold text-white focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-300">Target Elevation Gain (ft)</label>
                  <input
                    type="number"
                    value={targetElev}
                    onChange={(e) => setTargetElev(e.target.value)}
                    className="w-full mt-1 bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs font-bold text-white focus:border-cyan-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-amber-300">Target Power Effort (Watts, optional)</label>
                <input
                  type="number"
                  value={targetPower}
                  onChange={(e) => setTargetPower(e.target.value)}
                  className="w-full mt-1 bg-slate-900 border border-white/10 rounded-xl px-4 py-2.5 text-sm font-extrabold text-amber-400 focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-300">Strategy Notes</label>
                <input
                  type="text"
                  value={goalNotes}
                  onChange={(e) => setGoalNotes(e.target.value)}
                  placeholder="Optional"
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
                <span>Next: Import Data</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: Launch */}
        {step === 4 && (
          <div className="space-y-5 text-center py-2">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-cyan-500 to-emerald-400 p-[2px] mx-auto">
              <div className="w-full h-full bg-slate-950 rounded-[14px] flex items-center justify-center">
                <Upload className="w-6 h-6 text-cyan-400" />
              </div>
            </div>

            <div>
              <h2 className="text-xl font-extrabold text-white">4. Launch Summit</h2>
              <p className="text-xs text-slate-400 max-w-md mx-auto mt-1">
                Once you're in, use <span className="font-semibold text-slate-200">Import data</span> in the top bar to upload FIT files or
                connect COROS. Your dashboard fills in from the activities you provide.
              </p>
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
                disabled={!isProfileValid}
                className="px-8 py-3 rounded-xl bg-gradient-to-r from-emerald-500 via-cyan-500 to-blue-500 text-slate-950 font-extrabold text-xs shadow-lg shadow-emerald-500/20 hover:opacity-95 flex items-center space-x-2 disabled:opacity-40 disabled:cursor-not-allowed"
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
