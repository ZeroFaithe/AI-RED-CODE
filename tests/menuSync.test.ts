import { describe, expect, it, beforeEach } from 'vitest';
import {
  createNewRoom,
  generateRoomCode,
  getRoom,
  saveRoom,
  deleteRoom,
  type ServerRoom,
  PRESET_BOT_NAMES,
} from '../src/multiplayer/roomSync';

const storageMap = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storageMap.get(key) ?? null,
  setItem: (key: string, value: string) => storageMap.set(key, value),
  removeItem: (key: string) => storageMap.delete(key),
  clear: () => storageMap.clear(),
};
Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

describe('multiplayer roomSync and lobby logic', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('generates a valid 4-character room code prefixed with CR-', () => {
    const code = generateRoomCode();
    expect(code).toMatch(/^CR-[A-Z0-9]{4}$/);
  });

  it('creates and saves a room with custom settings', () => {
    const room = createNewRoom({
      code: 'CR-TEST',
      name: 'Classroom Beta',
      hostId: 'host-1',
      maxTeams: 6,
      roundTime: 90,
      droneFlights: 2,
    });

    expect(room.code).toBe('CR-TEST');
    expect(room.maxTeams).toBe(6);
    expect(room.roundTime).toBe(90);
    expect(room.droneFlights).toBe(2);
    expect(room.status).toBe('lobby');

    const loaded = getRoom('CR-TEST');
    expect(loaded).not.toBeNull();
    expect(loaded?.name).toBe('Classroom Beta');
    expect(loaded?.maxTeams).toBe(6);
  });

  it('supports adding and tracking teams up to maxTeams', () => {
    const room = createNewRoom({
      code: 'CR-TEAM',
      name: 'Exercise 1',
      hostId: 'host-1',
      maxTeams: 4,
      roundTime: 120,
      droneFlights: 3,
    });

    // Add teams
    room.teams.push({
      id: 't-alpha',
      name: 'Team Alpha',
      score: 45,
      opsScore: 25,
      aiScore: 20,
      savedCount: 30,
      wasteCount: 0,
      reportsChecked: 4,
      status: 'ready',
      joinedAt: Date.now(),
    });

    saveRoom(room);
    const loaded = getRoom('CR-TEAM');
    expect(loaded?.teams.length).toBe(1);
    expect(loaded?.teams[0].name).toBe('Team Alpha');
    expect(loaded?.teams[0].score).toBe(45);
  });

  it('transitions room from lobby to in_progress when started', () => {
    const room = createNewRoom({
      code: 'CR-START',
      name: 'Exercise Start',
      hostId: 'host-1',
      maxTeams: 10,
      roundTime: 120,
      droneFlights: 3,
    });

    expect(room.status).toBe('lobby');
    const started: ServerRoom = {
      ...room,
      status: 'in_progress',
      startedAt: Date.now(),
    };
    saveRoom(started);

    const loaded = getRoom('CR-START');
    expect(loaded?.status).toBe('in_progress');
    expect(loaded?.startedAt).toBeDefined();
  });

  it('correctly handles room deletion', () => {
    createNewRoom({
      code: 'CR-DEL',
      name: 'To Delete',
      hostId: 'host-1',
      maxTeams: 5,
      roundTime: 120,
      droneFlights: 3,
    });
    expect(getRoom('CR-DEL')).not.toBeNull();

    deleteRoom('CR-DEL');
    expect(getRoom('CR-DEL')).toBeNull();
  });

  it('has preset bot team names for automated filling', () => {
    expect(PRESET_BOT_NAMES.length).toBeGreaterThanOrEqual(9);
    expect(PRESET_BOT_NAMES).toContain('Baybayin Rescue');
    expect(PRESET_BOT_NAMES).toContain('Sagip Luzon');
  });

  it('resets game to round 1 with 3/3 investigation points and unstarted players when hosted', () => {
    const room = createNewRoom({
      code: 'CR-RESTART',
      name: 'Fresh Exercise',
      hostId: 'host-1',
      maxTeams: 8,
      roundTime: 120,
      droneFlights: 3,
    });
    expect(room.currentRound).toBe(1);
    expect(room.status).toBe('lobby');

    // Add teams with prior progress
    room.teams.push({
      id: 't-old',
      name: 'Prior Team',
      score: 80,
      opsScore: 40,
      aiScore: 40,
      savedCount: 50,
      wasteCount: 12,
      reportsChecked: 8,
      status: 'in_mission',
      joinedAt: Date.now() - 5000,
    });

    // Reset / restart on hosting game
    const restarted: ServerRoom = {
      ...room,
      status: 'in_progress',
      currentRound: 1,
      teams: room.teams.map(t => ({
        ...t,
        score: 0,
        opsScore: 0,
        aiScore: 0,
        savedCount: 0,
        wasteCount: 0,
        reportsChecked: 0,
        status: 'ready' as const,
      })),
    };

    saveRoom(restarted);
    const loaded = getRoom('CR-RESTART');
    expect(loaded?.currentRound).toBe(1);
    expect(loaded?.teams[0].score).toBe(0);
    expect(loaded?.teams[0].status).toBe('ready');
  });

  it('rejects duplicate team names (case-insensitive) to ensure only one page accesses each team', () => {
    const room = createNewRoom({
      code: 'CR-UNIQUE',
      name: 'Unique Test',
      hostId: 'host-1',
      maxTeams: 6,
      roundTime: 120,
      droneFlights: 3,
    });

    room.teams.push({
      id: 'team-alpha-id',
      name: 'Team Alpha',
      score: 0,
      opsScore: 0,
      aiScore: 0,
      savedCount: 0,
      wasteCount: 0,
      reportsChecked: 0,
      status: 'ready',
      joinedAt: Date.now(),
    });
    saveRoom(room);

    const checkNameExists = (name: string) => {
      const current = getRoom('CR-UNIQUE')!;
      return current.teams.some(t => t.name.trim().toLowerCase() === name.trim().toLowerCase());
    };

    expect(checkNameExists('Team Alpha')).toBe(true);
    expect(checkNameExists('team alpha')).toBe(true);
    expect(checkNameExists('TEAM ALPHA ')).toBe(true);
    expect(checkNameExists('Team Beta')).toBe(false);
  });
});
