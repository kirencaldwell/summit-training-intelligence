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
  full_name TEXT NOT NULL DEFAULT 'Endurance Athlete',
  avatar_url TEXT,
  ftp INTEGER NOT NULL DEFAULT 280, -- Functional Threshold Power (Watts)
  max_hr INTEGER NOT NULL DEFAULT 192, -- Max Heart Rate (BPM)
  lthr INTEGER NOT NULL DEFAULT 172, -- Lactate Threshold HR (BPM)
  weight_kg NUMERIC(5,2) NOT NULL DEFAULT 70.5,
  
  -- Injury & Health Considerations
  injury_notes TEXT[] DEFAULT ARRAY[
    'Posterior chain tight post high-ascent skimo',
    'Left patellar tendonitis awareness on steep climbs >12%'
  ],
  
  -- Decompression & Recovery Routines
  recovery_routines JSONB DEFAULT '{
    "wednesday": "Post-workout foam roll (15 min) + hamstrings mobility + low-load isometric knee extensions",
    "sunday": "Metabolic flushing spin (45 min @ Z1 <120W) + sauna / cold plunge"
  }'::jsonb,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

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
  target_distance_km NUMERIC(6,2),
  target_elevation_m NUMERIC(6,2),
  target_power_watts INTEGER,
  notes TEXT,
  priority TEXT CHECK (priority IN ('A_RACE', 'B_RACE', 'TRAINING_MILESTONE')) DEFAULT 'A_RACE',
  status TEXT CHECK (status IN ('ACTIVE', 'COMPLETED', 'DEPRIORITIZED')) DEFAULT 'ACTIVE',
  completed_at TIMESTAMPTZ,
  debrief_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

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
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS power_curve_best_efforts JSONB;

-- ---------------------------------------------------------
-- INDEXES FOR PERFORMANCE
-- ---------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_activities_user_date ON public.activities (user_id, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_activities_sport ON public.activities (sport_type);
CREATE INDEX IF NOT EXISTS idx_goals_date ON public.goals (target_date);

-- ---------------------------------------------------------
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ---------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "Users can view own goals" ON public.goals FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "Users can view own activities" ON public.activities FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);
