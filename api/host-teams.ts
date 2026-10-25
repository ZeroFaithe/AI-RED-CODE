import { getAdminClient, createSupabaseServerDeps } from '../server/supabaseServer.js';

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
    const token = (req.headers?.authorization?.replace(/^Bearer\s+/i, '') || req.query?.token || body?.token || '').toString();
    const sessionId = (req.query?.sessionId || body?.sessionId || '').toString();

    if (!token || !sessionId) {
      return res.status(400).json({ ok: false, error: 'token and sessionId are required' });
    }

    const admin = getAdminClient();
    const deps = createSupabaseServerDeps(admin);

    const who = await deps.authenticate(token);
    if (!who || who.role !== 'host' || who.sessionId !== sessionId) {
      return res.status(403).json({ ok: false, error: 'Forbidden: host access only' });
    }

    const { data: session, error: sessErr } = await admin
      .from('sessions')
      .select('id, code, round, status, round_ends_at, round_time, created_at')
      .eq('id', sessionId)
      .single();

    if (sessErr || !session) {
      return res.status(404).json({ ok: false, error: 'Session not found' });
    }

    const { data: teams, error: teamsErr } = await admin
      .from('teams')
      .select('id, team_num, name, score, owner, updated_at')
      .eq('session_id', sessionId)
      .order('team_num', { ascending: true });

    if (teamsErr) {
      return res.status(500).json({ ok: false, error: 'Could not fetch teams' });
    }

    const { data: states } = await admin
      .from('team_states')
      .select('team_id, state, version, updated_at')
      .eq('session_id', sessionId);

    const statesMap = Object.fromEntries((states || []).map(s => [s.team_id, s.state]));

    const enrichedTeams = (teams || []).map(t => ({
      ...t,
      state: statesMap[t.id] || null,
    }));

    return res.status(200).json({
      ok: true,
      session,
      teams: enrichedTeams,
    });
  } catch (err: any) {
    console.error('api/host-teams error:', err);
    return res.status(500).json({ ok: false, error: err?.message || 'Internal server error' });
  }
}

