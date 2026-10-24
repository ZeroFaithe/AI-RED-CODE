# AI: CODE RED (stage 1: shared simulation + scoring)

Pure, deterministic TypeScript modules that both the future client and server will import.

- `shared/scenario.ts` seeded map, 14 reports across 5 rounds, costs, capacities
- `shared/sim.ts` authoritative reducer `apply(state, action, actor)`: permission checks, idempotent per action id, never mutates input
- `shared/scoring.ts` ledger with category caps (lives 30, resources 20, verification 25, communication 15, prompts 10) and one-time event keys
- `tests/sim.test.ts` 16 tests: scoring caps, dedupe, resources, blocked roads, verification fairness, AI mock determinism, hallucination handling, permissions, replayed actions, round progression

Run: see SETUP.md

## Not built yet
React UI, canvas map port, `/api/ai` endpoint, Supabase schema/RLS, realtime sync, ten-team leaderboard, host authorization.
The published single-file prototype remains the visual reference. Travel time is not simulated here: the clock/server issues an `arrive` action.
Known gap: no penalty yet for ignoring credible contradictory evidence.
