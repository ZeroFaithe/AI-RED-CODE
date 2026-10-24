import { useState } from 'react';
import type { TeamState } from '../../shared/types';

const STEPS = [
  ['🌀', 'Your Mission: AI: CODE RED', 'A typhoon is flooding towns in Central Luzon. You lead a 10-team emergency command center. Save as many lives as you can across 5 rounds while managing fuel, food, and AI advice.'],
  ['🛰️', 'Scout Drone & Flight Limits', 'The Scout Drone reveals the ground truth of any town, but you have ONLY 3 FLIGHTS for the entire game, and it CANNOT FLY in Round 5 due to storm interference. Choose where to recon wisely!'],
  ['🔍', 'The Cross-check Desk', 'Save fuel and drone flights! In the Reports tab, use your 3 Analyst Time Tokens each round to cross-check claims against Official hotlines, News broadcasts, Social media searches, or Barangay phone calls. 2 independent sources confirm a flood without needing the drone!'],
  ['⚠️', 'Beware Echo Chambers & Stale Advisories', 'Social media searches only echo original rumors—reposts are NOT independent evidence. Older advisories may also be stale. And if an independent check contradicts a claim, do not verify it blindly!'],
  ['⏳', 'Cost of Delay & Supplies', 'Time costs lives: 15% of remaining people in flooded, unrescued towns are lost each round. Supply depots deliver +20 fuel and +12 food each round, and you have ONE emergency resupply convoy (+40 fuel, +25 food)—call it before the bridge breaks in Round 3!'],
  ['🤖', 'Human-in-the-Loop AI', 'The AI Helper suggests rescue priorities, but watch out: it can fabricate fake report citations (like R77) or get tricked by social media reposts. Check citations and approve or reject every deployment yourself.'],
  ['⭐', 'How You Win', 'Score up to 100 points: 30 for lives saved, 20 for resource & supply management, 25 for fact-checking & catching fake AI citations, 15 for honest public communication, and 10 for evidence-seeking AI prompts.']
];

export function Tutorial({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0), [e, t, p] = STEPS[i];
  return (
    <div className="ov">
      <div className="modal">
        <div className="big">{e}</div>
        <h2>{t}</h2>
        <p style={{ lineHeight: 1.6, fontSize: '15px' }}>{p}</p>
        <div className="hint" style={{ margin: '12px 0' }}>Step {i + 1} of {STEPS.length}</div>
        <div>
          {i > 0 && <button className="btn" onClick={() => setI(i - 1)}>Back</button>}
          {i < STEPS.length - 1 ? (
            <button className="btn pri big" onClick={() => setI(i + 1)}>Next</button>
          ) : (
            <button className="btn ok big" onClick={onClose}>Start the Mission</button>
          )}
          <button className="btn" onClick={onClose} style={{ marginLeft: 6 }}>Skip Tutorial</button>
        </div>
      </div>
    </div>
  );
}

const WORDS: [string, string][] = [
  ['Scout Drone Limits', 'Only 3 flights per entire game; grounded in round 5 when storm waves and network failure disable drone operations.'],
  ['Cross-check Desk', 'Free fact-checking tool using 3 Analyst Tokens per round. Checks reports across Official, News, Social, and Barangay channels.'],
  ['Circular Reporting', 'When many social media posts repeat the same original rumor. Reposts look like consensus, but have only ONE origin and zero independent corroboration.'],
  ['Cost of Delay', 'Flooded areas with unevacuated residents decline by 15% each round. Waiting too long or scouting everywhere instead of acting costs lives.'],
  ['Depot Replenishment', 'Every round advance automatically delivers +20 fuel and +12 food to your command center.'],
  ['Emergency Resupply', 'A one-time emergency convoy granting +40 fuel and +25 food. Arrives at the next round start, but fails if requested after the bridge breaks in Round 3.'],
  ['Independent Corroboration', 'Agreement from at least two separate channels with different origins (e.g., Official bulletin + Barangay contact). This validates a claim without needing a drone flight.'],
  ['AI Hallucination', 'When an AI model invents nonexistent evidence or report numbers (like citation R77). Spotting and flagging these scores top verification points.'],
  ['Stale Data', 'Advisories from earlier rounds that were true hours ago but do not reflect current flooding. Official hotline will report "no new record".']
];

export function Glossary({ onClose }: { onClose: () => void }) {
  return (
    <div className="ov" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>AI: CODE RED — Reference Guide</h2>
        {WORDS.map(([w, d]) => (
          <p key={w} style={{ margin: '10px 0' }}>
            <b style={{ color: '#ff6b5b' }}>{w}</b>: {d}
          </p>
        ))}
        <button className="btn pri big" onClick={onClose} style={{ marginTop: 12 }}>Got it</button>
      </div>
    </div>
  );
}

export function Legend() {
  return (
    <div className="legend">
      <div>🚤 <b>Rescue Boat:</b> carries up to 40 people (12 fuel, 6 food)</div>
      <div>🚑 <b>Ambulance:</b> carries up to 20 (8 fuel, 1 medic, blocked by broken bridge)</div>
      <div>🛰️ <b>Scout Drone:</b> reveals one town (8 fuel, max 3 flights, disabled Rd 5)</div>
      <div>🔍 <b>Cross-check Desk:</b> 3 tokens/rd to verify claims cheaply</div>
      <div>⬜ <b>Gray shade:</b> unobserved (fog of war)</div>
      <div>🔵 <b>Blue circle:</b> confirmed flooding</div>
      <div>⭕ <b>Dashed ring:</b> flood rumor (not yet confirmed)</div>
      <div>🟦 <b>EVAC:</b> evacuation shelter (occupancy / capacity)</div>
      <div>➕ <b>Hospital</b></div>
      <div>🟥 <b>Bridge OUT:</b> road blocked from Round 3 onward</div>
    </div>
  );
}

export function coachText(s: TeamState): [string, string] {
  if (s.finished) return ['Mission Complete', 'Open the Score tab to see why you earned each point and debrief your decisions.'];
  if (s.round >= 5 && s.droneFlights > 0) return ['Round 5: Drone Grounded', 'Severe weather and network blackout have grounded the Scout Drone. Rely on HAM radio (R14) and verified reports!'];
  if (s.droneFlights <= 0) return ['Scout Drone Out of Flights', 'You have used all 3 drone flights. Use the Cross-check Desk in Reports to corroborate reports with 2 independent channels before deploying!'];
  if (Object.keys(s.crossChecks).length === 0) return ['Step 1: Use the Cross-check Desk', 'Open the Reports tab. Click "Official" or "Barangay" on a report to cross-check it without spending fuel or drone flights.'];
  if (s.ai.length === 0) return ['Step 2: Consult the AI Helper', 'Open the AI Helper tab. Ask an evidence-based question, then check each cited report to catch hallucinations.'];
  if (s.saved === 0) return ['Step 3: Rescue Stranded Residents', 'Drag a Rescue Boat onto a confirmed flooded town. Remember: unrescued towns lose 15% of people each round to delay!'];
  return ['Monitor & Triage', 'Watch for circular social reposts and stale reports. Keep fuel ready and call emergency resupply before bridge failure if running low.'];
}
