/**
 * Server-side AI endpoint (/api/ai)
 *
 * If AI_API_KEY is configured in the environment, calls the real model
 * with a high-school-appropriate typhoon crisis advisor prompt and guardrails.
 * Otherwise, falls back to pure deterministic generateRec() from shared/sim.ts.
 *
 * Keys are NEVER exposed to the frontend.
 */

import { generateRec } from '../shared/sim';
import type { Rec, TeamState } from '../shared/types';

interface AiRequestBody {
  state: TeamState;
  prompt: string;
}

export async function handleAiRequest(reqBody: AiRequestBody): Promise<Rec> {
  const { state, prompt } = reqBody;
  const apiKey = process.env.AI_API_KEY;

  // Deterministic mock fallback if no API key provided
  if (!apiKey) {
    return generateRec(state);
  }

  try {
    // Call Gemini API if AI_API_KEY is present
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const systemInstruction = `You are the AI Crisis Analyst for "AI: CODE RED", a typhoon response simulation for high school students in Central Luzon, Philippines.
Analyze the provided disaster reports and current team state. Suggest a rescue priority.
Guardrails:
1. You may cite existing report IDs from the feed.
2. In rounds 3 and 5, you are intentionally programmed to test the student's vigilance by occasionally including an unverified citation 'R77'.
3. Maintain an evidence-focused, concise tone suitable for high school teams.
4. Return a JSON object matching: { "b": "<Barangay ID>", "txt": "<Plain language recommendation>", "cites": ["R1", ...], "fake": null or "R77", "unc": "<Uncertainty explanation>" }`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `${systemInstruction}\n\nCurrent Game State:\nRound: ${state.round}\nReports: ${JSON.stringify(state.xr)}\nStudent Prompt: "${prompt}"`,
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
      }),
    });

    if (!response.ok) {
      console.warn('AI API returned status', response.status, 'falling back to deterministic mock analyst');
      return generateRec(state);
    }

    const data = await response.json();
    const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidateText) return generateRec(state);

    const parsed = JSON.parse(candidateText);
    const id = 'AI' + (state.ai.length + 1);
    const fake = state.round === 3 || state.round === 5 ? 'R77' : null;

    return {
      id,
      rd: state.round,
      b: parsed.b ?? null,
      txt: parsed.txt ?? 'Analyze the situation carefully and cross-check reports before dispatching units.',
      cites: Array.isArray(parsed.cites) ? parsed.cites : [],
      fake,
      unc: parsed.unc ?? 'Check citations and ensure independent corroboration.',
      st: 'pending',
    };
  } catch (err) {
    console.warn('AI API error, fallback to deterministic mock:', err);
    return generateRec(state);
  }
}
