import { useState, useEffect } from 'react';
import { isDemoMode, fetchLeaderboard, subscribeLeaderboard, verifyHostPasscodeServer, type LeaderboardRow } from '../multiplayer/client';
import { B, EV, R0, DEPOT_FUEL, DEPOT_FOOD, RESUPPLY_FUEL, RESUPPLY_FOOD, HOSPITAL_CAP, RELOCATE_COST, RELOCATE_MAX } from '../../shared/scenario';
import { CAPS, CN, cats, total } from '../../shared/scoring';
import { reports } from '../../shared/sim';
import { board } from '../../shared/demoBoard';
import { isCorroborated, hasContradiction } from '../../shared/crosscheck';
import { ReplayTimeline } from './Replay';
import type { Cat, CheckChannel, TeamState } from '../../shared/types';

export type D = (a: Record<string, unknown>, who?: 'team' | 'host') => boolean;
const nm = (id: string) => B.find(b => b.id === id)!.n;
const Btn = ({ onClick, children, kind, disabled, title }: { onClick: () => void; children: React.ReactNode; kind?: string; disabled?: boolean; title?: string }) => (
  <button className={'btn ' + (kind ?? '')} onClick={onClick} disabled={disabled} title={title}>
    {children}
  </button>
);
const ago = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);
const MARK: Record<string, [string, string]> = {
  verified: ['✔ Looks true (checked)', 't'],
  contradicted: ['✖ False or outdated', 'f'],
  unverified: ['? Not checked yet', ''],
};

const CHANNELS: { id: CheckChannel; icon: string; label: string; desc: string }[] = [
  { id: 'official', icon: '📋', label: 'Official', desc: 'PAGASA / MDRRMO / LGU hotline (accurate, but can be stale)' },
  { id: 'news', icon: '📰', label: 'News', desc: 'Radio, TV, online (lags by one round)' },
  { id: 'social', icon: '📱', label: 'Social Search', desc: 'Social media search (fast, echoes original: circular reporting!)' },
  { id: 'barangay', icon: '📞', label: 'Barangay Call', desc: 'Direct phone call to captain (reliable, down in round 5)' },
];

export function Reports({ s, d }: { s: TeamState; d: D }) {
  const all = reports(s).filter(r => r.rd <= s.round);
  return (
    <div>
      <div className="intro">
        <b>📨 Incident Reports & Cross-check Desk.</b>
        <div>Field reports can be outdated, copied, or false. Use your <b>3 analyst time tokens</b> each round to check reports against official, news, social, or local contacts before marking them or deploying units.</div>
        <div style={{ marginTop: 4, fontWeight: 700, color: s.analystTokens > 0 ? '#1e9e5a' : '#c0392b' }}>
          ⏱️ Investigation points remaining this round: {s.analystTokens} of 3
        </div>
      </div>

      {all.slice().reverse().map(r => {
        const m = s.marks[r.id] ?? 'unverified';
        const same = all.filter(q => q.g === r.g && q.id !== r.id);
        const checks = s.crossChecks[r.id] ?? [];
        const corroborated = isCorroborated(checks);
        const contradicts = hasContradiction(checks);

        return (
          <div key={r.id} className={'card' + (r.rd === s.round ? ' new' : '')}>
            <div>
              <span className="tag">{r.id}</span>
              <span className={'tag ' + MARK[m][1]}>{MARK[m][0]}</span>
              {r.rd === s.round && <span className="tag w">NEW THIS ROUND</span>}
              {r.age >= 480 && <span className="tag w">⏳ OLD NEWS (STALE)</span>}
            </div>

            <p style={{ margin: '6px 0', fontSize: '14px', fontWeight: 600 }}>“{r.tx}”</p>
            <div style={{ fontSize: '13px' }}>
              <b>Who said it:</b> {r.src}<br />
              <b>About:</b> {nm(r.b)} · claims area is <b>{r.cl === 'f' ? 'flooded' : 'dry'}</b><br />
              <b>How old:</b> {ago(r.age)} · <b>Origin chain:</b> {r.g}
            </div>

            <div className="hint" style={{ marginTop: 4 }}>Reported confidence: {r.cf}%</div>
            <div className="meter"><i style={{ width: r.cf + '%' }} /></div>
            <div className="hint">Source provenance: {r.pv}</div>

            {same.length > 0 && (
              <div className="warn">
                ⚠️ <b>Circular origin warning:</b> Shares origin with {same.map(q => q.id).join(', ')}. These are duplicate reshares of one claim, NOT independent evidence.
              </div>
            )}

            {/* ── Cross-check Desk ────────────────────────────────────────── */}
            <div className="desk">
              <div className="desk-head">
                <span>🔍 Cross-check Desk</span>
                <span>Tokens left: {s.analystTokens}/3</span>
              </div>

              <div className="desk-btns">
                {CHANNELS.map(ch => {
                  const already = checks.some(c => c.channel === ch.id);
                  const isBgRd5 = ch.id === 'barangay' && s.round >= 5;
                  return (
                    <button
                      key={ch.id}
                      className="btn channel"
                      disabled={s.analystTokens <= 0}
                      title={ch.desc}
                      onClick={() => d({ type: 'crosscheck', report: r.id, channel: ch.id })}
                    >
                      {ch.icon} {ch.label}{already ? ' ↺' : ''}{isBgRd5 ? ' (down)' : ''}
                    </button>
                  );
                })}
              </div>

              {corroborated && (
                <div className="corrob-banner">
                  ✅ <b>Corroborated by ≥ 2 independent channels!</b> This claim is verified with evidence — deploying here qualifies for verification points without a scout flight.
                </div>
              )}

              {contradicts && (
                <div className="contra-banner">
                  ⚠️ <b>Contradictory evidence found!</b> An independent channel contradicted this claim. Marking it verified will be penalized.
                </div>
              )}

              {checks.map(c => (
                <div
                  key={c.channel}
                  className={
                    'check-card' +
                    (c.circular ? ' circular' : c.stale ? ' stale' : c.cf < 40 ? ' contra' : c.independent ? ' supported' : '')
                  }
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <b>{c.label}</b>
                    <div>
                      {c.circular && <span className="check-tag circ">CIRCULAR ECHO</span>}
                      {c.stale && <span className="check-tag neutral">STALE ADVISORY</span>}
                      {c.unavailable && <span className="check-tag bad">NETWORK DOWN</span>}
                      {c.independent && !c.circular && c.cf >= 50 && <span className="check-tag good">INDEPENDENT</span>}
                      {c.independent && !c.circular && c.cf < 40 && <span className="check-tag bad">CONTRADICTED</span>}
                      <span className="hint">Conf: {c.cf}%</span>
                    </div>
                  </div>
                  <div style={{ marginTop: 4 }}>{c.summary}</div>
                </div>
              ))}
            </div>

            {/* ── Action Buttons ────────────────────────────────────────── */}
            <div style={{ marginTop: 8 }}>
              <Btn kind="ok" onClick={() => d({ type: 'mark', report: r.id, status: 'verified' })}>
                ✔ Mark Verified (Looks True)
              </Btn>
              <Btn kind="no" onClick={() => d({ type: 'mark', report: r.id, status: 'contradicted' })}>
                ✖ Mark False / Outdated
              </Btn>
              <Btn onClick={() => d({ type: 'mark', report: r.id, status: 'unverified' })}>
                Reset Mark
              </Btn>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const ASKS = [
  'Compare the sources: which have independent evidence and which are uncertain?',
  'Which claims could be old or contradicted, and what is the evidence?',
  'Where should we send boats first, and how confident are you? Cite your sources.',
];

export function Analyst({ s, d }: { s: TeamState; d: D }) {
  const [p, setP] = useState(''), [chk, setChk] = useState<Record<string, boolean>>({});
  return (
    <div>
      <div className="intro">
        <b>🤖 AI Helper.</b> It reads the incident feed and recommends rescue priorities. It can hallucinate fake report numbers and can be misled by circular social media reposts. <b>You</b> approve or reject every deployment.
      </div>
      <b>Ask an evidence-based question</b> <span className="hint">(asking for evidence, confidence, and timestamps earns Smart AI points)</span>
      <div>{ASKS.map(a => <Btn key={a} onClick={() => setP(a)}>{a.slice(0, 38)}…</Btn>)}</div>
      <textarea
        value={p}
        onChange={e => setP(e.target.value)}
        rows={3}
        style={{ width: '100%', marginTop: 6 }}
        placeholder="Type your question for the AI Helper (e.g., 'Compare sources for Sta. Lucia, check confidence and timestamps')"
      />
      <Btn kind="ok" onClick={() => { if (d({ type: 'ask', prompt: p })) setP(''); }}>
        Ask the AI Helper
      </Btn>

      {s.ai.slice().reverse().map(r => (
        <div key={r.id} className="card">
          <b>AI plan {r.id}</b> <span className="tag">{r.st === 'pending' ? 'waiting for your decision' : r.st}</span>
          <p style={{ margin: '6px 0' }}>{r.txt}</p>
          {r.unc && <div className="warn"><b>Why it might be wrong:</b> {r.unc}</div>}
          {r.cites.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <b>Sources cited:</b> <span className="hint">(tap to verify each citation)</span>
              <div>{r.cites.map(c => <Btn key={c} onClick={() => setChk({ ...chk, [r.id + c]: true })}>{c}</Btn>)}</div>
            </div>
          )}
          {r.cites.filter(c => chk[r.id + c]).map(c => {
            const x = reports(s).find(q => q.id === c);
            return (
              <div key={c} className={x ? 'hint' : 'warn'}>
                {x ? `${c}: ${x.src}, about ${nm(x.b)} (cf ${x.cf}%)` : `⚠️ ${c}: FABRICATED CITATION! This report does not exist in your feed. The AI hallucinated it!`}
              </div>
            );
          })}
          {r.st === 'pending' && (
            <div style={{ marginTop: 8 }}>
              <Btn kind="ok" onClick={() => d({ type: 'approve', rec: r.id })}>
                ✅ Approve and send a boat
              </Btn>
              <Btn kind="no" onClick={() => d({ type: 'reject', rec: r.id })}>
                ❌ Reject this recommendation
              </Btn>
              <Btn onClick={() => d({ type: 'flag', rec: r.id })}>
                🚩 Flag made-up source (Hallucination)
              </Btn>
            </div>
          )}
        </div>
      ))}

      <h4>📢 Public announcement <span className="hint">(once per round each)</span></h4>
      <div className="hint">Residents trust your announcements. Broadcasting unverified rumors causes panic and loses ethical communication points.</div>
      <Btn onClick={() => d({ type: 'advisory', k: 'v' })}>Announce only checked facts</Btn>
      <Btn onClick={() => d({ type: 'advisory', k: 't' })}>Disclose AI assistance and uncertainty</Btn>
      <Btn kind="no" onClick={() => d({ type: 'advisory', k: 'x' })}>Broadcast the AI claim as confirmed</Btn>
    </div>
  );
}

export function Score({ s }: { s: TeamState }) {
  const [showReplay, setShowReplay] = useState(false);
  const c = cats(s), t = total(s);
  const Row = ({ k, why }: { k: Cat; why: string }) => (
    <div style={{ margin: '8px 0' }}>
      <b>{CN[k]}</b> <span className="hint">{c[k].toFixed(1)} / {CAPS[k]}</span>
      <div className="hint">{why}</div>
      <div className="meter"><i style={{ width: 100 * c[k] / CAPS[k] + '%' }} /></div>
    </div>
  );

  return (
    <div>
      <div className="intro">
        <b>Total Score: {Math.round(t.all)} / 100</b><br />
        🚤 Rescue & Operations: {Math.round(t.ops)} / 50 · 🧠 Smart AI & Ethics: {Math.round(t.ai)} / 50
      </div>
      <Row k="lives" why="People evacuated safely (30 pts cap). Cost of delay: unrescued flooded areas lose people each round." />
      <Row k="res" why="Depot and resupply resources used efficiently without false alarm waste (20 pts cap)." />
      <Row k="ver" why="Cross-checking sources, catching circular reporting, and spotting hallucinations (25 pts cap)." />
      <Row k="com" why="Responsible public advisories disclosing AI uncertainty (15 pts cap)." />
      <Row k="prm" why="Inquiry quality: evidence-oriented prompts demanding sources and timestamps (10 pts cap)." />

      <h4>Evidence Ledger (Why you got each point)</h4>
      {s.led.length === 0 && <div className="hint">No events logged yet. Cross-check a report, scout, or deploy units to begin scoring.</div>}
      {s.led.slice().reverse().map((l, i) => (
        <div key={i} className="card">
          <b style={{ color: l.pts >= 0 ? '#1e9e5a' : '#c0392b' }}>
            {l.pts >= 0 ? '+' : ''}{l.pts}
          </b>{' '}
          {CN[l.cat]} <span className="hint">Round {l.rd}</span>
          <div>{l.why}</div>
          <div className="hint">{l.ev}</div>
        </div>
      ))}
      <div style={{ marginTop: 10 }}>
        <button className="btn pri" onClick={() => setShowReplay(!showReplay)}>
          {showReplay ? 'Hide Timeline' : '📜 View Evidence Timeline & Decision Replay'}
        </button>
      </div>
      {showReplay && <div style={{ marginTop: 10 }}><ReplayTimeline s={s} onClose={() => setShowReplay(false)} /></div>}
    </div>
  );
}

export function Board({ s, t, sessionId, myTeamId }: { s: TeamState; t: number; sessionId?: string; myTeamId?: string }) {
  const [liveRows, setLiveRows] = useState<(LeaderboardRow & { rank: number; prevRank?: number })[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isDemoMode() || !sessionId) return;
    let mounted = true;
    setLoading(true);
    fetchLeaderboard(sessionId)
      .then(rows => {
        if (!mounted) return;
        const sorted = [...rows].sort((a, b) => b.score - a.score);
        setLiveRows(sorted.map((r, i) => ({ ...r, rank: i + 1 })));
        setLoading(false);
      })
      .catch(err => {
        console.warn('Failed to fetch live leaderboard:', err);
        setLoading(false);
      });

    const unsubscribe = subscribeLeaderboard(sessionId, (updated) => {
      setLiveRows(prev => {
        const next = [...prev];
        const idx = next.findIndex(r => r.id === updated.id);
        if (idx >= 0) {
          next[idx] = { ...next[idx], ...updated };
        } else {
          next.push({ ...updated, rank: next.length + 1 });
        }
        next.sort((a, b) => b.score - a.score);
        return next.map((r, i) => ({
          ...r,
          prevRank: r.rank,
          rank: i + 1,
        }));
      });
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [sessionId]);

  const demoRows = board(total(s).all, s.round, t, s.finished);

  return (
    <div>
      <div className="intro">
        <b>Leaderboard: {isDemoMode() || !sessionId ? '10 Competing Teams (Demo Mode)' : `${liveRows.length} Registered Teams`}.</b><br />
        Ranks update in real time as teams verify reports, evacuate residents, and manage resupply.
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #cbd5e1', textAlign: 'left', fontSize: 13, color: '#64748b' }}>
            <th style={{ padding: '6px 4px', width: 45 }}>Rank</th>
            <th style={{ padding: '6px 4px' }}>Team</th>
            <th style={{ padding: '6px 4px', textAlign: 'right' }}>Score</th>
          </tr>
        </thead>
        <tbody>
          {(!sessionId || isDemoMode()) ? (
            demoRows.map(x => (
              <tr key={x.n} style={{ fontWeight: x.you ? 800 : 400, background: x.you ? '#fff0ee' : undefined, borderBottom: '1px solid #edf2f7' }}>
                <td style={{ padding: '6px 4px' }}>#{x.r}</td>
                <td style={{ padding: '6px 4px' }}>{x.n}</td>
                <td style={{ padding: '6px 4px', textAlign: 'right' }}>{x.s} pts</td>
              </tr>
            ))
          ) : liveRows.length === 0 ? (
            <tr>
              <td colSpan={3} style={{ padding: '16px 4px', textAlign: 'center', color: '#94a3b8' }}>
                {loading ? 'Loading live leaderboard...' : 'No active teams registered yet.'}
              </td>
            </tr>
          ) : (
            liveRows.map(x => {
              const isYou = x.id === myTeamId;
              const rankDelta = x.prevRank !== undefined ? x.prevRank - x.rank : 0;
              return (
                <tr key={x.id} style={{ fontWeight: isYou ? 800 : 400, background: isYou ? '#fff0ee' : undefined, borderBottom: '1px solid #edf2f7' }}>
                  <td style={{ padding: '6px 4px' }}>
                    #{x.rank}
                    {rankDelta > 0 && <span style={{ color: '#16a34a', fontSize: 11, marginLeft: 4 }}>▲{rankDelta}</span>}
                    {rankDelta < 0 && <span style={{ color: '#dc2626', fontSize: 11, marginLeft: 4 }}>▼{Math.abs(rankDelta)}</span>}
                  </td>
                  <td style={{ padding: '6px 4px' }}>{x.name}{isYou ? ' (You)' : ''}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{x.score} pts</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Shelters({ s, d }: { s: TeamState; d: D }) {
  const bar = (used: number, cap: number) => <div className="meter"><i style={{ width: Math.min(100, 100 * used / cap) + '%', background: used >= cap ? '#c0392b' : '#3b82f6' }} /></div>;
  return <div className="intro"><b>🏠 Shelters</b> <span className="hint">Rescued people need a place to stay. A full center cannot take more people: move some to the provincial shelter (costs {RELOCATE_COST.fuel} fuel + {RELOCATE_COST.food} food, up to {RELOCATE_MAX} people, once per center per round).</span>
    {EV.map(e => { const u = s.ev[e.id] ?? 0; return <div key={e.id} style={{ marginTop: 6 }}>{e.n}: <b>{u}/{e.cap}</b>{u >= e.cap && <b style={{ color: '#c0392b' }}> FULL</b>}{bar(u, e.cap)}<Btn onClick={() => d({ type: 'relocate', center: e.id })}>🚌 Move up to {RELOCATE_MAX} people out</Btn></div>; })}
    <div style={{ marginTop: 6 }}>🏥 Hospital (ambulances deliver here first): <b>{s.ev.H ?? 0}/{HOSPITAL_CAP}</b> <span className="hint">{HOSPITAL_CAP > 0 && '30 patients go home at each round start.'}</span>{bar(s.ev.H ?? 0, HOSPITAL_CAP)}</div>
    <div className="hint">Moved to the provincial shelter so far: {s.relocated}</div></div>;
}

export function Host({ s, d, paused, setPaused }: { s: TeamState; d: D; paused: boolean; setPaused: (b: boolean) => void }) {
  const [ok, setOk] = useState(false), [code, setCode] = useState('');
  const [errorMsg, setErrorMsg] = useState(''), [checking, setChecking] = useState(false);

  const handleUnlock = async () => {
    setErrorMsg('');
    setChecking(true);
    const valid = await verifyHostPasscodeServer(code);
    setChecking(false);
    if (valid) {
      setOk(true);
    } else {
      setErrorMsg('Invalid facilitator passcode.');
    }
  };

  if (!ok) {
    return (
      <div>
        <div className="intro">
          <b>Teacher / Facilitator Dashboard.</b><br />
          {isDemoMode() ? (
            <span>Demo passcode: <code>CODERED</code></span>
          ) : (
            <span>Enter the secret facilitator passcode configured on the server.</span>
          )}
        </div>
        <input
          value={code}
          onChange={e => setCode(e.target.value)}
          placeholder="Passcode"
          type="password"
          style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e0' }}
        />
        {errorMsg && <div style={{ color: '#ef4444', fontSize: 13, marginTop: 4 }}>⚠️ {errorMsg}</div>}
        <div style={{ marginTop: 8 }}>
          <Btn kind="pri" onClick={handleUnlock} disabled={checking}>
            {checking ? 'Verifying...' : 'Unlock Dashboard'}
          </Btn>
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="intro"><b>Facilitator Controls.</b> Synchronize rounds or trigger emergency injects.</div>
      <div>
        <Btn kind="ok" onClick={() => setPaused(!paused)}>{paused ? '▶ Resume timer' : '⏸ Pause timer'}</Btn>
        <Btn onClick={() => d({ type: 'advance' }, 'host')}>⏭ Advance to next round</Btn>
      </div>

      <h4>Simulated Inject Events</h4>
      <Btn onClick={() => d({ type: 'inject', k: 's' }, 'host')}>🌊 Storm surge hits Dalig early</Btn>
      <Btn onClick={() => d({ type: 'inject', k: 'r' }, 'host')}>💬 Spread false rumor in social chat</Btn>
      <Btn onClick={() => d({ type: 'inject', k: 'o' }, 'host')}>📡 Sever AI uplink (offline)</Btn>

      <h4>Emergency Resupply Status</h4>
      <div className="hint">
        {s.supply.emergencyUsed
          ? s.supply.emergencyPending
            ? '🚁 Emergency convoy en route for next round.'
            : s.supply.bridgeBlockedAt
            ? `✅ Emergency resupply received (one round late: the bridge was out in round ${s.supply.bridgeBlockedAt}).`
            : '✅ Emergency resupply already received.'
          : 'Convoy standing by at headquarters.'}
      </div>

      <h4>Simulation Event Log</h4>
      <div className="hint" style={{ maxHeight: 200, overflowY: 'auto' }}>
        {s.log.slice().reverse().map((l, i) => (
          <div key={i} style={{ borderBottom: '1px solid #e2e8f0', padding: '3px 0' }}>
            <b>Round {l.rd}:</b> {l.t}
          </div>
        ))}
      </div>
    </div>
  );
}



export function Debrief({ s }: { s: TeamState }) {
  const [showReplay, setShowReplay] = useState(false);
  const t = total(s), st = s.st;
  return (
    <div className="card" style={{ background: '#fff8e1', border: '2px solid #ecc94b' }}>
      <h3 style={{ margin: 0 }}>🏁 Operation Complete: {Math.round(t.all)} / 100 Points</h3>
      <p style={{ margin: '8px 0 4px' }}>
        <b>Evacuation:</b> {s.saved} of 720 residents saved · <b>Fuel wasted on false alarms:</b> {st.waste} units<br />
        <b>Fact-Checking:</b> {st.vOK} of {st.vN} claims correctly verified · <b>False claims caught:</b> {st.caught}<br />
        <b>AI Vigilance:</b> {st.hall} hallucinated citations caught · <b>Blind AI deployments:</b> {st.unsup}
      </p>
      <div style={{ marginTop: 8 }}>
        <button className="btn pri" onClick={() => setShowReplay(!showReplay)}>
          {showReplay ? 'Hide Replay Timeline' : '📜 Open Mission Replay Timeline'}
        </button>
      </div>
      {showReplay && <div style={{ marginTop: 10 }}><ReplayTimeline s={s} onClose={() => setShowReplay(false)} /></div>}
    </div>
  );
}
