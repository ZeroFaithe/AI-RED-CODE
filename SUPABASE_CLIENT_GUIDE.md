# Supabase client and server wiring (instructions, NOT implemented)

The repository intentionally does not include the Supabase client. Everything below is what to add. The game rules
(`shared/sim.ts`) and the security-critical handler (`server/actionHandler.ts`) already exist and are unit-tested with
an in-memory fake; you only supply real storage and login.

## 0. Today's status
Rooms, joining and the leaderboard work **only inside one browser** (BroadcastChannel + localStorage). Ten separate
computers cannot play together until the steps below are done.

## 1. Create the project and apply the SQL
1. Create a project at supabase.com. In **Authentication > Providers** enable **Anonymous sign-ins**.
2. SQL Editor: run `supabase/migrations/01_init.sql`, then `supabase/migrations/02_harden_rls.sql`.
   (02 removes the open policies. It has not been run against a database by us: run it on a fresh project first.)
3. `npm i @supabase/supabase-js`

## 2. Environment variables
Browser (public): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_DEMO_MODE=false`.
Server only (host's environment settings; never commit, never prefix with VITE_):
`SUPABASE_SERVICE_ROLE_KEY`, `HOST_PASSCODE` (a long random string, NOT "CODERED"), optional `AI_API_KEY`.

## 3. Browser client (`src/multiplayer/client.ts`)
```ts
import { createClient } from '@supabase/supabase-js';
export const sb = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);
// On first load: await sb.auth.signInAnonymously();  (gives each student computer a stable user id)
// Read the leaderboard:  sb.from('teams').select('id,team_num,name,score').eq('session_id', sid)
// Read own state:        sb.from('team_states').select('state,version').eq('team_id', myTeamId).single()
// Send an action (never write tables directly):
//   const { data:{ session } } = await sb.auth.getSession();
//   await fetch('/api/action', { method:'POST', headers:{'content-type':'application/json'},
//     body: JSON.stringify({ token: session!.access_token, sessionId, teamId, action }) });
```
`action.id` must be a fresh `crypto.randomUUID()` per click. A retry after a dropped connection reuses the same id, so
it cannot score twice.

## 4. Server routes (Vercel example; Netlify functions are equivalent)
`api/action.ts`
```ts
import { createClient } from '@supabase/supabase-js';
import { handleAuthoritativeAction, type ServerDeps } from '../server/actionHandler';
const admin = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const deps: ServerDeps = {
  async authenticate(token) {
    const { data } = await admin.auth.getUser(token); if (!data.user) return null;
    // host: a row in sessions.host_owner (add this column) equal to the user id  =>  { role:'host', sessionId }
    // team: teams.owner = data.user.id  =>  { role:'team', sessionId, teamId }
    /* look both up with `admin` and return the Principal, or null */ return null;
  },
  async loadTeamState(sessionId, teamId) { const { data } = await admin.from('team_states').select('state,version').eq('team_id', teamId).eq('session_id', sessionId).single(); return data ? { state: data.state, version: data.version } : null; },
  async saveTeamState(sessionId, teamId, state, score, v) {
    const { data } = await admin.from('team_states').update({ state, version: v + 1, updated_at: new Date().toISOString() }).eq('team_id', teamId).eq('session_id', sessionId).eq('version', v).select('team_id');
    if (!data?.length) return false;
    await admin.from('teams').update({ score, updated_at: new Date().toISOString() }).eq('id', teamId);
    // then broadcast the leaderboard row on a Realtime Broadcast channel
    return true;
  },
};
export default async function handler(req: any, res: any) { const out = await handleAuthoritativeAction(deps, req.body); res.status(out.status).json(out); }
```
Also needed (all server-side, `verifyHostPasscode` is in `server/hostAuth.ts`):
- `api/session` (host creates a session: checks `verifyHostPasscode(body.passcode, process.env.HOST_PASSCODE)`, inserts the
  session with `host_owner = user id`, creates 10 `teams` rows and their initial `team_states` using `newTeamState`).
- `api/join` (a student picks a free team slot and sets `teams.owner` to their user id; reject if the slot is taken).
- **Arrivals:** after a successful `deploy`, schedule `handleSystemArrive(deps, sessionId, teamId, unitId, uuid)` after the
  travel time (distance / speed). On serverless hosts use a queued job or a database `arrive_at` column checked by a
  one-minute cron, because timers do not survive between invocations.
- **Round timer:** the server (host action `advance`) moves rounds; browsers display `sessions.round_ends_at`.
- `/api/ai` using `server/aiHandler.ts` (the same token check first).

## 5. What the browser must stop doing
Remove `localStorage` as the source of truth, stop using the passcode `CODERED` in `HostPage`, and stop passing
`currentState` or `actor` in requests (the server ignores them by design).

## 6. Before game day, test with 3 browsers
Two teams plus the host: confirm a team cannot read another team's `team_states`, cannot call `advance`, and that
re-sending the same action id does not change the score.
