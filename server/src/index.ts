import express from 'express';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server, type Socket } from 'socket.io';
import { GameError, viewFor, type Action, type Color, type Role } from '@jtr/shared';
import { RoomError, Rooms, type Room, type RoomInfo } from './rooms.ts';

const PORT = Number(process.env.PORT ?? 3000);
const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(here, '../../client/dist');

const app = express();
app.use(express.static(clientDist));
app.get('/{*splat}', (_req, res) => res.sendFile(path.join(clientDist, 'index.html'), (err) => {
  if (err) res.status(404).send('Client not built. Run "npm run build" (or use "npm run dev").');
}));

const http = createServer(app);
const io = new Server(http);
const rooms = new Rooms();

/** socket.id -> where that socket belongs */
const sessions = new Map<string, { code: string; playerId: string }>();

function roomInfo(room: Room): RoomInfo {
  const online = new Set([...sessions.values()].filter((s) => s.code === room.code).map((s) => s.playerId));
  return {
    code: room.code,
    hostId: room.hostId,
    started: !!room.game,
    players: room.players.map((p) => ({
      id: p.id, name: p.name, role: p.role, colors: p.colors, connected: !!p.bot || online.has(p.id), bot: !!p.bot,
    })),
  };
}

function broadcast(room: Room) {
  const info = roomInfo(room);
  for (const [sid, s] of sessions) {
    if (s.code !== room.code) continue;
    const sock = io.sockets.sockets.get(sid);
    if (!sock) continue;
    sock.emit('room', info);
    sock.emit('game', room.game ? viewFor(room.game, s.playerId) : null);
  }
  scheduleBots(room);
}

/** Bots act one step at a time, with a pause so the humans can follow what happens. */
const BOT_DELAY_MS = Number(process.env.BOT_DELAY_MS ?? 700);
const botTimers = new Map<string, NodeJS.Timeout>();

function scheduleBots(room: Room) {
  if (botTimers.has(room.code) || !rooms.botToAct(room)) return;
  botTimers.set(room.code, setTimeout(() => {
    botTimers.delete(room.code);
    if (rooms.rooms.get(room.code) !== room) return;
    const botId = rooms.botToAct(room);
    if (!botId) return;
    try {
      rooms.botStep(room, botId);
    } catch (e) {
      console.error(`Bot ${botId} in room ${room.code} is stuck:`, e);
      return;
    }
    broadcast(room);
  }, BOT_DELAY_MS));
}

type Ack = (res: { ok: true; [k: string]: unknown } | { ok: false; error: string }) => void;

function handler<T>(socket: Socket, fn: (arg: T, sess: { code: string; playerId: string } | undefined) => object | void) {
  return (arg: T, ack?: Ack) => {
    try {
      const out = fn(arg, sessions.get(socket.id)) ?? {};
      ack?.({ ok: true, ...out });
    } catch (e) {
      if (e instanceof RoomError || e instanceof GameError) ack?.({ ok: false, error: e.message });
      else { console.error(e); ack?.({ ok: false, error: 'Server error.' }); }
    }
  };
}

function inRoom(sess: { code: string; playerId: string } | undefined) {
  if (!sess) throw new RoomError('You are not in a room.');
  return { room: rooms.get(sess.code), playerId: sess.playerId };
}

io.on('connection', (socket) => {
  const enter = (room: Room, playerId: string) => {
    sessions.set(socket.id, { code: room.code, playerId });
    broadcast(room);
  };

  socket.on('room:create', handler<{ name: string }>(socket, ({ name }) => {
    const { room, player } = rooms.create(name);
    enter(room, player.id);
    return { code: room.code, playerId: player.id, token: player.token };
  }));

  socket.on('room:join', handler<{ code: string; name: string }>(socket, ({ code, name }) => {
    const { room, player } = rooms.join(code, name);
    enter(room, player.id);
    return { code: room.code, playerId: player.id, token: player.token };
  }));

  socket.on('room:solo', handler<{ name: string; role: Role }>(socket, ({ name, role }) => {
    if (role !== 'jack' && role !== 'detective') throw new RoomError('Unknown role.');
    const { room, player } = rooms.solo(name, role);
    enter(room, player.id);
    return { code: room.code, playerId: player.id, token: player.token };
  }));

  socket.on('room:resume', handler<{ code: string; token: string }>(socket, ({ code, token }) => {
    const { room, player } = rooms.resume(code, token);
    enter(room, player.id);
    return { code: room.code, playerId: player.id, token: player.token };
  }));

  socket.on('room:leave', handler(socket, (_: unknown, sess) => {
    sessions.delete(socket.id);
    if (sess) { try { broadcast(rooms.get(sess.code)); } catch { /* room gone */ } }
  }));

  socket.on('lobby:role', handler<{ playerId: string; role: Role }>(socket, ({ playerId, role }, sess) => {
    const { room, playerId: me } = inRoom(sess);
    rooms.setRole(room, me, playerId, role);
    broadcast(room);
  }));

  socket.on('lobby:color', handler<{ playerId: string; color: Color }>(socket, ({ playerId, color }, sess) => {
    const { room, playerId: me } = inRoom(sess);
    rooms.toggleColor(room, me, playerId, color);
    broadcast(room);
  }));

  socket.on('lobby:bot', handler(socket, (_: unknown, sess) => {
    const { room, playerId } = inRoom(sess);
    rooms.addBot(room, playerId);
    broadcast(room);
  }));

  socket.on('lobby:kick', handler<{ playerId: string }>(socket, ({ playerId }, sess) => {
    const { room, playerId: me } = inRoom(sess);
    rooms.kick(room, me, playerId);
    for (const [sid, s] of sessions) if (s.code === room.code && s.playerId === playerId) {
      io.sockets.sockets.get(sid)?.emit('kicked');
      sessions.delete(sid);
    }
    broadcast(room);
  }));

  socket.on('game:start', handler(socket, (_: unknown, sess) => {
    const { room, playerId } = inRoom(sess);
    rooms.start(room, playerId);
    broadcast(room);
  }));

  socket.on('game:action', handler<Action>(socket, (action, sess) => {
    const { room, playerId } = inRoom(sess);
    rooms.act(room, playerId, action);
    broadcast(room);
  }));

  socket.on('game:lobby', handler(socket, (_: unknown, sess) => {
    const { room, playerId } = inRoom(sess);
    rooms.backToLobby(room, playerId);
    broadcast(room);
  }));

  socket.on('disconnect', () => {
    const sess = sessions.get(socket.id);
    sessions.delete(socket.id);
    if (sess) { try { broadcast(rooms.get(sess.code)); } catch { /* room gone */ } }
  });
});

// saved games may be waiting for a bot
for (const room of rooms.rooms.values()) scheduleBots(room);

http.listen(PORT, () => {
  const ips = Object.values(networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i!.address);
  console.log(`Jack the Ripper server on http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  LAN: http://${ip}:${PORT}`);
});
