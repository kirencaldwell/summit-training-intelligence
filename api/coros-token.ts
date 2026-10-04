/**
 * Vercel Serverless Function: /api/coros-token
 * Exchanges a COROS OAuth2 authorization code for access + refresh tokens.
 * The COROS_CLIENT_SECRET env var is kept server-side only (never in VITE_).
 *
 * Usage: GET /api/coros-token?code=XXX&client_id=YYY&redirect_uri=ZZZ
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { code, client_id, redirect_uri } = req.query;
  const clientSecret = process.env.COROS_CLIENT_SECRET;

  if (!code || !client_id || !redirect_uri) {
    return res.status(400).json({ error: 'Missing required query params: code, client_id, redirect_uri' });
  }

  if (!clientSecret) {
    return res.status(500).json({ error: 'COROS_CLIENT_SECRET not configured on server.' });
  }

  try {
    const tokenRes = await fetch('https://open.coros.com/oauth2/accesstoken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(code),
        client_id: String(client_id),
        client_secret: clientSecret,
        redirect_uri: String(redirect_uri),
      }),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      return res.status(tokenRes.status).json({ error: `COROS returned error: ${text}` });
    }

    const json = await tokenRes.json();

    // Forward access_token and refresh_token to the browser
    return res.status(200).json({
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      expires_in: json.expires_in,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
