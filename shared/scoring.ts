import type { Cat, TeamState } from './types';
import { rules } from './scenario';
export const CAPS: Record<Cat, number> = { lives: 30, res: 20, ver: 25, com: 15, prm: 10 };
export const CN: Record<Cat, string> = { lives: 'Lives protected', res: 'Resource allocation', ver: 'Source verification', com: 'Communication & ethics', prm: 'Prompt quality' };
export function log(s: TeamState, t: string) { s.log.push({ rd: s.round, t }); }
/** Add a ledger entry. A key makes the event score at most once (duplicate-safe). Returns false if skipped. */
export function L(s: TeamState, cat: Cat, pts: number, why: string, ev = '', key?: string): boolean {
  if (key) { if (s.keys[key]) return false; s.keys[key] = 1; }
  if (pts < 0 && cat !== 'lives') pts *= rules(s).pen; // guided mode: mistakes cost less
  pts = Math.round(pts * 10) / 10;
  s.led.push({ rd: s.round, cat, pts, why, ev });
  log(s, (pts >= 0 ? '+' : '') + pts + ' ' + CN[cat] + ': ' + why);
  return true;
}
export function cats(s: TeamState): Record<Cat, number> {
  const o = {} as Record<Cat, number>;
  (Object.keys(CAPS) as Cat[]).forEach(k => { o[k] = Math.max(0, Math.min(CAPS[k], s.led.filter(l => l.cat === k).reduce((a, l) => a + l.pts, 0))); });
  return o;
}
export function total(s: TeamState) { const c = cats(s); return { ops: c.lives + c.res, ai: c.ver + c.com + c.prm, all: c.lives + c.res + c.ver + c.com + c.prm }; }