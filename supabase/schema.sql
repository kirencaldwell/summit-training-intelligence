-- =========================================================
-- Summit Multi-Sport Training Intelligence Database Schema
-- Supabase / PostgreSQL Schema Definition
-- =========================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------
-- 1. PROFILES TABLE
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  ftp INTEGER NOT NULL DEFAULT 0, -- Functional Threshold Power (Watts), supplied by the athlete
  max_hr INTEGER NOT NULL DEFAULT 0, -- Max Heart Rate (BPM)
  lthr INTEGER NOT NULL DEFAULT 0, -- Lactate Threshold HR (BPM)
  weight_kg NUMERIC(5,2) NOT NULL DEFAULT 0,

  -- The athlete's own notes about themselves, for the coach
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Existing databases: add `notes` and fold the old injury_notes / recovery_routines columns into it once.
-- (Those two columns are no longer used by the app; they are left in place so nothing is lost.)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS notes TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'injury_notes'
  ) THEN
    UPDATE public.profiles
    SET notes = NULLIF(concat_ws(
      E'\n',
      CASE WHEN COALESCE(array_length(injury_notes, 1), 0) > 0
           THEN 'Injuries / health: ' || array_to_string(injury_notes, '; ') END,
      NULLIF(recovery_routines->>'wednesday', ''),
      NULLIF(recovery_routines->>'sunday', '')
    ), '')
    WHERE notes IS NULL;
  END IF;
END $$;

-- ---------------------------------------------------------
-- 2. TARGET GOALS TABLE
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL, -- e.g. "Mount Baker Hill Climb"
  sport_type TEXT NOT NULL DEFAULT 'general', -- 'cycling', 'skimo', 'scrambling', 'weighted_hiking', 'general'
  target_date DATE, -- Optional target date
  timeframe_text TEXT, -- e.g. "Spring 2027", "Next Season", "Flexible"
  objective_summary TEXT NOT NULL, -- High-level text objective (e.g. "Car-to-car single day push on Mt Baker")
  target_distance_km NUMERIC(10,2),
  target_elevation_m NUMERIC(10,2),
  target_power_watts INTEGER,
  notes TEXT,
  priority TEXT CHECK (priority IN ('A_RACE', 'B_RACE', 'TRAINING_MILESTONE')) DEFAULT 'A_RACE',
  status TEXT CHECK (status IN ('ACTIVE', 'COMPLETED', 'DEPRIORITIZED')) DEFAULT 'ACTIVE',
  completed_at TIMESTAMPTZ,
  debrief_notes TEXT,
  creator TEXT CHECK (creator IN ('athlete', 'coach')), -- who proposed the goal
  periodization_phases JSONB, -- [{ name, focus, weeks, target_ctl, status }]
  milestones JSONB, -- [{ title, target_date, target_metric, completed }]
  readiness_assessment JSONB, -- latest on-request coach assessment of readiness for this goal
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Columns added after the first release (safe to re-run on an existing database)
ALTER TABLE public.goals
  ADD COLUMN IF NOT EXISTS creator TEXT CHECK (creator IN ('athlete', 'coach')),
  ADD COLUMN IF NOT EXISTS periodization_phases JSONB,
  ADD COLUMN IF NOT EXISTS milestones JSONB,
  ADD COLUMN IF NOT EXISTS readiness_assessment JSONB;

-- Multi-week goals can total more than 9,999 km / m, which overflowed NUMERIC(6,2)
ALTER TABLE public.goals
  ALTER COLUMN target_distance_km TYPE NUMERIC(10,2),
  ALTER COLUMN target_elevation_m TYPE NUMERIC(10,2);

-- ---------------------------------------------------------
-- 3. ACTIVITIES TABLE
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  strava_activity_id BIGINT UNIQUE,
  title TEXT NOT NULL,
  sport_type TEXT NOT NULL CHECK (
    sport_type IN ('cycling', 'zwift', 'skimo', 'backcountry_skiing', 'scrambling', 'weighted_hiking')
  ),
  start_date TIMESTAMPTZ NOT NULL,
  duration_seconds INTEGER NOT NULL,
  moving_time_seconds INTEGER NOT NULL,
  distance_meters NUMERIC(10,2) NOT NULL,
  total_elevation_gain_m NUMERIC(8,2) NOT NULL,
  
  -- Metrics
  avg_power INTEGER,
  max_power INTEGER,
  normalized_power INTEGER, -- NP (30s rolling algorithm)
  intensity_factor NUMERIC(4,3), -- IF = NP / FTP
  training_stress_score NUMERIC(6,2), -- TSS
  avg_hr INTEGER,
  max_hr INTEGER,
  avg_cadence INTEGER,
  max_speed_kmh NUMERIC(5,2),
  avg_vam_mh NUMERIC(6,2), -- Vertical Ascent Rate (meters/hour)
  
  -- Detailed Zones JSONB
  time_in_hr_zones JSONB, -- { "z1": 600, "z2": 1800, "z3": 1200, "z4": 600, "z5": 0 }
  time_in_power_zones JSONB, -- { "z1": 300, "z2": 1500, "z3": 1200, "z4": 900, "z5": 300, "z6": 0, "z7": 0 }
  power_curve_best_efforts JSONB, -- Best average watts by duration in seconds
  
  -- Route geometry polyline (encoded or array)
  map_summary_polyline TEXT,
  
  -- Time-series Metric Streams (JSONB array or reference)
  -- Schema: [{ "time": 0, "watts": 180, "hr": 135, "alt": 450, "lat": 48.775, "lng": -121.815, "cadence": 85, "speed": 6.2 }, ...]
  streams_data JSONB,
  
  -- Athlete Notes / Gear
  gear_notes TEXT,
  pack_weight_kg NUMERIC(4,2), -- For weighted hiking/scrambling/skimo
  perceived_exertion INTEGER CHECK (perceived_exertion BETWEEN 1 AND 10),
  knee_discomfort_level INTEGER CHECK (knee_discomfort_level BETWEEN 0 AND 10) DEFAULT 0,

  -- AI coach assessment of how the activity fits the plan and goals
  coach_assessment TEXT,
  coach_assessment_at TIMESTAMPTZ,

  -- Athlete-defined tags
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  -- Effort description and the AI training-load estimate derived from it
  effort_notes TEXT,
  estimated_tss NUMERIC(7,2),
  estimated_if NUMERIC(4,3),
  tss_source TEXT,
  tss_confidence TEXT,
  tss_rationale TEXT,
  tss_estimated_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS power_curve_best_efforts JSONB,
  ADD COLUMN IF NOT EXISTS coach_assessment TEXT,
  ADD COLUMN IF NOT EXISTS coach_assessment_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS effort_notes TEXT,
  ADD COLUMN IF NOT EXISTS estimated_tss NUMERIC(7,2),
  ADD COLUMN IF NOT EXISTS estimated_if NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS tss_source TEXT,
  ADD COLUMN IF NOT EXISTS tss_confidence TEXT,
  ADD COLUMN IF NOT EXISTS tss_rationale TEXT,
  ADD COLUMN IF NOT EXISTS tss_estimated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.training_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  week_start_date DATE NOT NULL,
  session_date DATE NOT NULL,
  title TEXT NOT NULL,
  sport_type TEXT NOT NULL CHECK (
    sport_type IN ('cycling', 'zwift', 'skimo', 'backcountry_skiing', 'scrambling', 'weighted_hiking')
  ),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  focus TEXT NOT NULL,
  details TEXT NOT NULL,
  target_tss INTEGER CHECK (target_tss >= 0),
  status TEXT NOT NULL DEFAULT 'PROPOSED' CHECK (
    status IN ('PROPOSED', 'ACCEPTED', 'COMPLETED', 'DECLINED')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------
-- INDEXES FOR PERFORMANCE
-- ---------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_activities_user_date ON public.activities (user_id, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_activities_sport ON public.activities (sport_type);
CREATE INDEX IF NOT EXISTS idx_goals_date ON public.goals (target_date);
CREATE INDEX IF NOT EXISTS idx_training_sessions_user_date ON public.training_sessions (user_id, session_date);

-- ---------------------------------------------------------
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ---------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own goals" ON public.goals;
DROP POLICY IF EXISTS "Users can view own activities" ON public.activities;
DROP POLICY IF EXISTS "Anonymous users can insert unowned activities" ON public.activities;
DROP POLICY IF EXISTS "Users can insert own goals" ON public.goals;
DROP POLICY IF EXISTS "Users can update own goals" ON public.goals;
DROP POLICY IF EXISTS "Users can delete own goals" ON public.goals;
DROP POLICY IF EXISTS "Users can view own activities" ON public.activities;
DROP POLICY IF EXISTS "Users can insert own activities" ON public.activities;
DROP POLICY IF EXISTS "Users can update own activities" ON public.activities;
DROP POLICY IF EXISTS "Users can delete own activities" ON public.activities;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own training sessions" ON public.training_sessions;
DROP POLICY IF EXISTS "Users can insert own training sessions" ON public.training_sessions;
DROP POLICY IF EXISTS "Users can update own training sessions" ON public.training_sessions;
DROP POLICY IF EXISTS "Users can delete own training sessions" ON public.training_sessions;

CREATE OR REPLACE FUNCTION public.current_profile_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.current_profile_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_profile_id() TO authenticated;

CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can view own goals" ON public.goals
  FOR SELECT TO authenticated USING (user_id = (SELECT public.current_profile_id()));
CREATE POLICY "Users can insert own goals" ON public.goals
  FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT public.current_profile_id()));
CREATE POLICY "Users can update own goals" ON public.goals
  FOR UPDATE TO authenticated USING (user_id = (SELECT public.current_profile_id()))
  WITH CHECK (user_id = (SELECT public.current_profile_id()));
CREATE POLICY "Users can delete own goals" ON public.goals
  FOR DELETE TO authenticated USING (user_id = (SELECT public.current_profile_id()));

CREATE POLICY "Users can view own activities" ON public.activities
  FOR SELECT TO authenticated USING (user_id = (SELECT public.current_profile_id()));
CREATE POLICY "Users can insert own activities" ON public.activities
  FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT public.current_profile_id()));
CREATE POLICY "Users can update own activities" ON public.activities
  FOR UPDATE TO authenticated USING (user_id = (SELECT public.current_profile_id()))
  WITH CHECK (user_id = (SELECT public.current_profile_id()));
CREATE POLICY "Users can delete own activities" ON public.activities
  FOR DELETE TO authenticated USING (user_id = (SELECT public.current_profile_id()));

CREATE POLICY "Users can view own training sessions" ON public.training_sessions
  FOR SELECT TO authenticated USING (user_id = (SELECT public.current_profile_id()));
CREATE POLICY "Users can insert own training sessions" ON public.training_sessions
  FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT public.current_profile_id()));
CREATE POLICY "Users can update own training sessions" ON public.training_sessions
  FOR UPDATE TO authenticated USING (user_id = (SELECT public.current_profile_id()))
  WITH CHECK (user_id = (SELECT public.current_profile_id()));
CREATE POLICY "Users can delete own training sessions" ON public.training_sessions
  FOR DELETE TO authenticated USING (user_id = (SELECT public.current_profile_id()));

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
      NULLIF(NEW.raw_user_meta_data->>'name', ''),
      NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
      'Endurance Athlete'
    ),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture')
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

NOTIFY pgrst, 'reload schema';
