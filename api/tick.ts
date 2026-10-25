import { getAdminClient, createSupabaseServerDeps } from '../server/supabaseServer.js';
import { processDueArrivals } from '../server/actionHandler.js';
import { total } from '../shared/scoring.js';

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
    const body = parseBody(req.body);
    const sessionId = (req.query?.sessionId || body?.sessionId || '').toString();
    const teamId = (req.query?.teamId || body?.teamId || '').toString();

    if (!sessionId || !teamId) {
      return res.status(400).json({ ok: false, error: 'sessionId and teamId are required' });
    }

    const admin = getAdminClient();
    const deps = createSupabaseServerDeps(admin);

    // Process any units whose travel time has elapsed
    const cur = await processDueArrivals(deps, sessionId, teamId);

    // Fetch session status & countdown
    const { data: sess } = await admin
      .from('sessions')
      .select('round, status, round_ends_at, round_time')
      .eq('id', sessionId)
      .maybeSingle();

    if (!cur) {
      return res.status(404).json({ ok: false, error: 'Team state not found', session: sess });
    }

    return res.status(200).json({
      ok: true,
      state: cur.state,
      version: cur.version,
      score: Math.round(total(cur.state).all),
      session: sess,
    });
  } catch (err: any) {
    console.error('api/tick error:', err);
    return res.status(500).json({ ok: false, error: err?.message || 'Internal server error' });
  }
}

