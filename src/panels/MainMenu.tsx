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
import { RT } from '../../shared/scenario';

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
        roundTime: 120,
        droneFlights: 3,
        status: 'lobby',
        currentRound: 1,
        timeRemaining: 120,
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
  const [roundTime, setRoundTime] = useState(120);
  const [droneFlights, setDroneFlights] = useState(3);
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
      droneFlights,
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
                    <option value={60}>60 Seconds (Blitz)</option>
                    <option value={90}>90 Seconds (Fast)</option>
                    <option value={120}>120 Seconds (Standard)</option>
                    <option value={180}>180 Seconds (Extended)</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Drone Flights Limit</label>
                  <select
                    className="form-input"
                    value={droneFlights}
                    onChange={e => setDroneFlights(Number(e.target.value))}
                  >
                    <option value={2}>2 Flights (Strict)</option>
                    <option value={3}>3 Flights (Default)</option>
                    <option value={5}>5 Flights (Generous)</option>
                  </select>
                </div>
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

export function HostLeaderboard({
  room,
  onAdvanceRound,
  onTogglePause,
  onInject,
  onExit,
}: HostLeaderboardProps) {
  const [currentRoom, setCurrentRoom] = useState<ServerRoom>(room);
  const [timer, setTimer] = useState(room.timeRemaining);
  const [isPaused, setIsPaused] = useState(room.isPaused);
  const [injectToast, setInjectToast] = useState('');

  // Live synchronization of team scores and events
  useEffect(() => {
    const unsubscribe = subscribeToSync(msg => {
      if ('roomCode' in msg && msg.roomCode.toUpperCase() === room.code.toUpperCase()) {
        const fresh = getRoom(room.code);
        if (fresh) {
          setCurrentRoom(fresh);
        }
      }
    });
    return () => unsubscribe();
  }, [room.code]);

  // Timer countdown
  useEffect(() => {
    const interval = setInterval(() => {
      if (!isPaused && timer > 0) {
        setTimer(v => v - 1);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [isPaused, timer]);

  const triggerInject = (k: 's' | 'r' | 'o', desc: string) => {
    onInject(k);
    setInjectToast(desc);
    setTimeout(() => setInjectToast(''), 4000);
  };

  // Sort teams by total score descending
  const sortedTeams = [...currentRoom.teams].sort((a, b) => (b.score || 0) - (a.score || 0));

  return (
    <div className="host-dashboard">
      {/* Top Bar Navigation */}
      <header className="host-topbar">
        <div className="host-brand">
          <span className="host-title">AI: CODE RED · HOST DASHBOARD</span>
          <span className="code-badge" style={{ fontSize: 16, padding: '4px 10px' }}>
            {currentRoom.code}
          </span>
        </div>

        <div className="host-stats-row">
          <span className="host-stat-chip active">
            Round {currentRoom.currentRound} / 5: {RT[currentRoom.currentRound - 1]}
          </span>
          <span className="host-stat-chip">
            ⏱ {Math.floor(timer / 60)}:{String(timer % 60).padStart(2, '0')}{isPaused ? ' (PAUSED)' : ''}
          </span>
          <span className="host-stat-chip">
            👥 {currentRoom.teams.length} Active Teams
          </span>

          <button
            className="menu-btn secondary"
            style={{ width: 'auto', padding: '6px 14px', fontSize: 13 }}
            onClick={() => {
              setIsPaused(!isPaused);
              onTogglePause();
            }}
          >
            {isPaused ? '▶ Resume' : '⏸ Pause'}
          </button>

          <button
            className="menu-btn primary"
            style={{ width: 'auto', padding: '6px 14px', fontSize: 13 }}
            onClick={onAdvanceRound}
          >
            ⏭ Advance Round
          </button>

          <button
            className="menu-btn secondary"
            style={{ width: 'auto', padding: '6px 12px', fontSize: 13, borderColor: '#ef4444', color: '#f87171' }}
            onClick={onExit}
          >
            Exit to Menu
          </button>
        </div>
      </header>

      {/* Main Content Layout: Leaderboard on Left, Facilitator Console on Right */}
      <div className="host-layout">
        {/* Left: Grand Leaderboard */}
        <main className="host-main">
          <div className="board-header-section">
            <div>
              <h2 style={{ margin: '0 0 4px', fontSize: 24, fontWeight: 800 }}>
                🏆 Live Team Leaderboard
              </h2>
              <div style={{ color: '#94a3b8', fontSize: 14 }}>
                Rankings update in real time as student command centers triage alerts, deploy boats, and verify sources.
              </div>
            </div>
            <div style={{ fontSize: 13, color: '#38bdf8', fontWeight: 600 }}>
              ● Live Syncing {sortedTeams.length} Teams
            </div>
          </div>

          <div className="board-table-card">
            <table className="leaderboard-table">
              <thead>
                <tr>
                  <th style={{ width: 60 }}>Rank</th>
                  <th>Team Call Sign</th>
                  <th>Total Score</th>
                  <th>Rescue (50)</th>
                  <th>Smart AI (50)</th>
                  <th>Saved</th>
                  <th>Waste</th>
                  <th>Fact-Checks</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sortedTeams.map((team, idx) => {
                  const rank = idx + 1;
                  return (
                    <tr key={team.id}>
                      <td className="rank-cell">
                        <div className={'rank-pill ' + (rank === 1 ? 'rank-1' : rank === 2 ? 'rank-2' : rank === 3 ? 'rank-3' : '')}>
                          {rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : `#${rank}`}
                        </div>
                      </td>
                      <td className="team-name-cell">
                        <span>{team.name}</span>
                        {team.isBot && <span className="team-pill-badge bot">SIM</span>}
                      </td>
                      <td className="score-cell">
                        {Math.round(team.score || 0)} <span style={{ fontSize: 13, color: '#64748b' }}>pts</span>
                      </td>
                      <td>
                        <span style={{ color: '#38bdf8', fontWeight: 700 }}>
                          {Math.round(team.opsScore || 0)}
                        </span> / 50
                      </td>
                      <td>
                        <span style={{ color: '#a78bfa', fontWeight: 700 }}>
                          {Math.round(team.aiScore || 0)}
                        </span> / 50
                      </td>
                      <td style={{ fontWeight: 600, color: '#34d399' }}>
                        🙂 {team.savedCount || 0}
                      </td>
                      <td style={{ color: team.wasteCount ? '#ef4444' : '#94a3b8' }}>
                        ⛽ {team.wasteCount || 0}u
                      </td>
                      <td>
                        🔍 {team.reportsChecked || 0}
                      </td>
                      <td>
                        <span
                          style={{
                            padding: '3px 8px',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 700,
                            background: 'rgba(56, 189, 248, 0.15)',
                            color: '#38bdf8',
                          }}
                        >
                          {team.status === 'finished' ? '🏁 Complete' : 'Active'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </main>

        {/* Right Sidebar: Facilitator Controls & Telemetry */}
        <aside className="host-sidebar">
          {/* Facilitator Inject Controls */}
          <div className="ctrl-card">
            <h4 className="ctrl-title">⚡ Facilitator Crisis Injects</h4>
            <button
              className="inject-btn"
              onClick={() => triggerInject('s', '🌊 Triggered Early Storm Surge in Dalig!')}
            >
              🌊 <span>Early Storm Surge (Dalig)</span>
            </button>
            <button
              className="inject-btn"
              onClick={() => triggerInject('r', '💬 Released Unverified Social Media Viral Rumor!')}
            >
              💬 <span>Viral Social Media Rumor</span>
            </button>
            <button
              className="inject-btn"
              onClick={() => triggerInject('o', '📡 Simulated AI Network Uplink Blackout!')}
            >
              📡 <span>Sever AI Network Uplink</span>
            </button>
            {injectToast && (
              <div style={{ marginTop: 8, padding: '8px 10px', background: '#059669', color: '#fff', borderRadius: 8, fontSize: 12, fontWeight: 700 }}>
                {injectToast}
              </div>
            )}
          </div>

          {/* Round Timeline & Bridge Status */}
          <div className="ctrl-card">
            <h4 className="ctrl-title">🌉 Tactical Environmental Status</h4>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: '#cfe0f5' }}>
              <div><b>Bagong Silang Bridge:</b> {currentRoom.currentRound >= 3 ? '🔴 WASHED OUT (Land blocked)' : '🟢 OPEN'}</div>
              <div><b>Drone Reconnaissance:</b> {currentRoom.currentRound >= 5 ? '🔴 GROUNDED (Wind gust blackout)' : '🟢 ACTIVE'}</div>
              <div><b>Barangay Phone Lines:</b> {currentRoom.currentRound >= 5 ? '🔴 OFFLINE' : '🟢 ONLINE'}</div>
            </div>
          </div>

          {/* Live Simulation Event Log */}
          <div className="ctrl-card" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <h4 className="ctrl-title">📜 Live Event Ticker</h4>
            <div className="log-ticker">
              {currentRoom.logs.map((log, i) => (
                <div key={i} className="log-entry">
                  <span className="log-time">{log.time}</span>
                  {log.text}
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}