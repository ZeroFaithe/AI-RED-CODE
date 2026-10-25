/**
 * Room synchronization for AI: CODE RED.
 *
 * Two transports, chosen at build time:
 *
 *  1. LOCAL (default / demo): BroadcastChannel + localStorage. Works between tabs of ONE browser.
 *  2. REMOTE (VITE_DEMO_MODE=false + Supabase URL/key): Supabase Realtime *Broadcast*. Works across
 *     computers. No database tables or serverless functions needed.
 *
 * REMOTE mode uses a HOST-AS-HUB model so simultaneous joins can't overwrite each other:
 *   - The host's browser owns the authoritative room (teams, round, logs).
 *   - Students send TEAM_JOIN / TEAM_LEAVE / SCORE_UPDATE; the host merges them and re-broadcasts ROOM_UPDATE.
 *   - Students ask for a room with ROOM_REQUEST; the host answers with ROOM_UPDATE.
 *   - ROOM_UPDATE from anyone who is not hosting that room is dropped.
 *   => The host tab must stay open for the whole session.
 */
/// <reference types="vite/client" />
import { createClient, type RealtimeChannel } from '@supabase/supabase-js';

/** Live progress details a team reports to the facilitator. */
export interface TeamInfo {
  round: number;
  fuel: number;
  food: number;
  flights: number;
  tokens: number;
  checks: number;        // cross-check results gathered so far
  caughtFake: boolean;   // flagged the AI's made-up citation
  fellForFake: boolean;  // approved a plan that cited a made-up report
  falseAlarms: number;   // units sent to dry/empty areas
  lastEvent: string;     // most recent log line
}

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
  info?: TeamInfo;
  /** Set by the host whenever it hears from this team (used to spot idle/disconnected teams). */
  lastSeen?: number;
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
  /** 'easy' = guided rules (default), 'classic' = original numbers. */
  difficulty?: 'easy' | 'classic';
  /** false = rounds only advance when the facilitator presses Advance. */
  autoAdvance?: boolean;
  createdAt: number;
  startedAt?: number;
  teams: RoomTeam[];
  logs: { time: string; text: string }[];
}

export type SyncMessage =
  | { type: 'ROOM_UPDATE'; room: ServerRoom }
  | { type: 'ROOM_REQUEST'; roomCode: string }
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
      status?: RoomTeam['status'];
      info?: TeamInfo;
    }
  | { type: 'HOST_ACTION'; roomCode: string; action: 'advance' | 'pause' | 'resume' | 'inject' | 'announce' | 'addtime' | 'grant'; payload?: string }
  | { type: 'ROOM_CLOSED'; roomCode: string };

type Envelope = SyncMessage & { _id?: string };
type Handler = (msg: SyncMessage) => void;

// Literal import.meta.env.VITE_* access is required so Vite statically replaces these at build time.
const SB_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
/** True when cross-computer multiplayer is configured. */
export const REMOTE = (import.meta.env.VITE_DEMO_MODE as string | undefined) === 'false' && Boolean(SB_URL && SB_KEY);
export const isRemote = () => REMOTE;

const CHANNEL_NAME = 'ai_code_red_multiplayer_sync';
const ROOM_PREFIX = 'cr_room_';
const up = (c: string) => c.toUpperCase();
const stamp = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/* ───────────────────────── shared state ───────────────────────── */
const handlers = new Set<Handler>();
const cache = new Map<string, ServerRoom>(); // REMOTE: in-memory rooms (host = authoritative)
const hosted = new Set<string>();            // room codes this browser is hosting

/* ───────────────────────── LOCAL transport ───────────────────────── */
let bc: BroadcastChannel | null = null;
if (!REMOTE) {
  try {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) bc = new BroadcastChannel(CHANNEL_NAME);
  } catch (e) {
    console.warn('BroadcastChannel not supported or restricted, relying on storage events', e);
  }
}

/* ───────────────────────── REMOTE transport ───────────────────────── */
let channel: RealtimeChannel | null = null;
let connected = false;
let outbox: Envelope[] = [];
const seen = new Set<string>();
const waiters = new Map<string, Array<(r: ServerRoom | null) => void>>();
const pendingRoomBroadcast = new Map<string, ReturnType<typeof setTimeout>>();

function ensureRemote(): void {
  if (!REMOTE || channel) return;
  const client = createClient(SB_URL!, SB_KEY!, { realtime: { params: { eventsPerSecond: 20 } } });
  channel = client.channel(CHANNEL_NAME, { config: { broadcast: { self: false } } });
  channel.on('broadcast', { event: 'msg' }, ({ payload }) => dispatch(payload as Envelope));
  channel.subscribe(status => {
    if (status === 'SUBSCRIBED') {
      connected = true;
      const queued = outbox;
      outbox = [];
      queued.forEach(m => channel!.send({ type: 'broadcast', event: 'msg', payload: m }));
      // After a reconnect, hosts re-announce their rooms so players resync.
      hosted.forEach(code => {
        const r = cache.get(code);
        if (r) sendRemote({ type: 'ROOM_UPDATE', room: r });
      });
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      connected = false;
      console.warn('Realtime channel status:', status);
    }
  });
}

function sendRemote(msg: SyncMessage): void {
  ensureRemote();
  const env: Envelope = { ...msg, _id: crypto.randomUUID() };
  if (connected && channel) channel.send({ type: 'broadcast', event: 'msg', payload: env });
  else outbox.push(env);
}

function dispatch(msg: Envelope): void {
  if (!msg || !msg.type) return;
  if (msg._id) {
    if (seen.has(msg._id)) return;
    seen.add(msg._id);
    if (seen.size > 2000) seen.delete(seen.values().next().value as string);
  }
  internal(msg);
  [...handlers].forEach(h => {
    try { h(msg); } catch (e) { console.error('sync handler error', e); }
  });
}

function pushRoom(code: string): void {
  const r = cache.get(code);
  if (r) sendRemote({ type: 'ROOM_UPDATE', room: r });
}

function scheduleRoomBroadcast(code: string): void {
  if (pendingRoomBroadcast.has(code)) return;
  pendingRoomBroadcast.set(code, setTimeout(() => { pendingRoomBroadcast.delete(code); pushRoom(code); }, 1000));
}

/** Hub logic. Runs BEFORE UI handlers so UI code reading getRoom() sees fresh data. */
function internal(msg: SyncMessage): void {
  switch (msg.type) {
    case 'ROOM_UPDATE': {
      const code = up(msg.room.code);
      if (hosted.has(code)) return; // the host never accepts someone else's version of its room
      cache.set(code, msg.room);
      (waiters.get(code) || []).forEach(w => w(msg.room));
      waiters.delete(code);
      return;
    }
    case 'ROOM_REQUEST': {
      const code = up(msg.roomCode);
      if (hosted.has(code)) pushRoom(code);
      return;
    }
    case 'TEAM_JOIN': {
      const code = up(msg.roomCode), r = cache.get(code);
      if (!hosted.has(code) || !r) return;
      if (!r.teams.some(t => t.id === msg.team.id) && r.teams.length < r.maxTeams) {
        cache.set(code, {
          ...r,
          teams: [...r.teams, msg.team],
          logs: [{ time: stamp(), text: `${msg.team.name} joined the lobby.` }, ...r.logs].slice(0, 100),
        });
      }
      pushRoom(code);
      return;
    }
    case 'TEAM_LEAVE': {
      const code = up(msg.roomCode), r = cache.get(code);
      if (!hosted.has(code) || !r) return;
      cache.set(code, { ...r, teams: r.teams.filter(t => t.id !== msg.teamId) });
      pushRoom(code);
      return;
    }
    case 'SCORE_UPDATE': {
      const code = up(msg.roomCode), r = cache.get(code);
      if (!hosted.has(code) || !r) return;
      if (!r.teams.some(t => t.id === msg.teamId)) return;
      cache.set(code, {
        ...r,
        teams: r.teams.map(t =>
          t.id !== msg.teamId ? t : {
            ...t,
            score: msg.score,
            opsScore: msg.opsScore,
            aiScore: msg.aiScore,
            savedCount: msg.savedCount,
            wasteCount: msg.wasteCount,
            reportsChecked: msg.reportsChecked,
            status: msg.status ?? t.status,
            info: msg.info ?? t.info,
            lastSeen: Date.now(),
          }),
      });
      scheduleRoomBroadcast(code); // throttled: many teams scoring at once
      return;
    }
    case 'ROOM_CLOSED': {
      const code = up(msg.roomCode);
      if (!hosted.has(code)) cache.delete(code);
      return;
    }
    default:
      return;
  }
}

/* ───────────────────────── public API ───────────────────────── */

export function broadcast(msg: SyncMessage): void {
  if (REMOTE) {
    if (msg.type === 'ROOM_UPDATE' && !hosted.has(up(msg.room.code))) return; // only the host publishes rooms
    sendRemote(msg);
    return;
  }
  if (bc) {
    try { bc.postMessage(msg); } catch (err) { console.warn('BroadcastChannel error', err); }
  }
  try { localStorage.setItem('cr_sync_signal', JSON.stringify({ ...msg, _t: Date.now() })); } catch { /* ignore */ }
}

export function subscribeToSync(handler: Handler): () => void {
  if (REMOTE) {
    ensureRemote();
    handlers.add(handler);
    return () => { handlers.delete(handler); };
  }
  const bcHandler = (e: MessageEvent) => { if (e.data && e.data.type) handler(e.data as SyncMessage); };
  const storageHandler = (e: StorageEvent) => {
    if (e.key === 'cr_sync_signal' && e.newValue) {
      try {
        const parsed = JSON.parse(e.newValue);
        if (parsed && parsed.type) handler(parsed as SyncMessage);
      } catch { /* ignore */ }
    }
  };
  if (bc) bc.addEventListener('message', bcHandler);
  window.addEventListener('storage', storageHandler);
  return () => {
    if (bc) bc.removeEventListener('message', bcHandler);
    window.removeEventListener('storage', storageHandler);
  };
}

export function saveRoom(room: ServerRoom): void {
  const code = up(room.code);
  if (REMOTE) cache.set(code, room);
  try {
    if (typeof localStorage !== 'undefined') {
      if (!REMOTE || hosted.has(code)) localStorage.setItem(ROOM_PREFIX + code, JSON.stringify(room));
      localStorage.setItem('cr_last_room', code);
    }
  } catch (e) {
    console.error('Failed to save room', e);
  }
}

export function getRoom(code: string): ServerRoom | null {
  if (REMOTE) return cache.get(up(code)) ?? null;
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(ROOM_PREFIX + up(code));
      if (raw) return JSON.parse(raw) as ServerRoom;
    }
  } catch (e) {
    console.error('Failed to get room', e);
  }
  return null;
}

/**
 * Look a room up. LOCAL: reads storage. REMOTE: asks the host over the network and waits up to
 * `timeoutMs` for its answer (resolves null if no host replies).
 */
export function fetchRoom(code: string, timeoutMs = 6000): Promise<ServerRoom | null> {
  const c = up(code);
  if (!REMOTE) return Promise.resolve(getRoom(c));
  if (hosted.has(c)) return Promise.resolve(cache.get(c) ?? null);
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      waiters.set(c, (waiters.get(c) || []).filter(w => w !== waiter));
      resolve(null);
    }, timeoutMs);
    const waiter = (r: ServerRoom | null) => { clearTimeout(timer); resolve(r); };
    waiters.set(c, [...(waiters.get(c) || []), waiter]);
    sendRemote({ type: 'ROOM_REQUEST', roomCode: c });
  });
}

export function deleteRoom(code: string): void {
  const c = up(code);
  cache.delete(c);
  hosted.delete(c);
  try { if (typeof localStorage !== 'undefined') localStorage.removeItem(ROOM_PREFIX + c); } catch { /* ignore */ }
}

export const PRESET_BOT_NAMES = [
  'Baybayin Rescue', 'Sagip Luzon', 'Tala Responders', 'Ilog Watch', 'Bayanihan Ops',
  'Agila Command', 'Pag-asa Unit', 'Kalasag Team', 'Dagat Guard',
];

export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return `CR-${code}`;
}

export function createNewRoom(options: {
  code: string;
  name: string;
  hostId: string;
  maxTeams: number;
  roundTime: number;
  droneFlights: number;
  difficulty?: 'easy' | 'classic';
  autoAdvance?: boolean;
}): ServerRoom {
  const code = options.code.toUpperCase();
  const room: ServerRoom = {
    code,
    name: options.name || 'Disaster Response Command',
    hostId: options.hostId,
    maxTeams: options.maxTeams || 10,
    roundTime: options.roundTime || 120,
    droneFlights: options.droneFlights || 3,
    status: 'lobby',
    currentRound: 1,
    timeRemaining: options.roundTime || 120,
    isPaused: false,
    difficulty: options.difficulty ?? 'easy',
    autoAdvance: options.autoAdvance ?? true,
    createdAt: Date.now(),
    teams: [],
    logs: [{ time: stamp(), text: `Command server created. Code: ${code} (Max: ${options.maxTeams} teams).` }],
  };
  if (REMOTE) { hosted.add(code); ensureRemote(); }
  saveRoom(room);
  broadcast({ type: 'ROOM_UPDATE', room });
  return room;
}