-- ==============================================================================
-- AI: CODE RED: 02 harden Row-Level Security   (NOT yet run against a live database)
-- Problems fixed from 01_init.sql:
--   * every policy was "using (true)": anyone could read host_token, passcodes and all team state,
--     and any visitor could UPDATE any team row (including score) or INSERT actions.
-- Model after this migration:
--   * Browsers never write to these tables. All writes go through the server (service_role key bypasses RLS).
--   * Browsers may read only: public session info, the leaderboard columns, and their OWN team state/actions/logs.
--   * team ownership = teams.owner = auth.uid()  (use Supabase anonymous sign-in; see SUPABASE_CLIENT_GUIDE.md)
-- ==============================================================================
begin;

-- 1. Remove the open policies
drop policy if exists "Sessions viewable by players"  on public.sessions;
drop policy if exists "Leaderboard viewable by players" on public.teams;
drop policy if exists "Teams update own state"        on public.teams;
drop policy if exists "Teams insert actions"          on public.actions;
drop policy if exists "Actions viewable by team"      on public.actions;
drop policy if exists "Event logs viewable by players" on public.event_logs;

-- 2. Ownership and private state
alter table public.teams add column if not exists owner uuid;
create table if not exists public.team_states (
  team_id uuid primary key references public.teams(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  state jsonb not null,
  version integer not null default 0,        -- optimistic concurrency, checked by the server
  updated_at timestamptz default now()
);
insert into public.team_states (team_id, session_id, state)
  select id, session_id, state from public.teams on conflict (team_id) do nothing;
alter table public.team_states enable row level security;

-- 3. No direct writes from browsers, ever
revoke insert, update, delete on public.sessions, public.teams, public.actions, public.event_logs, public.team_states from anon, authenticated;

-- 4. Column-level reads: hide secrets (host_token, passcode, state) from everyone but the server
revoke select on public.sessions from anon, authenticated;
grant  select (id, code, round, status, round_ends_at, created_at) on public.sessions to anon, authenticated;
revoke select on public.teams from anon, authenticated;
grant  select (id, session_id, team_num, name, score, updated_at) on public.teams to anon, authenticated;

-- 5. Row policies
create policy "sessions: public columns readable" on public.sessions for select using (true);
create policy "teams: leaderboard columns readable" on public.teams for select using (true);
create policy "team_states: owner reads own" on public.team_states for select
  using (exists (select 1 from public.teams t where t.id = team_states.team_id and t.owner = auth.uid()));
create policy "actions: owner reads own" on public.actions for select
  using (exists (select 1 from public.teams t where t.id = actions.team_id and t.owner = auth.uid()));
create policy "event_logs: owner reads own" on public.event_logs for select
  using (exists (select 1 from public.teams t where t.id = event_logs.team_id and t.owner = auth.uid()));

-- 6. The old plain-text columns must not stay readable or writable
alter table public.teams drop column if exists state;      -- now lives in team_states
-- passcode: store only a hash, set by the server. Nothing in the browser may read it (see step 4).
alter table public.teams add column if not exists passcode_hash text;
alter table public.teams drop column if exists passcode;

commit;
-- Realtime note: postgres_changes honors RLS but NOT column grants. For the live leaderboard, have the server
-- broadcast {team_num, name, score} on a Realtime Broadcast channel after each saved action (see the guide).
