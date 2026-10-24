/** Demo-mode leaderboard: nine seeded bot teams. Replaced by real teams when the Supabase layer exists. */
export const BOTS = ['Baybayin Rescue', 'Sagip Luzon', 'Tala Responders', 'Ilog Watch', 'Bayanihan Ops', 'Agila Command', 'Pag-asa Unit', 'Kalasag Team', 'Dagat Guard'];
const SK = [.82, .74, .69, .66, .62, .58, .55, .5, .44];
export interface Row { n: string; s: number; you: boolean; r: number }
export function board(score: number, round: number, t: number, finished: boolean): Row[] {
  const f = Math.min(1, (round - 1 + (finished ? 1 : 1 - t / 120)) / 5);
  const l: Row[] = [{ n: 'Team Alpha (you)', s: Math.round(score), you: true, r: 0 }, ...BOTS.map((n, i) => ({ n, s: Math.round(100 * f * SK[i] + ((i * 7 + round * 3) % 5) - 2), you: false, r: 0 }))];
  l.sort((a, b) => b.s - a.s); l.forEach((x, i) => (x.r = i + 1)); return l;
}
