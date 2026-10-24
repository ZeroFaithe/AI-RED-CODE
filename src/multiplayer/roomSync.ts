/**
 * Local & Cross-Tab Multiplayer Room Synchronization for AI: CODE RED
 * Uses BroadcastChannel with localStorage fallback so multiple browser tabs
 * can act as Host and Players with zero server configuration.
 */

export interface RoomTeam {
  id: string;
  name: string;
  isHost?: boolean;
  isBot?: boolean;
  score: number;
  opsScore: number;
  aiScore: number;
  savedCount: number;
  wasteCount: number;
  reportsChecked: number;
  status: 'waiting' | 'ready' | 'in_mission' | 'finished';
  joinedAt: number;
}

export interface ServerRoom {
  code: string;
  name: string;
  hostId: string;
  maxTeams: number;
  roundTime: number; // in seconds
  droneFlights: number;
  status: 'lobby' | 'in_progress' | 'finished';
  currentRound: number;
  timeRemaining: number;
  isPaused: boolean;
  createdAt: number;
  startedAt?: number;
  teams: RoomTeam[];
  logs: { time: string; text: string }[];
}

export type SyncMessage =
  | { type: 'ROOM_UPDATE'; room: ServerRoom }
  | { type: 'START_GAME'; roomCode: string }
  | { type: 'RESET_GAME'; roomCode: string }
  | { type: 'TEAM_JOIN'; roomCode: string; team: RoomTeam }
  | { type: 'TEAM_LEAVE'; roomCode: string; teamId: string }
  | {
      type: 'SCORE_UPDATE';
      roomCode: string;
      teamId: string;
      score: number;
      opsScore: number;
      aiScore: number;
      savedCount: number;
      wasteCount: number;
      reportsChecked: number;
    }
  | { type: 'HOST_ACTION'; roomCode: string; action: 'advance' | 'pause' | 'resume' | 'inject'; payload?: string }
  | { type: 'ROOM_CLOSED'; roomCode: string };

const CHANNEL_NAME = 'ai_code_red_multiplayer_sync';
const ROOM_PREFIX = 'cr_room_';

let bc: BroadcastChannel | null = null;
try {
  if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
    bc = new BroadcastChannel(CHANNEL_NAME);
  }
} catch (e) {
  console.warn('BroadcastChannel not supported or restricted, relying on storage events', e);
}

export function broadcast(msg: SyncMessage): void {
  if (bc) {
    try {
      bc.postMessage(msg);
    } catch (err) {
      console.warn('BroadcastChannel error', err);
    }
  }
  // Also trigger a storage event for cross-tab sync compatibility
  try {
    localStorage.setItem('cr_sync_signal', JSON.stringify({ ...msg, _t: Date.now() }));
  } catch {
    /* ignore */
  }
}

export function subscribeToSync(handler: (msg: SyncMessage) => void): () => void {
  const bcHandler = (e: MessageEvent) => {
    if (e.data && e.data.type) {
      handler(e.data as SyncMessage);
    }
  };

  const storageHandler = (e: StorageEvent) => {
    if (e.key === 'cr_sync_signal' && e.newValue) {
      try {
        const parsed = JSON.parse(e.newValue);
        if (parsed && parsed.type) {
          handler(parsed as SyncMessage);
        }
      } catch {
        /* ignore */
      }
    }
  };

  if (bc) {
    bc.addEventListener('message', bcHandler);
  }
  window.addEventListener('storage', storageHandler);

  return () => {
    if (bc) {
      bc.removeEventListener('message', bcHandler);
    }
    window.removeEventListener('storage', storageHandler);
  };
}

export function saveRoom(room: ServerRoom): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(ROOM_PREFIX + room.code.toUpperCase(), JSON.stringify(room));
      localStorage.setItem('cr_last_room', room.code.toUpperCase());
    }
  } catch (e) {
    console.error('Failed to save room', e);
  }
}

export function getRoom(code: string): ServerRoom | null {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(ROOM_PREFIX + code.toUpperCase());
      if (raw) return JSON.parse(raw) as ServerRoom;
    }
  } catch (e) {
    console.error('Failed to get room', e);
  }
  return null;
}

export function deleteRoom(code: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(ROOM_PREFIX + code.toUpperCase());
    }
  } catch {
    /* ignore */
  }
}

export const PRESET_BOT_NAMES = [
  'Baybayin Rescue',
  'Sagip Luzon',
  'Tala Responders',
  'Ilog Watch',
  'Bayanihan Ops',
  'Agila Command',
  'Pag-asa Unit',
  'Kalasag Team',
  'Dagat Guard',
];

export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `CR-${code}`;
}

export function createNewRoom(options: {
  code: string;
  name: string;
  hostId: string;
  maxTeams: number;
  roundTime: number;
  droneFlights: number;
}): ServerRoom {
  const room: ServerRoom = {
    code: options.code.toUpperCase(),
    name: options.name || 'Disaster Response Command',
    hostId: options.hostId,
    maxTeams: options.maxTeams || 10,
    roundTime: options.roundTime || 120,
    droneFlights: options.droneFlights || 3,
    status: 'lobby',
    currentRound: 1,
    timeRemaining: options.roundTime || 120,
    isPaused: false,
    createdAt: Date.now(),
    teams: [],
    logs: [
      {
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        text: `Command server created. Code: ${options.code.toUpperCase()} (Max: ${options.maxTeams} teams).`,
      },
    ],
  };
  saveRoom(room);
  broadcast({ type: 'ROOM_UPDATE', room });
  return room;
}
