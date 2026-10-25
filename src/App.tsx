import { useEffect, useRef, useState } from 'react';
import MapCanvas, { HQ, type Move } from './map/MapCanvas';
import { Analyst, Board, Debrief, Host, Reports, Score, type D } from './panels/Panels';
import { Glossary, Goals, Legend, Tutorial } from './panels/Help';
import { LandingPage, JoinPage, HostPage, HostLeaderboard } from './panels/MainMenu';
import {
  type ServerRoom,
  type RoomTeam,
  isRemote,
  saveRoom,
  getRoom,
  broadcast,
  subscribeToSync,
} from './multiplayer/roomSync';
import { B, RT, rules } from '../shared/scenario';
import { apply, flooded, newTeamState, reports, support } from '../shared/sim';
import { total } from '../shared/scoring';
import type { Row } from '../shared/demoBoard';
import type { Action, Actor, Mode, TeamState } from '../shared/types';
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
  return newTeamState(TEAM, 'easy');
};

const DEFAULT_ROUND = 240;

export default function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('menu');
  const [currentRoom, setCurrentRoom] = useState<ServerRoom | null>(null);
  const [myTeam, setMyTeam] = useState<{ id: string; name: string } | null>(null);
  const [liveTeams, setLiveTeams] = useState<RoomTeam[] | null>(null);

  const [s, setS] = useState(load);
  const [tab, setTab] = useState('rep');
  const [sel, setSel] = useState<string | null>(null);
  const [pend, setPend] = useState<{ unit: string; b: string } | null>(null);
  const [msg, setMsg] = useState('');
  const [t, setT] = useState(DEFAULT_ROUND);
  const [notice, setNotice] = useState('');
  const [paused, setPaused] = useState(false);
  const [unit, setUnit] = useState<string | null>(null);
  const [tut, setTut] = useState(() => !localStorage.getItem(SEEN));
  const [gl, setGl] = useState(false);
  const [lg, setLg] = useState(false);

  const sr = useRef(s), moves = useRef<Move[]>([]);
  sr.current = s;
  const roundSecs = currentRoom?.roundTime || DEFAULT_ROUND;
  const autoAdvance = currentRoom?.autoAdvance !== false;
  const R = rules(s);

  const say = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 4500); };

  const resetGame = (teamId = TEAM, roundDuration = DEFAULT_ROUND, mode: Mode = 'easy') => {
    const fresh = newTeamState(teamId, mode);
    moves.current = [];
    sr.current = fresh;
    setS(fresh);
    setT(roundDuration);
    setNotice('');
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
      if (a.type === 'advance') setT(roundSecs);
      if (a.type === 'approve') launch();
      if (a.type === 'resupply') {
        say('Extra supplies requested! They arrive at the start of next round (if the bridge is open).');
      }
    }
    return ok;
  };

  const order = (id: string, b: string) => {
    const u = sr.current.units.find(q => q.id === id);
    if (!u || u.st !== 'idle') return say('That unit is away on a mission.');
    if (u.ty === 'drone') {
      if (sr.current.droneFlights <= 0) {
        return say(`No scout flights left (limit ${R.droneMax} per game). Check reports in the Reports tab instead.`);
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
        status: s.finished ? 'finished' : 'in_mission',
        info: {
          round: s.round,
          fuel: s.res.fuel,
          food: s.res.food,
          flights: s.droneFlights,
          tokens: s.analystTokens,
          checks: Object.values(s.crossChecks).reduce((a, l) => a + l.length, 0),
          caughtFake: s.st.hall > 0,
          fellForFake: Object.keys(s.keys).some(k => k.startsWith('fk')),
          falseAlarms: s.led.filter(l => l.why.startsWith('False alarm')).length,
          lastEvent: s.log.length ? s.log[s.log.length - 1].t : '',
        },
      });
      broadcast({ type: 'ROOM_UPDATE', room });
    }
  }, [s, viewMode, currentRoom, myTeam]);

  // Listen for host remote actions in player_game
  useEffect(() => {
    if (viewMode === 'player_game' && currentRoom) {
      const unsub = subscribeToSync(msg => {
        if (msg.type === 'RESET_GAME' && currentRoom && msg.roomCode.toUpperCase() === currentRoom.code.toUpperCase()) {
          resetGame(myTeam?.id || TEAM, currentRoom.roundTime || DEFAULT_ROUND, currentRoom.difficulty ?? 'easy');
        } else if (msg.type === 'HOST_ACTION' && msg.roomCode.toUpperCase() === currentRoom.code.toUpperCase()) {
          if (msg.action === 'advance') {
            run({ type: 'advance' }, { role: 'host' });
            setT(currentRoom.roundTime || DEFAULT_ROUND);
            setNotice('⏭ The facilitator started the next round.');
          } else if (msg.action === 'announce' && msg.payload) {
            try {
              const p = JSON.parse(msg.payload) as { to: string; text: string };
              if (p.to === 'all' || p.to === myTeam?.id) setNotice('📢 ' + p.text);
            } catch { /* ignore */ }
          } else if (msg.action === 'addtime') {
            setT(v => v + (Number(msg.payload) || 60));
            setNotice('⏱ The facilitator added more time.');
          } else if (msg.action === 'grant' && msg.payload) {
            try {
              const p = JSON.parse(msg.payload) as { to: string; fuel: number; food: number };
              if (p.to === 'all' || p.to === myTeam?.id) {
                run({ type: 'grant', fuel: p.fuel, food: p.food }, { role: 'host' });
                setNotice(`🎁 The facilitator sent supplies: +${p.fuel} fuel, +${p.food} food.`);
              }
            } catch { /* ignore */ }
          } else if (msg.action === 'pause') {
            setPaused(true);
          } else if (msg.action === 'resume') {
            setPaused(false);
          } else if (msg.action === 'inject' && msg.payload) {
            run({ type: 'inject', k: msg.payload }, { role: 'host' });
            setNotice(msg.payload === 'o' ? '📡 The AI helper lost its connection. Rely on your own checks.' : '🚨 Breaking news from the facilitator! Check the Reports tab.');
          }
        } else if (msg.type === 'ROOM_CLOSED' && msg.roomCode.toUpperCase() === currentRoom.code.toUpperCase()) {
          say('Server room closed by host.');
        }
      });
      return () => unsub();
    }
  }, [viewMode, currentRoom, myTeam]);

  // Live roster for the real leaderboard (kept out of the score effect's deps to avoid feedback loops)
  const roomCode = currentRoom?.code;
  useEffect(() => {
    if (viewMode !== 'player_game' || !roomCode) return;
    setLiveTeams(getRoom(roomCode)?.teams ?? null);
    return subscribeToSync(m => {
      if (m.type === 'ROOM_UPDATE' && m.room.code.toUpperCase() === roomCode.toUpperCase()) setLiveTeams(m.room.teams);
    });
  }, [viewMode, roomCode]);

  useEffect(() => {
    if (viewMode !== 'player_game') return;
    const i = setInterval(() => {
      if (!paused && !sr.current.finished && !tut) setT(v => Math.max(0, v - 1));
    }, 1000);
    return () => clearInterval(i);
  }, [viewMode, paused, tut]);

  useEffect(() => {
    if (viewMode === 'player_game' && t <= 0 && !s.finished && autoAdvance) {
      run({ type: 'advance' }, { role: 'host' });
      setT(roundSecs);
    }
  });

  const sc = total(s), b = sel ? B.find(x => x.id === sel) : null, pu = pend ? s.units.find(u => u.id === pend.unit)! : null;
  const rows: Row[] | undefined =
    isRemote() && liveTeams && myTeam
      ? liveTeams
          .map(x => ({ n: x.id === myTeam.id ? `${x.name} (you)` : x.name, s: Math.round(x.id === myTeam.id ? sc.all : x.score), you: x.id === myTeam.id, r: 0 }))
          .sort((a, b) => b.s - a.s)
          .map((x, i) => ({ ...x, r: i + 1 }))
      : undefined;
  // In a live room the facilitator controls belong to the host's dashboard, not to students.
  const tabs = isRemote() && currentRoom ? TABS.filter(([k]) => k !== 'host') : TABS;
  const closeTut = () => { localStorage.setItem(SEEN, '1'); setTut(false); };

  const UI: Record<string, [string, string, string]> = {
    boat: ['🚤', 'Rescue Boat', `Takes up to ${R.cap.boat} people · ${R.cost.boat.fuel} fuel + ${R.cost.boat.food} food`],
    amb: ['🚑', 'Ambulance', `Takes up to ${R.cap.amb} · ${R.cost.amb.fuel} fuel + 1 medic · cannot cross broken bridge`],
    drone: ['🛰️', 'Scout Drone', `Shows the truth about one town · ${R.cost.drone.fuel} fuel · ${s.droneFlights}/${R.droneMax} flights left${s.round >= 5 ? ' (grounded)' : ''}`],
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
          resetGame(teamId, room.roundTime || DEFAULT_ROUND, room.difficulty ?? 'easy');
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
          resetGame(TEAM, room.roundTime || DEFAULT_ROUND);
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
        <span className="stat" title={autoAdvance ? 'Time left this round. The next round starts automatically at 0:00.' : 'Time left this round. The facilitator starts the next round.'}>
          ⏱ {Math.floor(t / 60)}:{String(t % 60).padStart(2, '0')}{paused ? ' (paused)' : ''}{t <= 0 && !autoAdvance ? ' · waiting for facilitator' : ''}
        </span>
        <span className="stat" title="Fuel is used every time you send a unit. More arrives each round.">⛽ Fuel {s.res.fuel}</span>
        <span className="stat" title="Food is used by rescue boats. More arrives each round.">🍞 Food {s.res.food}</span>
        <span className="stat" title="Ambulances need a medic.">⚕️ Medics {s.res.med}</span>
        <span className="stat highlight" title={`Scout drone flights left (max ${R.droneMax}). Not available in Round 5.`}>🛰️ Drone {s.droneFlights}/{R.droneMax}</span>
        <span className="stat highlight" title="Report checks left this round. You get more every round.">🔍 Checks {s.analystTokens}/{R.tokens}</span>
        <span className="stat" title="People rescued so far.">🙂 Saved {s.saved}</span>
        <span className="stat" title="Your total score out of 100. See the Score tab for details.">⭐ {Math.round(sc.all)}/100</span>

        <button
          className="btn"
          style={{ background: s.supply.emergencyUsed ? '#2a3b53' : '#d97706', color: '#fff', borderColor: '#b45309', fontSize: '12px' }}
          title={`One-time call for extra supplies: +${R.resupplyFuel} fuel, +${R.resupplyFood} food at the start of next round. It fails if the bridge is already out (Round 3+)!`}
          disabled={s.supply.emergencyUsed}
          onClick={() => d({ type: 'resupply' })}
        >
          🚁 Extra supplies {s.supply.emergencyUsed ? (s.supply.emergencyPending ? '⏳ on the way' : s.supply.bridgeBlockedAt ? '❌ blocked' : '✅ received') : '(once)'}
        </button>

        <button className="btn" onClick={() => setTut(true)}>❓ Help</button>
        <button className="btn" onClick={() => setGl(true)}>📖 Words</button>
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

          <Goals s={s} />

          <button className="btn legendbtn" onClick={() => setLg(!lg)}>🗺 Map key</button>
          {lg && <Legend mode={s.mode} />}
          {msg && <div className="toast">{msg}</div>}
          {notice && (
            <div className="notice">
              <span>{notice}</span>
              <button className="btn" onClick={() => setNotice('')}>OK</button>
            </div>
          )}

          <div className="dock">
            {pend && pu ? (
              <>
                <b>Send {UI[pu.ty][1]} {pu.id} to {B.find(x => x.id === pend.b)!.n}?</b> Cost: {Object.entries(R.cost[pu.ty]).map(([k, v]) => `${v} ${k}`).join(', ')}.
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
                  <>Drone saw it this round: <b>{flooded(s, b) ? '🔵 FLOODED' : '🟢 DRY'}</b>, {s.pop[b.id]} still need help.</>
                ) : support(s, b) && reports(s).some(r => r.b === b.id && r.rd <= s.round && r.cl === 'f') ? (
                  <>✅ <b>Confirmed flooded by checked reports.</b> Safe to send a boat.</>
                ) : reports(s).some(r => r.b === b.id && r.rd <= s.round && r.cl === 'f') ? (
                  <>🟡 Reports say flooded, but <b>not confirmed</b>. Check them in the Reports tab, or use a drone flight.</>
                ) : (
                  <>⚪ No flood reports yet. We do not know.</>
                )}
              </>
            ) : (
              'To rescue people: drag a unit from the bottom onto a town (or tap a unit, then tap a town). Tap a town to see what we know about it.'
            )}
          </div>
        </section>

        <aside className="side">
          <nav className="tabs">
            {tabs.map(([k, n]) => (
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
            {tab === 'brd' && <Board s={s} t={t} rows={rows} />}
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
                  return say(s.round >= 5 ? 'The drone is grounded in Round 5 (storm).' : `No scout flights left (limit ${R.droneMax} per game).`);
                }
                if (u.st === 'idle') setUnit(unit === u.id ? null : u.id);
              }}
            >
              <b>{UI[u.ty][0]} {UI[u.ty][1]} {u.id}</b>
              <small>
                {u.st !== 'idle'
                  ? 'On a mission, back soon'
                  : isDroneBlocked
                  ? s.round >= 5
                    ? 'Grounded: storm interference'
                    : `Out of flights (${R.droneMax}/${R.droneMax} used)`
                  : UI[u.ty][2]}
              </small>
            </div>
          );
        })}
      </footer>

      {tut && <Tutorial onClose={closeTut} mode={s.mode} />}
      {gl && <Glossary onClose={() => setGl(false)} />}
    </div>
  );
}