import { useEffect, useRef } from 'react';
import { B, EV } from '../../shared/scenario';
import { flooded, reports } from '../../shared/sim';
import type { TeamState } from '../../shared/types';
export const HQ = { x: 450, y: 505 }, W = 900, H = 560;
type Pt = { x: number; y: number };
export interface Move { unit: string; ty: string; from: Pt; to: Pt; t0: number; dur: number }
const NP: Record<string, Pt> = { HQ, H: { x: 800, y: 110 }, ...Object.fromEntries(B.map(b => [b.id, b])) };
const ROADS = [['HQ', 'D'], ['HQ', 'F'], ['D', 'A'], ['D', 'E'], ['A', 'B'], ['B', 'C'], ['F', 'C'], ['C', 'H']];
interface P { s: TeamState; moves: React.MutableRefObject<Move[]>; sel: string | null; onPick: (id: string | null) => void; onDrop: (unit: string, b: string) => void }
type V = { x: number; y: number; z: number; fit: boolean };
export default function MapCanvas({ s, moves, sel, onPick, onDrop }: P) {
  const ref = useRef<HTMLCanvasElement>(null), sr = useRef({ s, sel }), v = useRef<V>({ x: 0, y: 0, z: 1, fit: false }), rad = useRef<Record<string, number>>({}), dr = useRef<{ x: number; y: number; px: number; py: number; m: boolean } | null>(null);
  sr.current = { s, sel };
  useEffect(() => { const c = ref.current!; let raf = 0, last = performance.now(); const loop = (n: number) => { raf = requestAnimationFrame(loop); draw(c, sr.current.s, sr.current.sel, moves.current, v.current, rad.current, Math.min(.1, (n - last) / 1000)); last = n; }; raf = requestAnimationFrame(loop); return () => cancelAnimationFrame(raf); }, [moves]);
  const toW = (e: { clientX: number; clientY: number }) => { const r = ref.current!.getBoundingClientRect(), z = v.current; return { x: (e.clientX - r.left - z.x) / z.z, y: (e.clientY - r.top - z.y) / z.z }; };
  const hit = (p: Pt) => B.find(b => Math.hypot(b.x - p.x, b.y - p.y) < 38);
  return <canvas ref={ref} style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor: 'grab' }}
    onPointerDown={e => { dr.current = { x: e.clientX, y: e.clientY, px: v.current.x, py: v.current.y, m: false }; e.currentTarget.setPointerCapture(e.pointerId); }}
    onPointerMove={e => { const d = dr.current; if (!d) return; const dx = e.clientX - d.x, dy = e.clientY - d.y; if (Math.abs(dx) + Math.abs(dy) > 5) d.m = true; if (d.m) { v.current.x = d.px + dx; v.current.y = d.py + dy; } }}
    onPointerUp={e => { if (dr.current && !dr.current.m) onPick(hit(toW(e))?.id ?? null); dr.current = null; }}
    onWheel={e => { const r = ref.current!.getBoundingClientRect(), z = v.current, cx = e.clientX - r.left, cy = e.clientY - r.top, n = Math.max(.4, Math.min(4, z.z * (e.deltaY < 0 ? 1.12 : 1 / 1.12))); z.x = cx - (cx - z.x) * n / z.z; z.y = cy - (cy - z.y) * n / z.z; z.z = n; }}
    onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const u = e.dataTransfer.getData('unit'), b = hit(toW(e)); if (u && b) onDrop(u, b.id); }} />;
}
function draw(c: HTMLCanvasElement, s: TeamState, sel: string | null, moves: Move[], v: V, rad: Record<string, number>, dt: number) {
  const dpr = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); v.fit = false; }
  if (!v.fit) { v.z = Math.min(w / W, h / H); v.x = (w - W * v.z) / 2; v.y = (h - H * v.z) / 2; v.fit = true; }
  const x = c.getContext('2d')!; x.setTransform(dpr, 0, 0, dpr, 0, 0); x.fillStyle = '#7fa866'; x.fillRect(0, 0, w, h);
  x.save(); x.translate(v.x, v.y); x.scale(v.z, v.z); x.fillStyle = '#8fb573'; x.fillRect(0, 0, W, H); x.lineCap = 'round';
  x.strokeStyle = '#5aa0d8'; x.lineWidth = 28; x.beginPath(); x.moveTo(-20, 262); x.bezierCurveTo(200, 230, 300, 300, 450, 275); x.bezierCurveTo(600, 250, 750, 310, 920, 285); x.stroke();
  x.strokeStyle = '#d9cfae'; x.lineWidth = 6; ROADS.forEach(([a, b]) => { x.beginPath(); x.moveTo(NP[a].x, NP[a].y); x.lineTo(NP[b].x, NP[b].y); x.stroke(); });
  const out = s.round >= 3; x.fillStyle = out ? '#c0392b' : '#8a6d3b'; x.fillRect(527, 172, 16, 16); x.fillStyle = '#222'; x.font = '10px system-ui'; x.textAlign = 'center'; x.fillText(out ? 'Bridge OUT' : 'Bridge', 535, 200);
  const flooders = new Set(reports(s).filter(r => r.rd <= s.round && r.cl === 'f').map(r => r.b));
  B.forEach(b => {
    const seen = s.rev[b.id] === s.round, tg = seen && flooded(s, b) ? 58 + (s.round - (s.fr[b.id] ?? b.fr)) * 14 : 0; rad[b.id] = (rad[b.id] ?? 0) + (tg - (rad[b.id] ?? 0)) * Math.min(1, dt * 2.5);
    if (rad[b.id] > 1) { x.fillStyle = 'rgba(40,110,200,.5)'; x.beginPath(); x.arc(b.x, b.y, rad[b.id], 0, 7); x.fill(); }
    else if (flooders.has(b.id)) { x.setLineDash([6, 5]); x.strokeStyle = '#2a6fc0'; x.lineWidth = 2; x.beginPath(); x.arc(b.x, b.y, 62, 0, 7); x.stroke(); x.setLineDash([]); }
    if (!seen) { x.fillStyle = 'rgba(30,35,45,.38)'; x.beginPath(); x.arc(b.x, b.y, 44, 0, 7); x.fill(); }
    x.fillStyle = b.id === sel ? '#f1c40f' : '#f5efe0'; x.strokeStyle = '#4a3b22'; x.lineWidth = 2; x.fillRect(b.x - 15, b.y - 11, 30, 22); x.strokeRect(b.x - 15, b.y - 11, 30, 22);
    x.fillStyle = '#a8452e'; x.beginPath(); x.moveTo(b.x - 18, b.y - 11); x.lineTo(b.x, b.y - 24); x.lineTo(b.x + 18, b.y - 11); x.fill();
    x.fillStyle = '#111'; x.font = 'bold 11px system-ui'; x.fillText(b.n, b.x, b.y + 25); x.font = '10px system-ui'; x.fillText(seen ? `${s.pop[b.id]} still need help` : `about ${b.pop} people · unknown`, b.x, b.y + 37);
    if (s.round === 5 && (b.id === 'A' || b.id === 'F')) { x.fillStyle = '#c0392b'; x.fillText('📡 no signal', b.x, b.y - 30); }
  });
  x.fillStyle = '#fff'; x.strokeStyle = '#c0392b'; x.lineWidth = 3; x.fillRect(786, 96, 28, 28); x.strokeRect(786, 96, 28, 28); x.fillStyle = '#c0392b'; x.font = 'bold 20px system-ui'; x.fillText('+', 800, 117);
  EV.forEach(e => { x.fillStyle = '#2e86c1'; x.fillRect(e.x - 16, e.y - 12, 32, 24); x.fillStyle = '#fff'; x.font = 'bold 10px system-ui'; x.fillText('EVAC', e.x, e.y + 4); x.fillStyle = '#111'; x.fillText(`${s.ev[e.id]}/${e.cap}`, e.x, e.y + 26); });
  x.fillStyle = '#222'; x.fillRect(HQ.x - 18, HQ.y - 12, 36, 24); x.fillStyle = '#fff'; x.fillText('COMMAND', HQ.x, HQ.y + 4);
  const now = performance.now(); for (let i = moves.length - 1; i >= 0; i--) if (now > moves[i].t0 + moves[i].dur * 1000) moves.splice(i, 1);
  s.units.forEach((u, i) => {
    const m = moves.find(q => q.unit === u.id); let p: Pt = { x: HQ.x + (i - 2) * 16, y: HQ.y + 22 };
    if (m) { const k = Math.min(1, (now - m.t0) / (m.dur * 1000)); p = { x: m.from.x + (m.to.x - m.from.x) * k, y: m.from.y + (m.to.y - m.from.y) * k }; if (u.st === 'out') { x.setLineDash([5, 5]); x.strokeStyle = '#c0392b'; x.lineWidth = 2; x.beginPath(); x.moveTo(m.from.x, m.from.y); x.lineTo(m.to.x, m.to.y); x.stroke(); x.setLineDash([]); } }
    x.fillStyle = u.ty === 'boat' ? '#e67e22' : u.ty === 'amb' ? '#fff' : '#8e44ad'; x.strokeStyle = '#222'; x.lineWidth = 2; x.beginPath(); if (u.ty === 'boat') x.ellipse(p.x, p.y, 11, 6, 0, 0, 7); else if (u.ty === 'amb') x.rect(p.x - 9, p.y - 6, 18, 12); else x.arc(p.x, p.y, 7, 0, 7); x.fill(); x.stroke();
    x.fillStyle = '#111'; x.font = 'bold 9px system-ui'; x.fillText(u.id, p.x, p.y + 3);
  });
  x.restore();
}
