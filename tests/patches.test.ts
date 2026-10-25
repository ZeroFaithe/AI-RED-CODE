import { describe, expect, it } from 'vitest';
import { apply, freeSpace, newTeamState } from '../shared/sim';
import { total } from '../shared/scoring';
import { TOTPOP } from '../shared/scenario';
import { handleAuthoritativeAction, handleSystemArrive, type Principal, type ServerDeps, type Versioned } from '../server/actionHandler';
import { verifyHostPasscode } from '../server/hostAuth';
import type { Action, Actor, TeamState } from '../shared/types';
let n = 0;
type Body = Action extends infer A ? (A extends unknown ? Omit<A, 'id' | 'teamId'> : never) : never;
const T = (s: TeamState): Actor => ({ role: 'team', teamId: s.teamId }), H: Actor = { role: 'host' }, SYS: Actor = { role: 'system' };
const tr = (s: TeamState, a: Body, who: Actor = T(s)) => apply(s, { id: 'p' + ++n, teamId: s.teamId, ...a } as Action, who);
const act = (s: TeamState, a: Body, who: Actor = T(s)) => { const r = tr(s, a, who); if (!r.ok) throw new Error(r.error); return r.state; };
const go = (s: TeamState, unit: string, b: string) => act(act(s, { type: 'deploy', unit, b }), { type: 'arrive', unit }, SYS);

describe('resource balance', () => {
  it('a careful, fully informed team with a realistic number of trips per round can save most residents', () => {
    let s = newTeamState('t');
    for (let round = 1; round <= 5; round++) {
      for (let trip = 0; trip < 8; trip++) {
        const t = ['A', 'B', 'D', 'C', 'F'].find(id => { const fr = { A: 1, B: 2, D: 2, C: 3, F: 4 }[id]!; return round >= fr && s.pop[id] > 0; });
        if (!t) break;
        for (const c of ['E1', 'E2'] as const) if ((s.ev[c] ?? 0) >= 160) { const r = tr(s, { type: 'relocate', center: c }); if (r.ok) s = r.state; }
        const unit = (t === 'C' && round >= 3) || s.pop[t] > 20 ? 'B1' : 'M1';
        const r = tr(s, { type: 'deploy', unit, b: t }); if (!r.ok) break; s = act(r.state, { type: 'arrive', unit }, SYS);
      }
      if (round < 5) s = act(s, { type: 'advance' }, H);
    }
    expect(s.saved / TOTPOP).toBeGreaterThan(0.6);
    expect(s.res.fuel).toBeGreaterThanOrEqual(0);
  });
});
describe('shelters', () => {
  it('rescue is refused when every shelter is full, and relocation frees space', () => {
    let s = newTeamState('t'); s.ev.E1 = 200; s.ev.E2 = 150; s.ev.H = 60;
    expect(freeSpace(s, 'boat')).toBe(0);
    expect(tr(s, { type: 'deploy', unit: 'B1', b: 'A' }).ok).toBe(false);
    const fuel = s.res.fuel; s = act(s, { type: 'relocate', center: 'E1' });
    expect(s.ev.E1).toBe(120); expect(s.relocated).toBe(80); expect(s.res.fuel).toBe(fuel - 8); expect(freeSpace(s, 'boat')).toBe(80);
    expect(tr(s, { type: 'relocate', center: 'E1' }).ok).toBe(false);
    s = go(s, 'B1', 'A'); expect(s.saved).toBe(40);
  });
  it('relocation scores only when the center was nearly full, and only once per center per round', () => {
    let s = newTeamState('t'); s.ev.E1 = 40; s = act(s, { type: 'relocate', center: 'E1' }); expect(s.led.filter(l => l.cat === 'res').reduce((a, l) => a + l.pts, 0)).toBe(0);
    let q = newTeamState('t'); q.ev.E1 = 180; q = act(q, { type: 'relocate', center: 'E1' }); expect(q.led.filter(l => l.cat === 'res').reduce((a, l) => a + l.pts, 0)).toBe(1);
  });
  it('ambulances use the hospital first and the hospital discharges patients each round', () => {
    let s = go(newTeamState('t'), 'M1', 'A'); expect(s.ev.H).toBe(20); expect(s.ev.E1 + s.ev.E2).toBe(0);
    s = act(s, { type: 'advance' }, H); expect(s.ev.H).toBe(0);
  });
});
describe('emergency convoy', () => {
  it('requested in round 3 or later is held up one round, then delivered', () => {
    let s = newTeamState('t'); s = act(s, { type: 'advance' }, H); s = act(s, { type: 'advance' }, H); s = act(s, { type: 'resupply' });
    const f = s.res.fuel; s = act(s, { type: 'advance' }, H); expect(s.res.fuel).toBe(f + 20); expect(s.supply.emergencyPending).toBe(true);
    s = act(s, { type: 'advance' }, H); expect(s.res.fuel).toBe(f + 20 + 20 + 40); expect(s.supply.emergencyPending).toBe(false);
  });
});
describe('server handler (authoritative, injected storage)', () => {
  const mk = () => {
    const db = new Map<string, Versioned>(); const key = (s: string, t: string) => s + '/' + t;
    db.set(key('S', 't1'), { state: newTeamState('t1'), version: 0 }); db.set(key('S', 't2'), { state: newTeamState('t2'), version: 0 });
    const users: Record<string, Principal> = { u1: { role: 'team', sessionId: 'S', teamId: 't1' }, hostTok: { role: 'host', sessionId: 'S' }, other: { role: 'team', sessionId: 'X', teamId: 't1' } };
    const deps: ServerDeps = { authenticate: async tok => users[tok] ?? null, loadTeamState: async (s, t) => db.get(key(s, t)) ?? null,
      saveTeamState: async (s, t, st, _sc, v) => { const c = db.get(key(s, t))!; if (c.version !== v) return false; db.set(key(s, t), { state: st, version: v + 1 }); return true; } };
    return { db, deps };
  };
  const req = (token: string, teamId: string, a: Body, id = 'r' + ++n) => ({ token, sessionId: 'S', teamId, action: { id, teamId, ...a } as Action });
  it('rejects missing/foreign tokens and cross-team actions', async () => {
    const { deps } = mk();
    expect((await handleAuthoritativeAction(deps, req('nope', 't1', { type: 'mark', report: 'R1', status: 'verified' }))).status).toBe(401);
    expect((await handleAuthoritativeAction(deps, req('other', 't1', { type: 'mark', report: 'R1', status: 'verified' }))).status).toBe(401);
    expect((await handleAuthoritativeAction(deps, req('u1', 't2', { type: 'mark', report: 'R1', status: 'verified' }))).status).toBe(403);
  });
  it('team cannot advance rounds or fake arrivals; host can advance; the actor is never taken from the client', async () => {
    const { deps, db } = mk();
    expect((await handleAuthoritativeAction(deps, req('u1', 't1', { type: 'advance' }))).ok).toBe(false);
    expect((await handleAuthoritativeAction(deps, req('u1', 't1', { type: 'arrive', unit: 'B1' }))).status).toBe(403);
    expect((await handleAuthoritativeAction(deps, req('hostTok', 't1', { type: 'advance' }))).ok).toBe(true); expect(db.get('S/t1')!.state.round).toBe(2);
  });
  it('replayed action ids do not score twice; arrivals only via the server path; versions bump once', async () => {
    const { deps, db } = mk(); const r = req('u1', 't1', { type: 'mark', report: 'R1', status: 'verified' }, 'same');
    const a = await handleAuthoritativeAction(deps, r), b = await handleAuthoritativeAction(deps, r); expect(a.ok && b.ok && b.dup).toBe(true); expect(db.get('S/t1')!.version).toBe(1);
    await handleAuthoritativeAction(deps, req('u1', 't1', { type: 'deploy', unit: 'B1', b: 'A' }));
    expect((await handleSystemArrive(deps, 'S', 't1', 'B1', 'arr1')).ok).toBe(true); expect(db.get('S/t1')!.state.saved).toBe(40);
    expect(total(db.get('S/t1')!.state).all).toBeGreaterThan(0);
  });
});
describe('host passcode', () => {
  it('compares against a server-side secret and refuses when none is configured', () => { expect(verifyHostPasscode('x', 'x')).toBe(true); expect(verifyHostPasscode('x', 'y')).toBe(false); expect(verifyHostPasscode('', '')).toBe(false); expect(verifyHostPasscode('x', undefined)).toBe(false); });
});
