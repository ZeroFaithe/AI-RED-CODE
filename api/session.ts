import crypto from 'node:crypto';
import { getAdminClient } from '../server/supabaseServer';
import { verifyHostPasscode } from '../server/hostAuth';
import { newTeamState } from '../shared/sim';

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

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `CR-${code}`;
}

export default async function handler(req: any, res: any) {
  try {
    const method = req.method?.toUpperCase() ?? 'GET';
    const body = parseBody(req.body);

    if (method === 'POST') {
      const { passcode, token, roundTime, checkOnly } = body;

    const valid = verifyHostPasscode(passcode, process.env.HOST_PASSCODE);
    if (checkOnly) {
      return res.status(200).json({ ok: true, valid });
    }

    if (!valid) {
      return res.status(401).json({ ok: false, error: 'Invalid facilitator passcode' });
    }

    if (!token) {
      return res.status(401).json({ ok: false, error: 'Host user token is required' });
    }

    const admin = getAdminClient();
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData?.user) {
      return res.status(401).json({ ok: false, error: 'Could not authenticate host user: ' + (authError?.message ?? 'unknown') });
    }

    const hostUserId = authData.user.id;
    let code = generateRoomCode();

    // Check for collision and retry once
    const { data: existing } = await admin.from('sessions').select('id').eq('code', code).maybeSingle();
    if (existing) {
      code = generateRoomCode();
    }

    const sessionId = crypto.randomUUID();
    const duration = Number(roundTime) || 120;

    const { error: sessErr } = await admin.from('sessions').insert({
      id: sessionId,
      code,
      round: 1,
      status: 'lobby',
      round_ends_at: null,
      host_token: token,
      host_owner: hostUserId,
      round_time: duration,
    });

    if (sessErr) {
      return res.status(500).json({ ok: false, error: 'Failed to create session: ' + sessErr.message });
    }

    // Insert 10 teams and their initial states
    const teams = [];
    const teamStates = [];
    for (let i = 1; i <= 10; i++) {
      const teamId = crypto.randomUUID();
      teams.push({
        id: teamId,
        session_id: sessionId,
        team_num: i,
        name: `Team ${i}`,
        score: 0,
        owner: null,
      });
      teamStates.push({
        team_id: teamId,
        session_id: sessionId,
        state: newTeamState(teamId),
        version: 0,
      });
    }

    const { error: teamErr } = await admin.from('teams').insert(teams);
    if (teamErr) {
      return res.status(500).json({ ok: false, error: 'Failed to create teams: ' + teamErr.message });
    }

    const { error: stateErr } = await admin.from('team_states').insert(teamStates);
    if (stateErr) {
      return res.status(500).json({ ok: false, error: 'Failed to create team states: ' + stateErr.message });
    }

    return res.status(201).json({
      ok: true,
      session: {
        id: sessionId,
        code,
        round: 1,
        status: 'lobby',
        round_time: duration,
      },
      teams,
    });
  }

  if (method === 'PATCH') {
    // Host activates the session (lobby → active) or pauses/resumes
    const { token, sessionId, action } = body;
    if (!token || !sessionId) {
      return res.status(400).json({ ok: false, error: 'token and sessionId are required' });
    }
    const admin = getAdminClient();
    const { data: authData } = await admin.auth.getUser(token);
    if (!authData?.user) {
      return res.status(401).json({ ok: false, error: 'Invalid token' });
    }
    const uid = authData.user.id;

    const { data: sess, error: sessErr } = await admin
      .from('sessions')
      .select('id, round, round_time, status, host_owner')
      .eq('id', sessionId)
      .single();

    if (sessErr || !sess || sess.host_owner !== uid) {
      return res.status(403).json({ ok: false, error: 'Forbidden: not the host of this session' });
    }

    if (action === 'start') {
      const duration = sess.round_time || 120;
      const roundEndsAt = new Date(Date.now() + duration * 1000).toISOString();
      await admin.from('sessions').update({
        status: 'active',
        round_ends_at: roundEndsAt,
      }).eq('id', sessionId);
      return res.status(200).json({ ok: true, round_ends_at: roundEndsAt });
    }

    if (action === 'pause') {
      await admin.from('sessions').update({ status: 'paused' }).eq('id', sessionId);
      return res.status(200).json({ ok: true });
    }

    if (action === 'resume') {
      await admin.from('sessions').update({ status: 'active' }).eq('id', sessionId);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action, expected start|pause|resume' });
  }

  if (method === 'GET') {
    const code = (req.query?.code || '').toString().trim().toUpperCase();
    const id = (req.query?.id || '').toString().trim();

    if (!code && !id) {
      return res.status(400).json({ ok: false, error: 'Provide code or id parameter' });
    }

    const admin = getAdminClient();
    let query = admin.from('sessions').select('id, code, round, status, round_ends_at, round_time, created_at');
    if (code) query = query.eq('code', code);
    if (id) query = query.eq('id', id);

    const { data: session, error } = await query.maybeSingle();
    if (error || !session) {
      return res.status(404).json({ ok: false, error: 'Session not found' });
    }

    const { data: teams } = await admin
      .from('teams')
      .select('id, team_num, name, score, owner')
      .eq('session_id', session.id)
      .order('team_num', { ascending: true });

    return res.status(200).json({ ok: true, session, teams: teams || [] });
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
} catch (err: any) {
  console.error('api/session error:', err);
  return res.status(500).json({ ok: false, error: err?.message || 'Internal server error' });
}
}
