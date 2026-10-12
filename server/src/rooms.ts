import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  COLORS, actors, apply, botAction, createGame, fallbackAction, migrateGame, validatePlayers, viewFor,
  type Action, type Color, type GameState, type Player, type Role,
} from '@jtr/shared';

export interface LobbyPlayer { id: string; token: string; name: string; role: Role | null; colors: Color[]; bot?: boolean }
export interface Room { code: string; hostId: string; players: LobbyPlayer[]; game: GameState | null; updatedAt: number }

/** What everyone in the room may see about the lobby (tokens stay on the server). */
export interface RoomInfo {
  code: string;
  hostId: string;
  started: boolean;
  players: { id: string; name: string; role: Role | null; colors: Color[]; connected: boolean; bot: boolean }[];
}

export class RoomError extends Error {}

const BOT_NAMES = { jack: ['Saucy Jacky', 'Leather Apron', 'The Whitechapel Fiend'], detective: ['Lestrade', 'Gregson', 'Bucket', 'Cuff', 'Dupin', 'Poirot'] };

const SAVE_DIR = path.resolve(process.cwd(), process.env.SAVE_DIR ?? '../saves');
const SAVE_FILE = path.join(SAVE_DIR, 'rooms.json');

export class Rooms {
  rooms = new Map<string, Room>();
  private saveTimer: NodeJS.Timeout | null = null;

  constructor() {
    try {
      const data = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8')) as Room[];
      for (const r of data) this.rooms.set(r.code, { ...r, game: r.game && migrateGame(r.game) });
      console.log(`Loaded ${data.length} saved room(s) from ${SAVE_FILE}`);
    } catch { /* no saves yet */ }
  }

  private save() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
      for (const [k, r] of this.rooms) if (r.updatedAt < weekAgo) this.rooms.delete(k);
      fs.mkdirSync(SAVE_DIR, { recursive: true });
      fs.writeFileSync(SAVE_FILE, JSON.stringify([...this.rooms.values()]));
    }, 500);
  }

  private touch(r: Room) { r.updatedAt = Date.now(); this.save(); }

  get(code: string): Room {
    const r = this.rooms.get(code.toUpperCase());
    if (!r) throw new RoomError(`Room ${code} does not exist.`);
    return r;
  }

  create(name: string): { room: Room; player: LobbyPlayer } {
    let code: string;
    do code = randomBytes(3).toString('hex').toUpperCase().replace(/[01]/g, 'A').slice(0, 4);
    while (this.rooms.has(code));
    const player = newPlayer(name, 'jack');
    const room: Room = { code, hostId: player.id, players: [player], game: null, updatedAt: Date.now() };
    this.rooms.set(code, room);
    this.touch(room);
    return { room, player };
  }

  join(code: string, name: string): { room: Room; player: LobbyPlayer } {
    const room = this.get(code);
    if (room.game) throw new RoomError('The game has already started. Use your original browser tab to rejoin.');
    if (room.players.length >= 6) throw new RoomError('The room is full (6 players).');
    const player = newPlayer(name, room.players.some((p) => p.role === 'jack') ? 'detective' : 'jack');
    room.players.push(player);
    this.touch(room);
    return { room, player };
  }

  /** A room with the player and one bot opponent, already started: Jack against bot police, or the police against a bot Jack. */
  solo(name: string, role: Role): { room: Room; player: LobbyPlayer } {
    const { room, player } = this.create(name);
    player.role = role;
    this.addBot(room, player.id);
    this.start(room, player.id);
    return { room, player };
  }

  addBot(room: Room, actorId: string) {
    this.lobbyOnly(room);
    if (actorId !== room.hostId) throw new RoomError('Only the host can add bots.');
    if (room.players.length >= 6) throw new RoomError('The room is full (6 players).');
    const role: Role = room.players.some((p) => p.role === 'jack') ? 'detective' : 'jack';
    const taken = new Set(room.players.map((p) => p.name));
    const name = BOT_NAMES[role].map((n) => `${n} (bot)`).find((n) => !taken.has(n)) ?? `Bot ${room.players.length + 1}`;
    room.players.push({ ...newPlayer(name, role), bot: true });
    this.touch(room);
  }

  /** The bot that has to act now, if any. */
  botToAct(room: Room): string | undefined {
    if (!room.game || room.game.phase === 'gameOver') return undefined;
    return actors(room.game).find((id) => room.players.some((p) => p.id === id && p.bot));
  }

  /** Plays one action for a bot. If its choice is refused (a bot bug), it falls back to the plainest legal action. */
  botStep(room: Room, botId: string) {
    const game = room.game!;
    const view = viewFor(game, botId);
    try {
      room.game = apply(game, botId, botAction(view));
    } catch (e) {
      console.error(`Bot ${botId} in room ${room.code} failed in phase ${game.phase}:`, e);
      room.game = apply(game, botId, fallbackAction(view));
    }
    this.touch(room);
  }

  resume(code: string, token: string): { room: Room; player: LobbyPlayer } {
    const room = this.get(code);
    const player = room.players.find((p) => p.token === token);
    if (!player) throw new RoomError('Unknown player for this room.');
    return { room, player };
  }

  setRole(room: Room, actorId: string, targetId: string, role: Role) {
    this.lobbyOnly(room);
    if (actorId !== targetId && actorId !== room.hostId) throw new RoomError('Only the host can change other players.');
    const p = room.players.find((pl) => pl.id === targetId);
    if (!p) throw new RoomError('No such player.');
    if (role === 'jack') for (const o of room.players) if (o.role === 'jack' && o !== p) { o.role = 'detective'; }
    p.role = role;
    if (role === 'jack') p.colors = [];
    this.touch(room);
  }

  toggleColor(room: Room, actorId: string, targetId: string, color: Color) {
    this.lobbyOnly(room);
    if (actorId !== targetId && actorId !== room.hostId) throw new RoomError('Only the host can change other players.');
    const p = room.players.find((pl) => pl.id === targetId);
    if (!p || p.role !== 'detective') throw new RoomError('Policemen can only be given to detectives.');
    if (p.colors.includes(color)) p.colors = p.colors.filter((c) => c !== color);
    else {
      for (const o of room.players) o.colors = o.colors.filter((c) => c !== color);
      p.colors = [...p.colors, color].sort((a, b) => COLORS.indexOf(a) - COLORS.indexOf(b));
    }
    this.touch(room);
  }

  kick(room: Room, actorId: string, targetId: string) {
    this.lobbyOnly(room);
    if (actorId !== room.hostId || targetId === room.hostId) throw new RoomError('Only the host can remove other players.');
    room.players = room.players.filter((p) => p.id !== targetId);
    this.touch(room);
  }

  start(room: Room, actorId: string) {
    this.lobbyOnly(room);
    if (actorId !== room.hostId) throw new RoomError('Only the host can start the game.');
    const dets = room.players.filter((p) => p.role === 'detective');
    // give unassigned policemen to detectives round-robin
    const free = COLORS.filter((c) => !dets.some((d) => d.colors.includes(c)));
    for (const c of free) {
      const d = [...dets].sort((a, b) => a.colors.length - b.colors.length)[0];
      if (d) d.colors = [...d.colors, c].sort((a, b) => COLORS.indexOf(a) - COLORS.indexOf(b));
    }
    const players: Player[] = room.players.map((p) => ({ id: p.id, name: p.name, role: p.role ?? 'detective', colors: p.colors }));
    try { validatePlayers(players); } catch (e) { throw new RoomError((e as Error).message); }
    room.game = createGame(players);
    this.touch(room);
  }

  act(room: Room, playerId: string, action: Action) {
    if (!room.game) throw new RoomError('The game has not started.');
    room.game = apply(room.game, playerId, action);
    this.touch(room);
  }

  backToLobby(room: Room, actorId: string) {
    if (actorId !== room.hostId) throw new RoomError('Only the host can end the game.');
    room.game = null;
    this.touch(room);
  }

  private lobbyOnly(room: Room) {
    if (room.game) throw new RoomError('The game is already running.');
  }
}

function newPlayer(name: string, role: Role): LobbyPlayer {
  const clean = name.trim().slice(0, 24) || 'Anonymous';
  return { id: randomUUID().slice(0, 8), token: randomUUID(), name: clean, role, colors: [] };
}
