import React, { useState } from 'react';
import { Check, X } from 'lucide-react';
import { newSuggestions, type AssessmentVerdict, type StructuredAssessment } from '../lib/coachMemory';
import { useCoachMemory } from './CoachMemoryContext';

const VERDICT: Record<AssessmentVerdict, { label: string; cls: string } | null> = {
  on_plan: { label: 'On plan', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  partly: { label: 'Partly on plan', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  off_plan: { label: 'Off plan', cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
  unplanned: null,
};

/** The coach's assessment in its fixed shape: a verdict and headline, findings with their evidence, next steps. */
export const StructuredAssessmentView: React.FC<{ assessment: StructuredAssessment }> = ({ assessment }) => {
  const { memory, remember } = useCoachMemory();
  const [dismissed, setDismissed] = useState<string[]>([]);
  const verdict = VERDICT[assessment.verdict];
  const suggestions = newSuggestions(memory, assessment.remember).filter((s) => !dismissed.includes(s));
  return (
    <div className="space-y-3 text-sm text-slate-300 leading-relaxed">
      <div className="flex flex-wrap items-start gap-2">
        {verdict && <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${verdict.cls}`}>{verdict.label}</span>}
        {assessment.headline && <p className="min-w-0 flex-1 font-semibold text-white">{assessment.headline}</p>}
      </div>
      {assessment.findings.length > 0 && (
        <ul className="space-y-2.5">
          {assessment.findings.map((f, i) => (
            <li key={i}>
              <p><span className="font-semibold text-cyan-200">{f.topic}.</span> {f.detail}</p>
              {f.evidence && <p className="mt-0.5 text-[11px] text-slate-500">Based on: {f.evidence}</p>}
            </li>
          ))}
        </ul>
      )}
      {assessment.next_steps.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Next</p>
          <ul className="mt-1 list-disc pl-5 space-y-1">
            {assessment.next_steps.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}
      {suggestions.map((s) => (
        <div key={s} className="flex flex-wrap items-center gap-2 rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-3 py-2 text-xs">
          <span className="min-w-0 flex-1 text-slate-300">The coach suggests remembering: <span className="font-semibold text-white">{s}</span></span>
          <button type="button" onClick={() => remember(s)} className="min-h-8 inline-flex items-center gap-1 rounded-md bg-cyan-500/20 px-2.5 font-semibold text-cyan-200 hover:bg-cyan-500/30">
            <Check className="w-3.5 h-3.5" /> Remember
          </button>
          <button type="button" onClick={() => setDismissed((d) => [...d, s])} aria-label="Dismiss" className="min-h-8 min-w-8 inline-flex items-center justify-center rounded-md text-slate-500 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};
