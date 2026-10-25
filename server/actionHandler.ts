/**
 * Server-side authoritative action handler.
 *
 * SECURITY MODEL
 *  - The client sends ONLY { token, sessionId, teamId, action }.
 *  - The actor (team / host) is derived from the verified token, never from the request body.
 *  - Team state is loaded from the database, never taken from the client.
 *  - 'arrive' is a system action: clients cannot send it. The server schedules it (see handleSystemArrive).
 *  - Writes use optimistic versioning so two simultaneous requests cannot overwrite each other.
 *
 * The storage and auth are injected (ServerDeps) so this file has no Supabase dependency and is unit-tested.
 * See SUPABASE_CLIENT_GUIDE.md for the Supabase implementation of ServerDeps.
 */
import { apply } from '../shared/sim.js';
import { total } from '../shared/scoring.js';
import type { Action, Actor, TeamState } from '../shared/types.js';

export type Principal = { role: 'team'; sessionId: string; teamId: string } | { role: 'host'; sessionId: string };
export interface Versioned { state: TeamState; version: number }
export interface ServerDeps {
  /** Verify a login token (Supabase JWT / host token) and say who it belongs to. Null = not logged in. */
  authenticate(token: string): Promise<Principal | null>;
  loadTeamState(sessionId: string, teamId: string): Promise<Versioned | null>;
  /** Must fail (return false) if the stored version no longer equals expectedVersion. */
  saveTeamState(sessionId: string, teamId: string, state: TeamState, score: number, expectedVersion: number): Promise<boolean>;
  /** Optional helper to get all team IDs for a session when host advances or injects */
  listSessionTeamIds?(sessionId: string): Promise<string[]>;
}
export interface ActionRequest { token: string; sessionId: string; teamId: string; action: Action }
export interface ActionResponse { ok: boolean; status: number; state?: TeamState; score?: number; error?: string; dup?: boolean }

export async function processDueArrivals(
  deps: ServerDeps,
  sessionId: string,
  teamId: string,
  clock: number = Date.now()
): Promise<Versioned | null> {
  let cur = await deps.loadTeamState(sessionId, teamId);
  if (!cur) return null;
  for (const u of cur.state.units) {
    if (u.st === 'out' && u.dep?.departedAt !== undefined && u.dep?.dur !== undefined) {
      const arriveTime = u.dep.departedAt + u.dep.dur * 1000;
      if (clock >= arriveTime) {
        const actionId = `arrive-${u.id}-${u.dep.departedAt}`;
        const res = await handleSystemArrive(deps, sessionId, teamId, u.id, actionId, clock);
        if (res.ok && res.state) {
          cur = { state: res.state, version: cur.version + 1 };
        }
      }
    }
  }
  return cur;
}

async function applyAndSave(
  deps: ServerDeps,
  sessionId: string,
  teamId: string,
  action: Action,
  actor: Actor,
  clock: number = Date.now()
): Promise<ActionResponse> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await deps.loadTeamState(sessionId, teamId);
    if (!cur) return { ok: false, status: 404, error: 'team not found' };
    const result = apply(cur.state, action, actor, clock);
    if (!result.ok) return { ok: false, status: 400, error: result.error };
    if (result.dup) return { ok: true, status: 200, state: result.state, score: Math.round(total(result.state).all), dup: true };
    const score = Math.round(total(result.state).all);
    if (await deps.saveTeamState(sessionId, teamId, result.state, score, cur.version)) return { ok: true, status: 200, state: result.state, score };
  }
  return { ok: false, status: 409, error: 'conflict, please retry' };
}

export async function handleAuthoritativeAction(
  deps: ServerDeps,
  req: ActionRequest,
  clock: number = Date.now()
): Promise<ActionResponse> {
  const who = await deps.authenticate(req.token);
  if (!who || who.sessionId !== req.sessionId) return { ok: false, status: 401, error: 'not signed in to this session' };
  const a = req.action;
  if (a.type === 'arrive') return { ok: false, status: 403, error: 'arrivals are scheduled by the server, not the client' };
  if (a.teamId !== req.teamId) return { ok: false, status: 400, error: 'action teamId does not match request' };
  if (who.role === 'team' && who.teamId !== req.teamId) return { ok: false, status: 403, error: 'forbidden: not your team' };

  // If host advances and listSessionTeamIds is provided, advance all teams in session
  if (who.role === 'host' && (a.type === 'advance' || a.type === 'inject') && deps.listSessionTeamIds) {
    const teamIds = await deps.listSessionTeamIds(req.sessionId);
    let targetResult: ActionResponse | null = null;
    for (const tid of teamIds) {
      const teamAction: Action = { ...a, id: `${a.id}-${tid}`, teamId: tid };
      const res = await applyAndSave(deps, req.sessionId, tid, teamAction, { role: 'host' }, clock);
      if (tid === req.teamId || !targetResult) {
        targetResult = res;
      }
    }
    return targetResult ?? { ok: true, status: 200 };
  }

  // Process any due arrivals for this team before applying the action
  await processDueArrivals(deps, req.sessionId, req.teamId, clock);

  const actor: Actor = who.role === 'host' ? { role: 'host' } : { role: 'team', teamId: who.teamId };
  return applyAndSave(deps, req.sessionId, req.teamId, a, actor, clock);
}

/** Called by server logic when a unit's travel time has elapsed. Never exposed to clients. */
export function handleSystemArrive(
  deps: ServerDeps,
  sessionId: string,
  teamId: string,
  unit: string,
  actionId: string,
  clock: number = Date.now()
): Promise<ActionResponse> {
  return applyAndSave(deps, sessionId, teamId, { id: actionId, teamId, type: 'arrive', unit }, { role: 'system' }, clock);
}
