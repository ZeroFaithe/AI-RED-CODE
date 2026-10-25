import { useState } from 'react';
import { B, rules } from '../../shared/scenario';
import { CAPS, CN, cats, total } from '../../shared/scoring';
import { reports } from '../../shared/sim';
import { board, type Row } from '../../shared/demoBoard';
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
  { id: 'official', icon: '📋', label: 'Official', desc: 'PAGASA / MDRRMO / LGU hotline - accurate, but can be out of date' },
  { id: 'barangay', icon: '📞', label: 'Call barangay', desc: 'Phone the barangay captain - very reliable, but phones are down in Round 5' },
  { id: 'news', icon: '📰', label: 'News', desc: 'Radio, TV, online - always one round behind' },
  { id: 'social', icon: '📱', label: 'Social media', desc: 'Fast, but copies of one post - NOT proof' },
];

type Verdict = { cls: string; text: string };
function verdict(s: TeamState, r: { id: string; age: number }): Verdict {
  const checks = s.crossChecks[r.id] ?? [];
  if (isCorroborated(checks)) return { cls: 'good', text: '🟢 Probably TRUE - 2 independent sources agree. Safe to act on.' };
  if (hasContradiction(checks)) return { cls: 'bad', text: '🔴 Probably FALSE or OUTDATED - a trusted source disagrees. Do not send units on this alone.' };
  if (checks.length > 0 && checks.every(c => c.channel === 'social')) return { cls: 'warn', text: '🟠 Only social media says so. Many copies of one post are not proof - ask Official or the barangay.' };
  if (checks.some(c => c.stale)) return { cls: 'warn', text: '🟠 The official record is old. This does not tell us what is happening now - try another source.' };
  if (checks.length > 0) return { cls: 'neutral', text: '🟡 Some evidence, but not enough. Check one more source.' };
  if (r.age >= 480) return { cls: 'warn', text: '🟠 This report is many hours old and may no longer be true. Check it before acting.' };
  return { cls: 'neutral', text: '⚪ Not checked yet. Tap a source below to check it.' };
}

export function Reports({ s, d }: { s: TeamState; d: D }) {
  const all = reports(s).filter(r => r.rd <= s.round);
  const max = rules(s).tokens;
  return (
    <div>
      <div className="intro">
        <b>📨 Reports</b>
        <div>Messages about the flood. Some are true, some are old, some are rumors. Check a report <b>before</b> you send a boat.</div>
        <div style={{ marginTop: 4, fontWeight: 700, color: s.analystTokens > 0 ? '#1e9e5a' : '#c0392b' }}>
          🔍 Checks left this round: {s.analystTokens} of {max} {s.analystTokens === 0 && '(you get more next round)'}
        </div>
        <div className="hint">Most reliable: 📋 Official and 📞 Barangay. 📱 Social media only repeats what others posted.</div>
      </div>

      {all.slice().reverse().map(r => {
        const m = s.marks[r.id] ?? 'unverified';
        const same = all.filter(q => q.g === r.g && q.id !== r.id);
        const checks = s.crossChecks[r.id] ?? [];
        const v = verdict(s, r);

        return (
          <div key={r.id} className={'card' + (r.rd === s.round ? ' new' : '')}>
            <div>
              <span className="tag">{r.id}</span>
              <span className={'tag ' + MARK[m][1]}>{MARK[m][0]}</span>
              {r.rd === s.round && <span className="tag w">NEW</span>}
            </div>

            <p style={{ margin: '6px 0', fontSize: '15px', fontWeight: 600 }}>“{r.tx}”</p>
            <div style={{ fontSize: '13px' }}>
              <b>From:</b> {r.src} · <b>About:</b> {nm(r.b)} ({r.cl === 'f' ? 'says it is flooded' : 'says it is dry'}) · <b>Age:</b> {ago(r.age)}
            </div>

            <div className={'verdict ' + v.cls}>{v.text}</div>

            {same.length > 0 && (
              <div className="warn">
                ⚠️ Same origin as {same.map(q => q.id).join(', ')}. These are copies of one claim - not extra proof.
              </div>
            )}

            <div className="desk">
              <div className="desk-head"><span>🔍 Check this report</span><span>{s.analystTokens}/{max} left</span></div>
              <div className="desk-btns">
                {CHANNELS.map(ch => {
                  const already = checks.some(c => c.channel === ch.id);
                  return (
                    <button key={ch.id} className="btn channel" disabled={s.analystTokens <= 0} title={ch.desc}
                      onClick={() => d({ type: 'crosscheck', report: r.id, channel: ch.id })}>
                      {ch.icon} {ch.label}{already ? ' ✓' : ''}
                    </button>
                  );
                })}
              </div>

              {checks.map(c => (
                <div key={c.channel}
                  className={'check-card' + (c.circular ? ' circular' : c.stale ? ' stale' : c.cf < 40 ? ' contra' : c.independent ? ' supported' : '')}>
                  <b>{c.label}</b>{' '}
                  {c.circular && <span className="check-tag circ">COPY OF ONE POST</span>}
                  {c.stale && <span className="check-tag neutral">OLD RECORD</span>}
                  {c.unavailable && <span className="check-tag bad">PHONES DOWN</span>}
                  {c.independent && !c.circular && c.cf >= 50 && <span className="check-tag good">SUPPORTS</span>}
                  {c.independent && !c.circular && c.cf < 40 && !c.unavailable && <span className="check-tag bad">DISAGREES</span>}
                  <div style={{ marginTop: 4 }}>{c.summary}</div>
                </div>
              ))}
            </div>

            <details style={{ marginTop: 6 }}>
              <summary className="hint" style={{ cursor: 'pointer' }}>More details</summary>
              <div className="hint">Reported confidence: {r.cf}% · Origin group: {r.g}</div>
              <div className="meter"><i style={{ width: r.cf + '%' }} /></div>
              <div className="hint">{r.pv}</div>
            </details>

            <div style={{ marginTop: 8 }}>
              <Btn kind="ok" onClick={() => d({ type: 'mark', report: r.id, status: 'verified' })}>✔ Mark as true</Btn>
              <Btn kind="no" onClick={() => d({ type: 'mark', report: r.id, status: 'contradicted' })}>✖ Mark as false / old</Btn>
              <Btn onClick={() => d({ type: 'mark', report: r.id, status: 'unverified' })}>Reset</Btn>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const ASKS = [
  'Where should we send boats first? Cite your sources and how confident you are.',
  'Compare the sources: which have independent evidence and which are uncertain?',
  'Which claims could be old or contradicted, and what is the evidence?',
];

export function Analyst({ s, d }: { s: TeamState; d: D }) {
  const [p, setP] = useState(''), [chk, setChk] = useState<Record<string, boolean>>({});
  const checkAll = (id: string, cites: string[]) => setChk(prev => ({ ...prev, ...Object.fromEntries(cites.map(c => [id + c, true])) }));
  return (
    <div>
      <div className="intro">
        <b>🤖 AI Helper</b>
        <div>Ask the AI where to send help. It is fast, but it can <b>make things up</b> or be fooled by copied posts. <b>You</b> decide: check its sources, then approve or reject.</div>
      </div>

      <b>Tap a question to ask the AI</b>
      <div>{ASKS.map(a => <Btn key={a} onClick={() => d({ type: 'ask', prompt: a })}>{a}</Btn>)}</div>
      <details style={{ marginTop: 6 }}>
        <summary className="hint" style={{ cursor: 'pointer' }}>Or write your own question</summary>
        <textarea value={p} onChange={e => setP(e.target.value)} rows={3} style={{ width: '100%', marginTop: 6 }}
          placeholder="Tip: ask for sources, timestamps and how sure it is" />
        <Btn kind="ok" onClick={() => { if (d({ type: 'ask', prompt: p })) setP(''); }}>Ask</Btn>
      </details>

      {s.ai.length === 0 && <div className="hint" style={{ marginTop: 8 }}>No answers yet. Tap a question above.</div>}

      {s.ai.slice().reverse().map(r => (
        <div key={r.id} className="card">
          <b>AI plan {r.id}</b> <span className="tag">{r.st === 'pending' ? 'waiting for YOUR decision' : r.st}</span>
          <p style={{ margin: '6px 0' }}>{r.txt}</p>
          {r.unc && <div className="warn"><b>Why it might be wrong:</b> {r.unc}</div>}
          {r.cites.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <b>Sources it used:</b> <span className="hint">(tap to check that each one is real)</span>
              <div>
                {r.cites.map(c => <Btn key={c} onClick={() => setChk({ ...chk, [r.id + c]: true })}>{c}</Btn>)}
                <Btn kind="pri" onClick={() => checkAll(r.id, r.cites)}>Check all</Btn>
              </div>
            </div>
          )}
          {r.cites.filter(c => chk[r.id + c]).map(c => {
            const x = reports(s).find(q => q.id === c);
            return (
              <div key={c} className={x ? 'hint' : 'warn'}>
                {x ? `✔ ${c} is real: ${x.src}, about ${nm(x.b)}` : `⚠️ ${c} does NOT exist in your reports. The AI made it up!`}
              </div>
            );
          })}
          {r.st === 'pending' && (
            <div style={{ marginTop: 8 }}>
              <Btn kind="ok" onClick={() => d({ type: 'approve', rec: r.id })}>✅ Approve - send a boat</Btn>
              <Btn kind="no" onClick={() => d({ type: 'reject', rec: r.id })}>❌ Reject</Btn>
              <Btn onClick={() => d({ type: 'flag', rec: r.id })}>🚩 Report a made-up source</Btn>
            </div>
          )}
        </div>
      ))}

      <h4>📢 Public announcement <span className="hint">(once per round each)</span></h4>
      <div className="hint">People trust your announcements. Sharing unchecked rumors causes panic and loses points.</div>
      <Btn kind="ok" onClick={() => d({ type: 'advisory', k: 'v' })}>Announce only facts we checked</Btn>
      <Btn onClick={() => d({ type: 'advisory', k: 't' })}>Say that AI helped us and may be wrong</Btn>
      <Btn kind="no" onClick={() => d({ type: 'advisory', k: 'x' })}>Announce the AI's claim as confirmed</Btn>
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

export function Board({ s, t, rows }: { s: TeamState; t: number; rows?: Row[] }) {
  return (
    <div>
      <div className="intro">
        <b>Leaderboard: 10 Competing Teams.</b><br />
        Ranks update in real time as teams verify reports, evacuate residents, and manage resupply.
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {(rows ?? board(total(s).all, s.round, t, s.finished)).map(x => (
            <tr key={x.n} style={{ fontWeight: x.you ? 800 : 400, background: x.you ? '#fff0ee' : undefined, borderBottom: '1px solid #edf2f7' }}>
              <td style={{ padding: '6px 4px' }}>#{x.r}</td>
              <td style={{ padding: '6px 4px' }}>{x.n}</td>
              <td style={{ padding: '6px 4px', textAlign: 'right' }}>{x.s} pts</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Host({ s, d, paused, setPaused }: { s: TeamState; d: D; paused: boolean; setPaused: (b: boolean) => void }) {
  const [ok, setOk] = useState(false), [code, setCode] = useState('');
  if (!ok) {
    return (
      <div>
        <div className="intro">
          <b>Teacher / Facilitator Dashboard.</b><br />
          Demo passcode: <code>CODERED</code>
        </div>
        <input
          value={code}
          onChange={e => setCode(e.target.value)}
          placeholder="Passcode"
          style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e0' }}
        />
        <Btn kind="pri" onClick={() => setOk(code === 'CODERED')}>Unlock Dashboard</Btn>
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
            ? `⚠️ Blocked by broken bridge in round ${s.supply.bridgeBlockedAt}.`
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