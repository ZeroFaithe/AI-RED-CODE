import type { Action, Actor, Barangay, Rec, Report, Result, TeamState } from './types';
import {
  B, CAP, COST, EV, KW, R0, TOTPOP,
  DEPOT_FUEL, DEPOT_FOOD, RESUPPLY_FUEL, RESUPPLY_FOOD,
  DRONE_MAX_FLIGHTS, ANALYST_TOKENS_PER_ROUND, POP_DECAY,
  START_RES, FOOD_PER_PERSON, HOSPITAL_CAP, HOSPITAL_DISCHARGE, RELOCATE_COST, RELOCATE_MAX,
} from './scenario';
import { L, log } from './scoring';
import { crosscheck, hasContradiction, isCorroborated } from './crosscheck';

export const reports = (s: TeamState): Report[] => R0.concat(s.xr);
const vis = (s: TeamState) => reports(s).filter(r => r.rd <= s.round);
const bb = (id: string) => B.find(b => b.id === id)!;
export const flooded = (s: TeamState, b: Barangay) => s.round >= (s.fr[b.id] ?? b.fr);
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** Returns true if there is drone recon this round OR at least 2 independent verified reports for this town. */
export const support = (s: TeamState, b: Barangay): boolean => {
  if (s.rev[b.id] === s.round) return true;                          // drone recon this round
  if (reports(s).some(r => r.b === b.id && r.cl === 'f' && s.marks[r.id] === 'verified')) return true;
  // Cross-check corroboration counts as support too
  for (const rpt of vis(s).filter(r => r.b === b.id && r.cl === 'f')) {
    const checks = s.crossChecks[rpt.id] ?? [];
    if (isCorroborated(checks)) return true;
  }
  return false;
};

const groups = (s: TeamState, b: Barangay) => new Set(vis(s).filter(r => r.b === b.id && r.cl === 'f').map(r => r.g)).size;
/** Free shelter places for a unit type. Ambulances may also use the hospital. */
export const freeSpace = (s: TeamState, ty: string): number =>
  EV.reduce((a, e) => a + Math.max(0, e.cap - (s.ev[e.id] ?? 0)), 0) + (ty === 'amb' ? Math.max(0, HOSPITAL_CAP - (s.ev.H ?? 0)) : 0);
const drone = (s: TeamState) => s.units.find(u => u.ty === 'drone')!;
const opp = (s: TeamState, b: Barangay) => {
  if (drone(s).st === 'idle' && s.res.fuel >= COST.drone.fuel && s.droneFlights > 0 && s.round < 5) return true;
  if (groups(s, b) >= 2) return true;
  // Cross-check opportunity: if tokens remain or any cross-check exists for this town
  if (s.analystTokens > 0) return true;
  if (vis(s).filter(r => r.b === b.id).some(r => (s.crossChecks[r.id] ?? []).length > 0)) return true;
  return false;
};

export function newTeamState(teamId: string): TeamState {
  const pop: Record<string, number> = {}; B.forEach(b => (pop[b.id] = b.pop));
  const u = (id: string, ty: 'boat' | 'amb' | 'drone') => ({ id, ty, st: 'idle' as const });
  return {
    teamId, round: 1, finished: false, aiOff: false,
    res: { ...START_RES },
    pop, saved: 0, over: 0, ev: { E1: 0, E2: 0, H: 0 }, relocated: 0,
    rev: {}, fr: {}, marks: {}, keys: {}, done: {}, led: [], log: [], ai: [], xr: [],
    units: [u('B1', 'boat'), u('B2', 'boat'), u('M1', 'amb'), u('M2', 'amb'), u('D1', 'drone')],
    st: { caught: 0, vOK: 0, vN: 0, unsup: 0, hall: 0, waste: 0, deps: 0, ok: 0 },
    droneFlights: DRONE_MAX_FLIGHTS,
    analystTokens: ANALYST_TOKENS_PER_ROUND,
    crossChecks: {},
    supply: { emergencyUsed: false, emergencyPending: false },
  };
}

/** Deterministic mock analyst: same state + prompt => same recommendation.
 *  It sums confidence per area, so duplicate reshares inflate a claim (a realistic AI failure).
 *  With drone flights limited, it prioritises triage and cross-checking over scouting everything. */
export function generateRec(s: TeamState): Rec {
  const id = 'AI' + (s.ai.length + 1), busy = s.units.filter(u => u.st === 'out').map(u => u.tg);
  let best: [Barangay, Report[]] | null = null, bs = 0;
  B.forEach(b => {
    if (s.pop[b.id] <= 0 || busy.includes(b.id)) return;
    const rs = vis(s).filter(r => r.b === b.id && r.cl === 'f'), sc = rs.reduce((a, r) => a + r.cf, 0);
    if (sc > bs) { bs = sc; best = [b, rs]; }
  });
  if (!best) return { id, rd: s.round, b: null, txt: 'No unserved area has flood reports. Use cross-check or recon before committing units.', cites: [], fake: null, unc: '', st: 'info' };
  const [b, rs] = best as [Barangay, Report[]], gs = new Set(rs.map(r => r.g)), fake = s.round === 3 || s.round === 5;
  const checks = rs.flatMap(r => s.crossChecks[r.id] ?? []);
  const corroborated = isCorroborated(checks);
  const hasContra = hasContradiction(checks);
  const droneNote = s.droneFlights > 0 && s.round < 5
    ? `You have ${s.droneFlights} scout flight(s) left — use them on your highest-priority area. `
    : s.droneFlights === 0 ? 'Scout drone is out of flights. Use cross-check to verify before deploying. ' : '';
  const unc =
    (gs.size === 1 ? `All cited reports trace to one origin (${[...gs][0]}). ` : '') +
    (rs.every(r => r.k === 'social') ? 'Sources are social media only. ' : '') +
    (rs.some(r => r.age >= 480) ? 'Some reports are stale. ' : '') +
    (corroborated ? 'Cross-check results support this claim. ' : '') +
    (hasContra ? '⚠️ Cross-check found contradictory evidence — review before acting. ' : '') +
    droneNote +
    `Suggested check: recon or cross-check ${b.n}.`;
  return { id, rd: s.round, b: b.id, txt: `Prioritise ${b.n} (about ${b.pop} residents). Dispatch a boat.`, cites: rs.map(r => r.id).concat(fake ? ['R77'] : []), fake: fake ? 'R77' : null, unc, st: 'pending' };
}

const fail = (s: TeamState, error: string): Result => ({ ok: false, error, state: s });

/** Authoritative reducer. Pure: returns a new state, never mutates the input. Idempotent per action id. */
export function apply(s0: TeamState, a: Action, actor: Actor): Result {
  if (s0.done[a.id]) return { ok: true, state: s0, dup: true };
  const hostOnly = a.type === 'advance' || a.type === 'inject';
  if (hostOnly && actor.role !== 'host') return fail(s0, 'forbidden: host only');
  if (a.type === 'arrive' && actor.role !== 'system') return fail(s0, 'forbidden: system only');
  if (!hostOnly && a.type !== 'arrive' && !(actor.role === 'team' && actor.teamId === s0.teamId)) return fail(s0, 'forbidden: not your team');
  if (a.teamId !== s0.teamId) return fail(s0, 'forbidden: action targets another team');
  if (s0.finished) return fail(s0, 'game finished');
  const s = structuredClone(s0), err = run(s, a);
  if (err) return fail(s0, err);
  s.done[a.id] = 1; return { ok: true, state: s };
}

function run(s: TeamState, a: Action): string | null {
  switch (a.type) {
    case 'deploy': {
      const u = s.units.find(x => x.id === a.unit), b = B.find(x => x.id === a.b);
      if (!u || !b || u.st !== 'idle') return 'unit unavailable';
      if (u.ty === 'amb' && b.id === 'C' && s.round >= 3) return 'road blocked: bridge out';
      if (u.ty !== 'drone' && freeSpace(s, u.ty) <= 0) return 'All shelters are full. Relocate people out of an evacuation center first.';
      // Drone flight limits
      if (u.ty === 'drone') {
        if (s.round >= 5) return 'drone grounded: storm and network failure in round 5';
        if (s.droneFlights <= 0) return 'no scout flights remaining (limit: ' + DRONE_MAX_FLIGHTS + ' per game)';
        s.droneFlights--;
      }
      const c = COST[u.ty]; for (const k in c) if ((s.res as Record<string, number>)[k] < c[k]) return 'insufficient ' + k;
      const sup = support(s, b), op = opp(s, b);
      for (const k in c) (s.res as Record<string, number>)[k] -= c[k];
      u.st = 'out'; u.tg = b.id; u.dep = { b: b.id, src: a.src ?? 'manual', rid: a.rid, fake: a.fake, sup, opp: op, fuel: c.fuel };
      if (u.ty !== 'drone') s.st.deps++;
      log(s, `${u.id} dispatched to ${b.n}`); return null;
    }
    case 'arrive': {
      const u = s.units.find(x => x.id === a.unit); if (!u || u.st !== 'out' || !u.dep) return 'unit not en route';
      const b = bb(u.dep.b), d = u.dep, fo = flooded(s, b), ev = `Target ${b.n}${d.sup ? ' (verified)' : ' (not verified)'}`;
      u.st = 'idle'; u.tg = undefined; s.rev[b.id] = s.round; if (u.ty === 'amb') s.res.med++;
      if (u.ty === 'drone') { log(s, `Recon at ${b.n}: ${fo ? 'FLOODED, ' + s.pop[b.id] + ' remaining' : 'DRY'}`); return null; }
      if (fo && s.pop[b.id] > 0) {
        const n = Math.min(CAP[u.ty], s.pop[b.id], freeSpace(s, u.ty));
        if (n <= 0) { s.st.waste += d.fuel; L(s, 'res', -2, 'Arrived but every shelter was full: trip wasted. Relocate people to make room.', ev); return null; }
        s.pop[b.id] -= n; s.saved += n; s.st.ok++; let left = n;
        if (u.ty === 'amb') { const k = Math.min(left, HOSPITAL_CAP - (s.ev.H ?? 0)); s.ev.H = (s.ev.H ?? 0) + k; left -= k; }
        EV.slice().sort((p, q) => dist(p, b) - dist(q, b)).forEach(e => { const k = Math.min(left, e.cap - (s.ev[e.id] ?? 0)); s.ev[e.id] = (s.ev[e.id] ?? 0) + k; left -= k; });
        s.over += left; s.res.food = Math.max(0, s.res.food - Math.ceil(n * FOOD_PER_PERSON));
        L(s, 'lives', 30 * n / TOTPOP, `${u.id} rescued ${n} people from ${b.n}`, ev); L(s, 'res', 2, 'Successful deployment, fuel put to use', ev);
        if (left > 0) L(s, 'res', -2, `${left} rescued people had no shelter space`, ev, 'ov' + b.id + s.round);
        if (d.sup) L(s, 'ver', 4, `Deployed after evidence (recon, verified report, or corroboration) at ${b.n}`, ev, 'vd' + b.id + s.round);
        else if (d.src === 'ai' && d.opp && !d.fake) { s.st.unsup++; L(s, 'ver', -3, 'AI-sourced deployment without verification; favourable outcome but not evidence-based', ev, 'vp' + b.id + s.round); }
      } else if (fo) { L(s, 'res', -2, `${b.n} was already evacuated`, ev); s.st.waste += d.fuel; }
      else {
        s.st.waste += d.fuel; L(s, 'res', -3, `False alarm at ${b.n}: ${d.fuel} fuel wasted`, ev);
        if (!d.sup && d.opp && !d.fake) {
          if (d.src === 'ai') s.st.unsup++;
          L(s, 'ver', -8, 'Acted on an unverified claim that proved false. Recon or cross-check was available', ev, 'vp' + b.id + s.round);
        }
      }
      return null;
    }
    case 'mark': {
      const r = reports(s).find(q => q.id === a.report); if (!r) return 'unknown report';
      s.marks[r.id] = a.status; const b = bb(r.b), k = 'mk' + r.id;
      // Evidence check: recon this round, OR multiple independent cross-checks, OR contradicting reports from different origins
      const reconDone = s.rev[b.id] === s.round;
      const crossChecksForReport = s.crossChecks[r.id] ?? [];
      const hasIndependentCheck = crossChecksForReport.some(c => c.independent && !c.circular && !c.unavailable);
      const multiGroup = vis(s).some(q => q.b === r.b && q.g !== r.g && q.id !== r.id);
      const ev = reconDone || hasIndependentCheck || multiGroup;
      if (a.status === 'unverified' || s.keys[k]) return null;
      const right = (a.status === 'verified') === !!r.t; s.st.vN++; if (right) s.st.vOK++;

      // Contradictory-evidence penalty: if credible contradictory cross-checks exist and player still marks as verified
      const contradicts = hasContradiction(crossChecksForReport);
      if (a.status === 'verified' && contradicts && !r.t && ev) {
        L(s, 'ver', -6, `Ignored contradictory cross-check evidence and verified a false claim about ${b.n}`, `${r.id}: ${r.pv}`, 'ci' + r.id);
        s.keys[k] = 1; return null;
      }

      if (right) {
        if (a.status === 'contradicted') s.st.caught++;
        L(s, 'ver', ev ? (a.status === 'verified' ? 5 : 8) : 1, (a.status === 'verified' ? 'Verified a true claim' : 'Detected a false or outdated claim') + (ev ? ' with independent evidence available' : ' without cited evidence'), `${r.id}: ${r.src}`, k);
        // Bonus for using cross-check desk to catch a false claim
        if (a.status === 'contradicted' && hasIndependentCheck) {
          L(s, 'ver', 3, `Used the Cross-check Desk to catch a false claim — excellent source verification`, `${r.id}`, 'cdb' + r.id);
        }
      }
      else if (ev) L(s, 'ver', a.status === 'verified' ? -5 : -3, (a.status === 'verified' ? 'Verified a false claim' : 'Rejected a true claim') + ' although evidence was available', `${r.id}: ${r.pv}`, k);
      else { s.keys[k] = 1; log(s, `No penalty for ${r.id}: no independent evidence was available yet`); }
      return null;
    }
    case 'ask': {
      if (s.aiOff) return 'AI uplink lost';
      const p = a.prompt.trim().toLowerCase(), h = KW.filter(k => p.includes(k)).length;
      L(s, 'prm', p.length < 15 ? 0 : Math.min(4, h * 1.5), p.length < 15 ? 'Vague prompt' : `Prompt asked for ${h} evidence-oriented elements`, '', 'pq' + s.round);
      const rec = generateRec(s); s.ai.push(rec); log(s, `AI ${rec.id}: ${rec.txt}`); return null;
    }
    case 'approve': case 'reject': case 'flag': {
      const r = s.ai.find(x => x.id === a.rec); if (!r || r.st !== 'pending' || !r.b) return 'recommendation not pending';
      const b = bb(r.b), fo = flooded(s, b), sp = support(s, b);
      if (a.type === 'flag') { r.st = 'flagged'; if (r.fake) { s.st.hall++; L(s, 'ver', 10, `Caught a hallucinated citation: ${r.fake} is not in the incident feed`, r.id, 'hf' + r.id); } else L(s, 'ver', -3, `False accusation: every citation in ${r.id} exists`, r.id, 'hf' + r.id); return null; }
      if (a.type === 'reject') {
        r.st = 'rejected';
        if (!fo && !sp) L(s, 'ver', 4, `Correctly rejected an unsupported recommendation (${b.n} was not flooded)`, r.id, 'rj' + r.id);
        else if (fo && sp) L(s, 'ver', -2, 'Rejected a recommendation that evidence supported', r.id, 'rj' + r.id);
        return null;
      }
      const u = s.units.find(q => q.ty === 'boat' && q.st === 'idle' && s.res.fuel >= 12 && s.res.food >= 6); if (!u) return 'no available boat';
      if (r.fake) { s.st.unsup++; L(s, 'ver', -6, `Approved a recommendation with a fabricated citation (${r.fake}) that could be checked`, r.id, 'fk' + r.id); }
      r.st = 'approved'; log(s, `Team APPROVED ${r.id}`); return run(s, { id: a.id + '-d', teamId: s.teamId, type: 'deploy', unit: u.id, b: b.id, src: 'ai', rid: r.id, fake: !!r.fake });
    }
    case 'advisory': {
      const key = 'ad' + a.k + s.round; if (s.keys[key]) return 'already sent this round';
      const top = s.ai.filter(r => r.rd === s.round && r.b).pop(), ver = B.some(b => support(s, b) && flooded(s, b));
      if (a.k === 'v') L(s, 'com', ver ? 5 : 1, ver ? 'Evidence-based advisory naming verified areas' : 'Cautious advisory, nothing verified to name');
      if (a.k === 'x') { if (!top) return 'ask the AI first'; const sp = support(s, bb(top.b!)); L(s, 'com', sp ? 4 : -6, sp ? 'Broadcast a verified claim' : 'Broadcast an unverified AI claim as confirmed', top.id); }
      if (a.k === 't') L(s, 'com', 3, 'Disclosed AI assistance and uncertainty');
      s.keys[key] = 1; return null;
    }
    case 'crosscheck': {
      const r = reports(s).find(q => q.id === a.report); if (!r) return 'unknown report';
      if (r.rd > s.round) return 'report not yet visible';
      if (s.analystTokens <= 0) return 'no analyst time tokens left this round (resets next round)';
      // Barangay unavailable in round 5
      if (a.channel === 'barangay' && s.round >= 5) {
        // Still costs a token to attempt (teach about unavailability)
        s.analystTokens--;
        const result = crosscheck(r, s.round, a.channel);
        if (!s.crossChecks[r.id]) s.crossChecks[r.id] = [];
        // Replace existing result for this channel
        s.crossChecks[r.id] = s.crossChecks[r.id].filter(c => c.channel !== a.channel);
        s.crossChecks[r.id].push(result);
        log(s, `Cross-check: ${r.id} via ${a.channel} → unavailable (token used)`);
        return null;
      }
      s.analystTokens--;
      const result = crosscheck(r, s.round, a.channel);
      if (!s.crossChecks[r.id]) s.crossChecks[r.id] = [];
      s.crossChecks[r.id] = s.crossChecks[r.id].filter(c => c.channel !== a.channel);
      s.crossChecks[r.id].push(result);
      log(s, `Cross-check: ${r.id} via ${a.channel} → cf ${result.cf}%, ${result.independent && !result.circular ? 'independent' : 'NOT independent'}`);

      // Scoring for cross-check use
      const checks = s.crossChecks[r.id];
      const nowCorroborated = isCorroborated(checks);
      const nowContradicts = hasContradiction(checks);
      if (a.channel !== 'social') {
        if (nowContradicts && !r.t) {
          // Found a false claim via independent channel — reward careful checking
          L(s, 'ver', 2, `Cross-checked ${r.id} via independent channel and found contradictory evidence — good verification practice`, `${r.id}`, 'cck' + r.id + a.channel);
        } else if (nowCorroborated && r.t) {
          L(s, 'ver', 1, `Cross-checked ${r.id} — two independent channels now support this claim`, `${r.id}`, 'cck' + r.id + a.channel);
        }
      } else {
        // Social-only check: warn about circular reporting
        if (!checks.some(c => c.channel !== 'social')) {
          log(s, `Warning: social media check for ${r.id} is circular and cannot corroborate the claim`);
        }
      }
      return null;
    }
    case 'relocate': {
      const c = EV.find(e => e.id === a.center); if (!c) return 'unknown evacuation center';
      const used = s.ev[c.id] ?? 0, key = 'rl' + c.id + s.round;
      if (s.keys[key]) return 'this center already had a relocation convoy this round';
      if (used <= 0) return 'nobody to relocate from this center';
      if (s.res.fuel < RELOCATE_COST.fuel || s.res.food < RELOCATE_COST.food) return 'not enough fuel or food for a relocation convoy';
      const n = Math.min(RELOCATE_MAX, used); s.res.fuel -= RELOCATE_COST.fuel; s.res.food -= RELOCATE_COST.food; s.ev[c.id] = used - n; s.relocated += n;
      const needed = used >= 0.7 * c.cap;
      L(s, 'res', needed ? 1 : 0, needed ? `Relocated ${n} people from ${c.n} to the provincial shelter, freeing space for new rescues` : `Relocated ${n} people from ${c.n}, but it was not nearly full (no points)`, `Round ${s.round}`, key);
      return null;
    }
    case 'resupply': {
      if (s.supply.emergencyUsed) return 'emergency resupply already used this game';
      if (s.supply.emergencyPending) return 'emergency resupply already on its way';
      s.supply.emergencyPending = true;
      s.supply.emergencyUsed = true;
      log(s, `Emergency resupply requested. It arrives at the start of the next round${s.round >= 3 ? ', but the broken bridge will hold it up for one extra round' : ''}.`);
      return null;
    }
    case 'advance': {
      if (s.round === 5) { s.finished = true; return null; }

      // ── Population decay: flooded, unrescued towns lose 15% of remaining pop ──
      B.forEach(b => {
        if (flooded(s, b) && s.pop[b.id] > 0 && b.fr < 99) {
          const lost = Math.round(s.pop[b.id] * POP_DECAY);
          if (lost > 0) {
            s.pop[b.id] = Math.max(0, s.pop[b.id] - lost);
            L(s, 'lives', -30 * lost / TOTPOP, `${b.n}: ${lost} people could not be reached this round — time costs lives`, `Round ${s.round} delay`, 'decay' + b.id + s.round);
            log(s, `⚠️ ${b.n}: ${lost} people lost to delay (flooded and unrescued this round)`);
          }
        }
      });

      if ((s.ev.H ?? 0) > 0) { const k = Math.min(s.ev.H, HOSPITAL_DISCHARGE); s.ev.H -= k; log(s, `🏥 ${k} patients were discharged from the hospital, freeing beds.`); }
      s.round++;
      s.aiOff = false;

      // ── Analyst tokens reset ──────────────────────────────────────────────
      s.analystTokens = ANALYST_TOKENS_PER_ROUND;

      // ── Depot delivery (every round start) ────────────────────────────────
      s.res.fuel += DEPOT_FUEL;
      s.res.food += DEPOT_FOOD;
      log(s, `🚚 Supply depot delivered +${DEPOT_FUEL} fuel and +${DEPOT_FOOD} food at the start of Round ${s.round}.`);
      L(s, 'res', 0, `Depot delivery: +${DEPOT_FUEL} fuel, +${DEPOT_FOOD} food`, `Round ${s.round} depot`);

      // ── Emergency resupply (held up once by the broken bridge, then delivered) ──
      if (s.supply.emergencyPending) {
        if (s.round >= 3 && !s.supply.delayed) {
          s.supply.delayed = true; s.supply.bridgeBlockedAt = s.round;
          log(s, '⚠️ Emergency resupply delayed! The bridge is out, so the convoy is rerouted. It should arrive next round.');
        } else {
          s.supply.emergencyPending = false;
          s.res.fuel += RESUPPLY_FUEL; s.res.food += RESUPPLY_FOOD;
          log(s, `🚁 Emergency resupply arrived: +${RESUPPLY_FUEL} fuel, +${RESUPPLY_FOOD} food.`);
          L(s, 'res', 2, `Emergency resupply received: +${RESUPPLY_FUEL} fuel, +${RESUPPLY_FOOD} food`, `Round ${s.round}`);
        }
      }

      log(s, `Round ${s.round} begins`); return null;
    }
    case 'inject': {
      const n = 'X' + (s.xr.length + 1), base = { id: n, rd: s.round, age: 5, pv: 'Injected by the facilitator.' };
      if (a.k === 's') { s.fr.F = s.round; s.xr.push({ ...base, b: 'F', cl: 'f', src: 'Host: MDRRMO surge alert', k: 'official', cf: 80, t: 1, g: 'G' + n, tx: 'Storm surge: Dalig is now flooding.' }); }
      if (a.k === 'r') s.xr.push({ ...base, b: 'B', cl: 'd', src: 'Host: anonymous chat', k: 'social', age: 90, cf: 45, t: 0, g: 'G' + n, tx: 'San Roque is dry, cancel boats.' });
      if (a.k === 'o') s.aiOff = true;
      log(s, 'Facilitator injected ' + a.k); return null;
    }
  }
}
