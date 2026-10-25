# AI: CODE RED — Setup and Deployment Guide

## Overview
**AI: CODE RED** is a top-down 2D strategy game designed for high school students in Central Luzon, Philippines. Ten teams compete simultaneously, each running a disaster command center responding to a five-round typhoon crisis. The game teaches source verification, circular reporting recognition, human-in-the-loop AI decision making, hallucination spotting, and ethical crisis communications.

---

## 1. Local Development (Single Computer / Demo Mode)
Requires Node.js 18+ on this machine. No external services or database required.

```bash
# 1. Install dependencies
npm install

# 2. Run unit and engine test suite (all 48 tests)
npm test

# 3. Verify TypeScript type safety
npm run typecheck

# 4. Start local development server
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in any modern browser.

---

## 2. Classroom Deployment (Static Site — Zero Server Needed)
For a school computer lab where students have internet access:
1. Run `npm run build`. This generates the `dist/` directory containing static HTML, CSS, and JS bundles.
2. Deploy the `dist/` folder to any static hosting provider:
   - **Netlify Drop**: Drag and drop `dist/` into [app.netlify.com/drop](https://app.netlify.com/drop).
   - **Vercel / Cloudflare Pages / GitHub Pages**: Link the repo and set:
     - Build Command: `npm run build`
     - Output Directory: `dist`
3. Each student or student team navigates to the deployed URL.
   - Runs independently in local demo mode.
   - Leaderboard tracks the team's ranking against 9 simulated competitor teams.
   - Facilitator unlocks Host controls using passcode `CODERED`.

---

## 3. Multiplayer Mode (Supabase Realtime + Authoritative Server)
To synchronize 10 live student teams in real time across the classroom:

### Step 1: Create a Supabase Project
1. Create a free project at [supabase.com](https://supabase.com).
2. Go to the **SQL Editor** in the Supabase dashboard.
3. Open `supabase/migrations/01_init.sql` from this repository and run the SQL script. This creates:
   - `sessions` table (enforces 5 rounds, session codes, host authentication)
   - `teams` table (constrained to exactly 10 registered teams per session)
   - `actions` table (idempotent action log with unique `action_id`)
   - `event_logs` table (realtime audit trail)
   - Row-Level Security (RLS) policies and Realtime replication publications.

### Step 2: Configure Environment Variables
Copy `.env.example` to `.env`:
```env
VITE_DEMO_MODE=false
VITE_SUPABASE_URL=https://<your-project-id>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-public-anon-key>
```
On your serverless host (e.g. Vercel/Netlify Functions):
```env
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-secret-key>
AI_API_KEY=<optional-gemini-or-llm-api-key>
```

### Step 3: Serverless Endpoint Deployment
- `/api/action`: Invokes `handleAuthoritativeAction()` in `server/actionHandler.ts`, ensuring all state transitions are validated on the server using `shared/sim.ts` before committing to the database.
- `/api/ai`: Invokes `handleAiRequest()` in `server/aiHandler.ts`. If `AI_API_KEY` is present, it queries Gemini with typhoon crisis guardrails; otherwise, it deterministically runs `generateRec()`. Secrets are never exposed to the client.

---

## 4. Game Mechanics and Design Details
1. **Supply Replenishment**:
   - **Scheduled Depot Deliveries**: +20 fuel and +12 food automatically delivered at each round start.
   - **Emergency Resupply**: One-time convoy request (+40 fuel, +25 food) arriving next round. If requested after the bridge washes out in Round 3, the convoy fails/delays.
2. **Scout Drone Rebalancing**:
   - Strictly limited to **3 flights per game**.
   - **Grounded in Round 5** due to storm and network blackouts.
3. **Cost of Delay (15% Decay)**:
   - Flooded areas with unevacuated residents decline by 15% each round. Waiting too long costs lives.
4. **The Cross-check Desk**:
   - In the Reports tab, teams spend 3 **Analyst Time Tokens** per round (free of fuel) to check claims against 4 channels:
     - 📋 **Official**: Accurate, but returns "no new record" for stale advisory series (e.g. R9, R11).
     - 📰 **News**: Lags 1 round (reports "no coverage yet" for new events).
     - 📱 **Social**: Fast and noisy. Echoes original posts—warns students about **circular reporting**.
     - 📞 **Barangay**: Reliable direct contact, but unavailable in Round 5.
   - **Independent Corroboration**: Agreement from ≥ 2 channels of different origins verifies a claim without needing a drone flight.
   - **Contradictory Evidence Penalty**: Marking a claim verified after independent evidence contradicted it results in a -6 verification penalty.
5. **Replay Timeline**:
   - Full evidence audit trail viewable on Debrief and Score tabs. Filterable by round and category.
