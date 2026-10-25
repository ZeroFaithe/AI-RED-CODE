import { useState, useEffect } from 'react';
import {
  type ServerRoom,
  type RoomTeam,
  generateRoomCode,
  createNewRoom,
  saveRoom,
  getRoom,
  fetchRoom,
  isRemote,
  broadcast,
  subscribeToSync,
  PRESET_BOT_NAMES,
} from '../multiplayer/roomSync';
import { B, R0, RT, GM_GUIDE, RULESETS } from '../../shared/scenario';

/* ───────────────────────────────────────────────────────────────────────────
   1. LANDING PAGE
   Includes: Join Game, Host Game, and Exit buttons + Scenario Briefing
   ─────────────────────────────────────────────────────────────────────────── */
interface LandingPageProps {
  onJoinClick: () => void;
  onHostClick: () => void;
}

export function LandingPage({ onJoinClick, onHostClick }: LandingPageProps) {
  const [showExitModal, setShowExitModal] = useState(false);
  const [exited, setExited] = useState(false);

  if (exited) {
    return (
      <div className="menu-container">
        <div className="menu-content">
          <div className="exit-modal" style={{ maxWidth: 520 }}>
            <div className="exit-modal-icon">👋</div>
            <h2 className="exit-modal-title">Simulation Session Closed</h2>
            <p className="exit-modal-desc">
              Thank you for commanding the emergency response during Typhoon Code Red.
              Your local records and state have been preserved.
            </p>
            <div className="exit-modal-actions">
              <button className="menu-btn primary" onClick={() => setExited(false)}>
                🔄 Return to Main Menu
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="menu-container">
      <div className="menu-content">
        {/* Hero Branding */}
        <div className="menu-hero">
          <div className="hero-pill">
            <span className="pulse-dot" />
            Category 5 Typhoon Response Simulation
          </div>
          <h1 className="menu-title">AI: CODE RED</h1>
          <p className="menu-subtitle">
            Central Luzon Tactical Command · Multi-Team Emergency Strategy & AI-Assisted Verification
          </p>
        </div>

        {/* 3 Main Action Cards */}
        <div className="landing-grid">
          {/* 1. Join Game */}
          <div className="menu-card join" onClick={onJoinClick}>
            <div className="menu-card-icon">🎮</div>
            <h3 className="menu-card-title">Join Game</h3>
            <p className="menu-card-desc">
              Enter a server room code provided by your teacher or facilitator to join a team and stand by for deployment.
            </p>
            <button className="menu-btn primary">
              Join Server →
            </button>
          </div>

          {/* 2. Host Game */}
          <div className="menu-card host" onClick={onHostClick}>
            <div className="menu-card-icon">📡</div>
            <h3 className="menu-card-title">Host Game</h3>
            <p className="menu-card-desc">
              Set up team caps, round limits, and launch an authoritative server lobby to monitor student leaderboards.
            </p>
            <button className="menu-btn accent">
              Host Server →
            </button>
          </div>

          {/* 3. Exit Button */}
          <div className="menu-card exit" onClick={() => setShowExitModal(true)}>
            <div className="menu-card-icon">🚪</div>
            <h3 className="menu-card-title">Exit</h3>
            <p className="menu-card-desc">
              Close your active tactical terminal, reset game progress, or safely end your command session.
            </p>
            <button className="menu-btn secondary">
              Exit Simulation
            </button>
          </div>
        </div>

        {/* Simulation Highlights Briefing */}
        <div
          style={{
            background: 'rgba(15, 27, 45, 0.65)',
            border: '1px solid #1f3554',
            borderRadius: '16px',
            padding: '18px 24px',
            width: '100%',
            maxWidth: '960px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '16px',
            fontSize: '13px',
            color: '#94a3b8',
          }}
        >
          <div>
            <b style={{ color: '#fff', display: 'block', marginBottom: '4px' }}>🚤 Tactical 2D Rescue</b>
            Deploy rescue boats, ambulances, and scout drones across flood zones with dynamic washed-out bridges.
          </div>
          <div>
            <b style={{ color: '#fff', display: 'block', marginBottom: '4px' }}>🔍 Cross-Check Desk</b>
            Catch circular social media reposts, stale advisories, and verify facts with analyst time tokens.
          </div>
          <div>
            <b style={{ color: '#fff', display: 'block', marginBottom: '4px' }}>🤖 Human-In-The-Loop AI</b>
            Interrogate AI recommendations, catch hallucinated citations, and broadcast ethical crisis alerts.
          </div>
        </div>
      </div>

      {/* Exit Confirmation Dialog */}
      {showExitModal && (
        <div className="modal-overlay">
          <div className="exit-modal">
            <div className="exit-modal-icon">⚠️</div>
            <h2 className="exit-modal-title">End Simulation?</h2>
            <p className="exit-modal-desc">
              Are you sure you want to exit the AI: CODE RED tactical command center?
              Unfinished round data may be lost if you clear your browser storage.
            </p>
            <div className="exit-modal-actions">
              <button className="menu-btn secondary" onClick={() => setShowExitModal(false)}>
                Cancel
              </button>
              <button
                className="menu-btn accent"
                onClick={() => {
                  setShowExitModal(false);
                  setExited(true);
                }}
              >
                Yes, Exit Session
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
   2. JOIN PAGE
   Asks for a server code. Enters Waiting Room until Host starts the game.
   ─────────────────────────────────────────────────────────────────────────── */
interface JoinPageProps {
  onBack: () => void;
  onGameStart: (room: ServerRoom, teamId: string, teamName: string) => void;
}

export function JoinPage({ onBack, onGameStart }: JoinPageProps) {
  const [code, setCode] = useState('');
  const [teamName, setTeamName] = useState('Team Alpha');
  const [joined, setJoined] = useState(false);
  const [activeRoom, setActiveRoom] = useState<ServerRoom | null>(null);
  const [myTeamId, setMyTeamId] = useState('');
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Check if there was an active room
  useEffect(() => {
    const last = localStorage.getItem('cr_last_room');
    if (last && !code) {
      setCode(last);
    }
  }, []);

  // Listen for sync messages (e.g. host starting game or room updating)
  useEffect(() => {
    const unsubscribe = subscribeToSync(msg => {
      if (!activeRoom) return;

      if (msg.type === 'START_GAME' && msg.roomCode.toUpperCase() === activeRoom.code.toUpperCase()) {
        const fresh = getRoom(activeRoom.code) || activeRoom;
        onGameStart(fresh, myTeamId, teamName);
      } else if (msg.type === 'ROOM_UPDATE' && msg.room.code.toUpperCase() === activeRoom.code.toUpperCase()) {
        setActiveRoom(msg.room);
        if (msg.room.status === 'in_progress') {
          onGameStart(msg.room, myTeamId, teamName);
        }
      } else if (msg.type === 'ROOM_CLOSED' && msg.roomCode.toUpperCase() === activeRoom.code.toUpperCase()) {
        setErrorMsg('The host has disbanded the server room.');
        setJoined(false);
        setActiveRoom(null);
      }
    });

    return () => unsubscribe();
  }, [activeRoom, myTeamId, teamName, onGameStart]);

  const [connecting, setConnecting] = useState(false);

  const handleJoin = async () => {
    if (connecting) return;
    const trimmedCode = code.trim().toUpperCase();
    if (!trimmedCode) {
      setErrorMsg('Please enter a server room code.');
      return;
    }
    const cleanName = teamName.trim() || 'Responder Unit';

    setErrorMsg('');
    setConnecting(true);
    let room = await fetchRoom(trimmedCode);
    setConnecting(false);
    const teamId = 'team-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    setMyTeamId(teamId);

    if (!room && isRemote()) {
      setErrorMsg('Room not found. Check the code, and make sure the host has created the room and is keeping their page open.');
      return;
    }

    if (!room) {
      // Create a local room representation if joining first or in test mode
      room = {
        code: trimmedCode,
        name: 'Disaster Response Command',
        hostId: 'host-pending',
        maxTeams: 10,
        roundTime: 240,
        droneFlights: 5,
        difficulty: 'easy',
        status: 'lobby',
        currentRound: 1,
        timeRemaining: 240,
        isPaused: false,
        createdAt: Date.now(),
        teams: [],
        logs: [{ time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), text: `${cleanName} joined waiting room.` }],
      };
    }

    const freshRoom = getRoom(trimmedCode);
    if (freshRoom) {
      room = freshRoom;
    }

    // Check if team name is already taken by another page
    const nameExists = room.teams.some(
      t => t.name.trim().toLowerCase() === cleanName.toLowerCase()
    );
    if (nameExists) {
      setErrorMsg('This team name already exists');
      return;
    }

    // Check if room is already full
    if (room.teams.length >= room.maxTeams) {
      setErrorMsg(`Server is full (${room.teams.length}/${room.maxTeams} teams).`);
      return;
    }

    // Add this unique team to the room
    const newTeam: RoomTeam = {
      id: teamId,
      name: cleanName,
      score: 0,
      opsScore: 0,
      aiScore: 0,
      savedCount: 0,
      wasteCount: 0,
      reportsChecked: 0,
      status: 'ready',
      joinedAt: Date.now(),
    };
    room = { ...room, teams: [...room.teams, newTeam] };

    saveRoom(room);
    setActiveRoom(room);
    setJoined(true);
    setErrorMsg('');

    // Broadcast team join event
    broadcast({ type: 'TEAM_JOIN', roomCode: room.code, team: newTeam });
    broadcast({ type: 'ROOM_UPDATE', room });

    // If room is already in progress, enter game immediately
    if (room.status === 'in_progress') {
      onGameStart(room, teamId, cleanName);
    }
  };

  const handleLeaveLobby = () => {
    if (activeRoom) {
      const updated = {
        ...activeRoom,
        teams: activeRoom.teams.filter(t => t.id !== myTeamId),
      };
      saveRoom(updated);
      broadcast({ type: 'TEAM_LEAVE', roomCode: activeRoom.code, teamId: myTeamId });
      broadcast({ type: 'ROOM_UPDATE', room: updated });
    }
    setJoined(false);
    setActiveRoom(null);
  };

  const copyCode = () => {
    if (activeRoom) {
      navigator.clipboard?.writeText(activeRoom.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="menu-container">
      <div className="menu-content">
        <div className="panel-box">
          <div className="panel-header">
            <h2 className="panel-header-title">
              {joined ? '📡 Command Server Lobby' : '🎮 Join Server'}
            </h2>
            <button className="back-link" onClick={joined ? handleLeaveLobby : onBack}>
              {joined ? 'Leave Lobby' : '← Main Menu'}
            </button>
          </div>

          {errorMsg && (
            <div className="waiting-alert" style={{ borderColor: '#ef4444', color: '#f87171', background: 'rgba(239, 68, 68, 0.15)' }}>
              <span>⚠️</span> {errorMsg}
            </div>
          )}

          {!joined ? (
            /* Join Form */
            <div>
              <div className="form-group">
                <label className="form-label">Server Room Code</label>
                <input
                  className="form-input code-input"
                  value={code}
                  onChange={e => setCode(e.target.value.toUpperCase())}
                  placeholder="CR-XXXX"
                  maxLength={10}
                  autoFocus
                />
                <span className="hint" style={{ display: 'block', marginTop: 6 }}>
                  Enter the 4-7 character room code provided by the host (e.g. CR-8821).
                </span>
              </div>

              <div className="form-group">
                <label className="form-label">Team Call Sign / Name</label>
                <input
                  className="form-input"
                  value={teamName}
                  onChange={e => setTeamName(e.target.value)}
                  placeholder="e.g. Team Alpha, Sagip Bulacan..."
                  maxLength={24}
                />
                <div className="chips-row">
                  {['Team Alpha', 'Sagip Luzon', 'Bayanihan Unit', 'Agila Command', 'Tala Responders'].map(preset => (
                    <button key={preset} type="button" className="chip-btn" onClick={() => setTeamName(preset)}>
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginTop: 28, display: 'flex', gap: 12 }}>
                <button className="menu-btn secondary" onClick={onBack} style={{ flex: 1 }}>
                  Cancel
                </button>
                <button className="menu-btn primary" onClick={handleJoin} disabled={connecting} style={{ flex: 2 }}>
                  {connecting ? 'Connecting…' : 'Join Server →'}
                </button>
              </div>
            </div>
          ) : (
            /* Lobby Waiting Room */
            <div className="waiting-box">
              <div className="radar-animation">
                <span style={{ fontSize: 24, zIndex: 3 }}>📡</span>
              </div>

              <h3 className="waiting-title">Connected to {activeRoom?.code}</h3>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 12 }}>
                <span className="code-badge">{activeRoom?.code}</span>
                <button className="copy-btn" onClick={copyCode}>
                  {copied ? '✓ Copied' : '📋 Copy'}
                </button>
              </div>

              {/* Requirement: Game won't start unless host starts */}
              <div className="waiting-alert">
                <span style={{ fontSize: 20 }}>⏳</span>
                <div>
                  <b>Waiting for Host to start the game...</b>
                  <div style={{ fontSize: 13, marginTop: 2, opacity: 0.9 }}>
                    The game will automatically begin once the host initiates deployment. Stand by at your station.
                  </div>
                </div>
              </div>

              {/* Connected Teams in Lobby */}
              <div className="roster-header">
                <span>Connected Teams ({activeRoom?.teams.length || 0} / {activeRoom?.maxTeams || 10})</span>
                <span style={{ fontSize: 12, color: '#34d399' }}>● Live Uplink</span>
              </div>

              <div className="roster-grid">
                {activeRoom?.teams.map(t => (
                  <div key={t.id} className={'team-pill' + (t.id === myTeamId ? ' current' : '')}>
                    <span className="team-pill-name">
                      {t.id === myTeamId ? '⭐ ' : ''}{t.name}
                    </span>
                    <span className={'team-pill-badge' + (t.isBot ? ' bot' : '')}>
                      {t.id === myTeamId ? 'YOU' : t.isBot ? 'SIMULATED' : 'READY'}
                    </span>
                  </div>
                ))}
              </div>

              {/* Server Parameters */}
              <div
                style={{
                  background: '#0a1424',
                  borderRadius: 12,
                  padding: '10px 16px',
                  display: 'flex',
                  justifyContent: 'space-around',
                  fontSize: 13,
                  color: '#94a3b8',
                  marginBottom: 20,
                }}
              >
                <span>⏱ Round: {activeRoom?.roundTime}s</span>
                <span>🛰 Flights: {activeRoom?.droneFlights} max</span>
                <span>👥 Cap: {activeRoom?.maxTeams} teams</span>
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <button className="menu-btn secondary" onClick={handleLeaveLobby} style={{ width: '100%' }}>
                  🚪 Leave Lobby
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
   3. HOST PAGE
   Configures server settings (max teams, timer, flights).
   Once created: monitors joined teams with a button to start the game.
   ─────────────────────────────────────────────────────────────────────────── */
interface HostPageProps {
  onBack: () => void;
  onStartGame: (room: ServerRoom) => void;
}

export function HostPage({ onBack, onStartGame }: HostPageProps) {
  const [created, setCreated] = useState(false);
  const [roomCode, setRoomCode] = useState(generateRoomCode);
  const [roomName, setRoomName] = useState('Central Luzon Command Post');
  const [maxTeams, setMaxTeams] = useState(10);
  const [roundTime, setRoundTime] = useState(240);
  const [difficulty, setDifficulty] = useState<'easy' | 'classic'>('easy');
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [passcode, setPasscode] = useState('CODERED');
  const [room, setRoom] = useState<ServerRoom | null>(null);
  const [copied, setCopied] = useState(false);

  // Sync listener to see players join in real time
  useEffect(() => {
    if (!room) return;
    const unsubscribe = subscribeToSync(msg => {
      if (
        (msg.type === 'TEAM_JOIN' || msg.type === 'TEAM_LEAVE' || msg.type === 'ROOM_UPDATE') &&
        'roomCode' in msg &&
        msg.roomCode.toUpperCase() === room.code.toUpperCase()
      ) {
        const fresh = getRoom(room.code);
        if (fresh) setRoom(fresh);
      }
    });
    return () => unsubscribe();
  }, [room]);

  const handleCreateServer = () => {
    const newRoom = createNewRoom({
      code: roomCode,
      name: roomName,
      hostId: 'host-' + Date.now(),
      maxTeams,
      roundTime,
      droneFlights: RULESETS[difficulty].droneMax,
      difficulty,
      autoAdvance,
    });
    broadcast({ type: 'RESET_GAME', roomCode: newRoom.code });
    setRoom(newRoom);
    setCreated(true);
  };

  const handleAddBotTeam = () => {
    if (!room) return;
    if (room.teams.length >= room.maxTeams) return;
    const available = PRESET_BOT_NAMES.filter(n => !room.teams.some(t => t.name === n));
    const botName = available[0] || `Bot Team ${room.teams.length + 1}`;
    const botTeam: RoomTeam = {
      id: 'bot-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
      name: botName,
      isBot: true,
      score: 0,
      opsScore: 0,
      aiScore: 0,
      savedCount: 0,
      wasteCount: 0,
      reportsChecked: 0,
      status: 'ready',
      joinedAt: Date.now(),
    };
    const updated: ServerRoom = {
      ...room,
      teams: [...room.teams, botTeam],
      logs: [{ time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), text: `${botName} (Simulated) joined lobby.` }, ...room.logs],
    };
    saveRoom(updated);
    setRoom(updated);
    broadcast({ type: 'ROOM_UPDATE', room: updated });
  };

  const handleFillAllSlots = () => {
    if (!room) return;
    const needed = room.maxTeams - room.teams.length;
    if (needed <= 0) return;
    const available = PRESET_BOT_NAMES.filter(n => !room.teams.some(t => t.name === n));
    const newBots: RoomTeam[] = [];
    for (let i = 0; i < needed; i++) {
      const name = available[i] || `Simulated Team ${room.teams.length + i + 1}`;
      newBots.push({
        id: 'bot-' + (Date.now() + i) + '-' + Math.random().toString(36).slice(2, 5),
        name,
        isBot: true,
        score: 0,
        opsScore: 0,
        aiScore: 0,
        savedCount: 0,
        wasteCount: 0,
        reportsChecked: 0,
        status: 'ready',
        joinedAt: Date.now() + i,
      });
    }
    const updated: ServerRoom = {
      ...room,
      teams: [...room.teams, ...newBots],
      logs: [{ time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), text: `Auto-filled remaining slots with ${newBots.length} teams.` }, ...room.logs],
    };
    saveRoom(updated);
    setRoom(updated);
    broadcast({ type: 'ROOM_UPDATE', room: updated });
  };

  const handleKickTeam = (teamId: string) => {
    if (!room) return;
    const updated: ServerRoom = {
      ...room,
      teams: room.teams.filter(t => t.id !== teamId),
    };
    saveRoom(updated);
    setRoom(updated);
    broadcast({ type: 'TEAM_LEAVE', roomCode: room.code, teamId });
    broadcast({ type: 'ROOM_UPDATE', room: updated });
  };

  const handleStartGame = () => {
    if (!room) return;
    const updated: ServerRoom = {
      ...room,
      status: 'in_progress',
      currentRound: 1, // Full game restarts to round 1
      timeRemaining: room.roundTime || 120,
      isPaused: false,
      startedAt: Date.now(),
      teams: room.teams.map(t => ({
        ...t,
        score: 0,
        opsScore: 0,
        aiScore: 0,
        savedCount: 0,
        wasteCount: 0,
        reportsChecked: 0,
        status: 'ready' as const, // Players have not started yet
      })),
      logs: [
        {
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          text: '🚀 Host started the simulation! Round 1 is live.',
        },
        ...room.logs,
      ],
    };
    saveRoom(updated);
    broadcast({ type: 'RESET_GAME', roomCode: room.code });
    broadcast({ type: 'START_GAME', roomCode: room.code });
    broadcast({ type: 'ROOM_UPDATE', room: updated });
    onStartGame(updated);
  };

  const copyCode = () => {
    if (room) {
      navigator.clipboard?.writeText(room.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="menu-container">
      <div className="menu-content">
        <div className="panel-box" style={{ maxWidth: created ? 780 : 660 }}>
          <div className="panel-header">
            <h2 className="panel-header-title">
              {created ? '📡 Command Center Lobby (Host View)' : '⚙️ Host Server Configuration'}
            </h2>
            <button
              className="back-link"
              onClick={() => {
                if (created && room) {
                  broadcast({ type: 'ROOM_CLOSED', roomCode: room.code });
                }
                onBack();
              }}
            >
              ← Main Menu
            </button>
          </div>

          {!created ? (
            /* Host Configuration Form */
            <div>
              <div className="form-group">
                <label className="form-label">Server Room Code</label>
                <div style={{ display: 'flex', gap: 10 }}>
                  <input
                    className="form-input code-input"
                    value={roomCode}
                    onChange={e => setRoomCode(e.target.value.toUpperCase())}
                    maxLength={10}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="menu-btn secondary"
                    onClick={() => setRoomCode(generateRoomCode())}
                    style={{ width: 'auto', padding: '0 16px' }}
                    title="Generate new random code"
                  >
                    🎲 Random
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Command Center / Exercise Name</label>
                <input
                  className="form-input"
                  value={roomName}
                  onChange={e => setRoomName(e.target.value)}
                  placeholder="e.g. Central Luzon Command - Grade 10"
                />
              </div>

              {/* Setting: How many teams are allowed */}
              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label className="form-label">Max Teams Allowed</label>
                  <span style={{ fontWeight: 800, color: '#38bdf8', fontSize: 16 }}>{maxTeams} Teams</span>
                </div>
                <input
                  type="range"
                  min={2}
                  max={10}
                  step={1}
                  value={maxTeams}
                  onChange={e => setMaxTeams(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#38bdf8', height: 8 }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#64748b' }}>
                  <span>2 Teams (Duel)</span>
                  <span>5 Teams (Squad)</span>
                  <span>10 Teams (Full Classroom)</span>
                </div>
              </div>

              {/* Other settings: Round duration, drone flight limit */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div className="form-group">
                  <label className="form-label">Round Duration</label>
                  <select
                    className="form-input"
                    value={roundTime}
                    onChange={e => setRoundTime(Number(e.target.value))}
                  >
                    <option value={120}>2 minutes (fast, experienced players)</option>
                    <option value={180}>3 minutes</option>
                    <option value={240}>4 minutes (recommended for beginners)</option>
                    <option value={300}>5 minutes</option>
                    <option value={420}>7 minutes (first-time players)</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Difficulty</label>
                  <select
                    className="form-input"
                    value={difficulty}
                    onChange={e => setDifficulty(e.target.value as 'easy' | 'classic')}
                  >
                    <option value="easy">Guided - easier, for first-time players</option>
                    <option value="classic">Classic - original, harder rules</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer', fontSize: 14 }}>
                  <input type="checkbox" checked={autoAdvance} onChange={e => setAutoAdvance(e.target.checked)} style={{ width: 18, height: 18 }} />
                  Start the next round automatically when time runs out
                </label>
                <span className="hint" style={{ display: 'block', marginTop: 4 }}>
                  Turn this OFF to control the pace yourself: when time is up, students wait for you to press "Start next round" (good for class discussion between rounds).
                </span>
              </div>

              <div className="form-group">
                <label className="form-label">Facilitator Passcode</label>
                <input
                  className="form-input"
                  value={passcode}
                  onChange={e => setPasscode(e.target.value.toUpperCase())}
                  placeholder="CODERED"
                />
                <span className="hint" style={{ display: 'block', marginTop: 4 }}>
                  Passcode to authorize facilitator injects and round advances during the live game.
                </span>
              </div>

              <div style={{ marginTop: 28, display: 'flex', gap: 12 }}>
                <button className="menu-btn secondary" onClick={onBack} style={{ flex: 1 }}>
                  Cancel
                </button>
                <button className="menu-btn accent" onClick={handleCreateServer} style={{ flex: 2 }}>
                  Create Server & Open Lobby →
                </button>
              </div>
            </div>
          ) : (
            /* Host Created Lobby */
            <div>
              <div
                style={{
                  background: '#091322',
                  border: '1px solid #1f3657',
                  borderRadius: 16,
                  padding: '16px 20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 12,
                  marginBottom: 20,
                }}
              >
                <div>
                  <span style={{ fontSize: 12, textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '0.08em' }}>
                    Share Code with Players:
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                    <span className="code-badge">{room?.code}</span>
                    <button className="copy-btn" onClick={copyCode}>
                      {copied ? '✓ Copied' : '📋 Copy Code'}
                    </button>
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 13, color: '#94a3b8' }}>Status</div>
                  <div style={{ color: '#38bdf8', fontWeight: 800, fontSize: 15 }}>
                    ● Lobby Ready ({room?.teams.length || 0} / {room?.maxTeams} Teams)
                  </div>
                </div>
              </div>

              {/* Roster Controls */}
              <div className="roster-header">
                <span>Teams in Lobby ({room?.teams.length || 0} / {room?.maxTeams})</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="chip-btn"
                    onClick={handleAddBotTeam}
                    disabled={Boolean(room && room.teams.length >= room.maxTeams)}
                  >
                    ➕ Add Bot Team
                  </button>
                  <button
                    className="chip-btn"
                    onClick={handleFillAllSlots}
                    disabled={Boolean(room && room.teams.length >= room.maxTeams)}
                  >
                    ⚡ Auto-Fill Slots
                  </button>
                </div>
              </div>

              {/* Connected Teams List */}
              {room && room.teams.length === 0 ? (
                <div
                  style={{
                    border: '2px dashed #263c5e',
                    borderRadius: 14,
                    padding: '36px 20px',
                    textAlign: 'center',
                    color: '#94a3b8',
                    marginBottom: 24,
                  }}
                >
                  <div style={{ fontSize: 28, marginBottom: 8 }}>👥</div>
                  <b>No teams have joined yet.</b>
                  <p style={{ margin: '6px 0 0', fontSize: 13 }}>
                    Share room code <b>{room.code}</b> with players, or click <b>"Auto-Fill Slots"</b> to add simulated opponents.
                  </p>
                </div>
              ) : (
                <div className="roster-grid">
                  {room?.teams.map(t => (
                    <div key={t.id} className="team-pill">
                      <span className="team-pill-name">{t.name}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className={'team-pill-badge' + (t.isBot ? ' bot' : '')}>
                          {t.isBot ? 'BOT' : 'PLAYER'}
                        </span>
                        <button
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#ef4444',
                            cursor: 'pointer',
                            fontSize: 14,
                            padding: '0 2px',
                          }}
                          title="Remove team"
                          onClick={() => handleKickTeam(t.id)}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Start Game Action */}
              <div
                style={{
                  background: 'rgba(56, 189, 248, 0.08)',
                  border: '1px solid rgba(56, 189, 248, 0.25)',
                  borderRadius: 14,
                  padding: '16px',
                  marginBottom: 20,
                  fontSize: 13,
                  color: '#cfe0f5',
                }}
              >
                🚀 <b>Ready to Launch:</b> Clicking <b>Start Game</b> will dispatch Round 1 to all connected student terminals and switch this host dashboard to the <b>Live Leaderboard</b>.
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  className="menu-btn secondary"
                  onClick={() => {
                    if (room) broadcast({ type: 'ROOM_CLOSED', roomCode: room.code });
                    setCreated(false);
                  }}
                  style={{ flex: 1 }}
                >
                  Cancel Server
                </button>
                <button
                  className="menu-btn success"
                  onClick={handleStartGame}
                  style={{ flex: 2, fontSize: 16, padding: '14px 20px' }}
                >
                  🚀 START GAME →
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
   4. HOST LEADERBOARD PAGE (Host's view once game starts)
   Displays comprehensive Leaderboard, team metrics, facilitator timer & injects.
   ─────────────────────────────────────────────────────────────────────────── */
interface HostLeaderboardProps {
  room: ServerRoom;
  onAdvanceRound: () => void;
  onTogglePause: () => void;
  onInject: (type: 's' | 'r' | 'o') => void;
  onExit: () => void;
}

const QUICK_MESSAGES = [
  'Remember: many people sharing one post is still only ONE source.',
  'Before you send a boat, check the report with at least 2 different sources.',
  'The AI can make things up. Tap its sources to check that they are real.',
  'Read your Goals box - it tells you the next step.',
  'Talk to your teammates before you decide. Two minds are better than one.',
];

const tile = (label: string, value: string | number, sub?: string, color = '#e2e8f0') => (
  <div className="gm-tile" key={label}>
    <div className="gm-tile-value" style={{ color }}>{value}</div>
    <div className="gm-tile-label">{label}</div>
    {sub && <div className="gm-tile-sub">{sub}</div>}
  </div>
);

export function HostLeaderboard({ room, onAdvanceRound, onTogglePause, onInject, onExit }: HostLeaderboardProps) {
  const [currentRoom, setCurrentRoom] = useState<ServerRoom>(room);
  const [timer, setTimer] = useState(room.timeRemaining);
  const [isPaused, setIsPaused] = useState(room.isPaused);
  const [injectToast, setInjectToast] = useState('');
  const [target, setTarget] = useState<string>('all');
  const [text, setText] = useState('');
  const [now, setNow] = useState(Date.now());
  const [flash, setFlash] = useState('');

  useEffect(() => {
    const unsubscribe = subscribeToSync(msg => {
      if ('roomCode' in msg && msg.roomCode.toUpperCase() === room.code.toUpperCase()) {
        const fresh = getRoom(room.code);
        if (fresh) setCurrentRoom(fresh);
      }
    });
    return () => unsubscribe();
  }, [room.code]);

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
      if (!isPaused) setTimer(v => Math.max(0, v - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [isPaused]);

  // Adopt the new round time when the host presses Advance
  useEffect(() => { setTimer(currentRoom.roundTime); }, [currentRoom.currentRound, currentRoom.roundTime]);

  const say = (m: string) => { setFlash(m); setTimeout(() => setFlash(''), 3500); };
  const pushLog = (line: string) => {
    const fresh = getRoom(room.code) || currentRoom;
    const updated: ServerRoom = { ...fresh, logs: [{ time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), text: line }, ...fresh.logs].slice(0, 100) };
    saveRoom(updated);
    setCurrentRoom(updated);
    broadcast({ type: 'ROOM_UPDATE', room: updated });
  };
  const targetName = target === 'all' ? 'all teams' : currentRoom.teams.find(t => t.id === target)?.name ?? 'team';

  const sendAnnounce = (msg: string) => {
    const clean = msg.trim();
    if (!clean) return;
    broadcast({ type: 'HOST_ACTION', roomCode: room.code, action: 'announce', payload: JSON.stringify({ to: target, text: clean }) });
    pushLog(`📢 To ${targetName}: "${clean}"`);
    say(`Sent to ${targetName}`);
    setText('');
  };
  const sendGrant = (fuel: number, food: number) => {
    broadcast({ type: 'HOST_ACTION', roomCode: room.code, action: 'grant', payload: JSON.stringify({ to: target, fuel, food }) });
    pushLog(`🎁 Sent +${fuel} fuel, +${food} food to ${targetName}.`);
    say(`Supplies sent to ${targetName}`);
  };
  const addTime = (sec: number) => {
    broadcast({ type: 'HOST_ACTION', roomCode: room.code, action: 'addtime', payload: String(sec) });
    setTimer(v => v + sec);
    pushLog(`⏱ Added ${sec / 60} minute(s) to the round for everyone.`);
  };
  const triggerInject = (k: 's' | 'r' | 'o', desc: string) => {
    onInject(k);
    setInjectToast(desc);
    setTimeout(() => setInjectToast(''), 4000);
  };

  const teams = currentRoom.teams.filter(t => !t.isBot);
  const everyone = currentRoom.teams;
  const sorted = [...everyone].sort((a, b) => (b.score || 0) - (a.score || 0));
  const playing = teams.filter(t => t.info);
  const avg = teams.length ? teams.reduce((a, t) => a + (t.score || 0), 0) / teams.length : 0;
  const saved = teams.reduce((a, t) => a + (t.savedCount || 0), 0);
  const caught = playing.filter(t => t.info!.caughtFake).length;
  const fell = playing.filter(t => t.info!.fellForFake).length;
  const checkers = playing.filter(t => t.info!.checks > 0).length;
  const rd = currentRoom.currentRound;
  const guide = GM_GUIDE[rd - 1];
  const floodedNow = B.filter(b => rd >= b.fr && b.fr < 99);
  const rdReports = R0.filter(r => r.rd === rd);
  const auto = currentRoom.autoAdvance !== false;

  // Who needs attention, and why
  const attention = playing.map(t => {
    const why: string[] = [];
    const info = t.info!;
    const idle = t.lastSeen ? Math.round((now - t.lastSeen) / 1000) : null;
    if (idle !== null && idle > 90 && t.status !== 'finished') why.push(`no activity for ${idle}s`);
    if (rd >= 2 && info.checks === 0) why.push('has not checked any report yet');
    if (info.falseAlarms >= 2) why.push(`${info.falseAlarms} units sent to dry areas`);
    if (info.fellForFake) why.push('approved the AI\'s made-up source');
    if (info.fuel < 10) why.push('almost out of fuel');
    if (info.round < rd) why.push(`still on round ${info.round}`);
    if (rd >= 3 && teams.length > 2 && (t.score || 0) < avg * 0.5) why.push('far below class average');
    return { t, why };
  }).filter(x => x.why.length > 0);

  const exportCsv = () => {
    const head = ['Team', 'Total', 'Rescue', 'SmartAI', 'Saved', 'Checks', 'FalseAlarms', 'CaughtFakeSource', 'ApprovedFakeSource', 'Round', 'Fuel', 'Food'];
    const lines = sorted.map(t => [t.name, Math.round(t.score || 0), Math.round(t.opsScore || 0), Math.round(t.aiScore || 0), t.savedCount || 0, t.info?.checks ?? '', t.info?.falseAlarms ?? '', t.info?.caughtFake ? 'yes' : 'no', t.info?.fellForFake ? 'yes' : 'no', t.info?.round ?? '', t.info?.fuel ?? '', t.info?.food ?? '']
      .map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `code-red-${currentRoom.code}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="host-dashboard">
      <header className="host-topbar">
        <div className="host-brand">
          <span className="host-title">AI: CODE RED · FACILITATOR</span>
          <span className="code-badge" style={{ fontSize: 16, padding: '4px 10px' }}>{currentRoom.code}</span>
        </div>
        <div className="host-stats-row">
          <span className="host-stat-chip active">Round {rd} / 5: {RT[rd - 1]}</span>
          <span className="host-stat-chip">
            ⏱ {Math.floor(timer / 60)}:{String(timer % 60).padStart(2, '0')}{isPaused ? ' (PAUSED)' : ''}
            {timer === 0 && !isPaused && (auto ? ' · advancing' : ' · TIME IS UP')}
          </span>
          <span className="host-stat-chip">👥 {teams.length} team{teams.length === 1 ? '' : 's'}</span>
          <span className="host-stat-chip">{currentRoom.difficulty === 'classic' ? 'Classic rules' : 'Guided rules'}</span>
          <button className="menu-btn secondary" style={{ width: 'auto', padding: '6px 14px', fontSize: 13 }} onClick={() => { setIsPaused(!isPaused); onTogglePause(); }}>
            {isPaused ? '▶ Resume' : '⏸ Pause'}
          </button>
          <button className="menu-btn secondary" style={{ width: 'auto', padding: '6px 14px', fontSize: 13 }} onClick={() => addTime(60)}>＋1 min</button>
          <button className="menu-btn primary" style={{ width: 'auto', padding: '6px 14px', fontSize: 13 }} onClick={onAdvanceRound} disabled={rd >= 5}>
            ⏭ {rd >= 5 ? 'Final round' : `Start round ${rd + 1}`}
          </button>
          <button className="menu-btn secondary" style={{ width: 'auto', padding: '6px 12px', fontSize: 13, borderColor: '#ef4444', color: '#f87171' }} onClick={onExit}>Exit</button>
        </div>
      </header>

      {flash && <div className="gm-flash">{flash}</div>}

      <div className="host-layout">
        <main className="host-main">
          {/* Class snapshot */}
          <div className="gm-tiles">
            {tile('Class average', Math.round(avg), 'out of 100')}
            {tile('People saved', saved, 'all teams')}
            {tile('Checked a report', `${checkers}/${playing.length}`, 'teams using the desk', checkers < playing.length / 2 ? '#fbbf24' : '#34d399')}
            {tile('Caught AI fake source', `${caught}/${playing.length}`, 'flagged "R77"', '#34d399')}
            {tile('Fooled by AI fake', fell, 'approved it', fell ? '#f87171' : '#94a3b8')}
            {tile('Need attention', attention.length, 'see below', attention.length ? '#fbbf24' : '#94a3b8')}
          </div>

          {/* Needs attention */}
          <div className="gm-card">
            <h3 className="gm-h">🙋 Teams that may need help</h3>
            {attention.length === 0 ? (
              <div className="gm-muted">Nobody flagged right now. Teams appear here if they are idle, behind, out of fuel, or repeating mistakes.</div>
            ) : attention.map(({ t, why }) => (
              <div key={t.id} className="gm-attn">
                <b>{t.name}</b> <span className="gm-muted">- {why.join('; ')}</span>
                <button className="gm-mini" onClick={() => { setTarget(t.id); say(`Selected ${t.name} - use the Send panel →`); }}>Select</button>
              </div>
            ))}
          </div>

          {/* Table */}
          <div className="board-header-section">
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>🏆 Teams <span className="gm-muted" style={{ fontSize: 13 }}>(click a row to select it for messages and supplies)</span></h2>
            <button className="gm-mini" onClick={exportCsv}>⬇ Download results (CSV)</button>
          </div>
          <div className="board-table-card" style={{ overflowX: 'auto' }}>
            <table className="leaderboard-table">
              <thead>
                <tr>
                  <th>#</th><th>Team</th><th>Score</th><th>Saved</th><th>Round</th><th>Fuel / Food</th><th>Checks</th><th>AI fake source</th><th>False alarms</th><th>Last action</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((t, idx) => {
                  const i = t.info;
                  const idle = t.lastSeen ? Math.round((now - t.lastSeen) / 1000) : null;
                  return (
                    <tr key={t.id} className={target === t.id ? 'gm-row-sel' : ''} onClick={() => setTarget(target === t.id ? 'all' : t.id)} style={{ cursor: 'pointer' }}>
                      <td className="rank-cell">{idx < 3 ? ['🥇', '🥈', '🥉'][idx] : idx + 1}</td>
                      <td className="team-name-cell"><span>{t.name}</span>{t.isBot && <span className="team-pill-badge bot">SIM</span>}</td>
                      <td className="score-cell">{Math.round(t.score || 0)}</td>
                      <td style={{ color: '#34d399', fontWeight: 700 }}>{t.savedCount || 0}</td>
                      <td>{t.status === 'finished' ? '🏁' : i ? `${i.round}/5` : '-'}</td>
                      <td>{i ? `${i.fuel} / ${i.food}` : '-'}</td>
                      <td>{i ? i.checks : '-'}</td>
                      <td>{!i ? '-' : i.caughtFake ? <span style={{ color: '#34d399' }}>✔ caught</span> : i.fellForFake ? <span style={{ color: '#f87171' }}>✖ fooled</span> : <span className="gm-muted">not yet</span>}</td>
                      <td style={{ color: i && i.falseAlarms ? '#f87171' : '#94a3b8' }}>{i ? i.falseAlarms : '-'}</td>
                      <td className="gm-muted" style={{ fontSize: 12, maxWidth: 260 }}>
                        {i ? i.lastEvent.slice(0, 70) : 'waiting…'}{idle !== null && idle > 45 ? ` (${idle}s ago)` : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </main>

        <aside className="host-sidebar">
          {/* Round guide */}
          <div className="ctrl-card">
            <h4 className="ctrl-title">📘 Round {rd} guide (facilitator only)</h4>
            <div className="gm-muted" style={{ marginBottom: 6 }}>{RT[rd - 1]}</div>
            <div style={{ fontSize: 13, lineHeight: 1.5 }}><b>What is really happening:</b> {guide.watch}</div>
            <div style={{ fontSize: 13, lineHeight: 1.5, marginTop: 6, color: '#7dd3fc' }}><b>Ask the class:</b> {guide.ask}</div>
            <details style={{ marginTop: 8 }}>
              <summary className="gm-muted" style={{ cursor: 'pointer' }}>Answer key for this round</summary>
              <div style={{ fontSize: 12, marginTop: 6 }}>
                <b>Actually flooded now:</b> {floodedNow.length ? floodedNow.map(b => b.n).join(', ') : 'none yet'}
              </div>
              {rdReports.map(r => (
                <div key={r.id} style={{ fontSize: 12, marginTop: 3 }}>
                  <b>{r.id}</b> ({r.b}) {r.t ? <span style={{ color: '#34d399' }}>TRUE</span> : <span style={{ color: '#f87171' }}>FALSE/OLD</span>} - {r.pv}
                </div>
              ))}
              {(rd === 3 || rd === 5) && <div style={{ fontSize: 12, marginTop: 3 }}><b>R77</b> <span style={{ color: '#f87171' }}>does not exist</span> - the AI invents it this round.</div>}
            </details>
          </div>

          {/* Message + supplies */}
          <div className="ctrl-card">
            <h4 className="ctrl-title">📢 Send to students</h4>
            <label className="gm-muted" style={{ fontSize: 12 }}>Send to</label>
            <select className="form-input" value={target} onChange={e => setTarget(e.target.value)} style={{ marginBottom: 8 }}>
              <option value="all">All teams</option>
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <textarea className="form-input" rows={2} value={text} onChange={e => setText(e.target.value)} placeholder="Type a message that pops up on their screen" />
            <button className="inject-btn" style={{ marginTop: 6 }} onClick={() => sendAnnounce(text)} disabled={!text.trim()}>📢 <span>Send message to {targetName}</span></button>
            <details style={{ marginTop: 6 }}>
              <summary className="gm-muted" style={{ cursor: 'pointer' }}>Quick hints</summary>
              {QUICK_MESSAGES.map(m => <button key={m} className="gm-quick" onClick={() => sendAnnounce(m)}>{m}</button>)}
            </details>
            <h4 className="ctrl-title" style={{ marginTop: 14 }}>🎁 Send supplies</h4>
            <button className="inject-btn" onClick={() => sendGrant(20, 10)}>⛽ <span>+20 fuel, +10 food to {targetName}</span></button>
            <button className="inject-btn" onClick={() => sendGrant(50, 25)}>⛽ <span>+50 fuel, +25 food to {targetName}</span></button>
            <button className="inject-btn" onClick={() => addTime(120)}>⏱ <span>Give everyone +2 minutes</span></button>
          </div>

          {/* Injects */}
          <div className="ctrl-card">
            <h4 className="ctrl-title">⚡ Crisis events (affects all teams)</h4>
            <button className="inject-btn" onClick={() => triggerInject('s', '🌊 Early storm surge in Dalig sent to all teams')}>🌊 <span>Storm surge hits Dalig</span></button>
            <button className="inject-btn" onClick={() => triggerInject('r', '💬 Viral rumor sent to all teams')}>💬 <span>Viral social media rumor</span></button>
            <button className="inject-btn" onClick={() => triggerInject('o', '📡 AI helper cut off for all teams')}>📡 <span>Cut off the AI helper</span></button>
            {injectToast && <div style={{ marginTop: 8, padding: '8px 10px', background: '#059669', color: '#fff', borderRadius: 8, fontSize: 12, fontWeight: 700 }}>{injectToast}</div>}
            <div className="gm-muted" style={{ marginTop: 8, fontSize: 12 }}>Tip: use the rumor in Round 2 or 3 to test whether teams check before acting.</div>
          </div>

          <div className="ctrl-card">
            <h4 className="ctrl-title">🌉 Conditions</h4>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: '#cfe0f5' }}>
              <div><b>Bridge:</b> {rd >= 3 ? '🔴 OUT (ambulances blocked, emergency supplies fail)' : '🟢 open'}</div>
              <div><b>Drone:</b> {rd >= 5 ? '🔴 grounded' : '🟢 flying'}</div>
              <div><b>Barangay phones:</b> {rd >= 5 ? '🔴 down' : '🟢 working'}</div>
              <div><b>Round advance:</b> {auto ? 'automatic at 0:00' : 'manual (you press the button)'}</div>
            </div>
          </div>

          <div className="ctrl-card" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <h4 className="ctrl-title">📜 Event log</h4>
            <div className="log-ticker">
              {currentRoom.logs.map((l, i) => (
                <div key={i} className="log-entry"><span className="log-time">{l.time}</span>{l.text}</div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}