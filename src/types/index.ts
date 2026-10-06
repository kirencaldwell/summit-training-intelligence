export type SportType = 
  | 'cycling' 
  | 'zwift' 
  | 'skimo' 
  | 'backcountry_skiing' 
  | 'scrambling' 
  | 'weighted_hiking';

export type GoalStatus = 'ACTIVE' | 'COMPLETED' | 'DEPRIORITIZED';

export interface MetricStreamPoint {
  time: number; // Seconds from start
  watts?: number;
  hr?: number;
  alt?: number; // Altitude in meters
  lat?: number;
  lng?: number;
  cadence?: number;
  speed?: number; // km/h
  grade?: number; // slope percentage
}

export interface ZoneDistribution {
  z1: number; // seconds
  z2: number;
  z3: number;
  z4: number;
  z5: number;
  z6?: number; // power only
  z7?: number; // power only
}

export interface Activity {
  id: string;
  strava_activity_id?: number;
  title: string;
  sport_type: SportType;
  start_date: string; // ISO date string
  duration_seconds: number;
  moving_time_seconds: number;
  distance_meters: number;
  total_elevation_gain_m: number;
  
  // Power & HR metrics
  avg_power?: number;
  max_power?: number;
  normalized_power?: number;
  intensity_factor?: number;
  training_stress_score?: number;
  avg_hr?: number;
  max_hr?: number;
  avg_cadence?: number;
  max_speed_kmh?: number;
  avg_vam_mh?: number; // Vertical Ascent Rate (m/h)
  
  // Time in zones
  time_in_hr_zones?: ZoneDistribution;
  time_in_power_zones?: ZoneDistribution;
  
  // Stream data & maps
  map_summary_polyline?: string;
  streams_data?: MetricStreamPoint[];
  power_curve_best_efforts?: Record<string, number>;
  
  // Equipment & Notes
  gear_notes?: string;
  pack_weight_kg?: number;
  perceived_exertion?: number; // 1-10
  knee_discomfort_level?: number; // 0-10

  // AI coach assessment of how this activity fits the plan and goals (saved with the activity)
  coach_assessment?: string;
  coach_assessment_at?: string;

  // Athlete-defined labels, filterable in the activities tab
  tags?: string[];
}

export interface AthleteProfile {
  id: string;
  full_name: string;
  avatar_url?: string;
  ftp: number; // e.g. 285W
  max_hr: number; // e.g. 192 BPM
  lthr: number; // e.g. 172 BPM
  weight_kg: number; // e.g. 70.5 kg
  injury_notes: string[];
  recovery_routines: {
    wednesday: string;
    sunday: string;
    daily_post_workout?: string;
  };
}

export interface PeriodizationPhase {
  name: string;
  focus: string;
  weeks: number;
  target_ctl?: number;
  status?: 'UPCOMING' | 'CURRENT' | 'COMPLETED';
}

export interface GoalMilestone {
  title: string;
  target_date?: string;
  target_metric?: string;
  completed?: boolean;
}

export interface Goal {
  id: string;
  name: string;
  sport_type: SportType | 'general';
  target_date?: string; // Optional (YYYY-MM-DD)
  timeframe_text?: string; // e.g. "Spring 2027", "Next Season", "Flexible"
  objective_summary: string; // High level text objective e.g. "Car-to-car single day push on Mt Baker"
  target_distance_km?: number;
  target_elevation_m?: number;
  target_power_watts?: number;
  notes?: string;
  priority: 'A_RACE' | 'B_RACE' | 'TRAINING_MILESTONE';
  status: GoalStatus;
  completed_at?: string;
  debrief_notes?: string;
  creator?: 'athlete' | 'coach';
  periodization_phases?: PeriodizationPhase[];
  milestones?: GoalMilestone[];
}

export type TrainingSessionStatus = 'PROPOSED' | 'ACCEPTED' | 'COMPLETED' | 'DECLINED';

export interface TrainingSession {
  id: string;
  week_start_date: string;
  session_date: string;
  title: string;
  sport_type: SportType;
  duration_minutes: number;
  focus: string;
  details: string;
  target_tss?: number;
  status: TrainingSessionStatus;
}

export interface PMCDayPoint {
  date: string; // YYYY-MM-DD
  ctl: number; // Chronic Training Load (42d exponential avg - Fitness)
  atl: number; // Acute Training Load (7d exponential avg - Fatigue)
  tsb: number; // Training Stress Balance (CTL - ATL - Form)
  tss: number; // Daily accumulated TSS
}

export interface PowerCurvePoint {
  durationSeconds: number;
  label: string;
  watts: number;
  wattsPerKg: number;
}

export interface AICoachToolCall {
  toolName: string;
  args: Record<string, any>;
  result?: any;
}

export interface ProposedPlanAction {
  type: 'CREATE' | 'UPDATE' | 'REPLACE_WEEK' | 'DELETE';
  sessions: TrainingSession[];
  weekStartDate?: string;
  summary?: string;
  isAccepted?: boolean;
  isDeclined?: boolean;
}

export interface ProposedGoalAction {
  goal: Goal;
  summary?: string;
  isAccepted?: boolean;
  isDeclined?: boolean;
}

export interface AICoachMessage {
  id: string;
  sender: 'user' | 'coach' | 'system';
  text: string;
  timestamp: string;
  toolCalls?: AICoachToolCall[];
  isThinking?: boolean;
  proposedPlan?: ProposedPlanAction;
  proposedGoal?: ProposedGoalAction;
}

export interface StravaConnectState {
  isConnected: boolean;
  athleteName?: string;
  lastSyncedAt?: string;
  accessToken?: string;
}
