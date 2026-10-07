import type { AICoachMessage } from '../types';

/** The synced chat keeps the most recent messages only, so the stored row stays small. */
export const MAX_SYNCED_MESSAGES = 200;

/** Message ids end in the time they were created (user-1730000000000), which gives a stable order across devices. */
function createdAt(message: AICoachMessage): number {
  const match = /(\d{10,})$/.exec(message.id);
  return match ? Number(match[1]) : 0;
}

/** A plan or goal proposal the athlete already acted on: accepted beats declined beats still pending. */
function resolution(message: AICoachMessage): number {
  const score = (p?: { isAccepted?: boolean; isDeclined?: boolean }) => (p?.isAccepted ? 2 : p?.isDeclined ? 1 : 0);
  return Math.max(score(message.proposedPlan), score(message.proposedGoal));
}

/**
 * Combines two copies of the chat (for example this device's and the one stored for the account) into one:
 * every message from either side, in the order it was written. When both have the same message, the one the
 * athlete has already acted on wins, so accepting a proposal on one device shows as accepted on the other.
 */
export function mergeMessages(a: AICoachMessage[], b: AICoachMessage[]): AICoachMessage[] {
  const byId = new Map<string, AICoachMessage>();
  for (const message of [...a, ...b]) {
    const existing = byId.get(message.id);
    if (!existing) {
      byId.set(message.id, message);
      continue;
    }
    const keep = resolution(message) > resolution(existing) ? message : existing;
    // Tool logs are only kept on the device that produced them; don't lose them in a merge
    byId.set(keep.id, keep.toolCalls || !(existing.toolCalls || message.toolCalls) ? keep : { ...keep, toolCalls: existing.toolCalls ?? message.toolCalls });
  }
  return [...byId.values()]
    .filter((message) => !message.isThinking)
    .sort((x, y) => createdAt(x) - createdAt(y));
}

/** What is stored for the account: no greeting, no transient errors, no bulky tool logs, only the latest messages. */
export function toSyncable(messages: AICoachMessage[]): AICoachMessage[] {
  return messages
    .filter((message) => message.id !== 'init-msg' && !message.id.startsWith('err-') && !message.isThinking)
    .map(({ toolCalls: _toolCalls, ...rest }) => rest)
    .slice(-MAX_SYNCED_MESSAGES);
}

export function sameMessages(a: AICoachMessage[], b: AICoachMessage[]): boolean {
  return JSON.stringify(toSyncable(a)) === JSON.stringify(toSyncable(b));
}

/** Rows from the database are untrusted JSON: keep only well-formed messages. */
export function readStoredMessages(value: unknown): AICoachMessage[] {
  if (!Array.isArray(value)) return [];
  return value.filter((m): m is AICoachMessage => (
    Boolean(m) && typeof m.id === 'string' && typeof m.text === 'string'
    && (m.sender === 'user' || m.sender === 'coach' || m.sender === 'system')
  ));
}
