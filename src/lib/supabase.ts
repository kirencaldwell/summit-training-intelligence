import { createClient } from '@supabase/supabase-js';
import type { Activity, AthleteProfile, Goal } from '../types';
import { MOCK_ACTIVITIES, MOCK_GOALS, MOCK_PROFILE } from './mockData';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured 
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// Dual-mode Storage Manager (Local In-Memory / LocalStorage vs Supabase)
class DataService {
  private localActivities: Activity[] = [...MOCK_ACTIVITIES];
  private localProfile: AthleteProfile = { ...MOCK_PROFILE };
  private localGoals: Goal[] = [...MOCK_GOALS];
  private mode: 'demo' | 'supabase' = isSupabaseConfigured ? 'supabase' : 'demo';

  public getMode(): 'demo' | 'supabase' {
    return this.mode;
  }

  public setMode(mode: 'demo' | 'supabase') {
    this.mode = mode;
  }

  public async getProfile(): Promise<AthleteProfile> {
    if (this.mode === 'supabase' && supabase) {
      try {
        const { data, error } = await supabase.from('profiles').select('*').single();
        if (!error && data) return data as AthleteProfile;
      } catch (err) {
        console.warn('Supabase profile fetch failed, using demo profile', err);
      }
    }
    return this.localProfile;
  }

  public async updateProfile(profileUpdates: Partial<AthleteProfile>): Promise<AthleteProfile> {
    this.localProfile = { ...this.localProfile, ...profileUpdates };

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
        if (!error && data && data.length > 0) {
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
        if (!error && data && data.length > 0) return data as Goal[];
      } catch (err) {
        console.warn('Supabase goals fetch failed', err);
      }
    }
    return this.localGoals;
  }

  public async addGoal(newGoal: Goal): Promise<Goal> {
    this.localGoals.unshift(newGoal);

    if (this.mode === 'supabase' && supabase) {
      try {
        await supabase.from('goals').insert(newGoal);
      } catch (err) {
        console.warn('Supabase goal insertion failed', err);
      }
    }
    return newGoal;
  }

  public async updateGoal(id: string, updates: Partial<Goal>): Promise<Goal | undefined> {
    const idx = this.localGoals.findIndex(g => g.id === id);
    if (idx !== -1) {
      this.localGoals[idx] = { ...this.localGoals[idx], ...updates };
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
