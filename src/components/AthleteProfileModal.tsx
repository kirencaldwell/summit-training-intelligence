import React, { useState } from 'react';
import { X, Zap, NotebookPen, Save, User, Bot, UserRound } from 'lucide-react';
import type { AthleteProfile } from '../types';
import { kgToLb, lbToKg, roundTo } from '../lib/units';
import { activeCoachLabel } from '../lib/coachSettings';
import { CoachSettingsModal } from './CoachSettingsModal';

interface AthleteProfileModalProps {
  profile: AthleteProfile;
  /** True when the athlete hasn't entered their thresholds yet (shown after first sign-in) */
  needsSetup?: boolean;
  onClose: () => void;
  onSaveProfile: (updated: Partial<AthleteProfile>) => Promise<void>;
}

const numberText = (value: number, convert: (n: number) => number = (n) => n) =>
  value > 0 ? String(roundTo(convert(value), 1)) : '';

/** Everything the athlete sets up lives here: identity, thresholds, notes about themselves, and the coach AI. */
export const AthleteProfileModal: React.FC<AthleteProfileModalProps> = ({
  profile,
  needsSetup = false,
  onClose,
  onSaveProfile,
}) => {
  const [fullName, setFullName] = useState(profile.full_name ?? '');
  const [ftp, setFtp] = useState(numberText(profile.ftp));
  const [lthr, setLthr] = useState(numberText(profile.lthr));
  const [maxHr, setMaxHr] = useState(numberText(profile.max_hr));
  const [weightLb, setWeightLb] = useState(numberText(profile.weight_kg, kgToLb));
  const [notes, setNotes] = useState(profile.notes ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [isCoachSettingsOpen, setIsCoachSettingsOpen] = useState(false);
  // Re-read the coach label after the settings dialog closes
  const [, setCoachSettingsVersion] = useState(0);

  const positive = (text: string) => {
    const n = Number(text);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError('');
    try {
      await onSaveProfile({
        full_name: fullName.trim(),
        ftp: Math.round(positive(ftp)),
        lthr: Math.round(positive(lthr)),
        max_hr: Math.round(positive(maxHr)),
        weight_kg: roundTo(lbToKg(positive(weightLb)), 2),
        notes: notes.trim(),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Profile could not be saved.');
      setIsSaving(false);
    }
  };

  const inputClass =
    'w-full mt-1 bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-600 focus:border-cyan-500 focus:outline-none';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto">
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto glass-panel rounded-2xl border border-white/15 p-6 shadow-2xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center space-x-3">
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt="" className="w-10 h-10 rounded-xl object-cover ring-2 ring-cyan-500/40" />
            ) : (
              <span className="w-10 h-10 rounded-xl bg-slate-800 ring-2 ring-cyan-500/40 flex items-center justify-center">
                <User className="w-5 h-5 text-slate-400" />
              </span>
            )}
            <div>
              <h2 className="text-lg font-bold text-white">{profile.full_name || 'Your profile'}</h2>
              <p className="text-xs text-slate-400">Athlete profile & settings</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {needsSetup && (
          <p className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-3 text-xs text-cyan-100 leading-relaxed">
            Welcome! Add your thresholds below so training load, fitness and fatigue are calculated accurately. Everything is
            optional and you can change it any time from your profile. To add goals, use the Goals tab.
          </p>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
          {/* About you */}
          <div>
            <h3 className="text-sm font-semibold text-cyan-300 mb-2 flex items-center">
              <UserRound className="w-4 h-4 mr-1.5" /> About You
            </h3>
            <label className="text-xs text-slate-400 font-medium">
              Name
              <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your name" className={inputClass} />
            </label>
          </div>

          {/* Physiological Engine Inputs */}
          <div>
            <h3 className="text-sm font-semibold text-cyan-300 mb-3 flex items-center">
              <Zap className="w-4 h-4 mr-1.5 text-amber-400" /> Physiological Thresholds
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <label className="text-xs text-slate-400 font-medium">
                FTP (watts)
                <input type="number" min={0} value={ftp} onChange={(e) => setFtp(e.target.value)} placeholder="e.g. 250" className={`${inputClass} font-bold`} />
              </label>
              <label className="text-xs text-slate-400 font-medium">
                LTHR (bpm)
                <input type="number" min={0} value={lthr} onChange={(e) => setLthr(e.target.value)} placeholder="e.g. 165" className={`${inputClass} font-bold`} />
              </label>
              <label className="text-xs text-slate-400 font-medium">
                Max HR (bpm)
                <input type="number" min={0} value={maxHr} onChange={(e) => setMaxHr(e.target.value)} placeholder="e.g. 185" className={`${inputClass} font-bold`} />
              </label>
              <label className="text-xs text-slate-400 font-medium">
                Weight (lb)
                <input type="number" min={0} step="0.1" value={weightLb} onChange={(e) => setWeightLb(e.target.value)} placeholder="e.g. 155" className={`${inputClass} font-bold`} />
              </label>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              LTHR drives heart-rate training load, FTP drives power-based load, and weight is used for pack-weight and W/kg estimates.
            </p>
          </div>

          {/* Notes about the athlete */}
          <div>
            <h3 className="text-sm font-semibold text-cyan-300 mb-2 flex items-center">
              <NotebookPen className="w-4 h-4 mr-1.5" /> Notes About Yourself
            </h3>
            <textarea
              rows={6}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={4000}
              placeholder="Anything your coach should know: injuries or health issues, training history, how much time you have, equipment, how you like to train and recover, goals outside this app…"
              className="w-full bg-slate-900 border border-white/10 rounded-xl p-3 text-xs text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-slate-500">Shared with your AI coach whenever it answers or estimates training load.</p>
          </div>

          {/* Coach AI */}
          <div>
            <h3 className="text-sm font-semibold text-cyan-300 mb-2 flex items-center">
              <Bot className="w-4 h-4 mr-1.5" /> AI Coach
            </h3>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-900/60 p-3">
              <p className="text-xs text-slate-300">
                Answering as <span className="font-semibold text-white">{activeCoachLabel()}</span>. Use your own Claude API key or the app's default.
              </p>
              <button
                type="button"
                onClick={() => setIsCoachSettingsOpen(true)}
                className="px-3 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 text-xs font-semibold"
              >
                Coach AI settings
              </button>
            </div>
          </div>

          {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}

          {/* Footer Submit */}
          <div className="pt-3 border-t border-white/10 flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-300 disabled:opacity-50"
            >
              {needsSetup ? 'Skip for now' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 text-slate-950 font-bold text-xs hover:opacity-90 flex items-center space-x-1.5 disabled:opacity-60"
            >
              <Save className="w-4 h-4" />
              <span>{isSaving ? 'Saving…' : 'Save Profile'}</span>
            </button>
          </div>
        </form>
      </div>

      {isCoachSettingsOpen && (
        <CoachSettingsModal
          onClose={() => setIsCoachSettingsOpen(false)}
          onSaved={() => setCoachSettingsVersion((v) => v + 1)}
        />
      )}
    </div>
  );
};
