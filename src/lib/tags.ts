export const MAX_TAGS_PER_ACTIVITY = 20;
export const MAX_TAG_LENGTH = 30;

/** Trim, drop a leading '#', collapse spaces, cap length, de-duplicate case-insensitively (first spelling wins). */
export function normalizeTags(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const tag = entry.replace(/^#+/, '').replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LENGTH);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_TAGS_PER_ACTIVITY) break;
  }
  return out;
}

/** Every distinct tag across activities (case-insensitive), most used first, then alphabetical. */
export function collectTags(activities: { tags?: string[] }[]): string[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const activity of activities) {
    for (const tag of activity.tags ?? []) {
      const key = tag.toLowerCase();
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { label: tag, count: 1 });
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .map((entry) => entry.label);
}
