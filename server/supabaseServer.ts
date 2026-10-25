import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { apply } from '../shared/sim.js';
import { total } from '../shared/scoring.js';
import { newTeamState } from '../shared/sim.js';
import type { Action, Actor, TeamState } from '../shared/types.js';
import {
  type ServerDeps,
  type Principal,
  type Versioned,
  type ActionResponse,
  processDueArrivals,
  handleAuthoritativeAction,
  handleSystemArrive,
} from './actionHandler.js';

let cachedAdmin: SupabaseClient | null = null;

export function getAdminClient(): SupabaseClient {
  if (cachedAdmin) return cachedAdmin;
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment');
  }
  cachedAdmin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedAdmin;
}

export async function broadcastScore(
  admin: SupabaseClient,
  sessionId: string,
  payload: { id: string; team_num: number; name: string; score: number }
) {
  try {
    const channel = admin.channel('leaderboard:' + sessionId);
    await channel.send({
      type: 'broadcast',
      event: 'score',
      payload,
    });
  } catch (err) {
    console.warn('Realtime score broadcast failed:', err);
  }
}

export function createSupabaseServerDeps(admin: SupabaseClient): ServerDeps {
  return {
    async authenticate(token: string): Promise<Principal | null> {
      if (!token) return null;
      try {
        const { data, error } = await admin.auth.getUser(token);
        if (error || !data?.user) return null;
        const uid = data.user.id;

        // Check if host
        const { data: hostSess } = await admin
          .from('sessions')
          .select('id')
          .eq('host_owner', uid)
          .limit(1);

        if (hostSess && hostSess.length > 0) {
          return { role: 'host', sessionId: hostSess[0].id };
        }

        // Check if team owner
        const { data: teamRows } = await admin
          .from('teams')
          .select('id, session_id')
          .eq('owner', uid)
          .limit(1);

        if (teamRows && teamRows.length > 0) {
          return { role: 'team', sessionId: teamRows[0].session_id, teamId: teamRows[0].id };
        }

        return null;
      } catch (err) {
        console.error('authenticate error:', err);
        return null;
      }
    },

    async loadTeamState(sessionId: string, teamId: string): Promise<Versioned | null> {
      try {
        const { data, error } = await admin
          .from('team_states')
          .select('state, version')
          .eq('team_id', teamId)
          .eq('session_id', sessionId)
          .maybeSingle();

        if (error || !data) return null;
        return { state: data.state as TeamState, version: data.version };
      } catch (err) {
        console.error('loadTeamState error:', err);
        return null;
      }
    },

    async saveTeamState(
      sessionId: string,
      teamId: string,
      state: TeamState,
      score: number,
      expectedVersion: number
    ): Promise<boolean> {
      try {
        const now = new Date().toISOString();
        const { data, error } = await admin
          .from('team_states')
          .update({ state, version: expectedVersion + 1, updated_at: now })
          .eq('team_id', teamId)
          .eq('session_id', sessionId)
          .eq('version', expectedVersion)
          .select('team_id');

        if (error || !data?.length) return false;

        const { data: teamData } = await admin
          .from('teams')
          .update({ score, updated_at: now })
          .eq('id', teamId)
          .select('id, team_num, name, score')
          .single();

        if (teamData) {
          await broadcastScore(admin, sessionId, {
            id: teamData.id,
            team_num: teamData.team_num,
            name: teamData.name,
            score: teamData.score,
          });
        }

        return true;
      } catch (err) {
        console.error('saveTeamState error:', err);
        return false;
      }
    },

    async listSessionTeamIds(sessionId: string): Promise<string[]> {
      const { data } = await admin
        .from('teams')
        .select('id')
        .eq('session_id', sessionId)
        .order('team_num', { ascending: true });
      return data?.map(t => t.id) ?? [];
    },
  };
}
