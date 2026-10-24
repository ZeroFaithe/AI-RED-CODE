import { useEffect, useRef, useState } from 'react';
import MapCanvas, { HQ, type Move } from './map/MapCanvas';
import { Analyst, Board, Debrief, Host, Reports, Score, type D } from './panels/Panels';
import { Glossary, Legend, Tutorial, coachText } from './panels/Help';
import { LandingPage, JoinPage, HostPage, HostLeaderboard } from './panels/MainMenu';
import {
  type ServerRoom,
  saveRoom,
  getRoom,
  broadcast,
  subscribeToSync,
} from './multiplayer/roomSync';
import { B, COST, RT, DEPOT_FUEL, DEPOT_FOOD, RESUPPLY_FUEL, RESUPPLY_FOOD } from '../shared/scenario';
import { apply, flooded, newTeamState } from '../shared/sim';
import { total } from '../shared/scoring';
import type { Action, Actor, TeamState } from '../shared/types';
import './styles.css';
import './menu.css';

const TEAM = 'team-1', KEY = 'cr_react_v3', SEEN = 'cr_seen', SPD = { boat: 110, amb: 150, drone: 210 };
const TABS: [string, string][] = [
  ['rep', '📨 Reports & Desk'],
  ['ai', '🤖 AI Helper'],
  ['sco', '⭐ Score'],
  ['brd', '🏆 Board'],
  ['host', '🎓 Host'],
];

type ViewMode = 'menu' | 'join' | 'host' | 'player_game' | 'host_leaderboard';

const load = (): TeamState => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null') as TeamState | null;
    if (s?.units && s.droneFlights !== undefined && s.analystTokens !== undefined && s.supply) {
      s.units.forEach(u => { u.st = 'idle'; });
      return s;
    }
  } catch { /* ignore */ }
  return newTeamState(TEAM);
};

export default function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('menu');
  const [currentRoom, setCurrentRoom] = useState<ServerRoom | null>(null);
  const [myTeam, setMyTeam] = useState<{ id: string; name: string } | null>(null);

  const [s, setS] = useState(load);
  const [tab, setTab] = useState('rep');
  const [sel, setSel] = useState<string | null>(null);
  const [pend, setPend] = useState<{ unit: string; b: string } | null>(null);
  const [msg, setMsg] = useState('');
  const [t, setT] = useState(120);
  const [paused, setPaused] = useState(false);
  const [unit, setUnit] = useState<string | null>(null);
  const [tut, setTut] = useState(() => !localStorage.getItem(SEEN));
  const [gl, setGl] = useState(false);
  const [lg, setLg] = useState(false);

  const sr = useRef(s), moves = useRef<Move[]>([]);
  sr.current = s;

  const say = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 4500); };

  const resetGame = (teamId = TEAM, roundDuration = 120) => {
    const fresh = newTeamState(teamId);
    fresh.round = 1;
    fresh.finished = false;
    fresh.analystTokens = 3; // Investigation points 3/3
    fresh.droneFlights = 3;
    fresh.saved = 0;
    fresh.units.forEach(u => { u.st = 'idle'; });
    moves.current = [];
    sr.current = fresh;
    setS(fresh);
    setT(roundDuration);
    setPaused(false);
    setSel(null);
    setPend(null);
    setUnit(null);
    try {
      localStorage.setItem(KEY, JSON.stringify(fresh));
    } catch { /* ignore */ }
    return fresh;
  };

  const run = (a: Record<string, unknown>, who: Actor): boolean => {
    const currentTeamId = sr.current.teamId;
    const actionTeamId = (a.teamId as string) || currentTeamId;
    const actor: Actor =
      who.role === 'host'
        ? { role: 'host' }
        : who.role === 'system'
        ? { role: 'system' }
        : { role: 'team', teamId: currentTeamId };
    const r = apply(sr.current, { id: crypto.randomUUID(), teamId: actionTeamId, ...a } as Action, actor);
    if (!r.ok) {
      say(r.error);
      return false;
    }
    sr.current = r.state;
    setS(r.state);
    try { localStorage.setItem(KEY, JSON.stringify(r.state)); } catch { /* ignore */ }
    return true;
  };

  const fly = (id: string, ty: keyof typeof SPD, from: { x: number; y: number }, to: { x: number; y: number }) => {
    const dur = Math.hypot(to.x - from.x, to.y - from.y) / SPD[ty];
    moves.current.push({ unit: id, ty, from, to, t0: performance.now(), dur });
    return dur;
  };

  const launch = () => {
    sr.current.units
      .filter(u => u.st === 'out' && !moves.current.some(m => m.unit === u.id))
      .forEach(u => {
        const b = B.find(x => x.id === u.tg)!, dur = fly(u.id, u.ty, HQ, b);
        setTimeout(() => {
          if (run({ type: 'arrive', unit: u.id }, { role: 'system' })) {
            fly(u.id, u.ty, b, HQ);
          }
        }, dur * 1000);
      });
  };

  const d: D = (a, w = 'team') => {
    const currentTeamId = sr.current.teamId;
    const ok = run(a, w === 'host' ? { role: 'host' } : { role: 'team', teamId: currentTeamId });
    if (ok) {
      if (a.type === 'advance') setT(120);
      if (a.type === 'approve') launch();
      if (a.type === 'resupply') {
        say('Emergency resupply requested! Arrives at the start of next round (if bridge is open).');
      }
    }
    return ok;
  };

  const order = (id: string, b: string) => {
    const u = sr.current.units.find(q => q.id === id);
    if (!u || u.st !== 'idle') return say('That unit is away on a mission.');
    if (u.ty === 'drone') {
      if (sr.current.droneFlights <= 0) {
        return say('No scout flights remaining! Limit: 3 per game. Use the Cross-check Desk in Reports instead.');
      }
      if (sr.current.round >= 5) {
        return say('Scout drone grounded in Round 5 due to storm blackout!');
      }
      if (run({ type: 'deploy', unit: id, b }, { role: 'team', teamId: sr.current.teamId })) launch();
    } else {
      setPend({ unit: id, b });
    }
    setUnit(null);
  };

  // Broadcast player score changes to room sync
  useEffect(() => {
    if (viewMode === 'player_game' && currentRoom && myTeam) {
      const score = total(s);
      const room = getRoom(currentRoom.code) || currentRoom;
      const idx = room.teams.findIndex(t => t.id === myTeam.id);
      const updatedTeam = {
        ...(idx >= 0 ? room.teams[idx] : myTeam),
        score: score.all,
        opsScore: score.ops,
        aiScore: score.ai,
        savedCount: s.saved,
        wasteCount: s.st.waste,
        reportsChecked: s.st.vOK + s.st.caught,
        status: s.finished ? ('finished' as const) : ('in_mission' as const),
        joinedAt: idx >= 0 ? room.teams[idx].joinedAt : Date.now(),
      };
      if (idx >= 0) room.teams[idx] = updatedTeam;
      else room.teams.push(updatedTeam);
      saveRoom(room);
      broadcast({
        type: 'SCORE_UPDATE',
        roomCode: currentRoom.code,
        teamId: myTeam.id,
        score: score.all,
        opsScore: score.ops,
        aiScore: score.ai,
        savedCount: s.saved,
        wasteCount: s.st.waste,
        reportsChecked: s.st.vOK + s.st.caught,
      });
      broadcast({ type: 'ROOM_UPDATE', room });
    }
  }, [s, viewMode, currentRoom, myTeam]);

  // Listen for host remote actions in player_game
  useEffect(() => {
    if (viewMode === 'player_game' && currentRoom) {
      const unsub = subscribeToSync(msg => {
        if (msg.type === 'RESET_GAME' && currentRoom && msg.roomCode.toUpperCase() === currentRoom.code.toUpperCase()) {
          resetGame(myTeam?.id || TEAM, currentRoom.roundTime || 120);
        } else if (msg.type === 'HOST_ACTION' && msg.roomCode.toUpperCase() === currentRoom.code.toUpperCase()) {
          if (msg.action === 'advance') {
            run({ type: 'advance' }, { role: 'host' });
            setT(currentRoom.roundTime || 120);
          } else if (msg.action === 'pause') {
            setPaused(true);
          } else if (msg.action === 'resume') {
            setPaused(false);
          } else if (msg.action === 'inject' && msg.payload) {
            run({ type: 'inject', k: msg.payload }, { role: 'host' });
          }
        } else if (msg.type === 'ROOM_CLOSED' && msg.roomCode.toUpperCase() === currentRoom.code.toUpperCase()) {
          say('Server room closed by host.');
        }
      });
      return () => unsub();
    }
  }, [viewMode, currentRoom, myTeam]);

  useEffect(() => {
    if (viewMode !== 'player_game') return;
    const i = setInterval(() => {
      if (!paused && !sr.current.finished && !tut) setT(v => v - 1);
    }, 1000);
    return () => clearInterval(i);
  }, [viewMode, paused, tut]);

  useEffect(() => {
    if (viewMode === 'player_game' && t <= 0 && !s.finished) {
      run({ type: 'advance' }, { role: 'host' });
      setT(currentRoom?.roundTime || 120);
    }
  });

  const sc = total(s), b = sel ? B.find(x => x.id === sel) : null, [ct, cb] = coachText(s), pu = pend ? s.units.find(u => u.id === pend.unit)! : null;
  const closeTut = () => { localStorage.setItem(SEEN, '1'); setTut(false); };

  const UI: Record<string, [string, string, string]> = {
    boat: ['🚤', 'Rescue Boat', 'Carries 40 people · uses 12 fuel + 6 food'],
    amb: ['🚑', 'Ambulance', 'Carries 20 · uses 8 fuel + 1 medic · no broken bridges'],
    drone: ['🛰️', 'Scout Drone', `Reveals one town · uses 8 fuel · ${s.droneFlights}/3 flights left${s.round >= 5 ? ' (Grounded)' : ''}`],
  };

  if (viewMode === 'menu') {
    return (
      <LandingPage
        onJoinClick={() => setViewMode('join')}
        onHostClick={() => {
          resetGame(TEAM);
          setViewMode('host');
        }}
      />
    );
  }

  if (viewMode === 'join') {
    return (
      <JoinPage
        onBack={() => setViewMode('menu')}
        onGameStart={(room, teamId, name) => {
          resetGame(teamId, room.roundTime || 120);
          setCurrentRoom(room);
          setMyTeam({ id: teamId, name });
          setViewMode('player_game');
        }}
      />
    );
  }

  if (viewMode === 'host') {
    return (
      <HostPage
        onBack={() => setViewMode('menu')}
        onStartGame={room => {
          resetGame(TEAM, room.roundTime || 120);
          setCurrentRoom(room);
          setViewMode('host_leaderboard');
        }}
      />
    );
  }

  if (viewMode === 'host_leaderboard' && currentRoom) {
    return (
      <HostLeaderboard
        room={currentRoom}
        onAdvanceRound={() => {
          const fresh = getRoom(currentRoom.code) || currentRoom;
          const updated: ServerRoom = {
            ...fresh,
            currentRound: Math.min(5, fresh.currentRound + 1),
            timeRemaining: fresh.roundTime,
            logs: [
              {
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                text: `Host advanced exercise to Round ${Math.min(5, fresh.currentRound + 1)}: ${RT[Math.min(4, fresh.currentRound)]}.`,
              },
              ...fresh.logs,
            ],
          };
          saveRoom(updated);
          setCurrentRoom(updated);
          broadcast({ type: 'HOST_ACTION', roomCode: currentRoom.code, action: 'advance' });
          broadcast({ type: 'ROOM_UPDATE', room: updated });
        }}
        onTogglePause={() => {
          const fresh = getRoom(currentRoom.code) || currentRoom;
          const updated: ServerRoom = {
            ...fresh,
            isPaused: !fresh.isPaused,
            logs: [
              {
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                text: fresh.isPaused ? 'Timer resumed by host.' : 'Timer paused by host.',
              },
              ...fresh.logs,
            ],
          };
          saveRoom(updated);
          setCurrentRoom(updated);
          broadcast({ type: 'HOST_ACTION', roomCode: currentRoom.code, action: updated.isPaused ? 'pause' : 'resume' });
          broadcast({ type: 'ROOM_UPDATE', room: updated });
        }}
        onInject={k => {
          const desc = k === 's' ? 'Storm surge hits Dalig early' : k === 'r' ? 'Viral unverified social media rumor injected' : 'Simulated AI uplink outage';
          const fresh = getRoom(currentRoom.code) || currentRoom;
          const updated: ServerRoom = {
            ...fresh,
            logs: [
              {
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                text: `⚡ Host triggered crisis inject: ${desc}`,
              },
              ...fresh.logs,
            ],
          };
          saveRoom(updated);
          setCurrentRoom(updated);
          broadcast({ type: 'HOST_ACTION', roomCode: currentRoom.code, action: 'inject', payload: k });
          broadcast({ type: 'ROOM_UPDATE', room: updated });
        }}
        onExit={() => setViewMode('menu')}
      />
    );
  }

  return (
    <div className="app">
      <header className="top">
        <button
          className="btn"
          style={{ background: '#1e293b', color: '#f8fafc', borderColor: '#475569', fontWeight: 700 }}
          onClick={() => setViewMode('menu')}
          title="Return to Main Menu"
        >
          🚪 Menu
        </button>
        <span className="logo">AI: CODE RED</span>
        {currentRoom && (
          <span className="stat highlight" title="Connected Server Room & Team Call Sign">
            📡 {currentRoom.code} {myTeam ? `· ${myTeam.name}` : ''}
          </span>
        )}
        <span className="rounds" title="Round progression (5 rounds total)">
          {[1, 2, 3, 4, 5].map(n => (
            <span key={n} className={'dot ' + (n === s.round ? 'on' : n < s.round || s.finished ? 'done' : '')}>
              {n}
            </span>
          ))}
        </span>
        <span className="rname">Round {s.round}: {RT[s.round - 1]}</span>
        <span className="stat" title="Time remaining this round. Auto-advances when it reaches 0:00.">
          ⏱ {Math.floor(t / 60)}:{String(t % 60).padStart(2, '0')}{paused ? ' (paused)' : ''}
        </span>
        <span className="stat" title={`Fuel powers unit deployments. Supply depot delivers +${DEPOT_FUEL} fuel at each round start.`}>
          ⛽ Fuel {s.res.fuel}
        </span>
        <span className="stat" title={`Food is used by rescue boats to feed evacuees. Depot delivers +${DEPOT_FOOD} food each round start.`}>
          🍞 Food {s.res.food}
        </span>
        <span className="stat" title="Ambulance operations require a paramedic.">
          ⚕️ Medics {s.res.med}
        </span>
        <span className="stat highlight" title="Scout drone is strictly limited to 3 flights per game and grounded in Round 5.">
          🛰️ Flights {s.droneFlights}/3
        </span>
        <span className="stat highlight" title="Investigation points for the Cross-check Desk in Reports tab. 3 per round; unused tokens do not carry over.">
          🔍 Investigation {s.analystTokens}/3
        </span>
        <span className="stat" title="Total residents safely evacuated to shelters.">
          🙂 Saved {s.saved}
        </span>
        <span className="stat" title="Rescue effectiveness and resource management score (max 50)">
          🚤 Rescue {Math.round(sc.ops)}/50
        </span>
        <span className="stat" title="Source verification, AI oversight, and ethical communication score (max 50)">
          🧠 Smart AI {Math.round(sc.ai)}/50
        </span>

        {/* ── Emergency Resupply Trigger ───────────────────────────── */}
        <button
          className="btn"
          style={{
            background: s.supply.emergencyUsed ? '#2a3b53' : '#d97706',
            color: '#fff',
            borderColor: '#b45309',
            fontSize: '12px',
          }}
          title={`One-time emergency resupply: +${RESUPPLY_FUEL} fuel, +${RESUPPLY_FOOD} food at next round start. Fails if bridge is out!`}
          disabled={s.supply.emergencyUsed}
          onClick={() => d({ type: 'resupply' })}
        >
          🚁 Resupply {s.supply.emergencyUsed ? (s.supply.emergencyPending ? '⏳ En Route' : s.supply.bridgeBlockedAt ? '❌ Blocked' : '✅ Received') : 'Request'}
        </button>

        <button className="btn" onClick={() => setGl(true)}>❓ Guide</button>
        <button className="btn" onClick={() => setTut(true)}>Tutorial</button>
      </header>

      <main className="main">
        <section className="mapcol">
          <MapCanvas
            s={s}
            moves={moves}
            sel={sel}
            onPick={x => {
              setSel(x);
              if (x && unit) order(unit, x);
            }}
            onDrop={order}
          />

          <div className="coach">
            <b>{ct}</b>
            <br />
            {cb}
          </div>

          <button className="btn legendbtn" onClick={() => setLg(!lg)}>🗺 Map key</button>
          {lg && <Legend />}
          {msg && <div className="toast">{msg}</div>}

          <div className="dock">
            {pend && pu ? (
              <>
                <b>Send {UI[pu.ty][1]} {pu.id} to {B.find(x => x.id === pend.b)!.n}?</b> Cost: {Object.entries(COST[pu.ty]).map(([k, v]) => `${v} ${k}`).join(', ')}.
                <button
                  className="btn ok"
                  onClick={() => {
                    if (run({ type: 'deploy', unit: pend.unit, b: pend.b }, { role: 'team', teamId: sr.current.teamId })) launch();
                    setPend(null);
                  }}
                >
                  ✅ Yes, dispatch unit
                </button>
                <button className="btn" onClick={() => setPend(null)}>Cancel</button>
              </>
            ) : b ? (
              <>
                <b>{b.n}</b>: about {b.pop} residents.{' '}
                {s.rev[b.id] === s.round ? (
                  <>Observed this round: <b>{flooded(s, b) ? '🔵 FLOODED' : 'DRY'}</b>, {s.pop[b.id]} still need help.</>
                ) : (
                  <>Unobserved this round (Fog of War). Cross-check reports or use 1 of your {s.droneFlights} drone flights to confirm ground truth.</>
                )}
              </>
            ) : (
              'Drag a unit from the bottom tray onto a town, or click a unit then click a town. Unrescued flooded towns lose 15% population per round!'
            )}
          </div>
        </section>

        <aside className="side">
          <nav className="tabs">
            {TABS.map(([k, n]) => (
              <button key={k} className={'tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>
                {n}
              </button>
            ))}
          </nav>
          <div className="pane">
            {s.finished && <Debrief s={s} />}
            {tab === 'rep' && <Reports s={s} d={d} />}
            {tab === 'ai' && <Analyst s={s} d={d} />}
            {tab === 'sco' && <Score s={s} />}
            {tab === 'brd' && <Board s={s} t={t} />}
            {tab === 'host' && <Host s={s} d={d} paused={paused} setPaused={setPaused} />}
          </div>
        </aside>
      </main>

      <footer className="tray">
        {s.units.map(u => {
          const isDroneBlocked = u.ty === 'drone' && (s.droneFlights <= 0 || s.round >= 5);
          return (
            <div
              key={u.id}
              className={
                'unit' +
                (unit === u.id ? ' sel' : '') +
                (u.st !== 'idle' || isDroneBlocked ? ' away' : '')
              }
              draggable={u.st === 'idle' && !isDroneBlocked}
              onDragStart={e => e.dataTransfer.setData('unit', u.id)}
              onClick={() => {
                if (isDroneBlocked) {
                  return say(s.round >= 5 ? 'Drone grounded in Round 5!' : 'No scout flights remaining! Limit: 3 per game.');
                }
                if (u.st === 'idle') setUnit(unit === u.id ? null : u.id);
              }}
            >
              <b>{UI[u.ty][0]} {UI[u.ty][1]} {u.id}</b>
              <small>
                {u.st !== 'idle'
                  ? 'On a mission, returning soon'
                  : isDroneBlocked
                  ? s.round >= 5
                    ? 'Grounded: storm interference'
                    : 'Out of flights (3/3 used)'
                  : UI[u.ty][2]}
              </small>
            </div>
          );
        })}
      </footer>

      {tut && <Tutorial onClose={closeTut} />}
      {gl && <Glossary onClose={() => setGl(false)} />}
    </div>
  );
}
