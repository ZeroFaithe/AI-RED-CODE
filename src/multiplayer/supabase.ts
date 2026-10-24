/**
 * Supabase Multiplayer Client & Local Demo Mode Bridge
 *
 * Supports:
 * - Local Demo Mode (default): uses seeded scenario, mock AI, simulated opponents. Zero external services needed.
 * - Multiplayer Mode: connects to Supabase Realtime, validates actions on server via handleAuthoritativeAction(),
 *   syncs rounds and 10-team leaderboard.
 */

import type { Action, Actor, Result, TeamState } from '../../shared/types';
import { apply } from '../../shared/sim';

export interface MultiplayerConfig {
  isConfigured: boolean;
  isDemoMode: boolean;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
}

export function getMultiplayerConfig(): MultiplayerConfig {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env || {};
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY;
  const demo = env.VITE_DEMO_MODE !== 'false';

  return {
    isConfigured: Boolean(url && key),
    isDemoMode: demo || !Boolean(url && key),
    supabaseUrl: url,
    supabaseAnonKey: key,
  };
}

export interface MultiplayerSession {
  sessionId: string;
  sessionCode: string;
  teamId: string;
  teamNum: number;
  role: 'team' | 'host';
}

/**
 * Submit action to server if multiplayer is active, otherwise evaluate locally using pure reducer.
 * Idempotency is guaranteed by action.id.
 */
export async function submitAction(
  currentState: TeamState,
  action: Action,
  actor: Actor,
  session?: MultiplayerSession | null
): Promise<Result> {
  const cfg = getMultiplayerConfig();

  // If in demo mode or not connected to multiplayer session, execute locally
  if (cfg.isDemoMode || !session || !cfg.isConfigured) {
    return apply(currentState, action, actor);
  }

  // Authoritative server dispatch
  try {
    const res = await fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: session.sessionId,
        teamId: session.teamId,
        action,
        actor,
        currentState,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Server error' }));
      return { ok: false, error: err.error || 'Failed to submit action to server', state: currentState };
    }

    const data = await res.json();
    return { ok: true, state: data.state, dup: data.dup };
  } catch (err) {
    console.warn('Network error reaching server, evaluating locally:', err);
    return apply(currentState, action, actor);
  }
}
