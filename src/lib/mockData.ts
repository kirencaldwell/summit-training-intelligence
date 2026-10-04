import type { Activity, AthleteProfile, Goal, MetricStreamPoint } from '../types';

export const MOCK_PROFILE: AthleteProfile = {
  id: 'profile-endurance-athlete-01',
  full_name: 'Alex Mercer (Mount Baker Prep)',
  avatar_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=256&q=80',
  ftp: 285,
  max_hr: 192,
  lthr: 172,
  weight_kg: 70.5,
  injury_notes: [
    'Left patellar tendonitis awareness on steep gradients >12%',
    'Posterior chain & lower back tightness post high-ascent skimo sessions',
    'Right ankle mobility restriction from prior lateral sprain'
  ],
  recovery_routines: {
    wednesday: 'Mid-week Decompression: 20m hamstring & glute mobility + 3x45s isometric single-leg knee extensions + foam roll',
    sunday: 'Sunday Metabolic Flushing: 45m Z1 spin (<120W, CAD >95) + 15m active leg elevation + contrast shower'
  }
};

export const MOCK_GOALS: Goal[] = [
  {
    id: 'goal-baker-hillclimb',
    name: 'Mount Baker Hill Climb (Artist Point Finish)',
    sport_type: 'cycling',
    target_date: '2026-11-15',
    timeframe_text: 'Target Date: Nov 15',
    objective_summary: 'Sub-1:45:00 Artist Point finish. Pace 260W lower highway, lift to 285W upper switchbacks with 85+ RPM.',
    target_distance_km: 38.5,
    target_elevation_m: 1340,
    target_power_watts: 280,
    notes: 'Prioritize grade simulation climbing efforts and knee health checks >12% grade.',
    priority: 'A_RACE',
    status: 'ACTIVE'
  },
  {
    id: 'goal-baker-skimo-push',
    name: 'Mount Baker Car-to-Car Single Day Push',
    sport_type: 'skimo',
    timeframe_text: 'Spring Season / Glacier Window',
    objective_summary: 'Car-to-car single day push on Mt Baker Coleman-Deming route under 8 hours with 11kg mountaineering pack.',
    target_elevation_m: 2350,
    notes: 'Maintain 550+ m/h VAM pace on lower glacier. Check avalanche conditions.',
    priority: 'A_RACE',
    status: 'ACTIVE'
  },
  {
    id: 'goal-shuksan-scramble',
    name: 'Mount Shuksan Fisher Chimneys Speed Traverse',
    sport_type: 'scrambling',
    timeframe_text: 'Late Summer Window',
    objective_summary: 'Sub-7 hour car-to-car speed scramble via Fisher Chimneys & Winnie Slide.',
    target_distance_km: 19.0,
    target_elevation_m: 1750,
    notes: 'Test knee tendonitis resilience with 10kg pack.',
    priority: 'B_RACE',
    status: 'ACTIVE'
  },
  {
    id: 'goal-weighted-hike-benchmark',
    name: '15kg Weighted Vest Ridge Carry (1,000m Gain)',
    sport_type: 'weighted_hiking',
    timeframe_text: 'Ongoing Fitness Benchmark',
    objective_summary: 'Sustain >500 m/h vertical ascent rate carrying 15kg weighted vest without knee shear discomfort.',
    target_elevation_m: 1000,
    priority: 'TRAINING_MILESTONE',
    status: 'ACTIVE'
  },
  {
    id: 'goal-completed-rainier-skimo',
    name: 'Mount Rainier Fuhrer Finger Skimo Descent',
    sport_type: 'skimo',
    target_date: '2026-06-20',
    timeframe_text: 'Completed June 2026',
    objective_summary: 'Ascend & ski Fuhrer Finger route on Mt Rainier in single day window.',
    target_elevation_m: 2900,
    priority: 'A_RACE',
    status: 'COMPLETED',
    completed_at: '2026-06-20T17:30:00Z',
    debrief_notes: 'Successfully completed in 9h 15m. Snow conditions were ideal spring corn. Knee felt 100% using compression wrap. VAM averaged 510 m/h.'
  }
];

// Helper to generate realistic stream metrics
function generateStreams(
  durationSec: number, 
  baseWatts: number, 
  baseHr: number, 
  baseAlt: number, 
  altGain: number,
  startLat: number,
  startLng: number
): MetricStreamPoint[] {
  const points: MetricStreamPoint[] = [];
  const step = Math.max(1, Math.floor(durationSec / 120)); // ~120 sample points per activity

  for (let t = 0; t < durationSec; t += step) {
    const progress = t / durationSec;
    const noiseW = (Math.sin(t / 15) + Math.cos(t / 40)) * 25;
    const noiseHr = (Math.sin(t / 30) + Math.sin(t / 60)) * 6;
    
    // Altitude curve
    const alt = baseAlt + (Math.sin(progress * Math.PI) * altGain) + (Math.random() * 5);
    
    // GPS route wandering around starting point
    const lat = startLat + (Math.sin(progress * Math.PI * 2) * 0.04) + (progress * 0.05);
    const lng = startLng + (Math.cos(progress * Math.PI * 2) * 0.04) + (progress * 0.03);

    points.push({
      time: t,
      watts: Math.max(0, Math.round(baseWatts + noiseW)),
      hr: Math.max(80, Math.round(baseHr + noiseHr + (progress * 8))),
      alt: Math.round(alt),
      lat: Number(lat.toFixed(5)),
      lng: Number(lng.toFixed(5)),
      cadence: baseWatts > 0 ? Math.round(85 + Math.sin(t / 10) * 5) : 0,
      speed: Number((18 + Math.cos(t / 20) * 8).toFixed(1)),
      grade: Number((Math.sin(progress * Math.PI * 4) * 6).toFixed(1))
    });
  }

  return points;
}

export const MOCK_ACTIVITIES: Activity[] = [
  {
    id: 'act-001',
    strava_activity_id: 102938401,
    title: 'Mount Baker Highway Artist Point Simulation',
    sport_type: 'cycling',
    start_date: '2026-10-03T08:30:00Z',
    duration_seconds: 12600, // 3h 30m
    moving_time_seconds: 12100,
    distance_meters: 94500, // 94.5 km
    total_elevation_gain_m: 1420,
    avg_power: 242,
    max_power: 485,
    normalized_power: 272,
    intensity_factor: 0.954,
    training_stress_score: 285,
    avg_hr: 162,
    max_hr: 184,
    avg_cadence: 88,
    max_speed_kmh: 58.4,
    avg_vam_mh: 780,
    map_summary_polyline: 'mock_polyline_baker_cycling',
    time_in_hr_zones: { z1: 600, z2: 2400, z3: 4200, z4: 4800, z5: 600 },
    time_in_power_zones: { z1: 900, z2: 3000, z3: 3600, z4: 4200, z5: 900, z6: 0, z7: 0 },
    gear_notes: 'Canyon Ultimate CF SLX / 50-34 chainrings',
    perceived_exertion: 8,
    knee_discomfort_level: 2,
    streams_data: generateStreams(12600, 255, 162, 180, 1420, 48.775, -122.045)
  },
  {
    id: 'act-002',
    strava_activity_id: 102938402,
    title: 'Colfax Peak Skimo Ascent & Glacier Couloir Drop',
    sport_type: 'skimo',
    start_date: '2026-10-01T06:15:00Z',
    duration_seconds: 17280, // 4h 48m
    moving_time_seconds: 15400,
    distance_meters: 16800, // 16.8 km
    total_elevation_gain_m: 1850,
    avg_hr: 154,
    max_hr: 178,
    avg_vam_mh: 590,
    pack_weight_kg: 11.5,
    perceived_exertion: 9,
    knee_discomfort_level: 3,
    gear_notes: 'Dynafit Blacklight 88 skis + Crampons & Ice Axe',
    time_in_hr_zones: { z1: 1800, z2: 6400, z3: 6800, z4: 2280, z5: 0 },
    streams_data: generateStreams(17280, 0, 154, 1100, 1850, 48.770, -121.812)
  },
  {
    id: 'act-003',
    strava_activity_id: 102938403,
    title: 'Zwift - 4x10m Over-Under Threshold Intervals',
    sport_type: 'zwift',
    start_date: '2026-09-29T18:00:00Z',
    duration_seconds: 4500, // 1h 15m
    moving_time_seconds: 4500,
    distance_meters: 42000,
    total_elevation_gain_m: 320,
    avg_power: 258,
    max_power: 360,
    normalized_power: 288,
    intensity_factor: 1.01,
    training_stress_score: 118,
    avg_hr: 168,
    max_hr: 187,
    avg_cadence: 92,
    perceived_exertion: 9,
    knee_discomfort_level: 0,
    streams_data: generateStreams(4500, 270, 168, 50, 320, 48.00, -122.00)
  },
  {
    id: 'act-004',
    strava_activity_id: 102938404,
    title: 'Mount Shuksan Fisher Chimneys Speed Scramble',
    sport_type: 'scrambling',
    start_date: '2026-09-26T05:30:00Z',
    duration_seconds: 23400, // 6.5 hours
    moving_time_seconds: 21000,
    distance_meters: 18500,
    total_elevation_gain_m: 1680,
    avg_hr: 142,
    max_hr: 171,
    avg_vam_mh: 450,
    pack_weight_kg: 9.5,
    perceived_exertion: 7,
    knee_discomfort_level: 2,
    gear_notes: 'Approach shoes + 30m alpine rope + harness',
    streams_data: generateStreams(23400, 0, 142, 900, 1680, 48.831, -121.602)
  },
  {
    id: 'act-005',
    strava_activity_id: 102938405,
    title: 'Twin Lakes Ridge Weighted Conditioning Carry',
    sport_type: 'weighted_hiking',
    start_date: '2026-09-23T14:00:00Z',
    duration_seconds: 10080, // 2.8 hours
    moving_time_seconds: 9600,
    distance_meters: 9400,
    total_elevation_gain_m: 890,
    avg_hr: 148,
    max_hr: 169,
    avg_vam_mh: 520,
    pack_weight_kg: 15.0,
    perceived_exertion: 8,
    knee_discomfort_level: 4,
    gear_notes: '15kg weighted vest + trekking poles',
    streams_data: generateStreams(10080, 0, 148, 1600, 890, 48.950, -121.640)
  },
  {
    id: 'act-006',
    strava_activity_id: 102938406,
    title: 'North Cascades Early Season Backcountry Recon',
    sport_type: 'backcountry_skiing',
    start_date: '2026-09-20T07:00:00Z',
    duration_seconds: 18720, // 5.2 hours
    moving_time_seconds: 16200,
    distance_meters: 19800,
    total_elevation_gain_m: 1450,
    avg_hr: 146,
    max_hr: 172,
    avg_vam_mh: 480,
    pack_weight_kg: 10.0,
    perceived_exertion: 7,
    knee_discomfort_level: 1,
    streams_data: generateStreams(18720, 0, 146, 1200, 1450, 48.650, -121.720)
  },
  {
    id: 'act-007',
    strava_activity_id: 102938407,
    title: 'Sunday Decompression & Metabolic Flushing Spin',
    sport_type: 'cycling',
    start_date: '2026-09-17T10:00:00Z',
    duration_seconds: 2700, // 45m
    moving_time_seconds: 2700,
    distance_meters: 21000,
    total_elevation_gain_m: 85,
    avg_power: 118,
    max_power: 165,
    normalized_power: 122,
    intensity_factor: 0.428,
    training_stress_score: 18,
    avg_hr: 115,
    max_hr: 128,
    avg_cadence: 96,
    perceived_exertion: 2,
    knee_discomfort_level: 0,
    streams_data: generateStreams(2700, 118, 115, 20, 85, 48.750, -122.480)
  }
];
