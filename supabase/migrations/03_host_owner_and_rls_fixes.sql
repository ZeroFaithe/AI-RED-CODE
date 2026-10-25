-- ==============================================================================
-- AI: CODE RED: 03 Host Owner, Schema Enhancements, and RLS Fixes
-- ==============================================================================
begin;

-- 1. Add host_owner to sessions so authoritative server can authenticate host by auth.uid()
alter table public.sessions add column if not exists host_owner uuid;
alter table public.sessions add column if not exists name text default 'Disaster Command Center';
alter table public.sessions add column if not exists round_time integer default 120;

-- 2. Grant select on new session columns (host_token remains strictly revoked and private)
grant select (host_owner, name, round_time) on public.sessions to anon, authenticated;

-- 3. Grant select on teams.owner to anon, authenticated.
-- CRITICAL FIX: In 02_harden_rls.sql, RLS policies on team_states, actions, and event_logs
-- check `t.owner = auth.uid()`. Without column-level select permission on `teams.owner`,
-- Postgres throws "permission denied for column owner of relation teams".
-- Granting select on `owner` fixes this and allows clients to identify their own team slot.
grant select (owner) on public.teams to anon, authenticated;

-- 4. Explicit select grants on private tables guarded by RLS
grant select (team_id, session_id, state, version, updated_at) on public.team_states to anon, authenticated;
grant select on public.actions to anon, authenticated;
grant select on public.event_logs to anon, authenticated;

commit;
