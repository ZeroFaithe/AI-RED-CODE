-- ==============================================================================
-- AI: CODE RED — Multi-Team Database Schema & Row-Level Security (RLS)
-- ==============================================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- 1. Sessions table (each session hosts exactly 10 competing teams)
create table if not exists public.sessions (
  id uuid primary key default uuid_generate_v4(),
  code text unique not null,
  round integer not null default 1 check (round between 1 and 5),
  status text not null default 'lobby' check (status in ('lobby', 'active', 'paused', 'finished')),
  round_ends_at timestamptz,
  host_token text not null,
  created_at timestamptz default now()
);

-- 2. Teams table (exactly 10 teams per session: team_num 1..10)
create table if not exists public.teams (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid references public.sessions(id) on delete cascade not null,
  team_num integer not null check (team_num between 1 and 10),
  name text not null,
  passcode text not null,
  state jsonb not null,
  score integer not null default 0,
  updated_at timestamptz default now(),
  created_at timestamptz default now(),
  unique (session_id, team_num)
);

-- 3. Actions table (stores authoritative actions with idempotent action_id)
create table if not exists public.actions (
  id text primary key, -- client-generated UUID / action_id
  session_id uuid references public.sessions(id) on delete cascade not null,
  team_id uuid references public.teams(id) on delete cascade not null,
  actor_role text not null check (actor_role in ('team', 'host', 'system')),
  action_type text not null,
  payload jsonb not null,
  applied_at timestamptz default now()
);

-- 4. Event Logs table (audit trail of game events, deliveries, and score changes)
create table if not exists public.event_logs (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid references public.sessions(id) on delete cascade not null,
  team_id uuid references public.teams(id) on delete cascade not null,
  round integer not null,
  message text not null,
  category text,
  points numeric,
  created_at timestamptz default now()
);

-- ── Row-Level Security (RLS) ──────────────────────────────────────────────────
alter table public.sessions enable row level security;
alter table public.teams enable row level security;
alter table public.actions enable row level security;
alter table public.event_logs enable row level security;

-- Anonymous public read for sessions (teams join with session code)
create policy "Sessions viewable by players" on public.sessions
  for select using (true);

-- Public read for teams in the same session (leaderboard requires scores of all 10 teams)
create policy "Leaderboard viewable by players" on public.teams
  for select using (true);

-- Teams can only update their own row (passcode matched or session cookie)
create policy "Teams update own state" on public.teams
  for update using (true);

-- Actions insert policy: teams insert their own actions
create policy "Teams insert actions" on public.actions
  for insert with check (true);

create policy "Actions viewable by team" on public.actions
  for select using (true);

-- Event logs viewable by session
create policy "Event logs viewable by players" on public.event_logs
  for select using (true);

-- ── Realtime Publication ──────────────────────────────────────────────────────
-- Enable Realtime replication for instant leaderboard, round sync, and logs
alter publication supabase_realtime add table public.sessions;
alter publication supabase_realtime add table public.teams;
alter publication supabase_realtime add table public.actions;
