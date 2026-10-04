import { createClient, type User } from '@supabase/supabase-js';
import type { Activity, AthleteProfile, Goal, TrainingSession, TrainingSessionStatus } from '../types';
import { MOCK_ACTIVITIES, MOCK_GOALS, MOCK_PROFILE } from './mockData';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured 
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

const STORAGE_KEYS = {
  PROFILE: 'summit_athlete_profile',
  ACTIVITIES: 'summit_activities_list',
  GOALS: 'summit_goals_list',
  TRAINING_SESSIONS: 'summit_training_sessions',
  MODE: 'summit_data_mode',
};

// Dual-mode Storage Manager (LocalStorage fallback vs Supabase Live DB)
class DataService {
  private localActivities: Activity[];
  private localProfile: AthleteProfile;
  private localGoals: Goal[];
  private localTrainingSessions: TrainingSession[];
  private mode: 'demo' | 'supabase';
  private authUser: User | null = null;
  private authenticatedProfile: AthleteProfile | null = null;

  constructor() {
    const savedMode = localStorage.getItem(STORAGE_KEYS.MODE) as 'demo' | 'supabase' | null;
    this.mode = isSupabaseConfigured ? 'supabase' : savedMode || 'demo';

    // Load from localStorage or seed with defaults
    const savedProfile = localStorage.getItem(STORAGE_KEYS.PROFILE);
    this.localProfile = savedProfile ? JSON.parse(savedProfile) : { ...MOCK_PROFILE };

    const savedActivities = localStorage.getItem(STORAGE_KEYS.ACTIVITIES);
    this.localActivities = savedActivities ? JSON.parse(savedActivities) : [...MOCK_ACTIVITIES];

    const savedGoals = localStorage.getItem(STORAGE_KEYS.GOALS);
    this.localGoals = savedGoals ? JSON.parse(savedGoals) : [...MOCK_GOALS];

    const savedTrainingSessions = localStorage.getItem(STORAGE_KEYS.TRAINING_SESSIONS);
    this.localTrainingSessions = savedTrainingSessions ? JSON.parse(savedTrainingSessions) : [];
  }

  private saveLocalState() {
    localStorage.setItem(STORAGE_KEYS.PROFILE, JSON.stringify(this.localProfile));
    localStorage.setItem(STORAGE_KEYS.ACTIVITIES, JSON.stringify(this.localActivities));
    localStorage.setItem(STORAGE_KEYS.GOALS, JSON.stringify(this.localGoals));
    localStorage.setItem(STORAGE_KEYS.TRAINING_SESSIONS, JSON.stringify(this.localTrainingSessions));
  }

  public getMode(): 'demo' | 'supabase' {
    return this.mode;
  }

  public setMode(mode: 'demo' | 'supabase') {
    this.mode = isSupabaseConfigured ? 'supabase' : mode;
    localStorage.setItem(STORAGE_KEYS.MODE, this.mode);
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
    const fullName = metadata.full_name || metadata.name || this.authUser.email?.split('@')[0] || 'Endurance Athlete';
    const avatarUrl = metadata.avatar_url || metadata.picture;
    const { data: created, error: createError } = await supabase
      .from('profiles')
      .insert({ user_id: this.authUser.id, full_name: fullName, avatar_url: avatarUrl })
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
      const profile = await this.getAuthenticatedProfile();
      let query = supabase
        .from('activities')
        .select('*')
        .eq('user_id', profile.id)
        .order('start_date', { ascending: false });
      if (sportFilter && sportFilter !== 'all') query = query.eq('sport_type', sportFilter);
      const { data, error } = await query;
      if (error) throw new Error(`Activities could not be loaded: ${error.message}`);
      return (data || []) as Activity[];
    }

    if (sportFilter && sportFilter !== 'all') {
      return this.localActivities.filter(a => a.sport_type === sportFilter);
    }
    return this.localActivities;
  }

  public async getActivityById(id: string): Promise<Activity | undefined> {
    const list = await this.getActivities();
    return list.find(a => a.id === id);
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
      const rows = sessions.map((session) => ({
        ...session,
        user_id: profile.id,
        status: 'PROPOSED' as const,
      }));
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
}

export const dataService = new DataService();
