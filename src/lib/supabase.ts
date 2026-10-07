import { createClient, type User } from '@supabase/supabase-js';
import type { Activity, AthleteProfile, Goal, TrainingSession, TrainingSessionStatus } from '../types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured 
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

function sportFamily(sportType: string): string {
  if (sportType === 'cycling' || sportType === 'zwift') return 'cycling';
  if (sportType === 'skimo' || sportType === 'backcountry_skiing') return 'skiing';
  return sportType;
}

function isDuplicateActivity(candidate: Activity, existing: Activity): boolean {
  const candidateStart = new Date(candidate.start_date).getTime();
  const existingStart = new Date(existing.start_date).getTime();
  if (!Number.isFinite(candidateStart) || !Number.isFinite(existingStart)) return false;
  if (Math.abs(candidateStart - existingStart) > 5 * 60 * 1000) return false;
  if (sportFamily(candidate.sport_type) !== sportFamily(existing.sport_type)) return false;

  const candidateDuration = candidate.moving_time_seconds || candidate.duration_seconds;
  const existingDuration = existing.moving_time_seconds || existing.duration_seconds;
  const durationTolerance = Math.max(120, Math.max(candidateDuration, existingDuration) * 0.03);
  if (Math.abs(candidateDuration - existingDuration) > durationTolerance) return false;

  if (candidate.distance_meters > 0 && existing.distance_meters > 0) {
    const distanceTolerance = Math.max(300, Math.max(candidate.distance_meters, existing.distance_meters) * 0.03);
    if (Math.abs(candidate.distance_meters - existing.distance_meters) > distanceTolerance) return false;
  }

  return true;
}

// Everything except the heavy streams_data, which is only loaded for the detail view
const ACTIVITY_LIST_COLUMNS =
  'id, user_id, strava_activity_id, title, sport_type, start_date, duration_seconds, moving_time_seconds, distance_meters, total_elevation_gain_m, avg_power, max_power, normalized_power, intensity_factor, training_stress_score, avg_hr, max_hr, avg_cadence, max_speed_kmh, avg_vam_mh, time_in_hr_zones, time_in_power_zones, power_curve_best_efforts, map_summary_polyline, gear_notes, pack_weight_kg, perceived_exertion, knee_discomfort_level, coach_assessment, coach_assessment_at, tags, effort_notes, estimated_tss, estimated_if, tss_source, tss_confidence, tss_rationale, tss_estimated_at, created_at';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STORAGE_KEYS = {
  PROFILE: 'summit_athlete_profile',
  ACTIVITIES: 'summit_activities_list',
  GOALS: 'summit_goals_list',
  TRAINING_SESSIONS: 'summit_training_sessions',
};

// Dual-mode Storage Manager (LocalStorage fallback vs Supabase Live DB)
const EMPTY_PROFILE: AthleteProfile = {
  id: 'local-athlete',
  full_name: '',
  ftp: 0,
  max_hr: 0,
  lthr: 0,
  weight_kg: 0,
  notes: '',
};

/** Older saved profiles had separate injury and recovery-routine fields: fold them into the single notes field. */
function migrateProfile(raw: any): AthleteProfile {
  const { injury_notes, recovery_routines, ...profile } = raw ?? {};
  if (!profile.notes) {
    const parts = [
      Array.isArray(injury_notes) && injury_notes.length > 0 ? `Injuries / health: ${injury_notes.join('; ')}` : '',
      recovery_routines?.wednesday ?? '',
      recovery_routines?.sunday ?? '',
    ].filter(Boolean);
    profile.notes = parts.join('\n');
  }
  return profile as AthleteProfile;
}

class DataService {
  private localActivities: Activity[];
  private localProfile: AthleteProfile;
  private localGoals: Goal[];
  private localTrainingSessions: TrainingSession[];
  private mode: 'local' | 'supabase';
  private authUser: User | null = null;
  private authenticatedProfile: AthleteProfile | null = null;

  constructor() {
    this.mode = isSupabaseConfigured ? 'supabase' : 'local';

    // Load from localStorage; a new user starts empty and supplies everything themselves
    const savedProfile = localStorage.getItem(STORAGE_KEYS.PROFILE);
    this.localProfile = savedProfile ? migrateProfile(JSON.parse(savedProfile)) : { ...EMPTY_PROFILE };

    const savedActivities = localStorage.getItem(STORAGE_KEYS.ACTIVITIES);
    this.localActivities = savedActivities ? JSON.parse(savedActivities) : [];

    const savedGoals = localStorage.getItem(STORAGE_KEYS.GOALS);
    this.localGoals = savedGoals ? JSON.parse(savedGoals) : [];

    const savedTrainingSessions = localStorage.getItem(STORAGE_KEYS.TRAINING_SESSIONS);
    this.localTrainingSessions = savedTrainingSessions ? JSON.parse(savedTrainingSessions) : [];
  }

  private saveLocalState() {
    localStorage.setItem(STORAGE_KEYS.PROFILE, JSON.stringify(this.localProfile));
    localStorage.setItem(STORAGE_KEYS.ACTIVITIES, JSON.stringify(this.localActivities));
    localStorage.setItem(STORAGE_KEYS.GOALS, JSON.stringify(this.localGoals));
    localStorage.setItem(STORAGE_KEYS.TRAINING_SESSIONS, JSON.stringify(this.localTrainingSessions));
  }

  public getMode(): 'local' | 'supabase' {
    return this.mode;
  }

  public setAuthenticatedUser(user: User | null) {
    this.authUser = user;
    this.authenticatedProfile = null;
  }

  private async getAuthenticatedProfile(): Promise<AthleteProfile> {
    if (!supabase || !this.authUser) {
      throw new Error('Sign in with Google to access your Supabase data.');
    }
    if (this.authenticatedProfile) return this.authenticatedProfile;

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', this.authUser.id)
      .maybeSingle();
    if (error) throw new Error(`Profile lookup failed: ${error.message}`);

    if (data) {
      this.authenticatedProfile = data as AthleteProfile;
      return this.authenticatedProfile;
    }

    const metadata = this.authUser.user_metadata || {};
    const fullName = metadata.full_name || metadata.name || this.authUser.email?.split('@')[0] || '';
    const avatarUrl = metadata.avatar_url || metadata.picture;
    const { data: created, error: createError } = await supabase
      .from('profiles')
      .insert({
        user_id: this.authUser.id,
        full_name: fullName,
        avatar_url: avatarUrl,
        // Blank until the athlete fills in their profile
        ftp: 0,
        max_hr: 0,
        lthr: 0,
        weight_kg: 0,
      })
      .select('*')
      .single();
    if (createError || !created) {
      throw new Error(`Profile setup failed: ${createError?.message || 'No profile returned'}`);
    }

    this.authenticatedProfile = created as AthleteProfile;
    return this.authenticatedProfile;
  }

  public async getProfile(): Promise<AthleteProfile> {
    if (this.mode === 'supabase' && supabase) {
      return this.getAuthenticatedProfile();
    }
    return this.localProfile;
  }

  public async updateProfile(profileUpdates: Partial<AthleteProfile>): Promise<AthleteProfile> {
    if (this.mode === 'supabase' && supabase) {
      const profile = await this.getAuthenticatedProfile();
      const updates = { ...profileUpdates };
      delete updates.id;
      const { data, error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', profile.id)
        .eq('user_id', this.authUser!.id)
        .select('*')
        .single();
      if (error || !data) throw new Error(`Profile update failed: ${error?.message || 'No profile returned'}`);
      this.authenticatedProfile = data as AthleteProfile;
      return this.authenticatedProfile;
    }

    this.localProfile = { ...this.localProfile, ...profileUpdates };
    this.saveLocalState();
    return this.localProfile;
  }

  public async getActivities(sportFilter?: string): Promise<Activity[]> {
    if (this.mode === 'supabase' && supabase) {
      try {
        const profile = await this.getAuthenticatedProfile();
        let query = supabase
          .from('activities')
          .select(ACTIVITY_LIST_COLUMNS)
          .eq('user_id', profile.id)
          .order('start_date', { ascending: false });
        if (sportFilter && sportFilter !== 'all') query = query.eq('sport_type', sportFilter);
        const { data, error } = await query;
        if (error) {
          console.warn('Supabase getActivities query warning:', error.message);
          // If statement timed out or failed, fall back to local cached activities
          if (this.localActivities.length > 0) return this.localActivities;
          throw new Error(`Activities could not be loaded: ${error.message}`);
        }
        return (data || []) as Activity[];
      } catch (err: any) {
        console.warn('getActivities fallback to local activities:', err?.message);
        if (this.localActivities.length > 0) return this.localActivities;
        throw err;
      }
    }

    if (sportFilter && sportFilter !== 'all') {
      return this.localActivities.filter(a => a.sport_type === sportFilter);
    }
    return this.localActivities;
  }

  public async getActivityById(id: string): Promise<Activity | undefined> {
    if (this.mode === 'supabase' && supabase) {
      try {
        const profile = await this.getAuthenticatedProfile();
        const { data, error } = await supabase
          .from('activities')
          .select('*')
          .eq('id', id)
          .eq('user_id', profile.id)
          .maybeSingle();
        if (!error && data) return data as Activity;
      } catch (err) {
        console.warn('Supabase getActivityById error:', err);
      }
    }
    return this.localActivities.find(a => a.id === id);
  }

  public async findDuplicateActivity(candidate: Activity): Promise<Activity | undefined> {
    const candidateStart = new Date(candidate.start_date).getTime();
    if (!Number.isFinite(candidateStart)) return undefined;
    const startWindow = new Date(candidateStart - 5 * 60 * 1000).toISOString();
    const endWindow = new Date(candidateStart + 5 * 60 * 1000).toISOString();
    let possibleMatches: Activity[];

    if (this.mode === 'supabase' && supabase) {
      const profile = await this.getAuthenticatedProfile();
      const { data, error } = await supabase
        .from('activities')
        .select('id, title, sport_type, start_date, duration_seconds, moving_time_seconds, distance_meters, tags, effort_notes')
        .eq('user_id', profile.id)
        .gte('start_date', startWindow)
        .lte('start_date', endWindow);
      if (error) throw new Error(`Could not check for duplicate activities: ${error.message}`);
      possibleMatches = (data || []) as Activity[];
    } else {
      possibleMatches = this.localActivities.filter((activity) => {
        const start = new Date(activity.start_date).getTime();
        return Number.isFinite(start) && Math.abs(start - candidateStart) <= 5 * 60 * 1000;
      });
    }

    return possibleMatches.find((activity) => isDuplicateActivity(candidate, activity));
  }

  public async addActivity(newActivity: Activity): Promise<Activity> {
    if (this.mode === 'supabase' && supabase) {
      const profile = await this.getAuthenticatedProfile();
      const activityToInsert = { ...newActivity, user_id: profile.id };
      delete (activityToInsert as Partial<Activity>).id;
      const { data, error } = await supabase.from('activities').insert(activityToInsert).select('*').single();
      if (error || !data) throw new Error(`Activity insertion failed: ${error?.message || 'No activity returned'}`);
      return data as Activity;
    }

    this.localActivities.unshift(newActivity);
    this.saveLocalState();
    return newActivity;
  }

  public async updateActivity(id: string, updates: Partial<Activity>): Promise<Activity> {
    const { id: _id, ...changes } = updates;
    if (this.mode === 'supabase' && supabase) {
      const profile = await this.getAuthenticatedProfile();
      const { data, error } = await supabase
        .from('activities')
        .update(changes)
        .eq('id', id)
        .eq('user_id', profile.id)
        .select(ACTIVITY_LIST_COLUMNS)
        .maybeSingle();
      if (error) throw new Error(`Activity update failed: ${error.message}`);
      if (!data) throw new Error('Activity not found or not owned by this account.');
      return data as unknown as Activity;
    }

    const idx = this.localActivities.findIndex((a) => a.id === id);
    if (idx === -1) throw new Error('Activity not found.');
    this.localActivities[idx] = { ...this.localActivities[idx], ...changes };
    this.saveLocalState();
    return this.localActivities[idx];
  }

  public async deleteActivity(id: string): Promise<void> {
    if (this.mode === 'supabase' && supabase) {
      const profile = await this.getAuthenticatedProfile();
      const { data, error } = await supabase
        .from('activities')
        .delete()
        .eq('id', id)
        .eq('user_id', profile.id)
        .select('id')
        .maybeSingle();
      if (error) throw new Error(`Activity deletion failed: ${error.message}`);
      if (!data) throw new Error('Activity not found or not owned by this account.');
      return;
    }

    this.localActivities = this.localActivities.filter((activity) => activity.id !== id);
    this.saveLocalState();
  }

  public async getGoals(): Promise<Goal[]> {
    if (this.mode === 'supabase' && supabase) {
      const profile = await this.getAuthenticatedProfile();
      const { data, error } = await supabase
        .from('goals')
        .select('*')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false });
      if (error) throw new Error(`Goals could not be loaded: ${error.message}`);
      return (data || []) as Goal[];
    }
    return this.localGoals;
  }

  public async addGoal(newGoal: Goal): Promise<Goal> {
    if (this.mode === 'supabase' && supabase) {
      const profile = await this.getAuthenticatedProfile();
      const goalToInsert = { ...newGoal, user_id: profile.id };
      delete (goalToInsert as Partial<Goal>).id;
      const { data, error } = await supabase.from('goals').insert(goalToInsert).select('*').single();
      if (error || !data) throw new Error(`Goal insertion failed: ${error?.message || 'No goal returned'}`);
      return data as Goal;
    }

    this.localGoals.unshift(newGoal);
    this.saveLocalState();
    return newGoal;
  }

  public async updateGoal(id: string, updates: Partial<Goal>): Promise<Goal | undefined> {
    if (this.mode === 'supabase' && supabase) {
      const profile = await this.getAuthenticatedProfile();
      const { id: _id, ...goalUpdates } = updates;
      const { data, error } = await supabase
        .from('goals')
        .update(goalUpdates)
        .eq('id', id)
        .eq('user_id', profile.id)
        .select('*')
        .maybeSingle();
      if (error) throw new Error(`Goal update failed: ${error.message}`);
      return data as Goal | undefined;
    }

    const idx = this.localGoals.findIndex(g => g.id === id);
    if (idx !== -1) {
      this.localGoals[idx] = { ...this.localGoals[idx], ...updates };
      this.saveLocalState();
      return this.localGoals[idx];
    }
    return undefined;
  }

  public async completeGoal(id: string, debriefNotes: string): Promise<Goal | undefined> {
    return await this.updateGoal(id, {
      status: 'COMPLETED',
      completed_at: new Date().toISOString(),
      debrief_notes: debriefNotes,
    });
  }

  public async deleteGoal(id: string): Promise<boolean> {
    if (this.mode === 'supabase' && supabase) {
      const profile = await this.getAuthenticatedProfile();
      const { error } = await supabase
        .from('goals')
        .delete()
        .eq('id', id)
        .eq('user_id', profile.id);
      if (error) throw new Error(`Goal deletion failed: ${error.message}`);
      return true;
    }

    this.localGoals = this.localGoals.filter(g => g.id !== id);
    this.saveLocalState();
    return true;
  }

  public async getTrainingSessions(): Promise<TrainingSession[]> {
    if (this.mode === 'supabase' && supabase) {
      const profile = await this.getAuthenticatedProfile();
      const { data, error } = await supabase
        .from('training_sessions')
        .select('*')
        .eq('user_id', profile.id)
        .order('session_date', { ascending: true });
      if (error) throw new Error(`Training sessions could not be loaded: ${error.message}`);
      return (data || []) as TrainingSession[];
    }
    return this.localTrainingSessions;
  }

  public async replaceProposedTrainingSessions(
    weekStartDate: string,
    sessions: Omit<TrainingSession, 'id' | 'status'>[]
  ): Promise<TrainingSession[]> {
    if (this.mode === 'supabase' && supabase) {
      const profile = await this.getAuthenticatedProfile();
      const { error: deleteError } = await supabase
        .from('training_sessions')
        .delete()
        .eq('user_id', profile.id)
        .eq('week_start_date', weekStartDate)
        .eq('status', 'PROPOSED');
      if (deleteError) throw new Error(`Old proposals could not be replaced: ${deleteError.message}`);

      if (sessions.length === 0) return [];
      // The model's draft JSON carries its own ids (e.g. "session-1"); the DB generates real UUIDs
      const rows = sessions.map((session) => {
        const { id: _modelId, status: _modelStatus, ...fields } = session as Partial<TrainingSession>;
        return { ...fields, user_id: profile.id, status: 'PROPOSED' as const };
      });
      const { data, error } = await supabase.from('training_sessions').insert(rows).select('*');
      if (error) throw new Error(`Weekly plan could not be saved: ${error.message}`);
      return (data || []) as TrainingSession[];
    }

    this.localTrainingSessions = this.localTrainingSessions.filter(
      (session) => session.week_start_date !== weekStartDate || session.status !== 'PROPOSED'
    );
    const proposed = sessions.map((session) => ({
      ...session,
      id: crypto.randomUUID(),
      status: 'PROPOSED' as const,
    }));
    this.localTrainingSessions.push(...proposed);
    this.saveLocalState();
    return proposed;
  }

  public async saveTrainingSessions(
    sessions: TrainingSession[]
  ): Promise<TrainingSession[]> {
    if (this.mode === 'supabase' && supabase) {
      const profile = await this.getAuthenticatedProfile();
      const results: TrainingSession[] = [];
      for (const session of sessions) {
        const isExistingUUID = UUID_PATTERN.test(session.id || '');

        if (isExistingUUID) {
          const { id, ...rest } = session;
          const { data, error } = await supabase
            .from('training_sessions')
            .upsert({ ...rest, id, user_id: profile.id })
            .select('*')
            .single();
          if (!error && data) {
            results.push(data as TrainingSession);
          } else {
            console.warn('Failed to upsert session:', error?.message);
          }
        } else {
          const { id: _ignoredId, ...rest } = session;
          const { data, error } = await supabase
            .from('training_sessions')
            .insert({ ...rest, user_id: profile.id })
            .select('*')
            .single();
          if (!error && data) {
            results.push(data as TrainingSession);
          } else {
            console.warn('Failed to insert session:', error?.message);
          }
        }
      }
      return results;
    }

    // Local storage
    for (const session of sessions) {
      const idx = this.localTrainingSessions.findIndex((s) => s.id === session.id);
      if (idx >= 0) {
        this.localTrainingSessions[idx] = { ...session };
      } else {
        this.localTrainingSessions.push({
          ...session,
          id: session.id || crypto.randomUUID(),
        });
      }
    }
    this.saveLocalState();
    return sessions;
  }

  public async updateTrainingSessionStatus(
    id: string,
    status: TrainingSessionStatus
  ): Promise<TrainingSession> {
    if (this.mode === 'supabase' && supabase) {
      const profile = await this.getAuthenticatedProfile();
      const { data, error } = await supabase
        .from('training_sessions')
        .update({ status })
        .eq('id', id)
        .eq('user_id', profile.id)
        .select('*')
        .single();
      if (error || !data) throw new Error(`Training session update failed: ${error?.message || 'Session not found'}`);
      return data as TrainingSession;
    }

    const index = this.localTrainingSessions.findIndex((session) => session.id === id);
    if (index < 0) throw new Error('Training session not found.');
    const updated = { ...this.localTrainingSessions[index], status };
    this.localTrainingSessions[index] = updated;
    this.saveLocalState();
    return updated;
  }

  public async deleteTrainingSession(id: string): Promise<void> {
    if (this.mode === 'supabase' && supabase) {
      const profile = await this.getAuthenticatedProfile();
      const { error } = await supabase
        .from('training_sessions')
        .delete()
        .eq('id', id)
        .eq('user_id', profile.id);
      if (error) throw new Error(`Could not delete training session: ${error.message}`);
      return;
    }

    this.localTrainingSessions = this.localTrainingSessions.filter((s) => s.id !== id);
    this.saveLocalState();
  }
}

export const dataService = new DataService();
