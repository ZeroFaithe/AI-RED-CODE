import { useState } from 'react';
import { CN } from '../../shared/scoring';
import type { Cat, LedgerEntry, TeamState } from '../../shared/types';

interface ReplayProps {
  s: TeamState;
  onClose?: () => void;
}

export function ReplayTimeline({ s, onClose }: ReplayProps) {
  const [filterRd, setFilterRd] = useState<number | 'all'>('all');
  const [filterCat, setFilterCat] = useState<Cat | 'all'>('all');

  const filtered = s.led.filter(entry => {
    if (filterRd !== 'all' && entry.rd !== filterRd) return false;
    if (filterCat !== 'all' && entry.cat !== filterCat) return false;
    return true;
  });

  return (
    <div className="card" style={{ background: '#fdfdfe', border: '2px solid #3b82f6' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, color: '#1e3a8a' }}>📜 End-Game Replay & Evidence Timeline</h3>
        {onClose && <button className="btn" onClick={onClose}>Close</button>}
      </div>
      <p className="hint" style={{ margin: '6px 0 10px' }}>
        Review every tactical decision, AI interaction, and verification step across all 5 rounds with full evidentiary audit logs.
      </p>

      {/* ── Filters ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        <span style={{ fontSize: '13px', fontWeight: 600, alignSelf: 'center' }}>Round:</span>
        <button className={'btn ' + (filterRd === 'all' ? 'pri' : '')} onClick={() => setFilterRd('all')}>All</button>
        {[1, 2, 3, 4, 5].map(r => (
          <button key={r} className={'btn ' + (filterRd === r ? 'pri' : '')} onClick={() => setFilterRd(r)}>
            R{r}
          </button>
        ))}

        <span style={{ fontSize: '13px', fontWeight: 600, alignSelf: 'center', marginLeft: 10 }}>Category:</span>
        <button className={'btn ' + (filterCat === 'all' ? 'pri' : '')} onClick={() => setFilterCat('all')}>All</button>
        {(Object.keys(CN) as Cat[]).map(c => (
          <button key={c} className={'btn ' + (filterCat === c ? 'pri' : '')} onClick={() => setFilterCat(c)}>
            {CN[c].split(' ')[0]}
          </button>
        ))}
      </div>

      {/* ── Timeline items ──────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="hint" style={{ padding: 12, textAlign: 'center' }}>
          No decisions recorded for this filter.
        </div>
      ) : (
        <div style={{ position: 'relative', paddingLeft: 18, borderLeft: '2px solid #cbd5e1' }}>
          {filtered.map((item, idx) => {
            const isPos = item.pts >= 0;
            return (
              <div
                key={idx}
                style={{
                  position: 'relative',
                  marginBottom: 14,
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  padding: '8px 12px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                }}
              >
                {/* Bullet node on timeline */}
                <div
                  style={{
                    position: 'absolute',
                    left: -25,
                    top: 10,
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: isPos ? '#10b981' : '#ef4444',
                    border: '2px solid #fff',
                  }}
                />

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span className="tag w">Round {item.rd}</span>
                    <span className="tag">{CN[item.cat]}</span>
                  </div>
                  <b style={{ color: isPos ? '#059669' : '#dc2626', fontSize: '14px' }}>
                    {isPos ? `+${item.pts}` : item.pts} pts
                  </b>
                </div>

                <div style={{ marginTop: 4, fontWeight: 600, color: '#1e293b' }}>
                  {item.why}
                </div>

                {item.ev && (
                  <div className="hint" style={{ marginTop: 3, fontStyle: 'italic', color: '#64748b' }}>
                    <b>Evidence audit:</b> {item.ev}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
