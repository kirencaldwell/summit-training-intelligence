import type { Goal, PMCDayPoint, TrainingSession } from '../types';
import { ctlOn, goalProgress } from './trainingLog';
import { addDaysToDateOnly, getLocalDateString } from './trainingSessions';

/**
 * The weekly check-in's arithmetic, with no AI: how much training the week should hold (a load budget worked out from
 * fitness, form, the goal's phase targets and the athlete's availability) and a check of any drafted week against it.
 * The AI only fills the available days with sessions; this decides how much, and whether what it drafted is sound.
 */
export type Feel = 'fresh' | 'normal' | 'tired';

export interface DayAvailability {
  date: string;
  available: boolean;
  /** The longest session that day can take */
  max_minutes: number;
  /** The athlete's own note for the day ("commute there and back", "e-bike only"), passed to the coach as written */
  note?: string;
}

export interface CheckIn {
  week_start: string;
  days: DayAvailability[];
  feel: Feel;
  notes: string;
}

/** Daily CTL gain per unit of daily TSS held for a week (1 - e^(-7/42)): a week at d TSS/day moves CTL by (d - CTL) x this */
const WEEK_CTL_FACTOR = 1 - Math.exp(-7 / 42);

/** Training stress per hour for a session of this length: short ones can be hard, long ones are steadier */
export const tssPerHourCap = (minutes: number) => (minutes <= 90 ? 85 : minutes <= 180 ? 70 : 60);
export const HARD_TSS_PER_HOUR = 70;
const DEFAULT_TSS_PER_HOUR = 50;

export const sessionIsHard = (minutes: number, tss: number) => minutes > 0 && (tss / minutes) * 60 >= HARD_TSS_PER_HOUR;

export interface WeekBudget {
  week_start: string;
  ctl_now: number;
  atl_now: number;
  tsb_now: number;
  /** TSS actually done in the week so far (the current week only) */
  done_tss: number;
  /** TSS of sessions already planned for days the check-in leaves out */
  booked_tss: number;
  /** TSS the whole week should reach, and the range around it */
  week_tss_target: number;
  week_tss_min: number;
  week_tss_max: number;
  /** TSS still to fit into the available days */
  remaining_tss_target: number;
  remaining_tss_min: number;
  remaining_tss_max: number;
  /** The CTL change over the week this target aims for */
  ctl_change: number;
  /** What the available days could hold at most */
  capacity_tss: number;
  max_session_tss: number;
  max_hard_days: number;
  slots: { date: string; max_minutes: number; role: 'long' | 'standard' | 'short' }[];
  /** Plain-language reasons for the numbers, shown to the athlete */
  reasons: string[];
}

const round = (n: number) => Math.round(n);

/**
 * Reads what a free-text day note says about time, so "1 hour, commute there and back" sets the day's limit and "off"
 * turns it off, without the athlete touching the controls. Anything else in the note is left for the coach to read.
 */
export function readDayNote(text: string): { available?: boolean; max_minutes?: number } {
  const t = text.toLowerCase();
  let minutes: number | undefined;
  const hm = t.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b(?:\s*(?:and\s*)?(\d+)\s*(?:m|min|mins|minutes)\b)?/);
  const m = t.match(/(\d+)\s*(?:m|min|mins|minutes)\b/);
  if (hm) minutes = Number(hm[1]) * 60 + (hm[2] ? Number(hm[2]) : 0);
  else if (/\bhalf an hour\b|\bhalf hour\b/.test(t)) minutes = 30;
  else if (/\ban hour\b|\bone hour\b/.test(t)) minutes = 60;
  else if (/\bcouple of hours\b|\btwo hours\b/.test(t)) minutes = 120;
  else if (m) minutes = Number(m[1]);
  if (minutes !== undefined && /\b(each way|one way|per leg|each direction)\b/.test(t)) minutes *= 2;
  if (minutes !== undefined && minutes >= 20 && minutes <= 960) {
    return { available: true, max_minutes: Math.max(30, Math.min(480, Math.round(minutes / 30) * 30)) };
  }
  if (/^\s*(off|rest|rest day|day off)\s*[.!,;]?(\s|$)/.test(t) && t.trim().split(/\s+/).length <= 3) return { available: false };
  if (/^\s*(no training|can'?t|cannot|unavailable|travell?ing|away|busy)\b/.test(t)) return { available: false };
  return {};
}

const weekDays = (weekStart: string) => Array.from({ length: 7 }, (_, i) => addDaysToDateOnly(weekStart, i));

/** Days of the week with sensible default availability: weekdays 1 h, the weekend 3 h; days already past are out. */
export function defaultCheckIn(weekStart: string, today = getLocalDateString()): CheckIn {
  return {
    week_start: weekStart,
    days: weekDays(weekStart).map((date, i) => ({ date, available: date >= today && i !== 0, max_minutes: i >= 5 ? 180 : 60 })),
    feel: 'normal',
    notes: '',
  };
}

interface BudgetInput {
  checkIn: CheckIn;
  /** Training-load history up to today */
  pmc: PMCDayPoint[];
  goals: Goal[];
  /** Existing sessions of any week (the week's accepted/completed ones count as booked) */
  sessions: TrainingSession[];
  today?: string;
}

export function buildWeekBudget({ checkIn, pmc, goals, sessions, today = getLocalDateString() }: BudgetInput): WeekBudget {
  const sorted = [...pmc].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted[sorted.length - 1];
  const ctl = last?.ctl ?? 0;
  const atl = last?.atl ?? 0;
  const tsb = last?.tsb ?? 0;
  const reasons: string[] = [];
  const weekStart = checkIn.week_start;
  const weekEnd = addDaysToDateOnly(weekStart, 6);

  // What the weeks before did to fitness
  const weeklyChange = (offsetWeeks: number) => {
    const end = ctlOn(sorted, addDaysToDateOnly(weekStart, -1 - 7 * offsetWeeks));
    const start = ctlOn(sorted, addDaysToDateOnly(weekStart, -1 - 7 * (offsetWeeks + 1)));
    return end !== undefined && start !== undefined ? end - start : undefined;
  };
  const prior = [0, 1, 2].map(weeklyChange).filter((x): x is number => x !== undefined);
  const recentRamp = prior.length ? prior.reduce((a, b) => a + b, 0) / prior.length : 0;

  // 1. The ramp the goals ask for, within a safe rate
  const active = goals.filter((g) => g.status === 'ACTIVE' && g.target_date && g.target_date >= weekStart);
  const progresses = active.map((g) => goalProgress(g, sorted, today)).filter((p) => p.neededRampPerWeek !== undefined);
  progresses.sort((a, b) => (a.goal.target_date ?? '').localeCompare(b.goal.target_date ?? ''));
  const lead = progresses[0];
  let change = 2;
  if (lead?.neededRampPerWeek !== undefined) {
    change = lead.neededRampPerWeek;
    reasons.push(`${lead.goal.name} needs about ${change >= 0 ? '+' : ''}${change.toFixed(1)} CTL a week to reach ${lead.nextTarget?.phase ?? 'its next phase'} on time.`);
  } else if (active.length > 0) {
    reasons.push('No goal phase with a fitness target is under way yet, so the week aims for a gentle build.');
  } else {
    reasons.push('There is no active goal with a date, so the week aims for a gentle build.');
  }
  let cap = 6;
  if (recentRamp > 4.5) {
    cap = 3.5;
    reasons.push(`Fitness has been rising ${recentRamp.toFixed(1)} CTL a week, so this week consolidates (cap +3.5).`);
  }
  const loadedThreeWeeks = prior.length === 3 && prior.every((x) => x >= 2.5);
  if (loadedThreeWeeks) {
    change = Math.min(change, -2);
    reasons.push('Three weeks of building in a row: this is a recovery week.');
  }
  change = Math.min(change, cap);
  if (tsb < -30) {
    change = Math.min(change, -2);
    reasons.push(`Form is ${round(tsb)}: heavily fatigued, so the week lets fitness dip to recover.`);
  } else if (tsb < -20) {
    change = Math.min(change, 0);
    reasons.push(`Form is ${round(tsb)}: quite fatigued, so no build this week.`);
  }
  if (checkIn.feel === 'tired') {
    change = Math.min(change, 0);
    reasons.push('You said you are tired: no build this week.');
  } else if (checkIn.feel === 'fresh' && tsb > 0) {
    change = Math.min(change + 1, cap + 1);
  }
  change = Math.max(change, -5);

  // 2. The weekly load that ramp needs, then what the availability can hold
  const available = checkIn.days.filter((d) => d.available && d.max_minutes > 0);
  const capacity = available.reduce((s, d) => s + (d.max_minutes / 60) * tssPerHourCap(d.max_minutes), 0);
  // A week at d TSS/day moves CTL by (d - CTL) x factor: solve for d, then the weekly total
  let target = Math.max(0, 7 * (ctl + change / WEEK_CTL_FACTOR));

  // Sessions already booked on days the check-in leaves out count toward the week
  const availableDates = new Set(available.map((d) => d.date));
  const booked = sessions.filter((s) => s.week_start_date === weekStart && (s.status === 'ACCEPTED' || s.status === 'COMPLETED') && !availableDates.has(s.session_date));
  const bookedTss = booked.reduce((s, x) => s + (x.target_tss ?? (x.duration_minutes / 60) * DEFAULT_TSS_PER_HOUR), 0);
  const doneTss = sorted.filter((p) => p.date >= weekStart && p.date < today && p.date <= weekEnd).reduce((s, p) => s + p.tss, 0);
  const fixedTss = doneTss + bookedTss;

  const ceiling = capacity * 0.95 + fixedTss;
  if (target > ceiling) {
    target = ceiling;
    const achievable = (target / 7 - ctl) * WEEK_CTL_FACTOR;
    reasons.push(`Your available time can hold at most about ${round(capacity)} TSS, so the week tops out near ${round(target)} (CTL ${achievable >= 0 ? '+' : ''}${achievable.toFixed(1)}).`);
    change = achievable;
  }
  const remaining = Math.max(0, target - fixedTss);
  if (available.length === 0) reasons.push('No days are available, so there is nothing to plan.');

  // 3. Guard rails for the draft
  const maxSession = available.length
    ? Math.min(Math.max(...available.map((d) => (d.max_minutes / 60) * tssPerHourCap(d.max_minutes))), Math.max(remaining * (available.length <= 2 ? 0.7 : 0.45), 40))
    : 0;
  const maxHard = checkIn.feel === 'tired' || tsb < -20 ? 1 : 2;
  const slots = available
    .map((d) => ({ date: d.date, max_minutes: d.max_minutes, role: (d.max_minutes >= 150 ? 'long' : d.max_minutes >= 60 ? 'standard' : 'short') as 'long' | 'standard' | 'short' }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    week_start: weekStart,
    ctl_now: ctl, atl_now: atl, tsb_now: tsb,
    done_tss: round(doneTss), booked_tss: round(bookedTss),
    week_tss_target: round(target), week_tss_min: round(target * 0.9), week_tss_max: round(target * 1.1),
    remaining_tss_target: round(remaining), remaining_tss_min: round(remaining * 0.9), remaining_tss_max: round(remaining * 1.1),
    ctl_change: Math.round(change * 10) / 10,
    capacity_tss: round(capacity),
    max_session_tss: round(maxSession),
    max_hard_days: maxHard,
    slots,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Checking a drafted week
// ---------------------------------------------------------------------------

export interface DraftSession {
  week_start_date: string;
  session_date: string;
  title: string;
  sport_type: TrainingSession['sport_type'];
  duration_minutes: number;
  focus: string;
  details: string;
  target_tss: number;
}

export interface WeekIssue {
  /** 'fixed': software already corrected it; 'warning': the athlete should look */
  level: 'fixed' | 'warning';
  text: string;
}

export interface WeekCheck {
  sessions: DraftSession[];
  issues: WeekIssue[];
  total_tss: number;
  total_minutes: number;
  hard_days: number;
  /** Fitness after the week if every session is done as planned */
  projected: { ctl: number; atl: number; tsb: number };
}

const SPORTS: TrainingSession['sport_type'][] = ['cycling', 'zwift', 'skimo', 'backcountry_skiing', 'resort_skiing', 'scrambling', 'weighted_hiking'];

/** Turns the model's reply into draft sessions: anything malformed is dropped and numbers are bounded (the reply is only data). */
export function parseWeekDraft(raw: string, weekStart: string): DraftSession[] {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  let list: unknown;
  try { list = JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : raw); } catch { return []; }
  if (!Array.isArray(list)) return [];
  const out: DraftSession[] = [];
  for (const item of list.slice(0, 14)) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    const date = typeof c.session_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.session_date) ? c.session_date : undefined;
    const sport = SPORTS.find((x) => x === c.sport_type);
    const minutes = typeof c.duration_minutes === 'number' && Number.isFinite(c.duration_minutes) ? Math.round(c.duration_minutes) : undefined;
    const title = typeof c.title === 'string' ? c.title.replace(/\s+/g, ' ').trim().slice(0, 100) : '';
    if (!date || !sport || !minutes || minutes < 10 || minutes > 720 || !title) continue;
    const tss = typeof c.target_tss === 'number' && Number.isFinite(c.target_tss) ? Math.round(c.target_tss) : 0;
    out.push({
      week_start_date: weekStart, session_date: date, title, sport_type: sport, duration_minutes: minutes,
      focus: typeof c.focus === 'string' ? c.focus.trim().slice(0, 80) : '',
      details: typeof c.details === 'string' ? c.details.trim().slice(0, 1200) : '',
      target_tss: Math.max(0, Math.min(1000, tss)),
    });
  }
  return out;
}

const dayLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString([], { weekday: 'long' });

/** Fitness after a run of daily TSS values, from the state at the start. */
export function projectLoad(start: { ctl: number; atl: number }, dailyTss: number[]): { ctl: number; atl: number; tsb: number } {
  const lc = 1 - Math.exp(-1 / 42);
  const la = 1 - Math.exp(-1 / 7);
  let { ctl, atl } = start;
  for (const t of dailyTss) {
    ctl += (t - ctl) * lc;
    atl += (t - atl) * la;
  }
  return { ctl: Math.round(ctl * 10) / 10, atl: Math.round(atl * 10) / 10, tsb: Math.round((ctl - atl) * 10) / 10 };
}

/**
 * Check a drafted week against the budget and the availability, fixing what is plainly wrong (a session on a day that
 * is off, a session longer than its day allows, a week over budget) and warning about what needs a judgement.
 */
export function checkWeekDraft(drafts: DraftSession[], budget: WeekBudget, today = getLocalDateString()): WeekCheck {
  const issues: WeekIssue[] = [];
  const slotByDate = new Map(budget.slots.map((s) => [s.date, s]));
  const weekEnd = addDaysToDateOnly(budget.week_start, 6);
  const taken = new Set<string>();
  const placed: DraftSession[] = [];

  // Keep the longest sessions first when days collide, so the key session is not the one that is moved
  const ordered = [...drafts].sort((a, b) => b.duration_minutes - a.duration_minutes);
  for (const d of ordered) {
    let date = d.session_date;
    const inWeek = date >= budget.week_start && date <= weekEnd;
    if (!inWeek || !slotByDate.has(date) || taken.has(date)) {
      // Move it to the nearest free available day that can hold it, else drop it
      const candidates = budget.slots
        .filter((s) => !taken.has(s.date) && s.max_minutes >= Math.min(d.duration_minutes, 30))
        .sort((a, b) => Math.abs(Date.parse(a.date) - Date.parse(d.session_date)) - Math.abs(Date.parse(b.date) - Date.parse(d.session_date)));
      const to = candidates[0];
      if (!to) {
        issues.push({ level: 'fixed', text: `Dropped "${d.title}": no free available day for it.` });
        continue;
      }
      issues.push({ level: 'fixed', text: `Moved "${d.title}" from ${inWeek ? dayLabel(d.session_date) : 'outside the week'} to ${dayLabel(to.date)}, a day you are available.` });
      date = to.date;
    }
    taken.add(date);
    placed.push({ ...d, session_date: date, week_start_date: budget.week_start });
  }

  // Each session must fit its day and be a believable load for its length
  for (const s of placed) {
    const slot = slotByDate.get(s.session_date)!;
    if (s.duration_minutes > slot.max_minutes) {
      issues.push({ level: 'fixed', text: `Shortened "${s.title}" from ${s.duration_minutes} to ${slot.max_minutes} min (your limit for ${dayLabel(s.session_date)}).` });
      s.duration_minutes = slot.max_minutes;
    }
    const cap = (s.duration_minutes / 60) * tssPerHourCap(s.duration_minutes);
    if (!Number.isFinite(s.target_tss) || s.target_tss <= 0) {
      s.target_tss = round((s.duration_minutes / 60) * DEFAULT_TSS_PER_HOUR);
      issues.push({ level: 'fixed', text: `"${s.title}" had no load: set to about ${s.target_tss} TSS.` });
    } else if (s.target_tss > cap) {
      issues.push({ level: 'fixed', text: `Lowered "${s.title}" from ${s.target_tss} to ${round(cap)} TSS, the most ${s.duration_minutes} min can hold.` });
      s.target_tss = round(cap);
    }
  }

  // The week must not exceed the budget: scale everything down evenly
  let total = placed.reduce((s, x) => s + x.target_tss, 0);
  if (total > budget.remaining_tss_max * 1.1 && budget.remaining_tss_max > 0) {
    const factor = Math.max(0.7, budget.remaining_tss_target / total);
    for (const s of placed) {
      s.target_tss = round(s.target_tss * factor);
      s.duration_minutes = Math.max(20, round(s.duration_minutes * (factor + (1 - factor) / 2)));
    }
    issues.push({ level: 'fixed', text: `The draft was ${round(total)} TSS against a budget of about ${budget.remaining_tss_target}: all sessions were trimmed by ${round((1 - factor) * 100)}%.` });
    total = placed.reduce((s, x) => s + x.target_tss, 0);
  }
  if (budget.remaining_tss_min > 0 && total < budget.remaining_tss_min * 0.8) {
    issues.push({ level: 'warning', text: `The week holds ${round(total)} TSS, under the ${budget.remaining_tss_min}-${budget.remaining_tss_max} the plan needs. Add time on an available day, or regenerate.` });
  }

  placed.sort((a, b) => a.session_date.localeCompare(b.session_date));

  // Hard days: how many, and never back to back
  const hardDates = placed.filter((s) => sessionIsHard(s.duration_minutes, s.target_tss)).map((s) => s.session_date);
  if (hardDates.length > budget.max_hard_days) {
    issues.push({ level: 'warning', text: `${hardDates.length} hard sessions (${hardDates.map(dayLabel).join(', ')}); ${budget.max_hard_days} is the limit for how you are feeling. Regenerate, or soften one.` });
  }
  for (let i = 1; i < hardDates.length; i++) {
    if (addDaysToDateOnly(hardDates[i - 1], 1) === hardDates[i]) {
      issues.push({ level: 'warning', text: `Hard sessions on back-to-back days (${dayLabel(hardDates[i - 1])} and ${dayLabel(hardDates[i])}).` });
    }
  }
  if (placed.length === 0 && budget.slots.length > 0) {
    issues.push({ level: 'warning', text: 'The draft had no usable sessions.' });
  }

  // Where fitness ends up if it is all done
  const byDate = new Map(placed.map((s) => [s.session_date, s.target_tss]));
  const days = Array.from({ length: 7 }, (_, i) => addDaysToDateOnly(budget.week_start, i)).filter((d) => d >= today);
  const projected = projectLoad({ ctl: budget.ctl_now, atl: budget.atl_now }, days.map((d) => byDate.get(d) ?? 0));

  return {
    sessions: placed,
    issues,
    total_tss: round(total),
    total_minutes: placed.reduce((s, x) => s + x.duration_minutes, 0),
    hard_days: hardDates.length,
    projected,
  };
}
