import { actors, jackLocation, pendingColors } from './engine.ts';
import type { Color, GameState, LogEntry, PoliceTurn, Phase, Player, SpecialUse, Trail } from './types.ts';

/**
 * What one player is allowed to see. Secret values are replaced by null:
 * detectives never get Jack's hideout, sheet or location, nor which woman tokens are marked;
 * Jack never gets the identity of unrevealed patrol tokens. Everything is revealed at game over.
 */
export interface GameView {
  you: { id: string; role: Player['role'] | 'spectator'; colors: Color[] };
  players: Player[];
  phase: Phase;
  night: number;
  actors: string[];
  pendingColors: Color[];
  hideout: number | null;
  sheet: (number | null)[][] | null;
  jackLocation: number | null;
  timeOfCrime: number | null;
  track: number | null;
  coaches: number;
  alleys: number;
  specials: SpecialUse[];
  women: { circle: number; marked: boolean | null }[];
  wretched: number[];
  wretchedPending: number[];
  crimeScenes: { circle: number; night: number }[];
  patrols: { crossing: number; color: Color | null | 'hidden'; revealed: boolean }[];
  policemen: Partial<Record<Color, number>>;
  head: Color | null;
  headTilesLeft: number;
  clues: number[];
  turn: PoliceTurn | null;
  winner: GameState['winner'];
  winReason: string | null;
  log: LogEntry[];
  /** public: what the police know about Jack's route each night */
  trails: Trail[];
}

export function viewFor(s: GameState, playerId: string): GameView {
  const me = s.players.find((p) => p.id === playerId);
  const over = s.phase === 'gameOver';
  const isJack = me?.role === 'jack' || over;
  const isDet = me?.role === 'detective' || over;
  return {
    you: { id: playerId, role: me?.role ?? 'spectator', colors: me?.colors ?? [] },
    players: s.players,
    phase: s.phase,
    night: s.night,
    actors: actors(s),
    pendingColors: pendingColors(s),
    hideout: isJack ? s.hideout : null,
    sheet: isJack ? s.sheet : null,
    jackLocation: isJack ? jackLocation(s) : null,
    timeOfCrime: s.timeOfCrime,
    track: s.track,
    coaches: s.coaches,
    alleys: s.alleys,
    specials: s.specials,
    women: s.women.map((w) => ({ circle: w.circle, marked: isJack ? w.marked : null })),
    wretched: s.wretched,
    wretchedPending: s.wretchedPending,
    crimeScenes: s.crimeScenes,
    patrols: s.patrols.map((p) => ({ crossing: p.crossing, revealed: p.revealed, color: p.revealed || isDet ? p.color : 'hidden' })),
    policemen: s.policemen,
    head: s.head,
    headTilesLeft: s.headTiles.length,
    clues: s.clues,
    turn: s.turn,
    winner: s.winner,
    winReason: s.winReason,
    log: s.log.filter((l) => !l.jackOnly || isJack),
    trails: s.trails ?? [],
  };
}
