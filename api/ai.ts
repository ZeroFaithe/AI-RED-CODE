import { getAdminClient, createSupabaseServerDeps } from '../server/supabaseServer.js';
import { handleAiRequest } from '../server/aiHandler.js';

function parseBody(body: any): any {
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return body || {};
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    const { token, sessionId, teamId, state, prompt } = parseBody(req.body);

    if (!token || !sessionId || !teamId || !state) {
      return res.status(400).json({ ok: false, error: 'Missing token, sessionId, teamId, or state' });
    }

    const admin = getAdminClient();
    const deps = createSupabaseServerDeps(admin);

    const who = await deps.authenticate(token);
    if (!who || who.sessionId !== sessionId) {
      return res.status(401).json({ ok: false, error: 'Not signed in to this session' });
    }

    if (who.role === 'team' && who.teamId !== teamId) {
      return res.status(403).json({ ok: false, error: 'Forbidden: not your team' });
    }

    try {
      const rec = await handleAiRequest({ state, prompt: prompt || '' });
      return res.status(200).json({ ok: true, rec });
    } catch (err: any) {
      console.error('handleAiRequest error:', err);
      return res.status(500).json({ ok: false, error: err?.message ?? 'AI request failed' });
    }
  } catch (err: any) {
    console.error('api/ai error:', err);
    return res.status(500).json({ ok: false, error: err?.message || 'Internal server error' });
  }
}

