import React, { useState } from 'react';
import { X, Zap, ShieldAlert, HeartHandshake, Save } from 'lucide-react';
import type { AthleteProfile } from '../types';
import { kgToLb, lbToKg, roundTo } from '../lib/units';

interface AthleteProfileModalProps {
  profile: AthleteProfile;
  isOpen: boolean;
  onClose: () => void;
  onSaveProfile: (updated: Partial<AthleteProfile>) => void;
}

export const AthleteProfileModal: React.FC<AthleteProfileModalProps> = ({
  profile,
  isOpen,
  onClose,
  onSaveProfile,
}) => {
  if (!isOpen) return null;

  const [ftp, setFtp] = useState(profile.ftp);
  const [lthr, setLthr] = useState(profile.lthr);
  const [maxHr, setMaxHr] = useState(profile.max_hr);
  const [weightLb, setWeightLb] = useState(roundTo(kgToLb(profile.weight_kg), 1));
  const [injuries, setInjuries] = useState(profile.injury_notes.join('\n'));
  const [wedRoutine, setWedRoutine] = useState(profile.recovery_routines.wednesday);
  const [sunRoutine, setSunRoutine] = useState(profile.recovery_routines.sunday);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveProfile({
      ftp: Number(ftp),
      lthr: Number(lthr),
      max_hr: Number(maxHr),
      weight_kg: roundTo(lbToKg(Number(weightLb)), 2),
      injury_notes: injuries.split('\n').filter(Boolean),
      recovery_routines: {
        wednesday: wedRoutine,
        sunday: sunRoutine,
      },
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto">
      <div className="w-full max-w-2xl glass-panel rounded-2xl border border-white/15 p-6 shadow-2xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center space-x-3">
            <img
              src={profile.avatar_url}
              alt={profile.full_name}
              className="w-10 h-10 rounded-xl object-cover ring-2 ring-cyan-500/40"
            />
            <div>
              <h2 className="text-lg font-bold text-white">{profile.full_name}</h2>
              <p className="text-xs text-slate-400">Endurance Athlete Settings & Recovery Guardian</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Physiological Engine Inputs */}
          <div>
            <h3 className="text-sm font-semibold text-cyan-300 mb-3 flex items-center">
              <Zap className="w-4 h-4 mr-1.5 text-amber-400" /> Physiological Threshold Parameters
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-slate-400 font-medium">FTP (Watts)</label>
                <input
                  type="number"
                  value={ftp}
                  onChange={(e) => setFtp(Number(e.target.value))}
                  className="w-full mt-1 bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:border-cyan-500 font-bold"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 font-medium">LTHR (BPM)</label>
                <input
                  type="number"
                  value={lthr}
                  onChange={(e) => setLthr(Number(e.target.value))}
                  className="w-full mt-1 bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:border-cyan-500 font-bold"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 font-medium">Max HR (BPM)</label>
                <input
                  type="number"
                  value={maxHr}
                  onChange={(e) => setMaxHr(Number(e.target.value))}
                  className="w-full mt-1 bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:border-cyan-500 font-bold"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 font-medium">Weight (lb)</label>
                <input
                  type="number"
                  step="0.1"
                  value={weightLb}
                  onChange={(e) => setWeightLb(Number(e.target.value))}
                  className="w-full mt-1 bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:border-cyan-500 font-bold"
                />
              </div>
            </div>
          </div>

          {/* Injury & Knee Considerations */}
          <div>
            <h3 className="text-sm font-semibold text-amber-300 mb-2 flex items-center">
              <ShieldAlert className="w-4 h-4 mr-1.5 text-amber-400" /> Injury Considerations (One per line)
            </h3>
            <textarea
              rows={3}
              value={injuries}
              onChange={(e) => setInjuries(e.target.value)}
              className="w-full bg-slate-900 border border-white/10 rounded-xl p-3 text-xs text-slate-200 focus:border-cyan-500"
            />
          </div>

          {/* Recovery Routines */}
          <div>
            <h3 className="text-sm font-semibold text-emerald-300 mb-2 flex items-center">
              <HeartHandshake className="w-4 h-4 mr-1.5 text-emerald-400" /> Decompression & Recovery Routines
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-400">Mid-Week Wednesday Decompression Routine</label>
                <input
                  type="text"
                  value={wedRoutine}
                  onChange={(e) => setWedRoutine(e.target.value)}
                  className="w-full mt-1 bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400">Sunday Metabolic Flushing Routine</label>
                <input
                  type="text"
                  value={sunRoutine}
                  onChange={(e) => setSunRoutine(e.target.value)}
                  className="w-full mt-1 bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 focus:border-cyan-500"
                />
              </div>
            </div>
          </div>

          {/* Footer Submit */}
          <div className="pt-3 border-t border-white/10 flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 text-slate-950 font-bold text-xs hover:opacity-90 flex items-center space-x-1.5"
            >
              <Save className="w-4 h-4" />
              <span>Save Profile</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
