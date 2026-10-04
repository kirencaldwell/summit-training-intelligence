import React, { useState } from 'react';
import type { Activity, SportType } from '../types';
import { Mountain, Bike, Compass, Footprints, ShieldAlert, Zap, Calendar, Search, Trash2 } from 'lucide-react';

interface ActivityListProps {
  activities: Activity[];
  onSelectActivity: (activity: Activity) => void;
  onDeleteActivity: (activity: Activity) => Promise<void>;
}

export const ActivityList: React.FC<ActivityListProps> = ({ activities, onSelectActivity, onDeleteActivity }) => {
  const [selectedSport, setSelectedSport] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [deletingActivityId, setDeletingActivityId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');

  const handleDelete = async (event: React.MouseEvent<HTMLButtonElement>, activity: Activity) => {
    event.stopPropagation();
    if (!window.confirm(`Delete "${activity.title}"? This cannot be undone.`)) return;

    setDeletingActivityId(activity.id);
    setDeleteError('');
    try {
      await onDeleteActivity(activity);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Activity could not be deleted.');
    } finally {
      setDeletingActivityId(null);
    }
  };

  const sportsOptions = [
    { key: 'all', label: 'All Disciplines', icon: Compass },
    { key: 'cycling', label: 'Road / Zwift', icon: Bike },
    { key: 'skimo', label: 'Skimo', icon: Mountain },
    { key: 'backcountry_skiing', label: 'Backcountry Ski', icon: Mountain },
    { key: 'scrambling', label: 'Peak Scramble', icon: Compass },
    { key: 'weighted_hiking', label: 'Weighted Hike', icon: Footprints },
  ];

  const filteredActivities = activities.filter((act) => {
    const matchesSport = selectedSport === 'all' || act.sport_type === selectedSport || (selectedSport === 'cycling' && act.sport_type === 'zwift');
    const matchesSearch = act.title.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSport && matchesSearch;
  });

  const getSportBadgeColor = (sport: SportType) => {
    switch (sport) {
      case 'cycling':
      case 'zwift': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
      case 'skimo': return 'bg-sky-500/10 text-sky-400 border-sky-500/30';
      case 'backcountry_skiing': return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
      case 'scrambling': return 'bg-purple-500/10 text-purple-400 border-purple-500/30';
      case 'weighted_hiking': return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
    }
  };

  return (
    <div className="space-y-4">
      {/* Controls Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Discipline Filters */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          {sportsOptions.map((opt) => {
            const Icon = opt.icon;
            const isSelected = selectedSport === opt.key;
            return (
              <button
                key={opt.key}
                onClick={() => setSelectedSport(opt.key)}
                className={`min-h-11 flex items-center space-x-1.5 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                  isSelected
                    ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20 font-bold'
                    : 'bg-slate-900/60 text-slate-400 hover:text-white border border-white/5 hover:bg-white/5'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>

        {/* Search Field */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search activities..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="min-h-11 w-full sm:w-56 bg-slate-900/80 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-sm sm:text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50"
          />
        </div>
      </div>

      {deleteError && <p role="alert" className="text-sm text-rose-300">{deleteError}</p>}

      {/* Activity Card Feed */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredActivities.map((act) => {
          const distanceKm = (act.distance_meters / 1000).toFixed(1);

          return (
            <div
              key={act.id}
              onClick={() => onSelectActivity(act)}
              className="glass-panel-interactive rounded-2xl p-4 sm:p-5 cursor-pointer flex flex-col justify-between space-y-4"
            >
              <div>
                {/* Header Badge */}
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-full border ${getSportBadgeColor(act.sport_type)}`}>
                    {act.sport_type.replace('_', ' ')}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-400 flex items-center">
                      <Calendar className="w-3 h-3 mr-1" />
                      {new Date(act.start_date).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    </span>
                    <button
                      type="button"
                      onClick={(event) => void handleDelete(event, act)}
                      disabled={deletingActivityId === act.id}
                      aria-label={`Delete ${act.title}`}
                      title="Delete activity"
                      className="min-h-11 min-w-11 flex items-center justify-center rounded-md text-slate-400 hover:text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <h3 className="text-base font-bold text-white group-hover:text-cyan-400 transition-colors line-clamp-1">
                  {act.title}
                </h3>

                {act.gear_notes && (
                  <p className="text-xs text-slate-400 mt-1 line-clamp-1">
                    {act.gear_notes}
                  </p>
                )}
              </div>

              {/* Stats Row */}
              <div className="grid grid-cols-3 gap-2 pt-3 border-t border-white/5 text-center">
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-medium">Dist</span>
                  <p className="text-xs font-extrabold text-slate-200">{distanceKm} km</p>
                </div>

                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-medium">Elev</span>
                  <p className="text-xs font-extrabold text-slate-200">{act.total_elevation_gain_m} m</p>
                </div>

                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-medium">TSS</span>
                  <p className="text-xs font-extrabold text-amber-400 flex items-center justify-center">
                    <Zap className="w-3 h-3 mr-0.5 inline" />
                    {act.training_stress_score || 'N/A'}
                  </p>
                </div>
              </div>

              {/* Knee Alert Pill if any */}
              {(act.knee_discomfort_level || 0) > 0 && (
                <div className="flex items-center space-x-1.5 text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-lg">
                  <ShieldAlert className="w-3 h-3 flex-shrink-0 text-amber-400" />
                  <span>Knee Discomfort Rating: {act.knee_discomfort_level}/10</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
