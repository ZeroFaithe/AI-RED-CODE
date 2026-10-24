/**
 * Server-side authoritative validation handler.
 *
 * Runs shared/sim.ts apply() on the server for every action submitted.
 * Ensures permissions, deduplication, and pure state transitions.
 */

import { apply } from '../shared/sim';
import { total } from '../shared/scoring';
import type { Action, Actor, Result, TeamState } from '../shared/types';

export interface ActionRequestBody {
  sessionId: string;
  teamId: string;
  action: Action;
  actor: Actor;
  currentState: TeamState;
}

export interface ActionResponse {
  ok: boolean;
  state?: TeamState;
  score?: number;
  error?: string;
  dup?: boolean;
}

export function handleAuthoritativeAction(body: ActionRequestBody): ActionResponse {
  const { action, actor, currentState } = body;

  // Run pure, authoritative reducer
  const result: Result = apply(currentState, action, actor);

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  const score = Math.round(total(result.state).all);
  return {
    ok: true,
    state: result.state,
    score,
    dup: result.dup,
  };
}
