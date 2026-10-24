# AI: CODE RED

**AI: CODE RED** is a browser-based, top-down 2D strategy simulation designed for **high school students** in Central Luzon, Philippines. Ten teams compete simultaneously, each managing an emergency typhoon response command center.

The game teaches:
- **AI-assisted decision making** and human-in-the-loop oversight
- **Source verification & fact-checking** under time pressure
- **Circular reporting recognition** (distinguishing viral reshares from independent corroboration)
- **AI hallucination detection** (identifying fabricated evidence citations)
- **Ethical crisis communications** and resource logistics

It is a graphical, interactive strategy game—not a quiz or text adventure.

---

## Current Features

### 1. Interactive 2D Tactical Map
- **Canvas Rendering**: 900×560 virtual coordinate map with zoom, pan, river, and road networks.
- **Fog of War**: Unobserved towns remain shrouded in fog until scouted or corroborated.
- **Dynamic Floods & Hazards**: Towns display animated flood waters as typhoon surges arrive. The bridge to Bagong Silang washes out from Round 3 onward, blocking land units (ambulances).
- **Animated Units**: Drag-and-drop or tap-to-dispatch Rescue Boats, Ambulances, and the Scout Drone with real-time waypoint travel animation.

### 2. Supply Logistics & Replenishment
- **Depot Deliveries**: At the start of each round, a supply delivery automatically adds **+20 fuel** and **+12 food** to your command center.
- **Emergency Resupply Convoy**: Teams can call one emergency resupply per game granting **+40 fuel** and **+25 food** at the next round start.
  - *Risk Factor*: If requested after the bridge breaks in Round 3, the convoy is blocked and delayed.
- **Cost of Delay (15% Loss)**: Flooded areas with unrescued residents decline by **15% each round**. Waiting too long costs lives.

### 3. Rebalanced Reconnaissance & Drone Flights
- **Scout Drone Flight Cap**: Strictly limited to **3 flights per game**. Players must triage where to scout rather than blindly revealing every town.
- **Round 5 Grounding**: In Round 5, storm winds and telecom outages ground the drone entirely.

### 4. The Cross-Check Desk
Each visible report card in the Reports tab features a dedicated **Cross-check Desk**. Players spend **3 Analyst Time Tokens** per round (at zero fuel cost) to cross-check claims against 4 distinct channels:
- 📋 **Official** (PAGASA / MDRRMO / LGU hotline): Highly accurate, but reports from older advisory series (such as R9 and R11) return "no new record" to teach students about stale data.
- 📰 **News** (radio, TV, online): Lags by one round ("no coverage yet" for current round events).
- 📱 **Social Media Search**: Fast and noisy. Detects when hundreds of posts trace back to the same origin chain and alerts students to **circular reporting**.
- 📞 **Barangay Contact** (direct phone call): Highly reliable ground truth, but goes offline in Round 5 when cell networks fail.
- **Independent Corroboration**: Agreement from ≥ 2 channels with distinct origins verifies a claim, allowing boat deployments to earn full verification points without burning a scout flight.
- **Contradictory Evidence Penalty**: Marking a claim verified after an independent channel directly contradicted it incurs a **-6 point penalty**.

### 5. AI Crisis Analyst (Human-in-the-Loop)
- **Deterministic Mock Analyst**: Ranks rescue priorities and recommends actions.
- **Vigilance Tests**: In rounds 3 and 5, the analyst occasionally hallucinates a fabricated report citation (`R77`). Students score top points for flagging made-up sources, and are penalized if they blindly approve them.
- **Duplicate-Reshare Weakness**: The AI sums confidence per area, meaning repost storms can trick the AI into prioritizing dry areas—students must check citations before approving.
- **Ethical Advisories**: Broadcast checked facts, disclose AI uncertainty, or risk public panic by airing unverified claims.

### 6. Scoring Ledger & Replay Timeline
- **Normalized 100-Point Score**:
  - 🚤 **Lives Protected & Rescue Effectiveness**: 30 points
  - ⛽ **Resource Allocation & Evacuation Planning**: 20 points
  - 🔍 **Source Verification & Fact-Checking**: 25 points
  - 📢 **Communication & Ethical Decisions**: 15 points
  - 💡 **Inquiry & Prompt Quality**: 10 points
- **End-Game Evidence Replay**: Interactive timeline filterable by round and category, displaying the evidentiary rationale behind every point earned or lost.

### 7. Multiplayer & Demo Modes
- **Offline Demo Mode (Default)**: Runs instantly in any browser with 9 simulated bot teams on the leaderboard. No server or API keys required.
- **Multiplayer Architecture**: Includes Supabase Postgres schema ([`supabase/migrations/01_init.sql`](supabase/migrations/01_init.sql)) with Row-Level Security, Realtime sync, idempotent action tables, and authoritative server validation ([`server/actionHandler.ts`](server/actionHandler.ts)).

---

## How to Run Locally

### Prerequisites
- [Node.js](https://nodejs.org/) version 18 or higher.

### 1. Install Dependencies
```bash
npm install
```

### 2. Run the Test Suite
The project includes 31 Vitest unit and engine tests covering scoring, resource replenishment, drone limits, delay decay, cross-check channels, and permissions:
```bash
npm test
```

### 3. Verify TypeScript Type Safety
```bash
npm run typecheck
```

### 4. Start the Local Development Server
```bash
npm run dev
```
Open your browser and navigate to:
```
http://localhost:5173
```

---

## Classroom Deployment (Static Site)

1. Build the production distribution bundle:
   ```bash
   npm run build
   ```
2. The compiled assets will be in the `dist/` folder.
3. Deploy to any static hosting service:
   - **Netlify Drop**: Drag and drop the `dist/` directory into [app.netlify.com/drop](https://app.netlify.com/drop).
   - **Vercel / Cloudflare Pages / GitHub Pages**: Point the build command to `npm run build` and output directory to `dist`.
4. Students access the deployed URL from any desktop or mobile browser.
5. Teachers unlock the Host dashboard using passcode `CODERED` to pause/advance rounds or inject simulated crisis events.

For multi-team realtime synchronization using Supabase, see [`SETUP.md`](SETUP.md).
