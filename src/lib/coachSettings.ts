// Which AI the coach uses. This browser keeps the working copy of the settings and the Anthropic key in localStorage
// (the rest of the code reads them synchronously) and sends the key with each coach request to this app's own
// /api/coach function, which forwards it to Anthropic. The server never stores it. With an account (Supabase) the
// settings are also kept on the athlete's account row, protected by row-level security, so every device they sign in
// on uses the same coach; the athlete can turn that off, which also removes the key from the account.
import { dataService, isSupabaseConfigured, type CoachIntegration } from './supabase';

export type CoachProvider = 'gemini' | 'claude';

export const CLAUDE_MODEL_OPTIONS = [
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'Fast and cost-effective (default)' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'Most capable, about twice the cost' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'Fastest and cheapest, lighter coaching' },
] as const;

const KEYS = {
  provider: 'summit_coach_provider',
  model: 'summit_coach_claude_model',
  apiKey: 'summit_anthropic_api_key',
  workspaceId: 'summit_anthropic_workspace_id',
  savedAt: 'summit_coach_settings_at',
  sync: 'summit_coach_sync',
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

/** Saves the settings on this device and stamps when, so the newest copy (here or on the account) can win. */
export function saveCoachSettings(settings: CoachSettings, at: string = new Date().toISOString()) {
  write(KEYS.provider, settings.provider);
  write(KEYS.model, settings.claudeModel);
  write(KEYS.apiKey, settings.anthropicKey.trim());
  write(KEYS.workspaceId, (settings.workspaceId ?? '').trim());
  write(KEYS.savedAt, at);
}

// ── Keeping the settings with the account ────────────────────────────────────────────────────────────

/** Whether this device keeps the coach settings (and key) on the account. On unless the athlete turned it off. */
export const getCoachSyncEnabled = (): boolean => isSupabaseConfigured && read(KEYS.sync) !== 'off';
export function setCoachSyncEnabled(on: boolean) {
  write(KEYS.sync, on ? '' : 'off');
}

export type CoachAccountStatus =
  | { state: 'unknown' }
  | { state: 'saved' }
  | { state: 'off' }
  | { state: 'unavailable'; detail: string }
  | { state: 'error'; detail: string };

let accountStatus: CoachAccountStatus = { state: 'unknown' };
export const getCoachAccountStatus = (): CoachAccountStatus => accountStatus;

function recordAccountError(err: unknown) {
  const detail = err instanceof Error ? err.message : 'Unknown error';
  // Missing columns are a setup step; anything else (offline, expired session, permissions) is a problem to show
  accountStatus = /coach_settings_at|coach_provider|anthropic_api_key|anthropic_workspace|coach_claude_model|schema cache|does not exist/i.test(detail) && !/permission|policy/i.test(detail)
    ? { state: 'unavailable', detail }
    : { state: 'error', detail };
}

export type CoachReconciliation =
  | { action: 'none' }
  /** The account has nothing for this athlete yet, or this device is newer: upload this device's settings */
  | { action: 'push-local' }
  /** The account's copy is newer (or this device never saved any): take it */
  | { action: 'use-remote' };

/**
 * How this device's coach settings and the account's fit together: the newest copy wins. A removal is a save too (an
 * empty key with a newer time), so removing the key on one device removes it everywhere. A device that has a key from
 * before settings were stamped keeps it if the account has none.
 */
export function reconcileCoachSettings(
  local: { settings: CoachSettings; at?: string },
  remote: CoachIntegration | null,
): CoachReconciliation {
  const localHasContent = Boolean(local.settings.anthropicKey) || local.settings.provider === 'claude';
  if (!remote || !remote.updated_at) return localHasContent ? { action: 'push-local' } : { action: 'none' };
  if (!local.at) return local.settings.anthropicKey && !remote.anthropic_api_key ? { action: 'push-local' } : { action: 'use-remote' };
  if (local.at > remote.updated_at) return { action: 'push-local' };
  if (local.at < remote.updated_at) return { action: 'use-remote' };
  return { action: 'none' };
}

type CoachStore = Pick<typeof dataService, 'getCoachIntegration' | 'saveCoachIntegration'>;

const toIntegration = (s: CoachSettings): Omit<CoachIntegration, 'updated_at'> => ({
  provider: s.provider,
  claude_model: s.claudeModel,
  anthropic_api_key: s.anthropicKey.trim() || null,
  workspace_id: s.workspaceId?.trim() || null,
});

/** Run once the app has loaded: bring this device in line with the account. Returns true when this device changed. */
export async function syncCoachSettings(
  store: CoachStore = dataService,
  opts: { available: boolean; sync: boolean } = { available: isSupabaseConfigured, sync: getCoachSyncEnabled() },
): Promise<boolean> {
  if (!opts.available) return false;
  if (!opts.sync) { accountStatus = { state: 'off' }; return false; }
  try {
    const remote = await store.getCoachIntegration();
    const local = { settings: getCoachSettings(), at: read(KEYS.savedAt) || undefined };
    const outcome = reconcileCoachSettings(local, remote);
    let changed = false;
    if (outcome.action === 'use-remote' && remote) {
      const model = remote.claude_model && CLAUDE_MODEL_OPTIONS.some((m) => m.id === remote.claude_model) ? remote.claude_model : local.settings.claudeModel;
      saveCoachSettings({ provider: remote.provider ?? 'gemini', claudeModel: model, anthropicKey: remote.anthropic_api_key ?? '', workspaceId: remote.workspace_id ?? '' }, remote.updated_at ?? undefined);
      changed = true;
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('summit:coach-settings'));
    } else if (outcome.action === 'push-local') {
      const at = local.at ?? new Date().toISOString();
      if (!local.at) write(KEYS.savedAt, at);
      await store.saveCoachIntegration(toIntegration(local.settings), at);
    }
    accountStatus = { state: 'saved' };
    return changed;
  } catch (err) {
    console.warn('Coach settings could not be synced with the account:', err);
    recordAccountError(err);
    return false;
  }
}

/**
 * Saves the settings on the account (or, when this device keeps them local, removes the key from it). Never throws:
 * the outcome is in the account status.
 */
export async function saveCoachSettingsToAccount(
  settings: CoachSettings,
  store: CoachStore = dataService,
  opts: { available: boolean; sync: boolean } = { available: isSupabaseConfigured, sync: getCoachSyncEnabled() },
): Promise<void> {
  if (!opts.available) return;
  const sync = opts.sync;
  try {
    const at = read(KEYS.savedAt) || new Date().toISOString();
    // Keeping the key on this device only also means it must not stay on the account
    await store.saveCoachIntegration(sync ? toIntegration(settings) : { ...toIntegration(settings), anthropic_api_key: null, workspace_id: null }, at);
    accountStatus = sync ? { state: 'saved' } : { state: 'off' };
  } catch (err) {
    console.warn('Coach settings could not be saved to the account:', err);
    recordAccountError(err);
  }
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
