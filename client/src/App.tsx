import { useEffect, useState } from 'react';
import type { GameView } from '@jtr/shared';
import { call, lastSession, loadSession, saveSession, socket, type Session } from './socket.ts';
import type { RoomInfo } from './types.ts';
import Home from './Home.tsx';
import Lobby from './Lobby.tsx';
import Game from './game/Game.tsx';

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [game, setGame] = useState<GameView | null>(null);
  const [connected, setConnected] = useState(socket.connected);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      const s = loadSession();
      if (s) call('room:resume', { code: s.code, token: s.token }).catch((e: Error) => { setError(e.message); leave(); });
    };
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room', setRoom);
    socket.on('game', setGame);
    socket.on('kicked', () => { setError('You were removed from the room.'); leave(); });
    if (socket.connected) onConnect();
    return () => { socket.off('connect', onConnect); socket.off('disconnect', onDisconnect); socket.off('room'); socket.off('game'); socket.off('kicked'); };
  }, []);

  function enter(s: Session) {
    saveSession(s);
    setSession(s);
    setError(null);
    history.replaceState(null, '', `/?room=${s.code}`);
  }
  function leave() {
    call('room:leave').catch(() => {});
    saveSession(null);
    setSession(null);
    setRoom(null);
    setGame(null);
    history.replaceState(null, '', '/');
  }

  const me = room?.players.find((p) => p.id === session?.playerId);

  return (
    <div className="app">
      {!connected && <div className="banner">Connecting to the server...</div>}
      {error && <div className="banner error" onClick={() => setError(null)}>{error}</div>}
      {!session || !room ? (
        <Home onEnter={enter} onError={setError} last={session ? null : lastSession()} />
      ) : room.started && game ? (
        <Game view={game} room={room} onLeave={leave} />
      ) : (
        <Lobby room={room} me={me} onLeave={leave} onError={setError} />
      )}
    </div>
  );
}
