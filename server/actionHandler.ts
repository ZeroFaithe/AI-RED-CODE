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
import { apply } from '../shared/sim';
import { total } from '../shared/scoring';
import type { Action, Actor, TeamState } from '../shared/types';

export type Principal = { role: 'team'; sessionId: string; teamId: string } | { role: 'host'; sessionId: string };
export interface Versioned { state: TeamState; version: number }
export interface ServerDeps {
  /** Verify a login token (Supabase JWT / host token) and say who it belongs to. Null = not logged in. */
  authenticate(token: string): Promise<Principal | null>;
  loadTeamState(sessionId: string, teamId: string): Promise<Versioned | null>;
  /** Must fail (return false) if the stored version no longer equals expectedVersion. */
  saveTeamState(sessionId: string, teamId: string, state: TeamState, score: number, expectedVersion: number): Promise<boolean>;
}
export interface ActionRequest { token: string; sessionId: string; teamId: string; action: Action }
export interface ActionResponse { ok: boolean; status: number; state?: TeamState; score?: number; error?: string; dup?: boolean }

async function applyAndSave(deps: ServerDeps, sessionId: string, teamId: string, action: Action, actor: Actor): Promise<ActionResponse> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await deps.loadTeamState(sessionId, teamId);
    if (!cur) return { ok: false, status: 404, error: 'team not found' };
    const result = apply(cur.state, action, actor);
    if (!result.ok) return { ok: false, status: 400, error: result.error };
    if (result.dup) return { ok: true, status: 200, state: result.state, score: Math.round(total(result.state).all), dup: true };
    const score = Math.round(total(result.state).all);
    if (await deps.saveTeamState(sessionId, teamId, result.state, score, cur.version)) return { ok: true, status: 200, state: result.state, score };
  }
  return { ok: false, status: 409, error: 'conflict, please retry' };
}

export async function handleAuthoritativeAction(deps: ServerDeps, req: ActionRequest): Promise<ActionResponse> {
  const who = await deps.authenticate(req.token);
  if (!who || who.sessionId !== req.sessionId) return { ok: false, status: 401, error: 'not signed in to this session' };
  const a = req.action;
  if (a.type === 'arrive') return { ok: false, status: 403, error: 'arrivals are scheduled by the server, not the client' };
  if (a.teamId !== req.teamId) return { ok: false, status: 400, error: 'action teamId does not match request' };
  if (who.role === 'team' && who.teamId !== req.teamId) return { ok: false, status: 403, error: 'forbidden: not your team' };
  const actor: Actor = who.role === 'host' ? { role: 'host' } : { role: 'team', teamId: who.teamId };
  return applyAndSave(deps, req.sessionId, req.teamId, a, actor);
}

/** Called by a server timer when a unit's travel time has elapsed. Never exposed to clients. */
export function handleSystemArrive(deps: ServerDeps, sessionId: string, teamId: string, unit: string, actionId: string): Promise<ActionResponse> {
  return applyAndSave(deps, sessionId, teamId, { id: actionId, teamId, type: 'arrive', unit }, { role: 'system' });
}
