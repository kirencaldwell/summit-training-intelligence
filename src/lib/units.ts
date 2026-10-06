// Display units are imperial. Data is stored metric (meters, kilometers, kilograms) so existing
// rows and the database schema stay valid; convert at the UI, input and AI boundaries only.

const KM_PER_MI = 1.609344;
const M_PER_FT = 0.3048;
const KG_PER_LB = 0.45359237;

export const kmToMi = (km: number) => km / KM_PER_MI;
export const miToKm = (mi: number) => mi * KM_PER_MI;
export const mToFt = (m: number) => m / M_PER_FT;
export const ftToM = (ft: number) => ft * M_PER_FT;
export const kgToLb = (kg: number) => kg / KG_PER_LB;
export const lbToKg = (lb: number) => lb * KG_PER_LB;
export const kmhToMph = (kmh: number) => kmh / KM_PER_MI;

export const roundTo = (value: number, decimals: number) => {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
};

/** Distance in miles from meters, e.g. "26.2 mi" */
export const formatMilesFromMeters = (m: number) => `${roundTo(kmToMi(m / 1000), 1).toLocaleString()} mi`;
/** Distance in miles from km (goal targets), e.g. "26.2 mi" */
export const formatMilesFromKm = (km: number) => `${roundTo(kmToMi(km), 1).toLocaleString()} mi`;
/** Elevation in whole feet from meters, e.g. "4,230 ft" */
export const formatFeetFromMeters = (m: number) => `${Math.round(mToFt(m)).toLocaleString()} ft`;
/** Climb rate (VAM) in feet per hour from meters per hour */
export const formatFtPerHourFromMph = (mPerHour: number) => `${Math.round(mToFt(mPerHour)).toLocaleString()} ft/h`;
/** Weight in pounds from kilograms, e.g. "180.5 lb" */
export const formatLbFromKg = (kg: number) => `${roundTo(kgToLb(kg), 1)} lb`;

/** Parse an imperial form field into a stored metric value (undefined when empty/non-positive). */
export const parsePositive = (v: string | number): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
