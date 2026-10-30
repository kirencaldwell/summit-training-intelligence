import type { SessionScore, ScoreItem, ScoreStatus } from '../types';
import type { PlanCheckResult } from './planChecks';

/**
 * Scoring a completed session against its plan, with no AI: the duration and load the plan asked for, plus the
 * measurable checks (intervals, sprints, ceilings, zones, climbing rate, vertical) already run on the recorded data.
 * The AI assessment stays available, but this gives a verdict the moment activities are linked.
 */
export const SESSION_SCORE_VERSION = 1;

const round = (n: number, d = 0) => { const f = 10 ** d; return Math.round(f * n) / f; };

/** How a result compares with others of the same check across several linked activities: higher is better. */
const RANK: Record<ScoreStatus, number> = { met: 3, partial: 2, missed: 1, info: 0 };

function statusOf(r: PlanCheckResult): ScoreStatus {
  switch (r.status) {
    case 'met': case 'within_cap': case 'within_limit':
      return 'met';
    case 'partly_met': case 'shorter_than_planned': case 'below_target_power': case 'brief_excursions':
      return 'partial';
    case 'not_found': case 'exceeded': case 'not_met': case 'below_target': case 'short':
      return r.optional ? 'info' : 'missed';
    default:
      return 'info'; // could not be measured: no data, no FTP, ...
  }
}

function detailOf(r: PlanCheckResult): string {
  const unmeasured = statusOf(r) === 'info' && !['not_found'].includes(r.status) && !r.efforts;
  if (unmeasured && (r.status.startsWith('no_') || r.status.startsWith('needs_') || r.status === 'not_measurable')) {
    return `Could not be measured: ${r.measured_as}`;
  }
  switch (r.kind) {
    case 'intervals': {
      const parts = [`${r.found ?? 0} of ${r.expected ?? '?'} found`];
      if (r.efforts?.length) parts.push(`averaging ${r.efforts.map((e) => `${e.avg_watts} W`).join(', ')}`);
      if (r.notes?.length) parts.push(r.notes[0]);
      return parts.join('; ');
    }
    case 'repeated_efforts': {
      const parts = [r.expected !== undefined ? `${r.found ?? 0} of ${r.expected} found` : `${r.found ?? 0} found`];
      if (r.efforts?.length) parts.push(r.efforts.map((e) => `${e.seconds} s at ${e.avg_watts} W`).slice(0, 4).join(', '));
      return parts.join('; ');
    }
    case 'power_cap': {
      const s = r.stats ?? {};
      return `${s.percent_of_pedalling_time_above_cap ?? 0}% of pedalling time above ${s.cap_watts} W (best 30 s ${s.best_30s_watts} W)`;
    }
    case 'time_in_zone': {
      const s = r.stats ?? {};
      return `${s.percent_in_range}% in range, ${s.percent_above_range}% above, ${s.percent_below_range}% below`;
    }
    case 'climb_rate': {
      const s = r.stats ?? {};
      const best = s.best_30min_climb_ft_per_hour ? `, best 30 min ${Number(s.best_30min_climb_ft_per_hour).toLocaleString()}` : '';
      return `${Number(r.found).toLocaleString()} ft/h while climbing vs ${Number(r.expected).toLocaleString()} asked${best}`;
    }
    case 'vertical_gain':
      return `${Number(r.found).toLocaleString()} ft gained vs ${Number(r.expected).toLocaleString()} asked`;
    default:
      return r.status;
  }
}

export interface ScoreInput {
  planned_minutes: number;
  planned_tss?: number;
  actual_minutes: number;
  actual_tss: number;
  /** The same check's result for each linked activity (outer: check, inner: activity) */
  check_results: PlanCheckResult[][];
  activity_ids: string[];
  now?: Date;
}

const within = (ratio: number, lo: number, hi: number, softLo: number, softHi: number): ScoreStatus =>
  ratio >= lo && ratio <= hi ? 'met' : ratio >= softLo && ratio <= softHi ? 'partial' : 'missed';

export function scoreSession(input: ScoreInput): SessionScore {
  const items: ScoreItem[] = [];

  if (input.planned_minutes > 0) {
    const ratio = input.actual_minutes / input.planned_minutes;
    items.push({
      label: 'Duration',
      status: within(ratio, 0.85, 1.3, 0.6, 1.6),
      detail: `${round(input.actual_minutes)} min done vs ${round(input.planned_minutes)} planned (${round(ratio * 100)}%)`,
    });
  }
  if (input.planned_tss && input.planned_tss > 0) {
    const ratio = input.actual_tss / input.planned_tss;
    items.push({
      label: 'Training load',
      status: within(ratio, 0.75, 1.35, 0.5, 1.75),
      detail: `${round(input.actual_tss)} TSS vs ${round(input.planned_tss)} planned (${round(ratio * 100)}%)`,
    });
  }

  for (const perActivity of input.check_results) {
    if (!perActivity.length) continue;
    // Efforts may be in any of the linked rides: take the best. A ceiling must hold in all of them: take the worst.
    const scored = perActivity.map((r) => ({ r, status: statusOf(r) }));
    const worstWins = perActivity[0].kind === 'power_cap';
    const known = scored.filter((x) => x.status !== 'info');
    const pool = known.length ? known : scored;
    const pick = pool.reduce((a, b) => ((worstWins ? RANK[b.status] < RANK[a.status] : RANK[b.status] > RANK[a.status]) ? b : a));
    items.push({ label: pick.r.label, status: pick.status, detail: detailOf(pick.r) });
  }

  const measured = items.filter((i) => i.status !== 'info');
  const met = measured.filter((i) => i.status === 'met').length;
  const missed = measured.filter((i) => i.status === 'missed');
  const partial = measured.filter((i) => i.status === 'partial');
  let verdict: SessionScore['verdict'];
  let headline: string;
  if (measured.length === 0) {
    verdict = 'unmeasured';
    headline = 'Nothing in this plan could be measured from the linked activities.';
  } else if (met === measured.length) {
    verdict = 'on_plan';
    headline = `On plan: ${met} of ${measured.length} checks met.`;
  } else if (missed.length > measured.length / 2) {
    verdict = 'off_plan';
    headline = `Off plan: ${met} of ${measured.length} checks met. Missed: ${missed.map((i) => i.label).join('; ')}.`;
  } else {
    verdict = 'partly';
    const gaps = [...missed, ...partial].map((i) => i.label);
    headline = `Partly on plan: ${met} of ${measured.length} checks met. Short on: ${gaps.join('; ')}.`;
  }

  return { v: SESSION_SCORE_VERSION, verdict, headline, items, at: (input.now ?? new Date()).toISOString(), activity_ids: input.activity_ids };
}
