import { createClient, type User } from '@supabase/supabase-js';
import type { MunterParams } from './munter';
import { readMemory, type CoachMemory } from './coachMemory';
import type { TrackingMetric } from './trackingMetrics';
import { routeOutline } from './routePreview';
import type { Activity, AICoachMessage, AthleteProfile, Goal, LlmUsageRecord, SessionScore, TrainingSession, TrainingSessionStatus } from '../types';
import { addDaysToDateOnly } from './trainingSessions';
import { readStoredMessages } from './coachChatSync';
import { isDuplicateActivity, MAX_START_GAP_MS } from './activityDuplicates';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export interface IntegrationSettings {
  intervals_api_key: string | null;
  intervals_auto: boolean;
}

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured 
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// Everything except the heavy streams_data, which is only loaded for the detail view
const ACTIVITY_LIST_COLUMNS =
  'id, user_id, strava_activity_id, title, sport_type, start_date, duration_seconds, moving_time_seconds, distance_meters, total_elevation_gain_m, avg_power, max_power, normalized_power, intensity_factor, training_stress_score, avg_hr, max_hr, avg_cadence, max_speed_kmh, avg_vam_mh, time_in_hr_zones, time_in_power_zones, power_curve_best_efforts, map_summary_polyline, gear_notes, pack_weight_kg, perceived_exertion, knee_discomfort_level, coach_assessment, coach_assessment_at, tags, effort_notes, estimated_tss, estimated_if, tss_source, tss_confidence, tss_rationale, tss_estimated_at, created_at';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STORAGE_KEYS = {
  MUNTER: 'summit_munter_params',
  GOAL_METRICS: 'summit_goal_metrics',
  SESSION_LINKS: 'summit_session_links',
  SESSION_ASSESSMENTS: 'summit_session_assessments',
  SESSION_SCORES: 'summit_session_scores',
  COACH_MEMORY: 'summit_coach_memory',
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
    const startWindow = new Date(candidateStart - MAX_START_GAP_MS).toISOString();
    const endWindow = new Date(candidateStart + MAX_START_GAP_MS).toISOString();
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
        return Number.isFinite(start) && Math.abs(start - candidateStart) <= MAX_START_GAP_MS;
      });
    }

    return possibleMatches.find((activity) => isDuplicateActivity(candidate, activity));
  }

  public async addActivity(incoming: Activity): Promise<Activity> {
    // A small route outline for the activity cards, so the list never needs the full track
    const newActivity = incoming.map_summary_polyline == null && incoming.streams_data?.length
      ? { ...incoming, map_summary_polyline: routeOutline(incoming.streams_data) }
      : incoming;
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
      const cached = this.readGoalMetricsCache();
      // A database without the tracking_metrics column keeps them on this device
      return ((data || []) as Goal[]).map((g) => (g.tracking_metrics === undefined && cached[g.id] ? { ...g, tracking_metrics: cached[g.id] } : g));
    }
    return this.localGoals;
  }

  private readGoalMetricsCache(): Record<string, TrackingMetric[]> {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.GOAL_METRICS) || '{}');
    } catch {
      return {};
    }
  }

  /**
   * Save the metrics chosen for a goal. `synced` is false when the database has no tracking_metrics column yet
   * (the SQL has not been run): the metrics are then kept on this device only.
   */
  public async saveGoalMetrics(goalId: string, metrics: TrackingMetric[]): Promise<{ synced: boolean }> {
    try {
      await this.updateGoal(goalId, { tracking_metrics: metrics });
      return { synced: true };
    } catch (err) {
      if (!(err instanceof Error) || !err.message.includes('tracking_metrics')) throw err;
    }
    try {
      const all = this.readGoalMetricsCache();
      all[goalId] = metrics;
      localStorage.setItem(STORAGE_KEYS.GOAL_METRICS, JSON.stringify(all));
    } catch {
      // Storage unavailable: the metrics will not survive a reload
    }
    return { synced: false };
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

  private llmUsageTableMissing = false;

  /** Log model calls (sizes and counts only). Best effort: a missing table or no Supabase just means nothing is recorded. */
  public async logLlmUsage(records: LlmUsageRecord[]): Promise<void> {
    if (!(this.mode === 'supabase' && supabase) || this.llmUsageTableMissing || records.length === 0) return;
    try {
      const profile = await this.getAuthenticatedProfile();
      const rows = records.map((r) => ({ ...r, user_id: profile.id }));
      let { error } = await supabase.from('llm_usage').insert(rows);
      // A table from before the payload columns existed: keep the usage numbers and drop the text
      if (error && /system_text|user_text|history_text|response_text/.test(error.message)) {
        ({ error } = await supabase.from('llm_usage').insert(rows.map(({ system_text, user_text, history_text, response_text, ...rest }) => rest)));
      }
      if (error && /llm_usage/.test(error.message)) this.llmUsageTableMissing = true;
    } catch { /* usage logging never breaks the coach */ }
  }

  private memoryColumnMissing = false;
  private readMemoryCache(): CoachMemory {
    try { return readMemory(JSON.parse(localStorage.getItem(STORAGE_KEYS.COACH_MEMORY) || '{}')); } catch { return readMemory({}); }
  }

  /** What the coach remembers about the athlete. Synced in coach_chats.memory when that column exists, else kept on this device. */
  public async getCoachMemory(): Promise<CoachMemory> {
    const local = this.readMemoryCache();
    if (!(this.mode === 'supabase' && supabase) || this.memoryColumnMissing) return local;
    try {
      const profile = await this.getAuthenticatedProfile();
      const { data, error } = await supabase.from('coach_chats').select('memory').eq('user_id', profile.id).maybeSingle();
      if (error) {
        if (/memory/.test(error.message)) this.memoryColumnMissing = true;
        return local;
      }
      if (!data?.memory) return local;
      const remote = readMemory(data.memory);
      // Whichever side was changed last wins
      return (remote.updated_at ?? '') >= (local.updated_at ?? '') ? remote : local;
    } catch {
      return local;
    }
  }

  public async saveCoachMemory(memory: CoachMemory): Promise<{ synced: boolean }> {
    try { localStorage.setItem(STORAGE_KEYS.COACH_MEMORY, JSON.stringify(memory)); } catch { /* storage unavailable */ }
    if (!(this.mode === 'supabase' && supabase) || this.memoryColumnMissing) return { synced: this.mode !== 'supabase' };
    try {
      const profile = await this.getAuthenticatedProfile();
      const { error } = await supabase.from('coach_chats').upsert({ user_id: profile.id, memory }, { onConflict: 'user_id' });
      if (!error) return { synced: true };
      if (/memory/.test(error.message)) this.memoryColumnMissing = true;
    } catch { /* the device copy stands */ }
    return { synced: false };
  }

  /** The account's synced coach chat. Only available with Supabase; throws if the coach_chats table is missing. */
  public async getCoachChat(): Promise<AICoachMessage[]> {
    if (!(this.mode === 'supabase' && supabase)) return [];
    const profile = await this.getAuthenticatedProfile();
    const { data, error } = await supabase
      .from('coach_chats')
      .select('messages')
      .eq('user_id', profile.id)
      .maybeSingle();
    if (error) throw new Error(`Coach chat could not be loaded: ${error.message}`);
    return readStoredMessages(data?.messages);
  }

  public async saveCoachChat(messages: AICoachMessage[]): Promise<void> {
    if (!(this.mode === 'supabase' && supabase)) return;
    const profile = await this.getAuthenticatedProfile();
    const { error } = await supabase
      .from('coach_chats')
      .upsert({ user_id: profile.id, messages, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) throw new Error(`Coach chat could not be saved: ${error.message}`);
  }

  /**
   * The account's connections to other services. Null means the athlete never saved any; a row with a null key
   * means they disconnected on purpose. Only available with Supabase; throws if the table is missing.
   */
  public async getIntegrationSettings(): Promise<IntegrationSettings | null> {
    if (!(this.mode === 'supabase' && supabase)) return null;
    const profile = await this.getAuthenticatedProfile();
    const { data, error } = await supabase
      .from('integration_settings')
      .select('intervals_api_key, intervals_auto')
      .eq('user_id', profile.id)
      .maybeSingle();
    if (error) throw new Error(`Connection settings could not be loaded: ${error.message}`);
    if (!data) return null;
    return {
      intervals_api_key: typeof data.intervals_api_key === 'string' && data.intervals_api_key.trim() ? data.intervals_api_key.trim() : null,
      intervals_auto: data.intervals_auto !== false,
    };
  }

  public async saveIntegrationSettings(settings: Partial<IntegrationSettings>): Promise<void> {
    if (!(this.mode === 'supabase' && supabase)) return;
    const profile = await this.getAuthenticatedProfile();
    const { error } = await supabase
      .from('integration_settings')
      .upsert({ user_id: profile.id, ...settings, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) throw new Error(`Connection settings could not be saved: ${error.message}`);
  }

  // ── Munter travel parameters (kept per activity, kept out of the Activity objects so a database without the column can't break saves) ──
  private munterColumnMissing = false;
  private readMunterCache(): Record<string, MunterParams> {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.MUNTER) || '{}');
    } catch {
      return {};
    }
  }
  private writeMunterCache(id: string, params: MunterParams) {
    try {
      const all = this.readMunterCache();
      all[id] = params;
      localStorage.setItem(STORAGE_KEYS.MUNTER, JSON.stringify(all));
    } catch {
      // Storage unavailable: the estimate is recomputed next time
    }
  }

  /** Stored Munter parameters by activity id. */
  public async getMunterParams(): Promise<Record<string, MunterParams>> {
    const cached = this.readMunterCache();
    if (this.mode === 'supabase' && supabase && !this.munterColumnMissing) {
      const profile = await this.getAuthenticatedProfile();
      const { data, error } = await supabase
        .from('activities')
        .select('id, munter')
        .eq('user_id', profile.id)
        .not('munter', 'is', null);
      if (!error) {
        const fromDb: Record<string, MunterParams> = {};
        for (const row of (data || []) as { id: string; munter: MunterParams }[]) fromDb[row.id] = row.munter;
        return { ...cached, ...fromDb };
      }
      if (!error.message?.includes('munter')) throw new Error(`Travel parameters could not be loaded: ${error.message}`);
      this.munterColumnMissing = true;
    }
    return cached;
  }

  /** Save one activity's Munter parameters. `synced` is false when they could only be kept on this device (no database column yet). */
  public async saveMunterParams(id: string, params: MunterParams): Promise<{ synced: boolean }> {
    if (this.mode === 'supabase' && supabase) {
      if (!this.munterColumnMissing) {
        const profile = await this.getAuthenticatedProfile();
        const { error } = await supabase.from('activities').update({ munter: params }).eq('id', id).eq('user_id', profile.id);
        if (!error) return { synced: true };
        if (!error.message?.includes('munter')) throw new Error(`Travel parameters could not be saved: ${error.message}`);
        this.munterColumnMissing = true;
      }
      this.writeMunterCache(id, params);
      return { synced: false };
    }
    this.writeMunterCache(id, params);
    return { synced: true };
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
      const links = this.readSessionLinks();
      const assessments = this.readSessionAssessments();
      const scores = this.readSessionScores();
      // Rows from a database without the new columns take what was remembered on this device
      return ((data || []) as TrainingSession[]).map((session) => {
        let merged = session;
        if (session.completed_activity_ids === undefined && links[session.id]) {
          merged = { ...merged, completed_activity_ids: links[session.id] };
        }
        if (session.coach_assessment === undefined && assessments[session.id]) {
          merged = { ...merged, coach_assessment: assessments[session.id].text, coach_assessment_at: assessments[session.id].at };
        }
        if (session.auto_score === undefined && scores[session.id]) {
          merged = { ...merged, auto_score: scores[session.id] };
        }
        return merged;
      });
    }
    return this.localTrainingSessions;
  }

  // Fallback store for session-to-activity links when the database has no completed_activity_ids column yet
  private linkColumnMissing = false;
  private readSessionLinks(): Record<string, string[]> {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.SESSION_LINKS) || '{}');
    } catch {
      return {};
    }
  }
  private writeSessionLinks(id: string, ids: string[]) {
    try {
      const links = this.readSessionLinks();
      if (ids.length) links[id] = ids; else delete links[id];
      localStorage.setItem(STORAGE_KEYS.SESSION_LINKS, JSON.stringify(links));
    } catch {
      // Storage unavailable: the links just won't survive a reload
    }
  }

  private scoreColumnMissing = false;
  private readSessionScores(): Record<string, SessionScore> {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.SESSION_SCORES) || '{}');
    } catch {
      return {};
    }
  }

  /** Save the software score of a completed session. Kept on this device only when the database has no auto_score column yet. */
  public async saveSessionScore(id: string, score: SessionScore): Promise<{ session: TrainingSession; synced: boolean }> {
    if (this.mode === 'supabase' && supabase) {
      const profile = await this.getAuthenticatedProfile();
      if (!this.scoreColumnMissing) {
        const { data, error } = await supabase
          .from('training_sessions')
          .update({ auto_score: score })
          .eq('id', id)
          .eq('user_id', profile.id)
          .select('*')
          .single();
        if (!error && data) return { session: data as TrainingSession, synced: true };
        if (!error?.message?.includes('auto_score')) {
          throw new Error(`The session score could not be saved: ${error?.message || 'Session not found'}`);
        }
        this.scoreColumnMissing = true;
      }
      try {
        const saved = this.readSessionScores();
        saved[id] = score;
        localStorage.setItem(STORAGE_KEYS.SESSION_SCORES, JSON.stringify(saved));
      } catch {
        // Storage unavailable: the score just won't survive a reload
      }
      const current = (await this.getTrainingSessions()).find((s) => s.id === id);
      if (!current) throw new Error('Training session not found.');
      return { session: { ...current, auto_score: score }, synced: false };
    }
    const index = this.localTrainingSessions.findIndex((session) => session.id === id);
    if (index < 0) throw new Error('Training session not found.');
    const updated = { ...this.localTrainingSessions[index], auto_score: score };
    this.localTrainingSessions[index] = updated;
    this.saveLocalState();
    return { session: updated, synced: true };
  }

  private assessmentColumnMissing = false;
  private readSessionAssessments(): Record<string, { text: string; at: string }> {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.SESSION_ASSESSMENTS) || '{}');
    } catch {
      return {};
    }
  }

  /**
   * Save the coach's assessment of a completed session. `synced` is false when the database has no column for it yet
   * (the SQL has not been run): the assessment is then kept on this device only.
   */
  public async saveSessionAssessment(id: string, text: string): Promise<{ session: TrainingSession; synced: boolean }> {
    const at = new Date().toISOString();
    if (this.mode === 'supabase' && supabase) {
      const profile = await this.getAuthenticatedProfile();
      if (!this.assessmentColumnMissing) {
        const { data, error } = await supabase
          .from('training_sessions')
          .update({ coach_assessment: text, coach_assessment_at: at })
          .eq('id', id)
          .eq('user_id', profile.id)
          .select('*')
          .single();
        if (!error && data) return { session: data as TrainingSession, synced: true };
        if (!error?.message?.includes('coach_assessment')) {
          throw new Error(`The assessment could not be saved: ${error?.message || 'Session not found'}`);
        }
        this.assessmentColumnMissing = true;
      }
      try {
        const saved = this.readSessionAssessments();
        saved[id] = { text, at };
        localStorage.setItem(STORAGE_KEYS.SESSION_ASSESSMENTS, JSON.stringify(saved));
      } catch {
        // Storage unavailable: the assessment just won't survive a reload
      }
      const current = (await this.getTrainingSessions()).find((s) => s.id === id);
      if (!current) throw new Error('Training session not found.');
      return { session: { ...current, coach_assessment: text, coach_assessment_at: at }, synced: false };
    }

    const index = this.localTrainingSessions.findIndex((session) => session.id === id);
    if (index < 0) throw new Error('Training session not found.');
    const updated = { ...this.localTrainingSessions[index], coach_assessment: text, coach_assessment_at: at };
    this.localTrainingSessions[index] = updated;
    this.saveLocalState();
    return { session: updated, synced: true };
  }

  /**
   * Mark a planned session complete and link the activities that did it. `synced` is false when the database
   * could not store the links (the SQL has not been run yet): the session is still completed, and the links are
   * kept on this device only.
   */
  public async completeTrainingSession(id: string, activityIds: string[]): Promise<{ session: TrainingSession; synced: boolean }> {
    return this.setSessionCompletion(id, 'COMPLETED', activityIds);
  }

  public async reopenTrainingSession(id: string): Promise<TrainingSession> {
    return (await this.setSessionCompletion(id, 'ACCEPTED', [])).session;
  }

  private async setSessionCompletion(id: string, status: TrainingSessionStatus, activityIds: string[]): Promise<{ session: TrainingSession; synced: boolean }> {
    if (this.mode === 'supabase' && supabase) {
      const profile = await this.getAuthenticatedProfile();
      if (!this.linkColumnMissing) {
        const { data, error } = await supabase
          .from('training_sessions')
          .update({ status, completed_activity_ids: activityIds })
          .eq('id', id)
          .eq('user_id', profile.id)
          .select('*')
          .single();
        if (!error && data) {
          this.writeSessionLinks(id, []);
          return { session: data as TrainingSession, synced: true };
        }
        if (!error?.message?.includes('completed_activity_ids')) {
          throw new Error(`Training session update failed: ${error?.message || 'Session not found'}`);
        }
        this.linkColumnMissing = true;
      }
      const session = await this.updateTrainingSessionStatus(id, status);
      this.writeSessionLinks(id, activityIds);
      return { session: { ...session, completed_activity_ids: activityIds }, synced: activityIds.length === 0 };
    }

    const index = this.localTrainingSessions.findIndex((session) => session.id === id);
    if (index < 0) throw new Error('Training session not found.');
    const updated = { ...this.localTrainingSessions[index], status, completed_activity_ids: activityIds };
    this.localTrainingSessions[index] = updated;
    this.saveLocalState();
    return { session: updated, synced: true };
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

  /**
   * Replaces a whole week with an accepted plan: removes that week's proposed and accepted sessions
   * (completed ones are history and stay), then saves the new sessions as ACCEPTED.
   */
  public async replaceWeekWithAcceptedSessions(
    weekStartDate: string,
    sessions: Omit<TrainingSession, 'id' | 'status'>[]
  ): Promise<TrainingSession[]> {
    const weekEndDate = addDaysToDateOnly(weekStartDate, 6);

    if (this.mode === 'supabase' && supabase) {
      const profile = await this.getAuthenticatedProfile();
      const { error: deleteError } = await supabase
        .from('training_sessions')
        .delete()
        .eq('user_id', profile.id)
        .neq('status', 'COMPLETED')
        .or(`week_start_date.eq.${weekStartDate},and(session_date.gte.${weekStartDate},session_date.lte.${weekEndDate})`);
      if (deleteError) throw new Error(`The existing week could not be replaced: ${deleteError.message}`);

      if (sessions.length === 0) return [];
      const rows = sessions.map((session) => {
        const { id: _modelId, status: _modelStatus, ...fields } = session as Partial<TrainingSession>;
        return { ...fields, user_id: profile.id, status: 'ACCEPTED' as const };
      });
      const { data, error } = await supabase.from('training_sessions').insert(rows).select('*');
      if (error) throw new Error(`Weekly plan could not be saved: ${error.message}`);
      return (data || []) as TrainingSession[];
    }

    this.localTrainingSessions = this.localTrainingSessions.filter(
      (session) => session.status === 'COMPLETED'
        || (session.week_start_date !== weekStartDate && (session.session_date < weekStartDate || session.session_date > weekEndDate))
    );
    const accepted = sessions.map((session) => ({ ...session, id: crypto.randomUUID(), status: 'ACCEPTED' as const }));
    this.localTrainingSessions.push(...accepted);
    this.saveLocalState();
    return accepted;
  }

  public async saveTrainingSessions(
    sessions: TrainingSession[]
  ): Promise<TrainingSession[]> {
    if (this.mode === 'supabase' && supabase) {
      const profile = await this.getAuthenticatedProfile();
      const results: TrainingSession[] = [];
      for (const original of sessions) {
        let session = original;
        const isExistingUUID = UUID_PATTERN.test(session.id || '');
        // Links and assessments have their own save methods; sending them here would fail the whole save on a database without the columns
        session = { ...session, completed_activity_ids: undefined, coach_assessment: undefined, coach_assessment_at: undefined, auto_score: undefined };

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
            // Don't report an accepted plan that never reached the database
            throw new Error(`Session "${session.title}" could not be saved: ${error?.message || 'no row returned'}`);
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
            throw new Error(`Session "${session.title}" could not be saved: ${error?.message || 'no row returned'}`);
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
