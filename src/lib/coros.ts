import { dataService, isSupabaseConfigured, type CorosConnectionRow } from './supabase';

/**
 * The COROS connection from the app's side. The sign-in itself and every call to COROS go through /api/coros (it holds
 * the parts a browser cannot); this keeps the tokens: in this browser for immediate use, and on the athlete's account
 * so every device is connected. The newest copy wins, and disconnecting is a save too, so it disconnects everywhere.
 */
export interface CorosTokens {
  access_token: string;
  refresh_token?: string;
  /** Milliseconds since the epoch */
  expires_at: number;
  client_id: string;
  scope?: string;
}

const TOKENS_KEY = 'summit_coros_tokens';
const AT_KEY = 'summit_coros_tokens_at';

const readJson = <T,>(key: string): T | null => {
  try { return JSON.parse(localStorage.getItem(key) || 'null') as T | null; } catch { return null; }
};

const valid = (v: unknown): v is CorosTokens =>
  Boolean(v) && typeof v === 'object' && typeof (v as CorosTokens).access_token === 'string' && typeof (v as CorosTokens).expires_at === 'number';

export const readCorosTokens = (): CorosTokens | null => {
  const t = readJson<unknown>(TOKENS_KEY);
  return valid(t) ? t : null;
};
const savedAt = () => { try { return localStorage.getItem(AT_KEY) || undefined; } catch { return undefined; } };

function writeLocal(tokens: CorosTokens | null, at: string) {
  try {
    if (tokens) localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens)); else localStorage.removeItem(TOKENS_KEY);
    localStorage.setItem(AT_KEY, at);
  } catch { /* storage unavailable: the connection lasts for this visit */ }
}

export const isCorosConnected = () => readCorosTokens() !== null;

/** Sends the browser to COROS to approve the connection; COROS sends it back to the app when done. */
export function connectCoros() {
  window.location.href = '/api/coros?action=start';
}

export type CorosAccountStatus = { state: 'unknown' | 'saved' } | { state: 'unavailable' | 'error'; detail: string };
let accountStatus: CorosAccountStatus = { state: 'unknown' };
export const getCorosAccountStatus = () => accountStatus;
function recordError(err: unknown) {
  const detail = err instanceof Error ? err.message : 'Unknown error';
  accountStatus = /coros_connection|schema cache|does not exist/i.test(detail) && !/permission|policy/i.test(detail)
    ? { state: 'unavailable', detail } : { state: 'error', detail };
}

export type CorosReconciliation = 'none' | 'push-local' | 'use-remote' | 'clear-local';

/** Newest copy wins; a connection made on this device (no stamp yet) is uploaded; a removal on another device removes it here. */
export function reconcileCoros(local: { tokens: CorosTokens | null; at?: string }, remote: CorosConnectionRow | null): CorosReconciliation {
  if (!remote || !remote.updated_at) return local.tokens ? 'push-local' : 'none';
  const remoteHas = Boolean(remote.connection && valid(remote.connection));
  if (!local.at) return local.tokens && !remoteHas ? 'push-local' : remoteHas ? 'use-remote' : local.tokens ? 'clear-local' : 'none';
  if (local.at > remote.updated_at) return 'push-local';
  if (local.at < remote.updated_at) return remoteHas ? 'use-remote' : 'clear-local';
  return 'none';
}

type Store = Pick<typeof dataService, 'getCorosConnection' | 'saveCorosConnection'>;

/** Run once the app has loaded: bring this device in line with the account. Returns true when this device changed. */
export async function syncCorosConnection(store: Store = dataService, available = isSupabaseConfigured): Promise<boolean> {
  if (!available) return false;
  try {
    const remote = await store.getCorosConnection();
    const local = { tokens: readCorosTokens(), at: savedAt() };
    const action = reconcileCoros(local, remote);
    if (action === 'use-remote' && remote?.connection && valid(remote.connection)) writeLocal(remote.connection, remote.updated_at ?? new Date().toISOString());
    else if (action === 'clear-local') writeLocal(null, remote?.updated_at ?? new Date().toISOString());
    else if (action === 'push-local') {
      const at = local.at ?? new Date().toISOString();
      if (!local.at) writeLocal(local.tokens, at);
      await store.saveCorosConnection(local.tokens as unknown as Record<string, unknown> | null, at);
    }
    accountStatus = { state: 'saved' };
    return action === 'use-remote' || action === 'clear-local';
  } catch (err) {
    console.warn('The COROS connection could not be synced with the account:', err);
    recordError(err);
    return false;
  }
}

async function persist(tokens: CorosTokens | null, store: Store = dataService, available = isSupabaseConfigured) {
  const at = new Date().toISOString();
  writeLocal(tokens, at);
  if (!available) return;
  try {
    await store.saveCorosConnection(tokens as unknown as Record<string, unknown> | null, at);
    accountStatus = { state: 'saved' };
  } catch (err) {
    console.warn('The COROS connection could not be saved to the account:', err);
    recordError(err);
  }
}

/** Forgets the connection here and on the account. */
export async function disconnectCoros() {
  await persist(null);
}

export class CorosError extends Error {
  /** The connection is gone (revoked or expired for good): the athlete has to connect again */
  reconnect: boolean;
  constructor(message: string, reconnect = false) {
    super(message);
    this.name = 'CorosError';
    this.reconnect = reconnect;
  }
}

async function freshTokens(force = false): Promise<CorosTokens> {
  const tokens = readCorosTokens();
  if (!tokens) throw new CorosError('COROS is not connected.', true);
  if (!force && tokens.expires_at - Date.now() > 60_000) return tokens;
  if (!tokens.refresh_token) {
    await persist(null);
    throw new CorosError('The COROS connection expired. Connect it again.', true);
  }
  const res = await fetch('/api/coros?action=refresh', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: tokens.refresh_token }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !valid(data)) {
    if (res.status === 401) {
      await persist(null);
      throw new CorosError('COROS asked you to sign in again.', true);
    }
    throw new CorosError(typeof data?.error === 'string' ? data.error : `Could not refresh the COROS connection (HTTP ${res.status}).`);
  }
  await persist(data);
  return data;
}

export interface CorosToolResult { tool: string; ok: boolean; text: string }

async function post(tokens: CorosTokens, body: unknown): Promise<Response> {
  return fetch('/api/coros?action=call', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.access_token}` }, body: JSON.stringify(body),
  });
}

async function callCoros<T>(body: unknown): Promise<T> {
  let tokens = await freshTokens();
  let res = await post(tokens, body);
  if (res.status === 401) {
    tokens = await freshTokens(true);
    res = await post(tokens, body);
    if (res.status === 401) throw new CorosError('COROS rejected the connection. Connect it again.', true);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new CorosError(typeof data?.error === 'string' ? data.error : `COROS request failed (HTTP ${res.status}).`);
  return data as T;
}

/** Runs read-only COROS queries (a handful at a time). */
export async function queryCoros(calls: { tool: string; args?: Record<string, unknown> }[]): Promise<CorosToolResult[]> {
  return (await callCoros<{ results: CorosToolResult[] }>({ calls })).results ?? [];
}

export interface CorosTool { name: string; description: string; inputSchema?: { properties?: Record<string, { type?: string; description?: string }> } }

export async function listCorosTools(): Promise<CorosTool[]> {
  return (await callCoros<{ tools: CorosTool[] }>({ list: true })).tools ?? [];
}
