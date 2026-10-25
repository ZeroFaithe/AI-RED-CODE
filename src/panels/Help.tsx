import { useState } from 'react';
import { B, rules } from '../../shared/scenario';
import { flooded, support } from '../../shared/sim';
import type { TeamState } from '../../shared/types';

type Mode = TeamState['mode'];

const steps = (mode: Mode): [string, string, string][] => {
  const R = rules({ mode });
  return [
    ['🌀', 'What is happening', 'A typhoon is flooding towns in Central Luzon. You are the emergency command team. Your job: find out which towns are really flooded, and send boats to rescue people there. The game has 5 rounds.'],
    ['🗺️', 'The map', `Gray towns are unknown. Blue circles are confirmed floods. Tap a town to see what we know. To rescue people: drag a unit from the bottom onto a town, or tap a unit and then a town. A rescue boat takes up to ${R.cap.boat} people to shelter.`],
    ['📨', 'Reports can be wrong', 'The Reports tab lists messages about each town. Some are true, some are old, some are rumors. Many people sharing the SAME post is not proof - it is still just one source.'],
    ['🔍', 'Check before you send', `Under each report, tap a source (Official, News, Barangay) to check it. You get ${R.tokens} checks each round. When 2 different sources agree, you will see a green "Probably TRUE" message - safe to send help.`],
    ['🤖', 'The AI helper can make mistakes', 'The AI suggests where to go. It is fast but not always right - sometimes it quotes a report that does not exist (like "R77"). Tap each source it lists. You decide: approve, reject, or flag it.'],
    ['⛽', 'Fuel, food and time', `Boats use fuel and food (${R.cost.boat.fuel} fuel + ${R.cost.boat.food} food each trip). Supplies arrive every round. Waiting costs lives, so do not freeze up - but do not send boats blindly either.`],
    ['⭐', 'How you score', 'Points for people saved, using supplies well, checking sources, catching the AI\'s mistakes, and honest announcements. Your mistakes are explained in the Score tab so you can learn from them. Good luck!'],
  ];
};

export function Tutorial({ onClose, mode }: { onClose: () => void; mode?: Mode }) {
  const STEPS = steps(mode);
  const [i, setI] = useState(0), [e, t, p] = STEPS[i];
  return (
    <div className="ov">
      <div className="modal">
        <div className="big">{e}</div>
        <h2>{t}</h2>
        <p style={{ lineHeight: 1.6, fontSize: '16px' }}>{p}</p>
        <div className="hint" style={{ margin: '12px 0' }}>Step {i + 1} of {STEPS.length}</div>
        <div>
          {i > 0 && <button className="btn" onClick={() => setI(i - 1)}>Back</button>}
          {i < STEPS.length - 1 ? (
            <button className="btn pri big" onClick={() => setI(i + 1)}>Next</button>
          ) : (
            <button className="btn ok big" onClick={onClose}>Start the Mission</button>
          )}
          <button className="btn" onClick={onClose} style={{ marginLeft: 6 }}>Skip</button>
        </div>
      </div>
    </div>
  );
}

const WORDS: [string, string][] = [
  ['Barangay', 'The smallest local government unit in the Philippines - like a neighborhood. Its captain knows what is happening on the ground.'],
  ['Source', 'Who a piece of information came from (a forecaster, a resident, a social media page).'],
  ['Independent sources', 'Two sources that did NOT get their information from each other. Two independent sources agreeing is strong evidence.'],
  ['Circular reporting', 'Many posts that all trace back to one original post. It looks like lots of people agree, but it is really ONE source repeated.'],
  ['Stale / outdated', 'Information that used to be true but is now old. A "no flooding" report from 10 hours ago may be wrong now.'],
  ['AI hallucination', 'When an AI confidently makes something up - like a report number that does not exist. Always check what the AI cites.'],
  ['Fog of war', 'The gray shade on the map: you do not know the real situation there yet. Check reports or fly the scout drone.'],
  ['Scout drone', 'Flies to one town and shows you the truth. You only have a few flights, so use them where you are least sure.'],
  ['Cost of delay', 'People in flooded towns who are not rescued are lost each round. Acting too slowly costs lives.'],
];

export function Glossary({ onClose }: { onClose: () => void }) {
  return (
    <div className="ov" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>📖 Words to know</h2>
        {WORDS.map(([w, d]) => (
          <p key={w} style={{ margin: '10px 0' }}>
            <b style={{ color: '#d6432f' }}>{w}</b>: {d}
          </p>
        ))}
        <button className="btn pri big" onClick={onClose} style={{ marginTop: 12 }}>Got it</button>
      </div>
    </div>
  );
}

export function Legend({ mode }: { mode?: Mode }) {
  const R = rules({ mode });
  return (
    <div className="legend">
      <div>🚤 <b>Rescue boat:</b> takes up to {R.cap.boat} people ({R.cost.boat.fuel} fuel, {R.cost.boat.food} food)</div>
      <div>🚑 <b>Ambulance:</b> takes up to {R.cap.amb} ({R.cost.amb.fuel} fuel, 1 medic). Cannot cross the broken bridge</div>
      <div>🛰️ <b>Scout drone:</b> shows the truth about one town ({R.cost.drone.fuel} fuel, {R.droneMax} flights, not in Round 5)</div>
      <div>⬜ <b>Gray shade:</b> we do not know yet</div>
      <div>🔵 <b>Blue circle:</b> confirmed flood</div>
      <div>⭕ <b>Dashed ring:</b> rumor of flooding (not confirmed)</div>
      <div>🟦 <b>EVAC:</b> shelter (people inside / space)</div>
      <div>➕ <b>Hospital</b></div>
      <div>🟥 <b>Bridge OUT:</b> blocked from Round 3</div>
    </div>
  );
}

const ROUND_NOTE = [
  '',
  '',
  'Round 3: the bridge to Bagong Silang is OUT. If the AI quotes a report you cannot find, it made it up.',
  'Round 4: two "official" reports about Dalig disagree. Check which one is newer.',
  'Round 5: phones are down and the drone is grounded. Use the ham radio report (R14).',
];

/** "What should I do now?" checklist - replaces the old single-line coach box. */
export function Goals({ s }: { s: TeamState }) {
  if (s.finished) {
    return (
      <div className="coach">
        <b>🏁 Mission complete!</b>
        <div>Open the Score tab to see what you did well and what to improve.</div>
      </div>
    );
  }
  const checkedNow = Object.values(s.crossChecks).some(list => list.some(c => c.rd === s.round));
  const sure = B.some(b => flooded(s, b) && s.pop[b.id] > 0 && support(s, b));
  const rescued = s.led.some(l => l.rd === s.round && l.cat === 'lives' && l.pts > 0);
  const asked = s.ai.some(r => r.rd === s.round);
  const goals: [boolean, string][] = [
    [checkedNow, 'Check a report (Reports tab → tap a source)'],
    [sure, 'Find a town you are SURE is flooded (2 sources agree, or use the drone)'],
    [rescued, 'Send a boat to that town'],
    [asked, 'Ask the AI helper - then check its sources'],
  ];
  const next = goals.find(g => !g[0]);
  return (
    <div className="coach">
      <b>Round {s.round} goals</b>
      {goals.map(([done, text]) => (
        <div key={text} style={{ opacity: done ? 0.55 : 1 }}>{done ? '✅' : '⬜'} {text}</div>
      ))}
      <div style={{ marginTop: 4, color: '#7a5600' }}>
        {next ? <>👉 <b>Next:</b> {next[1]}</> : <>🎉 Great round! You can keep checking reports while you wait for the next round.</>}
      </div>
      {ROUND_NOTE[s.round - 1] && <div className="hint" style={{ marginTop: 4 }}>{ROUND_NOTE[s.round - 1]}</div>}
    </div>
  );
}