import { getAdminClient, createSupabaseServerDeps } from '../server/supabaseServer';
import { handleAuthoritativeAction, type ActionRequest } from '../server/actionHandler';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const body = (req.body || {}) as ActionRequest;
  const { token, sessionId, teamId, action } = body;

  if (!token || !sessionId || !teamId || !action) {
    return res.status(400).json({ ok: false, error: 'Missing token, sessionId, teamId, or action' });
  }

  const admin = getAdminClient();
  const deps = createSupabaseServerDeps(admin);

  // Authenticate principal
  const who = await deps.authenticate(token);
  if (!who || who.sessionId !== sessionId) {
    return res.status(401).json({ ok: false, error: 'Not signed in to this session' });
  }

  // Handle Host-specific session status actions (pause / resume)
  if (who.role === 'host' && action.type === 'pause' as any) {
    const isPaused = Boolean((action as any).paused);
    const newStatus = isPaused ? 'paused' : 'active';
    await admin.from('sessions').update({ status: newStatus }).eq('id', sessionId);
    return res.status(200).json({ ok: true, status: 200, sessionStatus: newStatus });
  }

  // Execute authoritative action
  const out = await handleAuthoritativeAction(deps, body);

  // If host advanced the round, update session round and round_ends_at
  if (out.ok && who.role === 'host' && action.type === 'advance') {
    const { data: sess } = await admin.from('sessions').select('round, round_time, status').eq('id', sessionId).single();
    if (sess) {
      const currentRound = sess.round || 1;
      const isFinished = currentRound >= 5;
      const nextRound = isFinished ? 5 : currentRound + 1;
      const duration = sess.round_time || 120;
      const roundEndsAt = isFinished ? null : new Date(Date.now() + duration * 1000).toISOString();
      const status = isFinished ? 'finished' : 'active';

      await admin.from('sessions').update({
        round: nextRound,
        status,
        round_ends_at: roundEndsAt,
      }).eq('id', sessionId);
    }
  }

  return res.status(out.status).json(out);
}
