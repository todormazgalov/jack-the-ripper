import { BOT_LEVELS, COLORS, HEADS, LEVEL_NAMES, type BotLevel, type Color } from '@jtr/shared';
import { call } from './socket.ts';
import { COLOR_HEX, type RoomInfo } from './types.ts';

interface Props { room: RoomInfo; me: RoomInfo['players'][number] | undefined; onLeave: () => void; onError: (e: string) => void }

export default function Lobby({ room, me, onLeave, onError }: Props) {
  const isHost = me?.id === room.hostId;
  const run = (ev: string, payload?: object) => call(ev, payload).catch((e: Error) => onError(e.message));
  const link = `${location.origin}/?room=${room.code}`;
  const assigned = new Set(room.players.flatMap((p) => p.colors));

  return (
    <div className="lobby">
      <h1>Room {room.code}</h1>
      <p>
        Invite players: <code>{link}</code>{' '}
        <button className="small" onClick={() => navigator.clipboard?.writeText(link)}>Copy</button>
      </p>
      <table className="players">
        <thead><tr><th>Player</th><th>Role</th><th>Policemen</th><th /></tr></thead>
        <tbody>
          {room.players.map((p) => {
            const canEdit = isHost || p.id === me?.id;
            return (
              <tr key={p.id} className={p.id === me?.id ? 'me' : ''}>
                <td>
                  <span className={`dot ${p.connected ? 'on' : 'off'}`} /> {p.name}
                  {p.id === room.hostId && <em> (host)</em>}
                  {p.bot && (
                    <select className="bot-level" disabled={!isHost} value={p.level ?? 'hard'} title="Bot difficulty"
                      onChange={(e) => run('lobby:level', { playerId: p.id, level: e.target.value as BotLevel })}>
                      {BOT_LEVELS.map((l) => <option key={l} value={l}>{LEVEL_NAMES[l]}</option>)}
                    </select>
                  )}
                </td>
                <td>
                  <select disabled={!canEdit} value={p.role ?? 'detective'}
                    onChange={(e) => run('lobby:role', { playerId: p.id, role: e.target.value })}>
                    <option value="jack">Jack the Ripper</option>
                    <option value="detective">Detective</option>
                    <option value="random">Random</option>
                  </select>
                </td>
                <td>
                  {p.role === 'detective' && COLORS.map((c: Color) => (
                    <button key={c} title={`${c} (${HEADS[c]})`} disabled={!canEdit}
                      className={`swatch ${p.colors.includes(c) ? 'sel' : ''}`}
                      style={{ background: COLOR_HEX[c], opacity: p.colors.includes(c) ? 1 : assigned.has(c) ? 0.15 : 0.4 }}
                      onClick={() => run('lobby:color', { playerId: p.id, color: c })} />
                  ))}
                </td>
                <td>{isHost && p.id !== me?.id && <button className="small secondary" onClick={() => run('lobby:kick', { playerId: p.id })}>Remove</button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <label className="option">
        <input type="checkbox" disabled={!isHost} checked={room.options.finalGuess}
          onChange={(e) => run('lobby:options', { finalGuess: e.target.checked })} />
        {' '}Final hideout guess: if Jack escapes on the fourth night, the detectives get one guess at his hideout. A right guess wins the game for the police.
      </label>
      <p className="hint">
        2 to 6 players: one Jack, the rest are detectives who share the 5 policemen. Unassigned policemen are
        shared out automatically when the game starts. Random roles are drawn at the start: one of them
        becomes Jack if nobody chose to be Jack, the others become detectives. Every player plays in their own browser (or browser tab).
        Bots can take any seat: they only see what their role is allowed to see.
      </p>
      <div className="row">
        {isHost ? <button onClick={() => run('game:start')}>Start the game</button> : <span>Waiting for the host to start...</span>}
        {isHost && <button className="secondary" disabled={room.players.length >= 6} onClick={() => run('lobby:bot')}>Add a bot</button>}
        <button className="secondary" onClick={onLeave}>Leave</button>
      </div>
    </div>
  );
}
