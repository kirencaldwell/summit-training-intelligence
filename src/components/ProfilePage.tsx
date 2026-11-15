import React, { useMemo } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Award, Flame, Settings, User } from 'lucide-react';
import type { Activity, AthleteProfile, PMCDayPoint, TrainingSession } from '../types';
import { getLocalDateString } from '../lib/trainingSessions';
import { SPORT_COLORS, SPORT_LABELS, activitiesByDay, personalBests, streaks, weeklyHours, yearSummary } from '../lib/profileStats';
import { formatFeetFromMeters, formatLbFromKg, formatMilesFromMeters } from '../lib/units';
import { ActivityCalendar } from './ActivityCalendar';
import { ActivityTotals } from './ActivityTotals';

interface ProfilePageProps {
  profile: AthleteProfile;
  activities: Activity[];
  sessions: TrainingSession[];
  pmc: PMCDayPoint[];
  onOpenActivity: (activity: Activity) => void;
  onEditProfile: () => void;
}

const hoursText = (seconds: number) => {
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60).toLocaleString()}h ${m % 60}m` : `${m}m`;
};

const Tile: React.FC<{ label: string; value: string; hint?: string }> = ({ label, value, hint }) => (
  <div className="rounded-xl border border-white/10 bg-slate-900/50 p-3">
    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
    <p className="mt-1 text-xl font-extrabold text-white tabular-nums">{value}</p>
    {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
  </div>
);

/** The athlete at a glance: who they are, this year in numbers, a calendar, consistency, personal bests and progress. */
export const ProfilePage: React.FC<ProfilePageProps> = ({ profile, activities, sessions, pmc, onOpenActivity, onEditProfile }) => {
  const today = getLocalDateString();
  const year = Number(today.slice(0, 4));
  const summary = useMemo(() => yearSummary(activities, year), [activities, year]);
  const days = useMemo(() => new Set(activitiesByDay(activities).keys()), [activities]);
  const run = useMemo(() => streaks(days, today), [days, today]);
  const weeks = useMemo(() => weeklyHours(activities, today, 12), [activities, today]);
  const bests = useMemo(
    () => personalBests(activities, { distance: formatMilesFromMeters, vert: formatFeetFromMeters, duration: (s) => hoursText(s) }),
    [activities],
  );
  const ctl = pmc[pmc.length - 1]?.ctl;
  const first = activities.reduce<string | undefined>((min, a) => (!min || a.start_date < min ? a.start_date : min), undefined);
  const last4 = weeks.slice(-4);
  const avgActive = last4.length ? Math.round((last4.reduce((n, w) => n + w.active, 0) / last4.length) * 10) / 10 : 0;

  return (
    <div className="space-y-4">
      <section className="glass-panel rounded-2xl border border-white/10 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-4">
          {profile.avatar_url
            ? <img src={profile.avatar_url} alt="" className="h-16 w-16 rounded-2xl object-cover ring-2 ring-cyan-500/40" />
            : <span className="h-16 w-16 rounded-2xl bg-slate-800 ring-2 ring-cyan-500/40 flex items-center justify-center"><User className="w-7 h-7 text-slate-400" /></span>}
          <div className="min-w-0 flex-1 basis-48">
            <h1 className="text-2xl font-extrabold text-white tracking-tight truncate">{profile.full_name || 'Athlete'}</h1>
            <p className="text-xs text-slate-400">
              {first ? `Training since ${new Date(first).toLocaleDateString([], { month: 'long', year: 'numeric' })}` : 'No activities yet'}
              {activities.length > 0 ? ` · ${activities.length.toLocaleString()} activities` : ''}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
              {profile.ftp > 0 && <span className="rounded-full border border-white/10 px-2.5 py-0.5 text-slate-200">FTP {profile.ftp} W</span>}
              {profile.lthr > 0 && <span className="rounded-full border border-white/10 px-2.5 py-0.5 text-slate-200">LTHR {profile.lthr} bpm</span>}
              {profile.max_hr > 0 && <span className="rounded-full border border-white/10 px-2.5 py-0.5 text-slate-200">Max HR {profile.max_hr}</span>}
              {profile.weight_kg > 0 && <span className="rounded-full border border-white/10 px-2.5 py-0.5 text-slate-200">{formatLbFromKg(profile.weight_kg)}</span>}
              {ctl !== undefined && <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-0.5 text-cyan-200">Fitness (CTL) {Math.round(ctl)}</span>}
            </div>
          </div>
          <button type="button" onClick={onEditProfile} className="min-h-10 inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-semibold text-slate-200 hover:bg-white/10">
            <Settings className="w-3.5 h-3.5" /> Settings
          </button>
        </div>
      </section>

      <section aria-label={`${year} so far`} className="space-y-2">
        <h2 className="text-sm font-bold text-white">{year} so far</h2>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
          <Tile label="Activities" value={summary.activities.toLocaleString()} hint={`${summary.activeDays} active days`} />
          <Tile label="Time" value={hoursText(summary.seconds)} />
          <Tile label="Distance" value={formatMilesFromMeters(summary.distanceM)} />
          <Tile label="Vert" value={formatFeetFromMeters(summary.vertM)} />
          <Tile label="Current streak" value={`${run.currentDays} ${run.currentDays === 1 ? 'day' : 'days'}`} hint={`longest ${run.longestDays}`} />
        </div>
        {summary.bySport.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {summary.bySport.map((s) => (
              <span key={s.sport} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-0.5 text-[11px] text-slate-300">
                <span className="h-2 w-2 rounded-full" style={{ background: SPORT_COLORS[s.sport] }} />
                {SPORT_LABELS[s.sport]} · {s.count} · {hoursText(s.seconds)}
              </span>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <ActivityCalendar activities={activities} sessions={sessions} onOpenActivity={onOpenActivity} />

        <div className="space-y-4">
          <section className="glass-panel rounded-2xl border border-white/10 p-4 sm:p-5 space-y-3" aria-label="Consistency">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2"><Flame className="w-4 h-4 text-amber-400" /> Consistency</h2>
                <p className="text-[11px] text-slate-400">Hours of moving time each week, last 12 weeks</p>
              </div>
              <div className="text-right text-[11px] text-slate-400">
                <p><span className="font-semibold text-white">{avgActive}</span> active days a week lately</p>
                <p><span className="font-semibold text-white">{run.currentWeeks}</span> {run.currentWeeks === 1 ? 'week' : 'weeks'} in a row with 3+ active days</p>
              </div>
            </div>
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeks.map((w) => ({ ...w, label: new Date(`${w.weekStart}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' }) }))} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94A3B8' }} interval="preserveStartEnd" tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#94A3B8' }} tickLine={false} axisLine={false} width={26} />
                  <Tooltip
                    cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                    contentStyle={{ backgroundColor: 'rgba(15,23,42,0.95)', borderColor: 'rgba(255,255,255,0.15)', borderRadius: '0.5rem', fontSize: '12px' }}
                    formatter={(v, _n, item) => [`${v} h · ${(item?.payload as { active?: number })?.active ?? 0} active days`, 'Week of']}
                    labelFormatter={(l) => String(l)}
                  />
                  <Bar dataKey="hours" fill="#22D3EE" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="glass-panel rounded-2xl border border-white/10 p-4 sm:p-5 space-y-2" aria-label="Personal bests">
            <h2 className="text-base font-bold text-white flex items-center gap-2"><Award className="w-4 h-4 text-amber-400" /> Personal bests</h2>
            {bests.length === 0 ? (
              <p className="text-xs text-slate-500">Bests appear as you add activities. E-bike rides never count.</p>
            ) : (
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {bests.map((b) => (
                  <li key={b.label}>
                    <button type="button" onClick={() => onOpenActivity(b.activity)} className="w-full min-h-11 flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-slate-900/50 px-3 text-left hover:bg-white/5">
                      <span className="min-w-0">
                        <span className="block text-[11px] text-slate-400">{b.label}</span>
                        <span className="block truncate text-[11px] text-slate-500">{new Date(b.activity.start_date).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                      </span>
                      <span className="shrink-0 text-sm font-bold text-white tabular-nums">{b.value}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {activities.length > 0 && <ActivityTotals activities={activities} />}
    </div>
  );
};
