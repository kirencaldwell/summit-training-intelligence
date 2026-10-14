import React from 'react';
import { HeartPulse, Zap, Mountain } from 'lucide-react';

export type PerformanceView = 'heart-rate' | 'power' | 'travel';

const VIEWS = [
  { id: 'heart-rate' as const, label: 'Heart rate', icon: HeartPulse, active: 'bg-rose-500/15 text-rose-200 border-rose-500/40' },
  { id: 'power' as const, label: 'Power', icon: Zap, active: 'bg-amber-500/15 text-amber-200 border-amber-500/40' },
  { id: 'travel' as const, label: 'Travel pace', icon: Mountain, active: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/40' },
];

interface PerformancePageProps {
  view: PerformanceView;
  onViewChange: (view: PerformanceView) => void;
  heartRate: React.ReactNode;
  power: React.ReactNode;
  travel: React.ReactNode;
}

/** One home for the athlete's performance views: heart-rate zones, the power curve, and hiking/ski travel pace. */
export const PerformancePage: React.FC<PerformancePageProps> = ({ view, onViewChange, heartRate, power, travel }) => (
  <div className="space-y-6">
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Performance view">
      {VIEWS.map((v) => {
        const Icon = v.icon;
        const active = view === v.id;
        return (
          <button
            key={v.id}
            role="tab"
            aria-selected={active}
            onClick={() => onViewChange(v.id)}
            className={`min-h-10 inline-flex items-center gap-2 px-4 rounded-xl text-sm font-semibold border transition-all ${active ? v.active : 'text-slate-400 border-white/10 hover:text-white hover:bg-white/5'}`}
          >
            <Icon className="w-4 h-4" /> {v.label}
          </button>
        );
      })}
    </div>
    {view === 'heart-rate' && heartRate}
    {view === 'power' && power}
    {view === 'travel' && travel}
  </div>
);
