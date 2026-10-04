export function getNextTrainingWeekStartDate(now = new Date()): string {
  const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  let daysUntilMonday = (8 - start.getUTCDay()) % 7;
  if (daysUntilMonday === 0) daysUntilMonday = 7;
  start.setUTCDate(start.getUTCDate() + daysUntilMonday);
  return start.toISOString().slice(0, 10);
}

export function addDaysToDateOnly(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}