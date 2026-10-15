import type { Activity, ZoneDistribution } from '../types';
import { getLocalDateString } from './trainingSessions';

/**
 * Plain numbers that say how hard a ride really was, for the coach. NP and IF alone mislead on rides made of easy
 * riding plus a few big surges (a stop-and-go commute): the surges inflate NP, so a ride that was mostly easy reads
 * as "IF 0.9". These figures let the coach see the whole shape of the effort.
 */
export interface IntensityCharacter {
  /** Average power as a % of FTP (needs FTP and power) */
  avg_power_percent_ftp?: number;
  /** Average heart rate as a % of lactate threshold HR (needs LTHR and HR) */
  avg_hr_percent_lthr?: number;
  /** Normalized power / average power. About 1.0-1.1 is steady; above ~1.2 means surges dominate NP */
  variability_index?: number;
  /** Share of time in power zones 1-2 (easy / endurance), of the time with zone data */
  percent_time_power_z1_z2?: number;
  /** Share of time in power zones 5 and above (VO2 / anaerobic / sprint) */
  percent_time_power_z5_plus?: number;
  percent_time_hr_z1_z2?: number;
  /** A one-line reading of the numbers above, so the shape of the ride is not left to NP/IF alone */
  reading: string;
}

const total = (z?: ZoneDistribution) => (z ? Object.values(z).reduce((a, b) => a + (b ?? 0), 0) : 0);
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : undefined);

export function intensityCharacter(
  a: Pick<Activity, 'avg_power' | 'normalized_power' | 'avg_hr' | 'time_in_power_zones' | 'time_in_hr_zones'>,
  profile: { ftp?: number; lthr?: number },
): IntensityCharacter | undefined {
  const pz = a.time_in_power_zones;
  const hz = a.time_in_hr_zones;
  const out: Omit<IntensityCharacter, 'reading'> = {};

  if (a.avg_power && profile.ftp) out.avg_power_percent_ftp = Math.round((a.avg_power / profile.ftp) * 100);
  if (a.avg_hr && profile.lthr) out.avg_hr_percent_lthr = Math.round((a.avg_hr / profile.lthr) * 100);
  if (a.avg_power && a.normalized_power) out.variability_index = Math.round((a.normalized_power / a.avg_power) * 100) / 100;
  if (pz && total(pz) > 0) {
    out.percent_time_power_z1_z2 = pct(pz.z1 + pz.z2, total(pz));
    out.percent_time_power_z5_plus = pct(pz.z5 + (pz.z6 ?? 0) + (pz.z7 ?? 0), total(pz));
  }
  if (hz && total(hz) > 0) out.percent_time_hr_z1_z2 = pct(hz.z1 + hz.z2, total(hz));
  if (Object.keys(out).length === 0) return undefined;

  const vi = out.variability_index;
  const easyPower = out.percent_time_power_z1_z2;
  const easyHr = out.percent_time_hr_z1_z2;
  const mostlyEasy = (easyPower ?? easyHr ?? 0) >= 70 && (easyHr ?? easyPower ?? 0) >= 60;
  let reading: string;
  if (vi !== undefined && vi >= 1.2 && mostlyEasy) {
    reading = `Mostly easy riding with brief surges: variability index ${vi} means the surges inflate normalized power and IF, so they overstate the ride's overall load. Judge it by average power/HR and time in zones.`;
  } else if (vi !== undefined && vi >= 1.2) {
    reading = `Variable ride (variability index ${vi}): normalized power sits well above average power.`;
  } else if (mostlyEasy) {
    reading = 'Steady, mostly easy ride.';
  } else {
    reading = 'Sustained moderate-to-hard effort across the ride.';
  }
  return { ...out, reading };
}

/** Other activities of the same sport on the same date, with their combined duration and TSS. */
export function sameDayTotals<T extends Pick<Activity, 'id' | 'start_date' | 'sport_type' | 'duration_seconds'>>(
  activity: T,
  all: T[],
  tssOf: (a: T) => number,
) {
  // The athlete's local day: a morning and an evening ride in the same day must not split across UTC dates
  const localDay = (a: T) => getLocalDateString(new Date(a.start_date));
  const day = localDay(activity);
  const group = all.filter((a) => a.sport_type === activity.sport_type && localDay(a) === day);
  if (!group.some((a) => a.id === activity.id)) group.push(activity);
  return {
    rides: group.length,
    combined_duration_minutes: Math.round(group.reduce((s, a) => s + a.duration_seconds, 0) / 60),
    combined_tss: Math.round(group.reduce((s, a) => s + tssOf(a), 0)),
  };
}
