import type { Barangay, Report, UnitType } from './types.js';
export const B: Barangay[] = [
  { id: 'A', n: 'Sta. Lucia', x: 210, y: 170, pop: 140, fr: 1 }, { id: 'B', n: 'San Roque', x: 430, y: 130, pop: 200, fr: 2 },
  { id: 'C', n: 'Bagong Silang', x: 650, y: 235, pop: 90, fr: 3 }, { id: 'D', n: 'Pulo', x: 300, y: 345, pop: 160, fr: 2 },
  { id: 'E', n: 'Masagana', x: 115, y: 340, pop: 110, fr: 99 }, { id: 'F', n: 'Dalig', x: 570, y: 385, pop: 130, fr: 4 }];
export const EV = [{ id: 'E1', n: 'Evac Center 1', x: 80, y: 470, cap: 200 }, { id: 'E2', n: 'Evac Center 2', x: 770, y: 440, cap: 150 }];
// ── Balance (v2): starting supplies and costs, tuned so careful play can reach most residents ──
export const START_RES = { fuel: 160, food: 100, med: 4 };
export const HQ = { x: 450, y: 505 };
export const SPD: Record<UnitType, number> = { boat: 110, amb: 150, drone: 210 };
export const COST: Record<UnitType, Record<string, number>> = { boat: { fuel: 10, food: 4 }, amb: { fuel: 6, med: 1 }, drone: { fuel: 6 } };
/** Food eaten per person evacuated (was 10%; now 5%). */
export const FOOD_PER_PERSON = 0.05;
// ── Shelters ──
export const HOSPITAL_CAP = 60;        // ambulances deliver here first
export const HOSPITAL_DISCHARGE = 30;  // patients discharged at each round start
export const RELOCATE_COST = { fuel: 8, food: 4 };
export const RELOCATE_MAX = 80;        // people moved per convoy, one convoy per center per round
export const CAP = { boat: 40, amb: 20, drone: 0 };
/** Only areas that actually flood count toward rescue effectiveness (Masagana never floods: its reports are false). */
export const TOTPOP = B.filter(b => b.fr < 99).reduce((a, b) => a + b.pop, 0);
export const RT = ['Weather & flood forecast', 'Evacuation reports & shelter capacity', 'Infrastructure damage & blocked roads', 'Conflicting missing-person reports', 'Communication failure'];
export const KW = ['source', 'verify', 'confidence', 'uncertain', 'evidence', 'timestamp', 'contradict', 'independent'];

// ── Supply replenishment constants ────────────────────────────────────────────
/** Fuel added at the start of every round by the supply depot. */
export const DEPOT_FUEL = 20;
/** Food added at the start of every round by the supply depot. */
export const DEPOT_FOOD = 12;
/** Extra fuel from a one-time emergency resupply request. */
export const RESUPPLY_FUEL = 40;
/** Extra food from a one-time emergency resupply request. */
export const RESUPPLY_FOOD = 25;

// ── Drone and analyst limits ──────────────────────────────────────────────────
/** Total scout drone flights allowed per game. */
export const DRONE_MAX_FLIGHTS = 3;
/** Cross-check analyst time tokens per round (unused tokens do NOT carry over). */
export const ANALYST_TOKENS_PER_ROUND = 3;

// ── Population decay ──────────────────────────────────────────────────────────
/** Fraction of remaining unrescued population lost per round in a flooded area (15%). */
export const POP_DECAY = 0.15;

// ── Report IDs that belong to stale official advisory series ─────────────────
/** Cross-checking these via the official channel may return "no new record" because
 *  the issuing series has not been updated. */
export const STALE_OFFICIAL_SERIES = new Set(['R9', 'R11']);

const r = (id: string, rd: number, b: string, cl: 'f' | 'd', src: string, k: string, age: number, cf: number, t: 0 | 1, g: string, pv: string, tx: string): Report => ({ id, rd, b, cl, src, k, age, cf, t, g, pv, tx });
export const R0: Report[] = [
  r('R1', 1, 'A', 'f', 'PAGASA regional bulletin', 'official', 20, 90, 1, 'G1', 'Direct bulletin signed by a forecaster.', 'River surge expected to reach low-lying Sta. Lucia by noon.'),
  r('R2', 1, 'E', 'f', 'Facebook: MAD Alert PH', 'social', 45, 35, 0, 'G2', 'Screenshot reshared 12x; original poster unknown.', 'Masagana is TOTALLY underwater!! share!!'),
  r('R3', 1, 'A', 'f', 'Resident call (Kap. Dela Cruz)', 'resident', 30, 60, 1, 'G3', 'Phone call logged by the MDRRMO desk.', 'Knee-deep water in Sta. Lucia, children on second floors.'),
  r('R4', 2, 'B', 'f', 'Barangay radio, San Roque', 'resident', 15, 70, 1, 'G4', 'Call sign matches the barangay registry.', 'Water rising fast, families on rooftops in San Roque.'),
  r('R5', 2, 'E', 'f', 'Facebook: MAD Alert PH (repost)', 'social', 60, 50, 0, 'G2', 'Same origin as R2. A reshare, NOT independent.', '300 stranded in Masagana, send boats now!'),
  r('R6', 2, 'D', 'f', 'LGU flood monitor (partial)', 'official', 90, 55, 1, 'G5', 'Gauge reading is 90 minutes old.', 'Pulo gauge is above spill level.'),
  r('R7', 3, 'C', 'f', 'MDRRMO field team', 'official', 10, 85, 1, 'G6', 'Team on site, GPS tagged.', 'Bridge to Bagong Silang washed out, residents cut off.'),
  r('R8', 3, 'D', 'f', 'BFP drone feed', 'drone', 5, 80, 1, 'G7', 'Live geotagged video.', 'Pulo flooded, about 160 stranded on rooftops.'),
  r('R9', 3, 'F', 'd', 'LGU advisory v1', 'official', 600, 60, 1, 'G8', 'Issued 10 hours ago. Correct then, now stale.', 'Dalig is safe, no flooding.'),
  r('R10', 4, 'F', 'f', 'SMS from resident', 'resident', 25, 65, 1, 'G9', 'Number matches the barangay registry.', 'Dalig flooded, family trapped, 40 missing.'),
  r('R11', 4, 'F', 'd', 'LGU situation report v2', 'official', 480, 70, 0, 'G8', 'Same series as R9, 8 hours old. Outdated.', 'No incidents reported in Dalig.'),
  r('R12', 4, 'E', 'f', 'Facebook comment thread', 'social', 40, 40, 0, 'G2', 'Same origin chain as R2 and R5.', 'Masagana still flooded, please share!'),
  r('R13', 5, 'D', 'd', 'Barangay SMS blast', 'resident', 70, 75, 0, 'G10', 'Auto-sent before the network failed. Stale.', 'Pulo water has receded, area safe.'),
  r('R14', 5, 'F', 'f', 'Amateur radio relay', 'resident', 20, 55, 1, 'G11', 'HAM relay, weak signal, the only channel working.', 'Dalig still stranded, about 130 people, cell towers down.')];
