/**
 * Vercel Serverless Function: /api/coros
 * Connects the app to the athlete's COROS account through COROS's MCP server, so the coach can read sleep, HRV and
 * recovery. COROS uses standard MCP sign-in (OAuth 2.1 with PKCE); this function does the parts a browser cannot:
 * the code exchange, token refresh and the MCP calls. It stores nothing: tokens live in the athlete's own account
 * (and browser), and are sent per request.
 *
 *   GET  ?action=start                 sends the browser to COROS to approve the connection
 *   GET  ?action=callback              COROS sends the browser back here; the tokens are handed to the page
 *   POST ?action=refresh               { refresh_token, client_id } -> new tokens
 *   POST ?action=call                  Authorization: Bearer <access>; { calls: [{ tool, args }] } or { list: true }
 *
 * Only read-only tools (query*) can be called; nothing here can change anything in the COROS account.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'node:crypto';

export const config = { maxDuration: 30 };

const AUTH_BASE = process.env.COROS_AUTH_BASE || 'https://mcp.coros.com';
const MCP_URL = process.env.COROS_MCP_URL || 'https://mcp.coros.com/mcp';
// A public client (no secret) registered with COROS for this app's redirect address
const CLIENT_ID = process.env.COROS_CLIENT_ID || '04e4fbc1-6034-404f-bcc2-6384d9a9279f';
const REDIRECT_URI = process.env.COROS_REDIRECT_URI || 'https://summit-training-intelligence.vercel.app/api/coros?action=callback';
const SCOPE = 'openid mcp.tools offline_access';
const COOKIE = 'coros_oauth';
const TIMEOUT_MS = 20_000;
const MAX_CALLS = 8;
const MAX_TEXT = 60_000;
const READ_ONLY_TOOL = /^query[A-Za-z0-9]{1,60}$/;
// The only writes the app may ask for: put one workout on the athlete's own account (always after they confirm it)
const WORKOUT_TOOL = /^(createSingleWorkout|createScheduledWorkout)$/;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const b64 = (buf: Buffer) => buf.toString('base64url');

interface Endpoints { authorization_endpoint: string; token_endpoint: string; resource: string }
let cached: Endpoints | undefined;

async function timedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Where to send the athlete and the codes, read from COROS's own published metadata. */
async function endpoints(): Promise<Endpoints> {
  if (cached) return cached;
  const meta = await (await timedFetch(`${AUTH_BASE}/.well-known/oauth-authorization-server`)).json() as Record<string, unknown>;
  let resource = process.env.COROS_RESOURCE || '';
  if (!resource) {
    try {
      const pr = await (await timedFetch(`${AUTH_BASE}/.well-known/oauth-protected-resource/mcp`)).json() as Record<string, unknown>;
      if (typeof pr.resource === 'string') resource = pr.resource;
    } catch { /* the resource indicator is optional */ }
  }
  if (typeof meta.authorization_endpoint !== 'string' || typeof meta.token_endpoint !== 'string') {
    throw new Error('COROS did not publish its sign-in endpoints.');
  }
  cached = { authorization_endpoint: meta.authorization_endpoint, token_endpoint: meta.token_endpoint, resource };
  return cached;
}

interface Tokens { access_token: string; refresh_token?: string; expires_at: number; client_id: string; scope?: string }

async function tokenRequest(form: Record<string, string>, withResource = true): Promise<Tokens> {
  const ep = await endpoints();
  const body = new URLSearchParams({ ...form, client_id: CLIENT_ID });
  if (withResource && ep.resource) body.set('resource', ep.resource);
  const res = await timedFetch(ep.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body });
  const data = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok || typeof data.access_token !== 'string') {
    const error = typeof data.error === 'string' ? data.error : `HTTP ${res.status}`;
    // Some servers reject the resource indicator: try once without it
    if (withResource && ep.resource && /invalid_target|resource/i.test(`${error} ${data.error_description ?? ''}`)) return tokenRequest(form, false);
    throw new Error(`COROS refused the request (${error}${typeof data.error_description === 'string' ? `: ${data.error_description}` : ''}).`);
  }
  return {
    access_token: data.access_token,
    refresh_token: typeof data.refresh_token === 'string' ? data.refresh_token : form.refresh_token,
    expires_at: Date.now() + (typeof data.expires_in === 'number' ? data.expires_in : 3600) * 1000,
    client_id: CLIENT_ID,
    scope: typeof data.scope === 'string' ? data.scope : undefined,
  };
}

const page = (body: string) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>COROS</title><body style="font-family:system-ui;background:#0b1120;color:#e2e8f0;padding:2rem">${body}</body>`;
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

async function start(res: VercelResponse) {
  const ep = await endpoints();
  const verifier = b64(crypto.randomBytes(48));
  const state = b64(crypto.randomBytes(18));
  const url = new URL(ep.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: 'code', client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, scope: SCOPE, state,
    code_challenge: b64(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
    ...(ep.resource ? { resource: ep.resource } : {}),
  }).toString();
  // The verifier never leaves the browser's cookie until COROS sends it back with the code
  res.setHeader('Set-Cookie', `${COOKIE}=${b64(Buffer.from(JSON.stringify({ verifier, state })))}; HttpOnly; Secure; SameSite=Lax; Path=/api/coros; Max-Age=600`);
  res.setHeader('Cache-Control', 'no-store');
  return res.redirect(302, url.toString());
}

async function callback(req: VercelRequest, res: VercelResponse) {
  const code = first(req.query?.code as string | string[] | undefined);
  const state = first(req.query?.state as string | string[] | undefined);
  const denied = first(req.query?.error as string | string[] | undefined);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/api/coros; Max-Age=0`);
  if (denied) return res.status(400).send(page(`<h2>COROS did not connect</h2><p>${escapeHtml(denied)}</p><p><a style="color:#22d3ee" href="/">Back to the app</a></p>`));
  const raw = /(?:^|;\s*)coros_oauth=([^;]+)/.exec(String(req.headers?.cookie ?? ''))?.[1];
  let saved: { verifier?: string; state?: string } = {};
  try { saved = raw ? JSON.parse(Buffer.from(raw, 'base64url').toString()) : {}; } catch { /* handled below */ }
  if (!code || !state || !saved.verifier || saved.state !== state) {
    return res.status(400).send(page('<h2>That sign-in link expired</h2><p>Start the connection again from the app.</p><p><a style="color:#22d3ee" href="/">Back to the app</a></p>'));
  }
  try {
    const tokens = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: saved.verifier });
    // This page is on the app's own address: it hands the connection to the app and returns there
    const json = JSON.stringify(tokens).replace(/</g, '\\u003c');
    return res.status(200).send(page(`<p>Connecting…</p><script>try{localStorage.setItem('summit_coros_tokens',${JSON.stringify(json)});location.replace('/?coros=connected')}catch(e){document.body.textContent='Could not save the connection: '+e}</script>`));
  } catch (err) {
    return res.status(502).send(page(`<h2>COROS did not connect</h2><p>${escapeHtml(err instanceof Error ? err.message : 'Unknown error')}</p><p><a style="color:#22d3ee" href="/">Back to the app</a></p>`));
  }
}

// ── MCP over streamable HTTP ──────────────────────────────────────────────────────────────────────────

class Unauthorized extends Error {}

async function rpc(token: string, session: string | undefined, id: number | undefined, method: string, params?: unknown) {
  const res = await timedFetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`,
      'MCP-Protocol-Version': '2025-06-18', ...(session ? { 'Mcp-Session-Id': session } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', ...(id !== undefined ? { id } : {}), method, ...(params !== undefined ? { params } : {}) }),
  });
  if (res.status === 401 || res.status === 403) throw new Unauthorized(`COROS rejected the access token (HTTP ${res.status}).`);
  if (id === undefined) return { session: res.headers.get('mcp-session-id') ?? session, result: undefined as unknown };
  if (!res.ok) throw new Error(`COROS answered HTTP ${res.status}.`);
  const text = await res.text();
  let message: any;
  if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    for (const block of text.split(/\n\n+/)) {
      const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
      if (!data) continue;
      try { const m = JSON.parse(data); if (m.id === id) message = m; } catch { /* not JSON */ }
    }
  } else {
    try { message = JSON.parse(text); } catch { /* handled below */ }
  }
  if (!message) throw new Error('COROS sent a reply this app could not read.');
  if (message.error) throw new Error(`COROS error: ${String(message.error.message ?? 'unknown')}`);
  return { session: res.headers.get('mcp-session-id') ?? session, result: message.result as any };
}

async function withSession<T>(token: string, run: (call: (method: string, params?: unknown) => Promise<any>) => Promise<T>): Promise<T> {
  let nextId = 1;
  const init = await rpc(token, undefined, nextId++, 'initialize', {
    protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'summit-training-intelligence', version: '1.0' },
  });
  let session = init.session;
  session = (await rpc(token, session, undefined, 'notifications/initialized')).session;
  return run(async (method, params) => {
    const out = await rpc(token, session, nextId++, method, params);
    session = out.session;
    return out.result;
  });
}

const textOf = (result: any): string =>
  (Array.isArray(result?.content) ? result.content : [])
    .map((c: any) => (c?.type === 'text' && typeof c.text === 'string' ? c.text : ''))
    .join('\n')
    .slice(0, MAX_TEXT);

async function call(req: VercelRequest, res: VercelResponse) {
  const token = /^Bearer\s+(.+)$/i.exec(String(req.headers?.authorization ?? ''))?.[1]?.trim();
  if (!token) return res.status(401).json({ error: 'not_connected' });
  const body = (req.body ?? {}) as { list?: boolean; calls?: { tool?: unknown; args?: unknown }[] };
  try {
    if (body.list) {
      const tools = await withSession(token, async (rpcCall) => (await rpcCall('tools/list', {}))?.tools ?? []);
      return res.status(200).json({ tools: (tools as any[]).map((t) => ({ name: t.name, description: String(t.description ?? '').slice(0, 400), inputSchema: t.inputSchema })) });
    }
    const calls = (Array.isArray(body.calls) ? body.calls : []).slice(0, MAX_CALLS);
    for (const c of calls) {
      if (typeof c.tool !== 'string' || !(READ_ONLY_TOOL.test(c.tool) || (WORKOUT_TOOL.test(c.tool) && calls.length === 1))) return res.status(400).json({ error: 'Only COROS queries and sending one workout are allowed.' });
    }
    const results = await withSession(token, async (rpcCall) => {
      const out: { tool: string; ok: boolean; text: string }[] = [];
      for (const c of calls) {
        try {
          const result = await rpcCall('tools/call', { name: c.tool, arguments: c.args && typeof c.args === 'object' ? c.args : {} });
          out.push({ tool: c.tool as string, ok: !result?.isError, text: textOf(result) });
        } catch (err) {
          if (err instanceof Unauthorized) throw err;
          out.push({ tool: c.tool as string, ok: false, text: err instanceof Error ? err.message : 'Failed' });
        }
      }
      return out;
    });
    return res.status(200).json({ results });
  } catch (err) {
    if (err instanceof Unauthorized) return res.status(401).json({ error: 'unauthorized' });
    return res.status(502).json({ error: err instanceof Error ? err.message : 'COROS could not be reached.' });
  }
}

async function refresh(req: VercelRequest, res: VercelResponse) {
  const refreshToken = (req.body as { refresh_token?: unknown } | undefined)?.refresh_token;
  if (typeof refreshToken !== 'string' || !refreshToken) return res.status(400).json({ error: 'Missing refresh_token.' });
  try {
    return res.status(200).json(await tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken }));
  } catch (err) {
    return res.status(401).json({ error: err instanceof Error ? err.message : 'Could not refresh the connection.' });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const action = first(req.query?.action as string | string[] | undefined);
    if (req.method === 'GET' && action === 'start') return await start(res);
    if (req.method === 'GET' && action === 'callback') return await callback(req, res);
    if (req.method === 'POST' && action === 'refresh') return await refresh(req, res);
    if (req.method === 'POST' && action === 'call') return await call(req, res);
    return res.status(404).json({ error: 'Unknown action.' });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'COROS connection failed.' });
  }
}
