import { describe, expect, it } from 'vitest';
import { apply, newTeamState, support } from '../shared/sim';
import { L, cats, total } from '../shared/scoring';
import { B, DEPOT_FUEL, DEPOT_FOOD, RESUPPLY_FUEL, RESUPPLY_FOOD, DRONE_MAX_FLIGHTS, ANALYST_TOKENS_PER_ROUND } from '../shared/scenario';
import { crosscheck, isCorroborated, hasContradiction } from '../shared/crosscheck';
import type { Action, Actor, TeamState } from '../shared/types';

let n = 0;
const T = (s: TeamState): Actor => ({ role: 'team', teamId: s.teamId }), H: Actor = { role: 'host' }, SYS: Actor = { role: 'system' };
type Body = Action extends infer A ? (A extends unknown ? Omit<A, 'id' | 'teamId'> : never) : never;
const act = (s: TeamState, a: Body, who: Actor = T(s)) => { const r = apply(s, { id: 'a' + ++n, teamId: s.teamId, ...a } as Action, who); if (!r.ok) throw new Error(r.error); return r.state; };
const tryAct = (s: TeamState, a: Body, who: Actor = T(s)) => apply(s, { id: 'a' + ++n, teamId: s.teamId, ...a } as Action, who);
const go = (s: TeamState, unit: string, b: string, extra = {}) => act(act(s, { type: 'deploy', unit, b, ...extra }), { type: 'arrive', unit }, SYS);
const nxt = (s: TeamState, k = 1) => { for (let i = 0; i < k; i++) s = act(s, { type: 'advance' }, H); return s; };
const pts = (s: TeamState, c: string) => s.led.filter(l => l.cat === c).reduce((a, l) => a + l.pts, 0);

describe('scoring', () => {
  it('clamps categories to caps and dedupes by key', () => {
    const s = newTeamState('t1'); for (let i = 0; i < 20; i++) L(s, 'prm', 4, 'x'); expect(cats(s).prm).toBe(10);
    const t = newTeamState('t1'); expect(L(t, 'ver', 5, 'x', '', 'k')).toBe(true); expect(L(t, 'ver', 5, 'x', '', 'k')).toBe(false); expect(total(t).all).toBe(5);
  });
});

describe('resources and rescue', () => {
  it('deploys deduct resources and a verified flooded target scores lives and verification', () => {
    let s = newTeamState('t1'); s = go(s, 'D1', 'A'); expect(s.res.fuel).toBe(112);
    s = go(s, 'B1', 'A'); expect(s.res.fuel).toBe(100); expect(s.res.food).toBe(70); expect(s.saved).toBe(40); expect(s.pop.A).toBe(100);
    expect(pts(s, 'lives')).toBeCloseTo(30 * 40 / 720, 1); expect(pts(s, 'ver')).toBe(4);
  });
  it('rejects insufficient resources and blocked roads', () => {
    let s = newTeamState('t1'); s.res.fuel = 5; expect(apply(s, { id: 'z1', teamId: 't1', type: 'deploy', unit: 'B1', b: 'A' }, T(s)).ok).toBe(false);
    s = nxt(newTeamState('t1'), 2); const r = apply(s, { id: 'z2', teamId: 't1', type: 'deploy', unit: 'M1', b: 'C' }, T(s)); expect(r.ok).toBe(false);
  });
  it('false alarm on an unverified claim costs resources and verification once', () => {
    let s = go(newTeamState('t1'), 'B1', 'E'); expect(pts(s, 'res')).toBe(-3); expect(pts(s, 'ver')).toBe(-8); expect(s.st.waste).toBe(12);
  });
  it('same false alarm after recon is not double-penalised on verification', () => {
    let s = go(newTeamState('t1'), 'D1', 'E'); s = go(s, 'B1', 'E'); expect(pts(s, 'ver')).toBe(0); expect(pts(s, 'res')).toBe(-3);
  });
});

describe('replenishment and emergency resupply', () => {
  it('replenishes fuel and food automatically at each round advance via depot delivery', () => {
    let s = newTeamState('t1');
    const initFuel = s.res.fuel;
    const initFood = s.res.food;
    s = act(s, { type: 'advance' }, H);
    expect(s.round).toBe(2);
    expect(s.res.fuel).toBe(initFuel + DEPOT_FUEL);
    expect(s.res.food).toBe(initFood + DEPOT_FOOD);
    expect(s.log.some(l => l.t.includes('Supply depot delivered'))).toBe(true);
  });

  it('emergency resupply requested before round 3 arrives successfully at next round', () => {
    let s = newTeamState('t1');
    s = act(s, { type: 'resupply' });
    expect(s.supply.emergencyPending).toBe(true);
    expect(s.supply.emergencyUsed).toBe(true);

    const f0 = s.res.fuel, fd0 = s.res.food;
    s = act(s, { type: 'advance' }, H); // round 1 -> 2
    expect(s.supply.emergencyPending).toBe(false);
    // Received depot (+20, +12) PLUS emergency resupply (+40, +25)
    expect(s.res.fuel).toBe(f0 + DEPOT_FUEL + RESUPPLY_FUEL);
    expect(s.res.food).toBe(fd0 + DEPOT_FOOD + RESUPPLY_FOOD);
    expect(s.log.some(l => l.t.includes('Emergency resupply arrived'))).toBe(true);

    // Cannot request again in the same game
    const r2 = tryAct(s, { type: 'resupply' });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toContain('already used');
  });

  it('emergency resupply fails/delays when arriving in round 3 or later due to broken bridge', () => {
    let s = newTeamState('t1');
    s = act(s, { type: 'advance' }, H); // now round 2
    s = act(s, { type: 'resupply' });  // request in round 2 -> will arrive at round 3 start
    const f0 = s.res.fuel, fd0 = s.res.food;
    s = act(s, { type: 'advance' }, H); // advance to round 3 (bridge out!)
    expect(s.round).toBe(3);
    // Only depot delivery arrives, emergency was blocked
    expect(s.res.fuel).toBe(f0 + DEPOT_FUEL);
    expect(s.res.food).toBe(fd0 + DEPOT_FOOD);
    expect(s.supply.bridgeBlockedAt).toBe(3);
    expect(s.log.some(l => l.t.includes('Emergency resupply delayed! The bridge is out'))).toBe(true);
  });
});

describe('drone flight limits and grounding', () => {
  it('allows maximum 3 drone flights per game, 4th flight is rejected', () => {
    let s = newTeamState('t1');
    expect(s.droneFlights).toBe(DRONE_MAX_FLIGHTS);

    s = go(s, 'D1', 'A');
    expect(s.droneFlights).toBe(2);

    s = go(s, 'D1', 'B');
    expect(s.droneFlights).toBe(1);

    s = go(s, 'D1', 'D');
    expect(s.droneFlights).toBe(0);

    // 4th flight must fail
    const r = tryAct(s, { type: 'deploy', unit: 'D1', b: 'C' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('no scout flights remaining');
  });

  it('grounds drone in round 5 due to storm and network failure', () => {
    let s = newTeamState('t1');
    s = nxt(s, 4); // Advance to round 5
    expect(s.round).toBe(5);
    expect(s.droneFlights).toBe(3); // Flights still remaining
    const r = tryAct(s, { type: 'deploy', unit: 'D1', b: 'A' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('drone grounded: storm and network failure in round 5');
  });
});

describe('cost of delay (population decay)', () => {
  it('decays 15% of remaining population in flooded unrescued towns per round advance', () => {
    let s = newTeamState('t1');
    // Sta. Lucia (A) has pop 140 and fr: 1 (flooded from round 1)
    const initialPop = s.pop.A;
    expect(initialPop).toBe(140);
    s = act(s, { type: 'advance' }, H); // Advance round 1 -> 2
    const expectedLoss = Math.round(140 * 0.15); // 21
    expect(s.pop.A).toBe(140 - expectedLoss); // 119
    expect(pts(s, 'lives')).toBeLessThan(0); // Penalized on lives
    expect(s.log.some(l => l.t.includes('people lost to delay'))).toBe(true);
  });

  it('does not decay dry areas', () => {
    let s = newTeamState('t1');
    // Masagana (E) never floods (fr: 99)
    const initE = s.pop.E;
    s = act(s, { type: 'advance' }, H);
    expect(s.pop.E).toBe(initE);
  });
});

describe('cross-check desk channel rules and analyst tokens', () => {
  it('manages 3 analyst tokens per round, resetting on advance', () => {
    let s = newTeamState('t1');
    expect(s.analystTokens).toBe(ANALYST_TOKENS_PER_ROUND);

    s = act(s, { type: 'crosscheck', report: 'R1', channel: 'official' });
    expect(s.analystTokens).toBe(2);
    s = act(s, { type: 'crosscheck', report: 'R1', channel: 'barangay' });
    expect(s.analystTokens).toBe(1);
    s = act(s, { type: 'crosscheck', report: 'R2', channel: 'official' });
    expect(s.analystTokens).toBe(0);

    // 4th check fails
    const r = tryAct(s, { type: 'crosscheck', report: 'R2', channel: 'social' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('no analyst time tokens left');

    // Advance round resets tokens
    s = act(s, { type: 'advance' }, H);
    expect(s.analystTokens).toBe(ANALYST_TOKENS_PER_ROUND);
  });

  it('official channel: stale advisory returns "no new record" and is flagged stale', () => {
    const s = newTeamState('t1');
    const r9 = { id: 'R9', rd: 3, b: 'F', cl: 'd' as const, src: 'LGU advisory v1', k: 'official', age: 600, cf: 60, t: 1 as const, g: 'G8', pv: '', tx: '' };
    const res = crosscheck(r9, 3, 'official');
    expect(res.stale).toBe(true);
    expect(res.summary).toContain('No new record for this advisory');
    expect(res.cf).toBe(30);
  });

  it('news channel: lags by one round (no coverage for current round events)', () => {
    const r1 = { id: 'R1', rd: 1, b: 'A', cl: 'f' as const, src: 'PAGASA', k: 'official', age: 20, cf: 90, t: 1 as const, g: 'G1', pv: '', tx: '' };
    // Check in round 1 (same round as report)
    const res1 = crosscheck(r1, 1, 'news');
    expect(res1.summary).toContain('No coverage yet');
    expect(res1.cf).toBe(0);

    // Check in round 2 (news has now covered it)
    const res2 = crosscheck(r1, 2, 'news');
    expect(res2.summary).toContain('Multiple news sources');
    expect(res2.cf).toBeGreaterThan(50);
  });

  it('social media channel: circular reporting is marked and never qualifies as independent', () => {
    const r2 = { id: 'R2', rd: 1, b: 'E', cl: 'f' as const, src: 'Facebook', k: 'social', age: 45, cf: 35, t: 0 as const, g: 'G2', pv: '', tx: '' };
    const res = crosscheck(r2, 1, 'social');
    expect(res.circular).toBe(true);
    expect(res.independent).toBe(false);
    expect(res.summary).toContain('NOT independent evidence');
  });

  it('barangay contact: reliable in rounds 1-4, unavailable in round 5', () => {
    const r1 = { id: 'R1', rd: 1, b: 'A', cl: 'f' as const, src: 'PAGASA', k: 'official', age: 20, cf: 90, t: 1 as const, g: 'G1', pv: '', tx: '' };
    const resR1 = crosscheck(r1, 2, 'barangay');
    expect(resR1.unavailable).toBe(false);
    expect(resR1.cf).toBe(90);

    // In round 5
    const resR5 = crosscheck(r1, 5, 'barangay');
    expect(resR5.unavailable).toBe(true);
    expect(resR5.cf).toBe(0);
    expect(resR5.summary).toContain('Cannot reach the barangay');
  });
});

describe('corroboration logic and contradictory evidence penalty', () => {
  it('independent corroboration from 2 channels satisfies support() without drone recon', () => {
    let s = newTeamState('t1');
    const staLucia = B.find(b => b.id === 'A')!;
    // Initially not supported without drone or verified mark
    expect(support(s, staLucia)).toBe(false);

    // Cross-check R1 with official and barangay
    s = act(s, { type: 'crosscheck', report: 'R1', channel: 'official' });
    s = act(s, { type: 'crosscheck', report: 'R1', channel: 'barangay' });

    const checks = s.crossChecks.R1;
    expect(isCorroborated(checks)).toBe(true);
    // Now support() is true!
    expect(support(s, staLucia)).toBe(true);

    // Deploying boat receives verification credit (1 from cross-check corroboration + 4 from deployment)
    s = go(s, 'B1', 'A');
    expect(pts(s, 'ver')).toBe(5);
  });

  it('penalizes ignoring credible contradictory evidence from cross-check desk', () => {
    let s = newTeamState('t1');
    // R2 is false report about Masagana (E). Check it with official desk
    s = act(s, { type: 'crosscheck', report: 'R2', channel: 'official' });
    const checks = s.crossChecks.R2;
    expect(hasContradiction(checks)).toBe(true);

    // Player ignores the contradictory cross-check and marks R2 as verified anyway!
    s = act(s, { type: 'mark', report: 'R2', status: 'verified' });
    // Must receive the -6 penalty for ignoring contradictory evidence
    expect(s.led.some(l => l.why.includes('Ignored contradictory cross-check evidence'))).toBe(true);
  });

  it('awards bonus for catching a false claim using the cross-check desk', () => {
    let s = newTeamState('t1');
    s = act(s, { type: 'crosscheck', report: 'R2', channel: 'official' });
    s = act(s, { type: 'mark', report: 'R2', status: 'contradicted' });
    expect(s.led.some(l => l.why.includes('Used the Cross-check Desk to catch a false claim'))).toBe(true);
  });
});

describe('verification mechanics', () => {
  it('detecting a false report scores +8 with evidence but only +1 as an unevidenced guess', () => {
    expect(pts(act(newTeamState('t1'), { type: 'mark', report: 'R2', status: 'contradicted' }), 'ver')).toBe(1);
    const s = act(go(newTeamState('t1'), 'D1', 'E'), { type: 'mark', report: 'R2', status: 'contradicted' }); expect(pts(s, 'ver')).toBe(8); expect(s.st.caught).toBe(1);
  });
  it('wrong mark without evidence has no penalty; with evidence it does', () => {
    let s = act(newTeamState('t1'), { type: 'mark', report: 'R2', status: 'verified' }); expect(pts(s, 'ver')).toBe(0);
    s = act(newTeamState('t1'), { type: 'ask', prompt: 'x' }); // no-op for evidence
    s = go(s, 'D1', 'E'); s = act(s, { type: 'mark', report: 'R2', status: 'verified' }); expect(pts(s, 'ver')).toBe(-5);
  });
  it('re-marking does not re-score', () => {
    let s = go(newTeamState('t1'), 'D1', 'E'); s = act(s, { type: 'mark', report: 'R2', status: 'contradicted' }); const a = pts(s, 'ver');
    s = act(s, { type: 'mark', report: 'R2', status: 'verified' }); s = act(s, { type: 'mark', report: 'R2', status: 'contradicted' }); expect(pts(s, 'ver')).toBe(a);
  });
});

describe('AI analyst', () => {
  it('is deterministic and never moves units by itself', () => {
    const a = act(newTeamState('t1'), { type: 'ask', prompt: 'compare sources' }), b = act(newTeamState('t1'), { type: 'ask', prompt: 'compare sources' });
    expect(a.ai[0]).toEqual(b.ai[0]); expect(a.units.every(u => u.st === 'idle')).toBe(true);
  });
  it('round 3 recommendation cites a fabricated report; flagging scores once, approving unflagged is penalised once', () => {
    let s = nxt(newTeamState('t1'), 2); s = act(s, { type: 'ask', prompt: 'x' }); expect(s.ai[0].fake).toBe('R77');
    const f = act(s, { type: 'flag', rec: 'AI1' }); expect(pts(f, 'ver')).toBe(10); expect(f.st.hall).toBe(1);
    const p = act(s, { type: 'approve', rec: 'AI1' }); expect(pts(p, 'ver')).toBe(-6);
  });
  it('duplicate reshares mislead the AI in round 2; rejecting that unsupported rec is rewarded', () => {
    let s = nxt(newTeamState('t1')); s.pop.A = 0; s = act(s, { type: 'ask', prompt: 'x' }); expect(s.ai[0].b).toBe('E'); expect(s.ai[0].unc).toContain('one origin');
    expect(pts(act(s, { type: 'reject', rec: 'AI1' }), 'ver')).toBe(4);
  });
  it('rejecting an evidence-supported recommendation is penalised (no blind rejection reward)', () => {
    let s = act(newTeamState('t1'), { type: 'ask', prompt: 'x' }); expect(s.ai[0].b).toBe('A'); s = go(s, 'D1', 'A');
    expect(pts(act(s, { type: 'reject', rec: 'AI1' }), 'ver')).toBe(-2);
  });
});

describe('permissions, idempotency, rounds', () => {
  it('blocks cross-team and non-host actions', () => {
    const s = newTeamState('t1');
    expect(apply(s, { id: 'p1', teamId: 't1', type: 'mark', report: 'R1', status: 'verified' }, { role: 'team', teamId: 't2' }).ok).toBe(false);
    expect(apply(s, { id: 'p2', teamId: 't1', type: 'advance' }, T(s)).ok).toBe(false);
    expect(apply(s, { id: 'p3', teamId: 't1', type: 'arrive', unit: 'B1' }, T(s)).ok).toBe(false);
    expect(apply(s, { id: 'p4', teamId: 't2', type: 'mark', report: 'R1', status: 'verified' }, T(s)).ok).toBe(false);
  });
  it('a replayed action id (reconnect, double click) changes nothing', () => {
    const s = newTeamState('t1'), a: Action = { id: 'dup', teamId: 't1', type: 'mark', report: 'R1', status: 'verified' };
    const r1 = apply(s, a, T(s)); if (!r1.ok) throw 0; const r2 = apply(r1.state, a, T(s)); expect(r2.ok && r2.dup).toBe(true); expect(r2.state.led.length).toBe(r1.state.led.length);
  });
  it('input state is never mutated', () => { const s = newTeamState('t1'), snap = JSON.stringify(s); act(s, { type: 'mark', report: 'R1', status: 'verified' }); expect(JSON.stringify(s)).toBe(snap); });
  it('rounds advance 1..5 then finish; surge injection floods Dalig early', () => {
    let s = nxt(newTeamState('t1'), 4); expect(s.round).toBe(5); s = act(s, { type: 'advance' }, H); expect(s.finished).toBe(true);
    let q = act(newTeamState('t1'), { type: 'inject', k: 's' }, H); q = go(q, 'D1', 'F'); expect(q.rev.F).toBe(1);
  });
});
