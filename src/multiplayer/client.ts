import { createClient } from '@supabase/supabase-js';
import type { Action, TeamState, Rec } from '../../shared/types';

export const isDemoMode = (): boolean => import.meta.env.VITE_DEMO_MODE === 'true';

export const sb = createClient(
  import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co',
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder',
);

export interface LeaderboardRow {
  id: string;
  team_num: number;
  name: string;
  score: number;
}

export interface SessionInfo {
  id: string;
  code: string;
  round: number;
  status: 'lobby' | 'active' | 'paused' | 'finished';
  round_ends_at: string | null;
  round_time: number;
}

export interface JoinResult {
  ok: boolean;
  sessionId: string;
  sessionCode: string;
  teamId: string;
  teamNum: number;
  teamName: string;
  reconnected?: boolean;
  error?: string;
}

/** Call once when the app loads. Gives each student's computer its own anonymous login. */
export async function ensureSignedIn(): Promise<string> {
  if (isDemoMode()) return 'demo-user-id';
  const { data } = await sb.auth.getSession();
  if (data.session) return data.session.user.id;
  const { data: created, error } = await sb.auth.signInAnonymously();
  if (error || !created.user) throw new Error('Could not sign in: ' + (error?.message ?? 'unknown error'));
  return created.user.id;
}

export async function getAccessToken(): Promise<string> {
  if (isDemoMode()) return 'demo-token';
  const { data } = await sb.auth.getSession();
  if (!data.session) {
    await ensureSignedIn();
    const fresh = await sb.auth.getSession();
    return fresh.data.session?.access_token || '';
  }
  return data.session.access_token;
}

/** The public leaderboard columns for one session. */
export async function fetchLeaderboard(sessionId: string): Promise<LeaderboardRow[]> {
  if (isDemoMode()) return [];
  const { data, error } = await sb
    .from('teams')
    .select('id,team_num,name,score')
    .eq('session_id', sessionId)
    .order('score', { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** This team's own saved game state (the database only lets the team's owner read it). */
export async function fetchOwnState(teamId: string): Promise<{ state: TeamState; version: number }> {
  if (isDemoMode()) {
    throw new Error('fetchOwnState called in demo mode');
  }
  const { data, error } = await sb
    .from('team_states')
    .select('state,version')
    .eq('team_id', teamId)
    .single();
  if (error || !data) throw new Error(error?.message ?? 'No saved state for this team');
  return data as { state: TeamState; version: number };
}

/** Verify facilitator passcode securely against server route. */
export async function verifyHostPasscodeServer(passcode: string): Promise<boolean> {
  if (isDemoMode()) {
    return passcode.trim().toUpperCase() === 'CODERED';
  }
  try {
    const res = await fetch('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ passcode, checkOnly: true }),
    });
    const data = await res.json();
    return Boolean(data.ok && data.valid);
  } catch {
    return false;
  }
}

/** Create a session as host. */
export async function createSession(passcode: string, roundTime = 120): Promise<{ ok: boolean; session?: SessionInfo; teams?: any[]; error?: string }> {
  const token = await getAccessToken();
  const res = await fetch('/api/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ passcode, token, roundTime }),
  });
  return res.json();
}

/** Lookup a session and its registered teams. */
export async function fetchSession(codeOrId: string): Promise<{ ok: boolean; session?: SessionInfo; teams?: any[]; error?: string }> {
  const isCode = codeOrId.toUpperCase().startsWith('CR-');
  const url = isCode ? `/api/session?code=${encodeURIComponent(codeOrId)}` : `/api/session?id=${encodeURIComponent(codeOrId)}`;
  const res = await fetch(url);
  return res.json();
}

/** Host-only: activate (start), pause, or resume a session via PATCH /api/session. */
export async function patchSession(sessionId: string, action: 'start' | 'pause' | 'resume'): Promise<{ ok: boolean; error?: string }> {
  if (isDemoMode()) return { ok: true };
  const token = await getAccessToken();
  const res = await fetch('/api/session', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, sessionId, action }),
  });
  return res.json();
}

/** Claim a team slot in a session. */
export async function joinSession(sessionCode: string, teamName: string, teamNum?: number): Promise<JoinResult> {
  const token = await getAccessToken();
  const res = await fetch('/api/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, sessionCode, teamName, teamNum }),
  });
  return res.json();
}

/** Send a game action to the server. Never write to the tables directly. */
export async function sendAction(sessionId: string, teamId: string, action: Action) {
  const token = await getAccessToken();
  const res = await fetch('/api/action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, sessionId, teamId, action }),
  });
  return (await res.json()) as { ok: boolean; status: number; state?: TeamState; score?: number; error?: string; dup?: boolean };
}

/** Background tick poll: applies due arrivals and retrieves latest state & timer. */
export async function pollTick(sessionId: string, teamId: string) {
  const res = await fetch('/api/tick', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, teamId }),
  });
  return (await res.json()) as { ok: boolean; state?: TeamState; version?: number; score?: number; session?: SessionInfo; error?: string };
}

/** Call server-side AI helper. */
export async function requestAiAnalysis(sessionId: string, teamId: string, state: TeamState, prompt: string): Promise<Rec> {
  const token = await getAccessToken();
  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, sessionId, teamId, state, prompt }),
  });
  const data = await res.json();
  if (!data.ok || !data.rec) throw new Error(data.error ?? 'AI request failed');
  return data.rec;
}

/** Host dashboard data fetch. */
export async function fetchHostTeams(sessionId: string) {
  const token = await getAccessToken();
  const res = await fetch('/api/host-teams', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, sessionId }),
  });
  return res.json();
}

/** Live leaderboard updates. The server broadcasts after every saved action. Returns an unsubscribe function. */
export function subscribeLeaderboard(sessionId: string, onRow: (row: LeaderboardRow) => void): () => void {
  if (isDemoMode()) return () => {};
  const channel = sb
    .channel('leaderboard:' + sessionId)
    .on('broadcast', { event: 'score' }, msg => onRow(msg.payload as LeaderboardRow))
    .subscribe();
  return () => { void sb.removeChannel(channel); };
}