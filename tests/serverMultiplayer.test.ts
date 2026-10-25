import { describe, expect, it } from 'vitest';
import { newTeamState } from '../shared/sim';
import { total } from '../shared/scoring';
import {
  handleAuthoritativeAction,
  handleSystemArrive,
  processDueArrivals,
  type ServerDeps,
  type Principal,
  type Versioned,
} from '../server/actionHandler';
import { verifyHostPasscode } from '../server/hostAuth';
import type { Action } from '../shared/types';

interface FakeDb {
  sessions: Map<string, { id: string; code: string; round: number; status: string; host_owner: string; round_time: number }>;
  teams: Map<string, { id: string; session_id: string; team_num: number; name: string; score: number; owner: string | null }>;
  teamStates: Map<string, Versioned>;
  users: Map<string, { id: string; email?: string }>;
}

function createFakeServer(hostPasscode = 'FACILITATOR_PASS_2026') {
  const db: FakeDb = {
    sessions: new Map(),
    teams: new Map(),
    teamStates: new Map(),
    users: new Map(),
  };

  const stateKey = (sessionId: string, teamId: string) => `${sessionId}/${teamId}`;

  const deps: ServerDeps = {
    async authenticate(token: string): Promise<Principal | null> {
      if (!token) return null;
      const user = db.users.get(token);
      if (!user) return null;

      // Check if user is host of any session
      for (const sess of db.sessions.values()) {
        if (sess.host_owner === user.id) {
          return { role: 'host', sessionId: sess.id };
        }
      }

      // Check if user owns a team
      for (const team of db.teams.values()) {
        if (team.owner === user.id) {
          return { role: 'team', sessionId: team.session_id, teamId: team.id };
        }
      }

      return null;
    },

    async loadTeamState(sessionId: string, teamId: string): Promise<Versioned | null> {
      return db.teamStates.get(stateKey(sessionId, teamId)) ?? null;
    },

    async saveTeamState(
      sessionId: string,
      teamId: string,
      state: any,
      score: number,
      expectedVersion: number
    ): Promise<boolean> {
      const cur = db.teamStates.get(stateKey(sessionId, teamId));
      if (!cur || cur.version !== expectedVersion) return false;

      db.teamStates.set(stateKey(sessionId, teamId), {
        state: structuredClone(state),
        version: expectedVersion + 1,
      });

      const team = db.teams.get(teamId);
      if (team) {
        team.score = score;
      }
      return true;
    },

    async listSessionTeamIds(sessionId: string): Promise<string[]> {
      const res: string[] = [];
      for (const t of db.teams.values()) {
        if (t.session_id === sessionId) res.push(t.id);
      }
      return res;
    },
  };

  // Helper simulating api/session
  async function createSession(passcode: string, token: string, roundTime = 120) {
    if (!verifyHostPasscode(passcode, hostPasscode)) {
      return { ok: false, status: 401, error: 'Invalid facilitator passcode' };
    }
    const user = db.users.get(token);
    if (!user) return { ok: false, status: 401, error: 'Host token not found' };

    const sessionId = 'sess-' + Math.random().toString(36).slice(2, 7);
    const code = 'CR-' + Math.random().toString(36).slice(2, 6).toUpperCase();

    db.sessions.set(sessionId, {
      id: sessionId,
      code,
      round: 1,
      status: 'lobby',
      host_owner: user.id,
      round_time: roundTime,
    });

    const teams = [];
    for (let i = 1; i <= 10; i++) {
      const teamId = `${sessionId}-t${i}`;
      const teamObj = {
        id: teamId,
        session_id: sessionId,
        team_num: i,
        name: `Team ${i}`,
        score: 0,
        owner: null,
      };
      db.teams.set(teamId, teamObj);
      db.teamStates.set(stateKey(sessionId, teamId), {
        state: newTeamState(teamId),
        version: 0,
      });
      teams.push(teamObj);
    }

    return { ok: true, status: 201, sessionId, code, teams };
  }

  // Helper simulating api/join
  async function joinSession(token: string, sessionCode: string, teamName: string, teamNum?: number) {
    const user = db.users.get(token);
    if (!user) return { ok: false, status: 401, error: 'Not signed in' };

    let session: any = null;
    for (const s of db.sessions.values()) {
      if (s.code === sessionCode.toUpperCase()) {
        session = s;
        break;
      }
    }
    if (!session) return { ok: false, status: 404, error: 'Session not found' };

    // Check reconnection
    for (const t of db.teams.values()) {
      if (t.session_id === session.id && t.owner === user.id) {
        return { ok: true, status: 200, sessionId: session.id, teamId: t.id, teamNum: t.team_num, name: t.name, reconnected: true };
      }
    }

    const cleanName = teamName.trim();
    // Check duplicate name
    for (const t of db.teams.values()) {
      if (t.session_id === session.id && t.owner && t.name.toLowerCase() === cleanName.toLowerCase()) {
        return { ok: false, status: 400, error: 'Team name already exists in this session' };
      }
    }

    let target: any = null;
    if (teamNum) {
      for (const t of db.teams.values()) {
        if (t.session_id === session.id && t.team_num === teamNum) {
          if (t.owner) return { ok: false, status: 409, error: `Team slot ${teamNum} is already taken` };
          target = t;
          break;
        }
      }
    } else {
      for (const t of db.teams.values()) {
        if (t.session_id === session.id && !t.owner) {
          target = t;
          break;
        }
      }
    }

    if (!target) return { ok: false, status: 409, error: 'No available slots' };

    target.owner = user.id;
    target.name = cleanName;
    return { ok: true, status: 200, sessionId: session.id, teamId: target.id, teamNum: target.team_num, name: target.name };
  }

  return { db, deps, createSession, joinSession };
}

describe('Server multiplayer authoritative logic & permissions', () => {
  it('session creation makes exactly ten teams with slots 1..10 and initial states', async () => {
    const { db, createSession } = createFakeServer();
    db.users.set('host-tok-1', { id: 'host-user-1' });

    const res = await createSession('FACILITATOR_PASS_2026', 'host-tok-1', 120);
    expect(res.ok).toBe(true);
    expect(res.teams?.length).toBe(10);

    const sessionTeams = Array.from(db.teams.values()).filter(t => t.session_id === res.sessionId);
    expect(sessionTeams.length).toBe(10);
    expect(sessionTeams.map(t => t.team_num).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    for (const team of sessionTeams) {
      expect(team.owner).toBeNull();
      const stateObj = db.teamStates.get(`${res.sessionId}/${team.id}`);
      expect(stateObj).toBeDefined();
      expect(stateObj?.version).toBe(0);
      expect(stateObj?.state.teamId).toBe(team.id);
      expect(stateObj?.state.round).toBe(1);
    }
  });

  it('join rejects a taken slot and duplicate name', async () => {
    const { db, createSession, joinSession } = createFakeServer();
    db.users.set('host-tok', { id: 'host-1' });
    db.users.set('student-1-tok', { id: 'student-1' });
    db.users.set('student-2-tok', { id: 'student-2' });
    db.users.set('student-3-tok', { id: 'student-3' });

    const sess = await createSession('FACILITATOR_PASS_2026', 'host-tok');
    const code = sess.code!;

    // Student 1 claims slot 3 with name "Alpha Unit"
    const join1 = await joinSession('student-1-tok', code, 'Alpha Unit', 3);
    expect(join1.ok).toBe(true);
    expect(join1.teamNum).toBe(3);

    // Student 2 tries to claim same slot 3 -> 409 rejected
    const join2 = await joinSession('student-2-tok', code, 'Bravo Unit', 3);
    expect(join2.ok).toBe(false);
    expect(join2.status).toBe(409);
    expect(join2.error).toContain('already taken');

    // Student 3 tries to use duplicate name (case-insensitive) -> 400 rejected
    const join3 = await joinSession('student-3-tok', code, 'alpha unit', 4);
    expect(join3.ok).toBe(false);
    expect(join3.status).toBe(400);
    expect(join3.error).toContain('already exists');
  });

  it('a team cannot read or act on another team', async () => {
    const { db, deps, createSession, joinSession } = createFakeServer();
    db.users.set('host-tok', { id: 'host-1' });
    db.users.set('s1-tok', { id: 's1' });
    db.users.set('s2-tok', { id: 's2' });

    const sess = await createSession('FACILITATOR_PASS_2026', 'host-tok');
    const j1 = await joinSession('s1-tok', sess.code!, 'Team Alpha');
    const j2 = await joinSession('s2-tok', sess.code!, 'Team Bravo');

    const team1Id = j1.teamId!;
    const team2Id = j2.teamId!;

    // Team 1 acts on Team 1 -> OK
    const okAction: Action = { id: 'act-1', teamId: team1Id, type: 'mark', report: 'R1', status: 'verified' };
    const r1 = await handleAuthoritativeAction(deps, {
      token: 's1-tok',
      sessionId: sess.sessionId!,
      teamId: team1Id,
      action: okAction,
    });
    expect(r1.ok).toBe(true);

    // Team 1 attempts to act on Team 2 -> 403 Forbidden
    const crossAction: Action = { id: 'act-cross', teamId: team2Id, type: 'mark', report: 'R1', status: 'verified' };
    const r2 = await handleAuthoritativeAction(deps, {
      token: 's1-tok',
      sessionId: sess.sessionId!,
      teamId: team2Id,
      action: crossAction,
    });
    expect(r2.ok).toBe(false);
    expect(r2.status).toBe(403);
    expect(r2.error).toContain('forbidden');
  });

  it('only the host can advance rounds; student advance is rejected', async () => {
    const { db, deps, createSession, joinSession } = createFakeServer();
    db.users.set('host-tok', { id: 'host-1' });
    db.users.set('s1-tok', { id: 's1' });

    const sess = await createSession('FACILITATOR_PASS_2026', 'host-tok');
    const j1 = await joinSession('s1-tok', sess.code!, 'Team Alpha');

    // Student tries to advance -> Rejected
    const studentAdv = await handleAuthoritativeAction(deps, {
      token: 's1-tok',
      sessionId: sess.sessionId!,
      teamId: j1.teamId!,
      action: { id: 'adv-student', teamId: j1.teamId!, type: 'advance' },
    });
    expect(studentAdv.ok).toBe(false);

    // Host advances -> Advances all teams in session
    const hostAdv = await handleAuthoritativeAction(deps, {
      token: 'host-tok',
      sessionId: sess.sessionId!,
      teamId: j1.teamId!,
      action: { id: 'adv-host', teamId: j1.teamId!, type: 'advance' },
    });
    expect(hostAdv.ok).toBe(true);

    // Verify team 1 advanced to round 2
    const st1 = await deps.loadTeamState(sess.sessionId!, j1.teamId!);
    expect(st1?.state.round).toBe(2);
  });

  it('replaying an action id never changes the score (idempotency)', async () => {
    const { db, deps, createSession, joinSession } = createFakeServer();
    db.users.set('host-tok', { id: 'host-1' });
    db.users.set('s1-tok', { id: 's1' });

    const sess = await createSession('FACILITATOR_PASS_2026', 'host-tok');
    const j1 = await joinSession('s1-tok', sess.code!, 'Team Alpha');
    const tid = j1.teamId!;

    const action: Action = { id: 'idemp-action-1', teamId: tid, type: 'mark', report: 'R1', status: 'verified' };
    const r1 = await handleAuthoritativeAction(deps, {
      token: 's1-tok',
      sessionId: sess.sessionId!,
      teamId: tid,
      action,
    });
    expect(r1.ok).toBe(true);
    const score1 = r1.score;
    const version1 = (await deps.loadTeamState(sess.sessionId!, tid))?.version;

    // Send the EXACT same action id again
    const r2 = await handleAuthoritativeAction(deps, {
      token: 's1-tok',
      sessionId: sess.sessionId!,
      teamId: tid,
      action,
    });
    expect(r2.ok).toBe(true);
    expect(r2.dup).toBe(true);
    expect(r2.score).toBe(score1);

    // Version does not increment on dup
    const version2 = (await deps.loadTeamState(sess.sessionId!, tid))?.version;
    expect(version2).toBe(version1);
  });

  it('due arrivals apply exactly once using deterministic action ids without double-scoring', async () => {
    const { db, deps, createSession, joinSession } = createFakeServer();
    db.users.set('host-tok', { id: 'host-1' });
    db.users.set('s1-tok', { id: 's1' });

    const sess = await createSession('FACILITATOR_PASS_2026', 'host-tok');
    const j1 = await joinSession('s1-tok', sess.code!, 'Team Alpha');
    const tid = j1.teamId!;

    const t0 = 1000000;
    // Deploy boat B1 to Sta. Lucia (A) at timestamp t0
    const depRes = await handleAuthoritativeAction(
      deps,
      {
        token: 's1-tok',
        sessionId: sess.sessionId!,
        teamId: tid,
        action: { id: 'deploy-b1', teamId: tid, type: 'deploy', unit: 'B1', b: 'A' },
      },
      t0
    );
    expect(depRes.ok).toBe(true);
    expect(depRes.state?.units.find(u => u.id === 'B1')?.st).toBe('out');

    const dur = depRes.state?.units.find(u => u.id === 'B1')?.dep?.dur!;
    expect(dur).toBeGreaterThan(0);

    // Before arrival time: unit should NOT arrive yet
    const curBefore = await processDueArrivals(deps, sess.sessionId!, tid, t0 + 500);
    expect(curBefore?.state.units.find(u => u.id === 'B1')?.st).toBe('out');

    // At or after arrival time: arrival applies!
    const arrivalTime = t0 + dur * 1000 + 100;
    const curAfter = await processDueArrivals(deps, sess.sessionId!, tid, arrivalTime);
    expect(curAfter?.state.units.find(u => u.id === 'B1')?.st).toBe('idle');
    expect(curAfter?.state.saved).toBe(40);
    const scoreAfterArrival = total(curAfter!.state).all;
    expect(scoreAfterArrival).toBeGreaterThan(0);

    // Running processDueArrivals again at arrivalTime + 5000: DOES NOT APPLY AGAIN
    const curAgain = await processDueArrivals(deps, sess.sessionId!, tid, arrivalTime + 5000);
    expect(curAgain?.state.saved).toBe(40);
    expect(total(curAgain!.state).all).toBe(scoreAfterArrival);
  });
});
