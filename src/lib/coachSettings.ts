// Which AI the coach uses. The Anthropic key lives only in this browser's localStorage and is
// sent with each coach request to this app's own /api/coach function, which forwards it to
// Anthropic. It is never saved on the server or in the database.

export type CoachProvider = 'gemini' | 'claude';

export const CLAUDE_MODEL_OPTIONS = [
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'Fast and cost-effective (default)' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'Most capable, about twice the cost' },
] as const;

const KEYS = {
  provider: 'summit_coach_provider',
  model: 'summit_coach_claude_model',
  apiKey: 'summit_anthropic_api_key',
  workspaceId: 'summit_anthropic_workspace_id',
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
  /** Only needed when the key isn't scoped to a workspace (wrkspc_...) */
  workspaceId?: string;
}

export function getCoachSettings(): CoachSettings {
  const model = read(KEYS.model);
  return {
    provider: read(KEYS.provider) === 'claude' ? 'claude' : 'gemini',
    claudeModel: CLAUDE_MODEL_OPTIONS.some((m) => m.id === model) ? model : CLAUDE_MODEL_OPTIONS[0].id,
    anthropicKey: read(KEYS.apiKey),
    workspaceId: read(KEYS.workspaceId),
  };
}

export function saveCoachSettings(settings: CoachSettings) {
  write(KEYS.provider, settings.provider);
  write(KEYS.model, settings.claudeModel);
  write(KEYS.apiKey, settings.anthropicKey.trim());
  write(KEYS.workspaceId, (settings.workspaceId ?? '').trim());
}

/** Label for the model currently answering, e.g. "Claude Opus 5.5" or "Gemini Flash". */
export function activeCoachLabel(settings: CoachSettings = getCoachSettings()): string {
  if (settings.provider === 'claude') {
    return CLAUDE_MODEL_OPTIONS.find((m) => m.id === settings.claudeModel)?.label ?? 'Claude';
  }
  return 'Gemini Flash';
}

function anthropicHeaders(settings: CoachSettings): Record<string, string> {
  const headers: Record<string, string> = { 'x-anthropic-key': settings.anthropicKey.trim() };
  const workspaceId = settings.workspaceId?.trim();
  if (workspaceId) headers['x-anthropic-workspace-id'] = workspaceId;
  return headers;
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
    headers: anthropicHeaders(settings),
    body: { provider: 'claude', claudeModel: settings.claudeModel },
  };
}

/** A failed call to /api/coach, with the HTTP status so callers can decide whether a retry makes sense. */
export class CoachApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'CoachApiError';
    this.status = status;
  }
}

/**
 * Turn a failed /api/coach response into a readable error. Our own errors are JSON; anything else
 * (a platform timeout page, a crashed function, a missing route) is described by its status instead
 * of being swallowed as an "unknown" error.
 */
export async function readCoachError(res: Response): Promise<CoachApiError> {
  const raw = await res.text().catch(() => '');
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.error === 'string' && parsed.error) return new CoachApiError(parsed.error, res.status);
  } catch {
    /* not JSON: describe it below */
  }

  const snippet = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
  if (res.status === 504 || res.status === 408 || /TIMEOUT|timed out/i.test(raw)) {
    return new CoachApiError(`The coach server timed out (HTTP ${res.status}). Try again; if it keeps happening, the AI provider is responding slowly.`, res.status);
  }
  if (res.status === 413) {
    return new CoachApiError('The request was too large for the coach server (HTTP 413).', res.status);
  }
  if (res.status === 404) {
    return new CoachApiError('The coach endpoint (/api/coach) was not found. It only exists on the deployed site, not in a plain dev server.', res.status);
  }
  return new CoachApiError(
    `The coach server failed (HTTP ${res.status})${snippet ? `: ${snippet}` : ''}. Check the function logs for /api/coach.`,
    res.status
  );
}

/** Verify a key with a tiny request through the app's own server. */
export async function testAnthropicKey(settings: CoachSettings): Promise<void> {
  const res = await fetch('/api/coach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...anthropicHeaders(settings) },
    body: JSON.stringify({ mode: 'ping', provider: 'claude', claudeModel: settings.claudeModel }),
  });
  if (!res.ok) throw await readCoachError(res);
}
