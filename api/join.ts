import { getAdminClient } from '../server/supabaseServer';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { token, sessionCode, sessionId, teamName, teamNum } = req.body || {};

  if (!token) {
    return res.status(401).json({ ok: false, error: 'Authentication token required' });
  }

  const cleanName = (teamName || '').toString().trim();
  if (!cleanName) {
    return res.status(400).json({ ok: false, error: 'Team name is required' });
  }

  const admin = getAdminClient();
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData?.user) {
    return res.status(401).json({ ok: false, error: 'Could not authenticate user: ' + (authError?.message ?? 'unknown') });
  }

  const userId = authData.user.id;

  // Resolve session
  let sessQuery = admin.from('sessions').select('id, code, status');
  if (sessionId) {
    sessQuery = sessQuery.eq('id', sessionId);
  } else if (sessionCode) {
    sessQuery = sessQuery.eq('code', sessionCode.toString().trim().toUpperCase());
  } else {
    return res.status(400).json({ ok: false, error: 'Provide sessionCode or sessionId' });
  }

  const { data: session, error: sessErr } = await sessQuery.maybeSingle();
  if (sessErr || !session) {
    return res.status(404).json({ ok: false, error: 'Session not found' });
  }

  // Check if student already owns a team in this session (reconnection path)
  const { data: existingTeam } = await admin
    .from('teams')
    .select('id, team_num, name, session_id')
    .eq('session_id', session.id)
    .eq('owner', userId)
    .maybeSingle();

  if (existingTeam) {
    return res.status(200).json({
      ok: true,
      sessionId: session.id,
      sessionCode: session.code,
      teamId: existingTeam.id,
      teamNum: existingTeam.team_num,
      teamName: existingTeam.name,
      reconnected: true,
    });
  }

  // Get all teams in this session
  const { data: allTeams, error: teamsErr } = await admin
    .from('teams')
    .select('id, team_num, name, owner')
    .eq('session_id', session.id)
    .order('team_num', { ascending: true });

  if (teamsErr || !allTeams) {
    return res.status(500).json({ ok: false, error: 'Could not retrieve session teams' });
  }

  // Reject duplicate team names among claimed teams
  const nameLower = cleanName.toLowerCase();
  const duplicate = allTeams.some(t => t.owner && t.name.trim().toLowerCase() === nameLower);
  if (duplicate) {
    return res.status(400).json({ ok: false, error: 'This team name already exists in this session' });
  }

  // Determine target slot
  let targetSlot = null;
  if (teamNum) {
    targetSlot = allTeams.find(t => t.team_num === Number(teamNum));
    if (!targetSlot) {
      return res.status(400).json({ ok: false, error: 'Invalid team slot number' });
    }
    if (targetSlot.owner) {
      return res.status(409).json({ ok: false, error: `Team slot ${teamNum} is already taken` });
    }
  } else {
    targetSlot = allTeams.find(t => !t.owner);
    if (!targetSlot) {
      return res.status(409).json({ ok: false, error: 'Session is full (all 10 slots taken)' });
    }
  }

  // Atomically claim the slot
  const { data: claimed, error: claimErr } = await admin
    .from('teams')
    .update({
      owner: userId,
      name: cleanName,
      updated_at: new Date().toISOString(),
    })
    .eq('id', targetSlot.id)
    .is('owner', null)
    .select('id, team_num, name')
    .maybeSingle();

  if (claimErr || !claimed) {
    return res.status(409).json({ ok: false, error: 'Slot was claimed by another team, please try again' });
  }

  return res.status(200).json({
    ok: true,
    sessionId: session.id,
    sessionCode: session.code,
    teamId: claimed.id,
    teamNum: claimed.team_num,
    teamName: claimed.name,
  });
}
