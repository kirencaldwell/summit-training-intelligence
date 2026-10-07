export function getNextTrainingWeekStartDate(now = new Date()): string {
  const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  let daysUntilMonday = (8 - start.getUTCDay()) % 7;
  if (daysUntilMonday === 0) daysUntilMonday = 7;
  start.setUTCDate(start.getUTCDate() + daysUntilMonday);
  return start.toISOString().slice(0, 10);
}

export function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** The Monday on or before a YYYY-MM-DD date. */
export function getWeekStartDate(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Today's date in the athlete's own time zone, as YYYY-MM-DD. */
export function getLocalDateString(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function getCurrentTrainingWeekStartDate(now = new Date()): string {
  return getWeekStartDate(getLocalDateString(now));
}

export function addDaysToDateOnly(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}