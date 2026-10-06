// Which AI the coach uses. The Anthropic key lives only in this browser's localStorage and is
// sent with each coach request to this app's own /api/coach function, which forwards it to
// Anthropic. It is never saved on the server or in the database.

export type CoachProvider = 'gemini' | 'claude';

export const CLAUDE_MODEL_OPTIONS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'Most capable (default)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'Faster and about half the cost' },
] as const;

const KEYS = {
  provider: 'summit_coach_provider',
  model: 'summit_coach_claude_model',
  apiKey: 'summit_anthropic_api_key',
};

const read = (key: string): string => {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
};

const write = (key: string, value: string) => {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* storage unavailable (private mode): settings simply won't persist */
  }
};

export interface CoachSettings {
  provider: CoachProvider;
  claudeModel: string;
  anthropicKey: string;
}

export function getCoachSettings(): CoachSettings {
  const model = read(KEYS.model);
  return {
    provider: read(KEYS.provider) === 'claude' ? 'claude' : 'gemini',
    claudeModel: CLAUDE_MODEL_OPTIONS.some((m) => m.id === model) ? model : CLAUDE_MODEL_OPTIONS[0].id,
    anthropicKey: read(KEYS.apiKey),
  };
}

export function saveCoachSettings(settings: CoachSettings) {
  write(KEYS.provider, settings.provider);
  write(KEYS.model, settings.claudeModel);
  write(KEYS.apiKey, settings.anthropicKey.trim());
}

/** Label for the model currently answering, e.g. "Claude Opus 5.5" or "Gemini Flash". */
export function activeCoachLabel(settings: CoachSettings = getCoachSettings()): string {
  if (settings.provider === 'claude') {
    return CLAUDE_MODEL_OPTIONS.find((m) => m.id === settings.claudeModel)?.label ?? 'Claude';
  }
  return 'Gemini Flash';
}

/**
 * Extra request pieces for /api/coach: which provider to use, and the Anthropic key as a header
 * (kept out of the JSON body). Throws a readable error when Claude is selected without a key.
 */
export function coachRequestExtras(): { headers: Record<string, string>; body: Record<string, string> } {
  const settings = getCoachSettings();
  if (settings.provider !== 'claude') return { headers: {}, body: { provider: 'gemini' } };
  if (!settings.anthropicKey) {
    throw new Error('Claude is selected but no Anthropic API key is saved. Add one in Coach Settings.');
  }
  return {
    headers: { 'x-anthropic-key': settings.anthropicKey },
    body: { provider: 'claude', claudeModel: settings.claudeModel },
  };
}

/** Verify a key with a tiny request through the app's own server. */
export async function testAnthropicKey(settings: CoachSettings): Promise<void> {
  const res = await fetch('/api/coach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-anthropic-key': settings.anthropicKey.trim() },
    body: JSON.stringify({ mode: 'ping', provider: 'claude', claudeModel: settings.claudeModel }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `Server returned ${res.status}` }));
    throw new Error(err.error || `Server returned ${res.status}`);
  }
}
