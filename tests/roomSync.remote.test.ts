import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory stand-in for Supabase Realtime Broadcast: delivers to every OTHER client (self:false).
const clients: Array<(p: unknown) => void> = [];
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    channel: () => {
      let cb: (x: { payload: unknown }) => void = () => {};
      let subCb: (s: string) => void = () => {};
      const me = (p: unknown) => cb({ payload: p });
      const ch = {
        on: (_t: string, _f: unknown, fn: typeof cb) => { cb = fn; return ch; },
        subscribe: (fn: (s: string) => void) => { subCb = fn; clients.push(me); queueMicrotask(() => subCb('SUBSCRIBED')); return ch; },
        send: ({ payload }: { payload: unknown }) => { clients.filter(c => c !== me).forEach(c => queueMicrotask(() => c(payload))); },
      };
      return ch;
    },
  }),
}));

type Mod = typeof import('../src/multiplayer/roomSync');
async function browser(): Promise<Mod> {           // each call = a separate browser with its own module state
  vi.resetModules();
  vi.stubEnv('VITE_DEMO_MODE', 'false'); vi.stubEnv('VITE_SUPABASE_URL', 'http://x'); vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'k');
  return await import('../src/multiplayer/roomSync');
}
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));
const team = (id: string, name: string) => ({ id, name, score: 0, opsScore: 0, aiScore: 0, savedCount: 0, wasteCount: 0, reportsChecked: 0, status: 'ready' as const, joinedAt: 1 });

beforeEach(() => { clients.length = 0; vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} }); });

describe('remote host-as-hub', () => {
  it('students on other "computers" find the room, join concurrently, and all appear on the host', async () => {
    const host = await browser();
    const room = host.createNewRoom({ code: 'cr-abcd', name: 'T', hostId: 'h', maxTeams: 10, roundTime: 120, droneFlights: 3 });
    await tick();
    const students = [await browser(), await browser(), await browser()];
    const found = await Promise.all(students.map(s => s.fetchRoom('CR-ABCD', 500)));
    found.forEach(r => expect(r?.code).toBe('CR-ABCD'));
    students.forEach((s, i) => s.broadcast({ type: 'TEAM_JOIN', roomCode: room.code, team: team('t' + i, 'Team ' + i) })); // simultaneous
    await tick(80);
    expect(host.getRoom('CR-ABCD')!.teams.map(t => t.id).sort()).toEqual(['t0', 't1', 't2']);
    for (const s of students) expect(s.getRoom('CR-ABCD')!.teams.length).toBe(3); // everyone sees the full roster
  });

  it('wrong code times out as null; capacity and duplicate ids are enforced', async () => {
    const host = await browser(); const s = await browser();
    host.createNewRoom({ code: 'CR-FULL', name: 'T', hostId: 'h', maxTeams: 2, roundTime: 120, droneFlights: 3 }); await tick();
    expect(await s.fetchRoom('CR-NOPE', 150)).toBeNull();
    for (const id of ['a', 'a', 'b', 'c']) s.broadcast({ type: 'TEAM_JOIN', roomCode: 'CR-FULL', team: team(id, id) });
    await tick(60);
    expect(host.getRoom('CR-FULL')!.teams.map(t => t.id)).toEqual(['a', 'b']);
  });

  it('score updates reach the host and are re-broadcast (throttled) to players', async () => {
    const host = await browser(); const s = await browser();
    host.createNewRoom({ code: 'CR-SCOR', name: 'T', hostId: 'h', maxTeams: 10, roundTime: 120, droneFlights: 3 }); await tick();
    await s.fetchRoom('CR-SCOR', 500);
    s.broadcast({ type: 'TEAM_JOIN', roomCode: 'CR-SCOR', team: team('t1', 'One') }); await tick(60);
    const seen: number[] = []; s.subscribeToSync(m => { if (m.type === 'ROOM_UPDATE') seen.push(m.room.teams[0].score); });
    for (let i = 1; i <= 5; i++) s.broadcast({ type: 'SCORE_UPDATE', roomCode: 'CR-SCOR', teamId: 't1', score: i * 10, opsScore: 0, aiScore: 0, savedCount: 0, wasteCount: 0, reportsChecked: 0, status: 'in_mission' });
    await tick(60);
    expect(host.getRoom('CR-SCOR')!.teams[0]).toMatchObject({ score: 50, status: 'in_mission' });
    await tick(1100);
    expect(seen).toEqual([50]); // 5 updates -> ONE throttled broadcast carrying the latest score
  });

  it('a student cannot overwrite the host\'s room with their own ROOM_UPDATE', async () => {
    const host = await browser(); const s = await browser();
    const room = host.createNewRoom({ code: 'CR-SAFE', name: 'T', hostId: 'h', maxTeams: 10, roundTime: 120, droneFlights: 3 }); await tick();
    await s.fetchRoom('CR-SAFE', 500);
    s.broadcast({ type: 'ROOM_UPDATE', room: { ...room, teams: [team('evil', 'Evil')] } }); await tick(60);
    expect(host.getRoom('CR-SAFE')!.teams).toEqual([]);
  });
});