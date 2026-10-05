/**
 * Vercel Serverless Function: /api/coach
 * Proxies user queries to Gemini, keeping the API key server-side only.
 * The client sends its pre-fetched training context; Gemini synthesizes the response.
 *
 * Usage: POST /api/coach
 * Body: { message: string, context: CoachContext }
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenerativeAI } from '@google/generative-ai';

const SYSTEM_PROMPT = `You are Summit Intelligence, an elite AI endurance coach specializing in multi-sport mountain athletes. You have deep expertise in:
- Road Cycling, Zwift indoor training, Skimo (ski mountaineering), Backcountry Skiing, Peak Scrambling, Weighted Hiking
- Training load management: CTL (fitness), ATL (fatigue), TSB (form), TSS, FTP-based power metrics
- Injury management — specifically the athlete's left patellar tendonitis and posterior chain tightness
- Mount Baker Hill Climb race preparation (target: 280W / ~4 W/kg)

The user will provide their current training data as JSON context. Use this data to give precise, data-driven coaching advice. Use markdown formatting with headers (###, ####), bold for key numbers, and bullet lists. Be concise and actionable (under 350 words unless a detailed analysis is requested).`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server.' });
  }

  const { message, context } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Missing required field: message' });
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      systemInstruction: SYSTEM_PROMPT,
    });

    const contextBlock = context
      ? `\n\n<athlete_context>\n${JSON.stringify(context, null, 2)}\n</athlete_context>\n\n`
      : '';

    const result = await model.generateContent(`${contextBlock}User question: ${message}`);
    const text = result.response.text();

    return res.status(200).json({ text });
  } catch (err: any) {
    console.error('Gemini API error:', err);
    return res.status(500).json({ error: err.message || 'Failed to get response from Gemini.' });
  }
}
