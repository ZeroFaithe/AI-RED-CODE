export type Cat = 'lives' | 'res' | 'ver' | 'com' | 'prm';
export type UnitType = 'boat' | 'amb' | 'drone';
export type CheckChannel = 'official' | 'news' | 'social' | 'barangay';
export interface Barangay { id: string; n: string; x: number; y: number; pop: number; fr: number }
export interface Report { id: string; rd: number; b: string; cl: 'f' | 'd'; src: string; k: string; age: number; cf: number; t: 0 | 1; g: string; pv: string; tx: string }
export interface LedgerEntry { rd: number; cat: Cat; pts: number; why: string; ev: string }
export interface Dep { b: string; src: 'manual' | 'ai'; rid?: string; fake?: boolean; sup: boolean; opp: boolean; fuel: number; departedAt?: number; dur?: number }
export interface Unit { id: string; ty: UnitType; st: 'idle' | 'out'; tg?: string; dep?: Dep }
export interface Rec { id: string; rd: number; b: string | null; txt: string; cites: string[]; fake: string | null; unc: string; st: 'pending' | 'approved' | 'rejected' | 'flagged' | 'info' }
export interface Stats { caught: number; vOK: number; vN: number; unsup: number; hall: number; waste: number; deps: number; ok: number }
/** Result of a cross-check against one channel. `independent` is true when the channel's
 *  result does NOT share an origin group with the report being checked (so it counts toward
 *  the two-independent-source corroboration threshold). */
export interface CrossCheckResult {
  channel: CheckChannel;
  label: string;      // e.g. "📋 Official (PAGASA/MDRRMO)"
  rd: number;         // round it was checked
  summary: string;    // plain-language result
  cf: number;         // 0-100 confidence the check returned
  independent: boolean; // true = genuinely independent of the report's origin group
  stale: boolean;     // true = data is stale (old advisory)
  circular: boolean;  // true = social echo — NOT independent
  unavailable: boolean; // true = channel was unavailable this round
}

export interface TeamState {
  teamId: string; round: number; finished: boolean; aiOff: boolean;
  res: { fuel: number; food: number; med: number };
  pop: Record<string, number>; saved: number; over: number; ev: Record<string, number>;
  rev: Record<string, number>; fr: Record<string, number>; marks: Record<string, string>;
  keys: Record<string, 1>; done: Record<string, 1>;
  led: LedgerEntry[]; log: { rd: number; t: string }[]; ai: Rec[]; xr: Report[]; units: Unit[]; st: Stats;
  /** Scout drone: how many flights remain (starts at DRONE_MAX_FLIGHTS, decrements per use). */
  /** People moved out of evacuation centers to the provincial shelter (frees space). */
  relocated: number;
  droneFlights: number;
  /** Analyst time tokens for cross-checking. 3 per round; unused tokens do NOT carry over. */
  analystTokens: number;
  /** Per-report cross-check results. Key is report id. */
  crossChecks: Record<string, CrossCheckResult[]>;
  /** Supply tracking for resupply requests. */
  supply: {
    emergencyUsed: boolean;     // only one emergency resupply per game
    emergencyPending: boolean;  // requested, arriving next round start
    delayed?: boolean;          // convoy was held up once by the broken bridge
    bridgeBlockedAt?: number;   // round when bridge blocked the emergency (for UI)
  };
}
export type Action = { id: string; teamId: string } & (
  | { type: 'deploy'; unit: string; b: string; src?: 'manual' | 'ai'; rid?: string; fake?: boolean }
  | { type: 'arrive'; unit: string }
  | { type: 'mark'; report: string; status: 'verified' | 'contradicted' | 'unverified' }
  | { type: 'ask'; prompt: string }
  | { type: 'approve' | 'reject' | 'flag'; rec: string }
  | { type: 'advisory'; k: 'v' | 'x' | 't' }
  | { type: 'advance' }
  | { type: 'inject'; k: 's' | 'r' | 'o' }
  | { type: 'crosscheck'; report: string; channel: CheckChannel }
  | { type: 'relocate'; center: 'E1' | 'E2' }
  | { type: 'resupply' });
export type Actor = { role: 'team'; teamId: string } | { role: 'host' } | { role: 'system' };
export type Result = { ok: true; state: TeamState; dup?: boolean } | { ok: false; error: string; state: TeamState };
