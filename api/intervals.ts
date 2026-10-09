/**
 * Vercel Serverless Function: /api/intervals
 * A narrow read-only proxy to the Intervals.icu API, so the browser doesn't need CORS access to it.
 * The athlete's API key is sent per request in the x-intervals-key header and is never stored or logged.
 *
 * Usage: GET /api/intervals?path=athlete/0/activities&oldest=2025-01-01&newest=2025-02-01&fields=id,name
 *        GET /api/intervals?path=activity/<id>/file
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { maxDuration: 30 };

const BASE_URL = 'https://intervals.icu/api/v1';
const TIMEOUT_MS = 25_000;
// Vercel caps a function response at 4.5 MB
const MAX_BYTES = 4_400_000;

// Only these two read-only shapes are forwarded; anything else is refused.
const ALLOWED_PATHS = [
  /^athlete\/(0|[A-Za-z0-9]{1,20})\/activities$/,
  /^activity\/[A-Za-z0-9_-]{1,40}\/(file|fit-file)$/,
];
const DATE = /^\d{4}-\d{2}-\d{2}(T[\d:]{5,8})?$/;
const FIELDS = /^[A-Za-z0-9_,]{1,600}$/;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const key = first(req.headers?.['x-intervals-key'] as string | string[] | undefined)?.trim();
    if (!key) return res.status(401).json({ error: 'Missing your Intervals.icu API key.' });

    const path = first(req.query?.path as string | string[] | undefined) ?? '';
    if (!ALLOWED_PATHS.some((pattern) => pattern.test(path))) {
      return res.status(400).json({ error: 'That Intervals.icu path is not allowed.' });
    }

    const params = new URLSearchParams();
    for (const [name, pattern] of [['oldest', DATE], ['newest', DATE], ['fields', FIELDS]] as const) {
      const value = first(req.query?.[name] as string | string[] | undefined);
      if (!value) continue;
      if (!pattern.test(value)) return res.status(400).json({ error: `Invalid ${name} parameter.` });
      params.set(name, value);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let upstream: Response;
    try {
      upstream = await fetch(`${BASE_URL}/${path}${params.size ? `?${params}` : ''}`, {
        headers: {
          // Intervals.icu API keys use basic auth with the literal username "API_KEY"
          Authorization: `Basic ${Buffer.from(`API_KEY:${key}`).toString('base64')}`,
          Accept: path.endsWith('/activities') ? 'application/json' : '*/*',
        },
        signal: controller.signal,
      });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'AbortError';
      return res.status(504).json({ error: timedOut ? 'Intervals.icu took too long to respond. Try again.' : 'Could not reach Intervals.icu.' });
    } finally {
      clearTimeout(timer);
    }

    if (upstream.status === 401 || upstream.status === 403) {
      return res.status(401).json({ error: 'Intervals.icu rejected the API key. Check it in Intervals.icu settings.' });
    }
    if (upstream.status === 404) return res.status(404).json({ error: 'Intervals.icu has no such activity or file.' });
    if (upstream.status === 429) return res.status(429).json({ error: 'Intervals.icu rate limit reached. Wait a moment and try again.' });
    if (!upstream.ok) return res.status(502).json({ error: `Intervals.icu returned an error (${upstream.status}).` });

    const bytes = Buffer.from(await upstream.arrayBuffer());
    if (bytes.length > MAX_BYTES) return res.status(413).json({ error: 'That file is too large to fetch through the app.' });

    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(bytes);
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unexpected server error.' });
  }
}
