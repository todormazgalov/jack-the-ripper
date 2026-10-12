import { useState } from 'react';
import { BOT_LEVELS, LEVEL_NAMES, type BotLevel } from '@jtr/shared';
import { LEVEL_HINTS } from './types.ts';
import { call, type Session } from './socket.ts';

interface Props { onEnter: (s: Session) => void; onError: (e: string) => void; last: Session | null }

export default function Home({ onEnter, onError, last }: Props) {
  const [name, setName] = useState(() => localStorage.getItem('jtr-name') ?? '');
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('room') ?? '');
  const [busy, setBusy] = useState(false);
  const [level, setLevel] = useState<BotLevel>(() => (localStorage.getItem('jtr-level') as BotLevel | null) ?? 'normal');
  const pickLevel = (l: BotLevel) => { setLevel(l); localStorage.setItem('jtr-level', l); };

  async function go(event: 'room:create' | 'room:join' | 'room:resume' | 'room:solo', payload: object) {
    setBusy(true);
    try {
      localStorage.setItem('jtr-name', name);
      onEnter(await call<Session>(event, payload));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="home">
      <h1>Jack the Ripper</h1>
      <p className="subtitle">Whitechapel, 1888. One player is Jack. The others hunt him through the streets.</p>
      <div className="card">
        <label>Your name <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} autoFocus /></label>
        <button disabled={busy || !name.trim()} onClick={() => go('room:create', { name })}>Create a new game</button>
        <div className="or">or play alone against bots</div>
        <div className="levels" role="radiogroup" aria-label="Bot difficulty">
          {BOT_LEVELS.map((l) => (
            <button key={l} role="radio" aria-checked={level === l} className={`level ${level === l ? 'sel' : ''}`} onClick={() => pickLevel(l)}>
              {LEVEL_NAMES[l]}
            </button>
          ))}
        </div>
        <div className="hint">{LEVEL_HINTS[level]}</div>
        <div className="row solo">
          <button className="secondary" disabled={busy || !name.trim()} onClick={() => go('room:solo', { name, role: 'jack', level })}>
            Play Jack vs bot police
          </button>
          <button className="secondary" disabled={busy || !name.trim()} onClick={() => go('room:solo', { name, role: 'detective', level })}>
            Play the police vs bot Jack
          </button>
        </div>
        <div className="or">or join an existing game</div>
        <label>Room code <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={4} placeholder="ABCD" /></label>
        <button disabled={busy || !name.trim() || code.length !== 4} onClick={() => go('room:join', { code, name })}>Join</button>
        {last && (
          <>
            <div className="or">or</div>
            <button className="secondary" disabled={busy} onClick={() => go('room:resume', { code: last.code, token: last.token })}>
              Rejoin room {last.code} as before
            </button>
          </>
        )}
      </div>
    </div>
  );
}
