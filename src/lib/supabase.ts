import { createClient } from '@supabase/supabase-js';
import type { Activity, AthleteProfile, Goal } from '../types';
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
  MODE: 'summit_data_mode',
};

// Dual-mode Storage Manager (LocalStorage fallback vs Supabase Live DB)
class DataService {
  private localActivities: Activity[];
  private localProfile: AthleteProfile;
  private localGoals: Goal[];
  private mode: 'demo' | 'supabase';

  constructor() {
    const savedMode = localStorage.getItem(STORAGE_KEYS.MODE) as 'demo' | 'supabase' | null;
    this.mode = savedMode || (isSupabaseConfigured ? 'supabase' : 'demo');

    // Load from localStorage or seed with defaults
    const savedProfile = localStorage.getItem(STORAGE_KEYS.PROFILE);
    this.localProfile = savedProfile ? JSON.parse(savedProfile) : { ...MOCK_PROFILE };

    const savedActivities = localStorage.getItem(STORAGE_KEYS.ACTIVITIES);
    this.localActivities = savedActivities ? JSON.parse(savedActivities) : [...MOCK_ACTIVITIES];

    const savedGoals = localStorage.getItem(STORAGE_KEYS.GOALS);
    this.localGoals = savedGoals ? JSON.parse(savedGoals) : [...MOCK_GOALS];
  }

  private saveLocalState() {
    localStorage.setItem(STORAGE_KEYS.PROFILE, JSON.stringify(this.localProfile));
    localStorage.setItem(STORAGE_KEYS.ACTIVITIES, JSON.stringify(this.localActivities));
    localStorage.setItem(STORAGE_KEYS.GOALS, JSON.stringify(this.localGoals));
  }

  public getMode(): 'demo' | 'supabase' {
    return this.mode;
  }

  public setMode(mode: 'demo' | 'supabase') {
    this.mode = mode;
    localStorage.setItem(STORAGE_KEYS.MODE, mode);
  }

  public async getProfile(): Promise<AthleteProfile> {
    if (this.mode === 'supabase' && supabase) {
      try {
        const { data, error } = await supabase.from('profiles').select('*').single();
        if (!error && data) return data as AthleteProfile;
      } catch (err) {
        console.warn('Supabase profile fetch failed, using local profile', err);
      }
    }
    return this.localProfile;
  }

  public async updateProfile(profileUpdates: Partial<AthleteProfile>): Promise<AthleteProfile> {
    this.localProfile = { ...this.localProfile, ...profileUpdates };
    this.saveLocalState();

    if (this.mode === 'supabase' && supabase) {
      try {
        await supabase.from('profiles').update(profileUpdates).eq('id', this.localProfile.id);
      } catch (err) {
        console.warn('Supabase profile update failed', err);
      }
    }
    return this.localProfile;
  }

  public async getActivities(sportFilter?: string): Promise<Activity[]> {
    let list = this.localActivities;

    if (this.mode === 'supabase' && supabase) {
      try {
        let query = supabase.from('activities').select('*').order('start_date', { ascending: false });
        if (sportFilter && sportFilter !== 'all') {
          query = query.eq('sport_type', sportFilter);
        }
        const { data, error } = await query;
        if (!error && data) {
          list = data as Activity[];
        }
      } catch (err) {
        console.warn('Supabase activities fetch failed, falling back to local list', err);
      }
    }

    if (sportFilter && sportFilter !== 'all') {
      return list.filter(a => a.sport_type === sportFilter);
    }
    return list;
  }

  public async getActivityById(id: string): Promise<Activity | undefined> {
    const list = await this.getActivities();
    return list.find(a => a.id === id);
  }

  public async addActivity(newActivity: Activity): Promise<Activity> {
    this.localActivities.unshift(newActivity);
    this.saveLocalState();

    if (this.mode === 'supabase' && supabase) {
      try {
        await supabase.from('activities').insert(newActivity);
      } catch (err) {
        console.warn('Supabase activity insertion failed', err);
      }
    }
    return newActivity;
  }

  public async getGoals(): Promise<Goal[]> {
    if (this.mode === 'supabase' && supabase) {
      try {
        const { data, error } = await supabase.from('goals').select('*').order('created_at', { ascending: false });
        if (!error && data) return data as Goal[];
      } catch (err) {
        console.warn('Supabase goals fetch failed', err);
      }
    }
    return this.localGoals;
  }

  public async addGoal(newGoal: Goal): Promise<Goal> {
    this.localGoals.unshift(newGoal);
    this.saveLocalState();

    if (this.mode === 'supabase' && supabase) {
      try {
        await supabase.from('goals').insert(newGoal);
      } catch (err) {
        console.warn('Supabase goal insertion failed. Did you execute schema.sql in Supabase?', err);
      }
    }
    return newGoal;
  }

  public async updateGoal(id: string, updates: Partial<Goal>): Promise<Goal | undefined> {
    const idx = this.localGoals.findIndex(g => g.id === id);
    if (idx !== -1) {
      this.localGoals[idx] = { ...this.localGoals[idx], ...updates };
      this.saveLocalState();

      if (this.mode === 'supabase' && supabase) {
        try {
          await supabase.from('goals').update(updates).eq('id', id);
        } catch (err) {
          console.warn('Supabase goal update failed', err);
        }
      }
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
    this.localGoals = this.localGoals.filter(g => g.id !== id);
    this.saveLocalState();

    if (this.mode === 'supabase' && supabase) {
      try {
        await supabase.from('goals').delete().eq('id', id);
      } catch (err) {
        console.warn('Supabase goal deletion failed', err);
      }
    }
    return true;
  }
}

export const dataService = new DataService();
