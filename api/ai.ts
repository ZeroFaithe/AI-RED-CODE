import { getAdminClient, createSupabaseServerDeps } from '../server/supabaseServer';
import { handleAiRequest } from '../server/aiHandler';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { token, sessionId, teamId, state, prompt } = req.body || {};

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
}
