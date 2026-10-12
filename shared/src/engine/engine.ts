import {
  RED_CIRCLES, YELLOW_CROSSINGS, adjacentCircles, alleyDestinations, circleById, circleNeighbors,
  circlesAroundCrossing, crossingById, policeDestinations,
} from '../map/graph.ts';
import {
  COLORS, GameError, HEADS, LAST_SLOT, NIGHTS, SLOT_COUNT, slotLabel,
  type Action, type Color, type GameState, type Player, type Trail,
} from './types.ts';

const fail = (msg: string): never => { throw new GameError(msg); };

// ---------------------------------------------------------------- setup

export function validatePlayers(players: Player[]): void {
  if (players.filter((p) => p.role === 'jack').length !== 1) fail('Exactly one player must be Jack the Ripper.');
  const dets = players.filter((p) => p.role === 'detective');
  if (dets.length < 1) fail('At least one detective is needed.');
  const owned = dets.flatMap((p) => p.colors);
  for (const c of COLORS) if (owned.filter((o) => o === c).length !== 1) fail(`Policeman ${c} must belong to exactly one detective.`);
  if (players.some((p) => p.role === 'jack' && p.colors.length)) fail('Jack cannot control policemen.');
}

export function createGame(players: Player[], rng: () => number = Math.random): GameState {
  validatePlayers(players);
  const headTiles = [...COLORS];
  for (let i = headTiles.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [headTiles[i], headTiles[j]] = [headTiles[j], headTiles[i]];
  }
  return {
    players: structuredClone(players),
    phase: 'hideout',
    night: 1,
    hideout: null,
    sheet: NIGHTS.map(() => Array<number | null>(SLOT_COUNT).fill(null)),
    timeOfCrime: null,
    track: null,
    coaches: 0,
    alleys: 0,
    specials: [],
    women: [],
    wretched: [],
    wretchedPending: [],
    crimeScenes: [],
    patrols: [],
    policemen: {},
    headTiles,
    head: null,
    clues: [],
    turn: null,
    winner: null,
    winReason: null,
    log: [{ night: 1, text: 'London, 1888. Jack the Ripper chooses his hideout...' }],
    trails: [],
  };
}

// ---------------------------------------------------------------- queries

export const jackPlayer = (s: GameState) => s.players.find((p) => p.role === 'jack')!;
export const ownerOf = (s: GameState, color: Color) => s.players.find((p) => p.colors.includes(color))!;
export const nightRules = (s: GameState) => NIGHTS[s.night - 1];
export const policeCrossings = (s: GameState) => new Set(Object.values(s.policemen) as number[]);
export const patrolCrossings = (s: GameState) => new Set(s.patrols.map((p) => p.crossing));
/** The public record of tonight's route, once Jack has killed. */
export const currentTrail = (s: Pick<GameState, 'trails' | 'night'>): Trail | undefined =>
  s.trails?.find((t) => t.night === s.night);

/** Jack's current location (secret). */
export function jackLocation(s: GameState): number | null {
  return s.track === null ? null : s.sheet[s.night - 1][s.track];
}

/** Player ids allowed to act right now. */
export function actors(s: GameState): string[] {
  switch (s.phase) {
    case 'hideout': case 'women': case 'kill': case 'reveal': case 'jackMove':
      return [jackPlayer(s).id];
    case 'patrols': case 'wretched':
      return s.head ? [ownerOf(s, s.head).id] : [];
    case 'policeMove': case 'policeAction':
      return s.turn ? [s.turn.order[s.turn.index]] : [];
    default:
      return [];
  }
}

/** Policemen the current detective still has to move / act with. */
export function pendingColors(s: GameState): Color[] {
  if (!s.turn) return [];
  const p = s.players.find((pl) => pl.id === s.turn!.order[s.turn!.index]);
  return (p?.colors ?? []).filter((c) => !s.turn!.done.includes(c));
}

export function freeRedCircles(s: GameState): number[] {
  return RED_CIRCLES.filter((c) => !s.crimeScenes.some((cs) => cs.circle === c));
}

export function legalWretchedMoves(s: GameState, from: number): number[] {
  const patrols = patrolCrossings(s);
  const nearPatrol = new Set([...patrols].flatMap((x) => circlesAroundCrossing(x)));
  return circleNeighbors(from, patrols).filter((c) =>
    !s.wretched.includes(c) && !s.crimeScenes.some((cs) => cs.circle === c) && !nearPatrol.has(c));
}

export function jackNormalMoves(s: GameState): number[] {
  const loc = jackLocation(s);
  return loc === null ? [] : circleNeighbors(loc, policeCrossings(s));
}

export function jackCoachMoves(s: GameState): [number, number][] {
  const loc = jackLocation(s);
  if (loc === null || s.coaches <= 0 || s.track! + 2 > LAST_SLOT) return [];
  const out: [number, number][] = [];
  for (const a of adjacentCircles(loc)) for (const b of adjacentCircles(a)) if (b !== loc && b !== a) out.push([a, b]);
  return out;
}

export function jackAlleyMoves(s: GameState): number[] {
  const loc = jackLocation(s);
  return loc === null || s.alleys <= 0 ? [] : alleyDestinations(loc);
}

export function jackHasMove(s: GameState): boolean {
  return jackNormalMoves(s).length > 0 || jackCoachMoves(s).length > 0 || jackAlleyMoves(s).length > 0;
}

export function policeMoveTargets(s: GameState, color: Color): number[] {
  const from = s.policemen[color];
  if (from === undefined) return [];
  const others = new Set(Object.entries(s.policemen).filter(([c]) => c !== color).map(([, x]) => x));
  return policeDestinations(from).filter((x) => !others.has(x));
}

/** Circles this policeman may still inspect for clues. */
export function searchTargets(s: GameState, color: Color): number[] {
  const x = s.policemen[color];
  if (x === undefined) return [];
  const checked = s.turn?.searching?.color === color ? s.turn.searching.checked : [];
  return circlesAroundCrossing(x).filter((c) => !checked.includes(c) && !s.clues.includes(c));
}

export function arrestTargets(s: GameState, color: Color): number[] {
  const x = s.policemen[color];
  return x === undefined ? [] : circlesAroundCrossing(x);
}

// ---------------------------------------------------------------- transitions

function log(s: GameState, text: string, jackOnly = false) {
  s.log.push({ night: s.night, text, ...(jackOnly ? { jackOnly } : {}) });
}

function startNight(s: GameState) {
  const r = nightRules(s);
  s.coaches = r.coach;
  s.alleys = r.alley;
  s.specials = [];
  s.clues = [];
  s.timeOfCrime = null;
  s.track = null;
  s.women = [];
  s.wretched = [];
  s.patrols = [];
  s.turn = null;
  s.phase = 'women';
  log(s, `Night ${s.night} (${r.date}) begins. Jack has ${r.coach} coach and ${r.alley} alley token(s).`);
}

function finish(s: GameState, winner: 'jack' | 'police', reason: string) {
  s.winner = winner;
  s.winReason = reason;
  s.phase = 'gameOver';
  s.turn = null;
  log(s, reason);
}

function startPoliceTurn(s: GameState, phase: 'policeMove' | 'policeAction') {
  const dets = s.players.filter((p) => p.role === 'detective' && p.colors.length);
  const seat = (id: string) => s.players.findIndex((p) => p.id === id);
  const headSeat = seat(ownerOf(s, s.head!).id);
  const n = s.players.length;
  const order = dets
    .map((p) => p.id)
    .sort((a, b) => ((seat(a) - headSeat + n) % n) - ((seat(b) - headSeat + n) % n));
  s.phase = phase;
  s.turn = { order, index: 0, done: [], searching: null };
}

function startJackMove(s: GameState) {
  s.phase = 'jackMove';
  s.turn = null;
  if (!jackHasMove(s)) finish(s, 'police', 'Jack is cornered: he has no legal move. The police win!');
}

/** After a policeman finished its move/action: advance to the next detective or the next phase. */
function advancePolice(s: GameState) {
  const t = s.turn!;
  while (t.index < t.order.length && pendingColors(s).length === 0) {
    t.index++;
  }
  if (t.index < t.order.length) return;
  if (s.phase === 'policeMove') startPoliceTurn(s, 'policeAction');
  else startJackMove(s);
}

function afterWretchedMove(s: GameState) {
  s.wretchedPending = s.wretchedPending.filter((w) => legalWretchedMoves(s, w).length > 0);
  if (s.wretchedPending.length === 0) s.phase = 'reveal';
  if (s.phase === 'reveal' && !s.patrols.some((p) => !p.revealed)) s.phase = 'kill';
}

function recordMove(s: GameState, circle: number) {
  s.track = s.track! + 1;
  s.sheet[s.night - 1][s.track] = circle;
}

function recordTrail(s: GameState, kind: Trail['moves'][number]['kind'], blocked: number[]) {
  currentTrail(s)?.moves.push({ slot: s.track!, kind, blocked });
}

function recordCheck(s: GameState, circle: number, result: Trail['checks'][number]['result']) {
  currentTrail(s)?.checks.push({ slot: s.track!, circle, result });
}

function afterJackMove(s: GameState, escape: boolean) {
  const loc = jackLocation(s)!;
  if (escape) {
    if (loc !== s.hideout) fail('Jack can only declare his escape on his hideout.');
    log(s, `Jack declares his escape on move ${slotLabel(s.track!)}. He vanishes into the night...`);
    const t = currentTrail(s);
    if (t) t.escaped = true;
    if (s.night === NIGHTS.length) {
      finish(s, 'jack', 'Jack the Ripper has escaped after all four nights. Jack wins!');
      return;
    }
    s.night++;
    startNight(s);
    return;
  }
  if (s.track === LAST_SLOT) {
    finish(s, 'police', 'Jack failed to reach his hideout before the end of the move track. The police win!');
    return;
  }
  startPoliceTurn(s, 'policeMove');
}

// ---------------------------------------------------------------- apply

export function apply(state: GameState, playerId: string, action: Action): GameState {
  if (state.phase === 'gameOver') fail('The game is over.');
  if (!actors(state).includes(playerId)) fail('It is not your turn.');
  const s = structuredClone(state);
  s.trails ??= [];
  const r = nightRules(s);

  switch (action.type) {
    case 'chooseHideout': {
      if (s.phase !== 'hideout') fail('Not the time to choose a hideout.');
      if (!circleById.has(action.circle)) fail('Unknown circle.');
      if (RED_CIRCLES.includes(action.circle)) fail('The hideout cannot be a red numbered circle.');
      s.hideout = action.circle;
      log(s, `You chose hideout ${action.circle}.`, true);
      log(s, 'Jack has chosen his hideout.');
      startNight(s);
      break;
    }

    case 'placeWomen': {
      if (s.phase !== 'women') fail('Not the time to place women.');
      const free = freeRedCircles(s);
      // crime scenes are often not on red circles, so there can be more free red circles than women
      const circles = [...new Set(action.circles ?? (free.length === r.women ? free : []))];
      const marked = [...new Set(action.marked)];
      if (circles.length !== r.women) fail(`Place exactly ${r.women} women tonight (choose which red circles stay empty).`);
      if (circles.some((c) => !free.includes(c))) fail('Women must be on free red circles.');
      if (marked.length !== r.marked) fail(`Exactly ${r.marked} women must be marked tonight.`);
      if (marked.some((c) => !circles.includes(c))) fail('Marked women must be on free red circles.');
      s.women = circles.sort((a, b) => a - b).map((circle) => ({ circle, marked: marked.includes(circle) }));
      log(s, `Jack places ${r.women} woman tokens face down on the red circles.`);
      s.head = s.headTiles.shift()!;
      log(s, `Head of the Investigation tonight: ${HEADS[s.head]} (${s.head}, ${ownerOf(s, s.head).name}).`);
      s.phase = 'patrols';
      break;
    }

    case 'placePatrols': {
      if (s.phase !== 'patrols') fail('Not the time to place patrols.');
      const ps = action.patrols;
      if (ps.length !== 7) fail('Place exactly 7 patrol tokens.');
      const crossings = ps.map((p) => p.crossing);
      if (new Set(crossings).size !== 7) fail('Patrol tokens must be on 7 different crossings.');
      if (crossings.some((x) => !crossingById.has(x))) fail('Unknown crossing.');
      const colors = ps.map((p) => p.color);
      if (colors.filter((c) => c === null).length !== 2 || COLORS.some((c) => colors.filter((x) => x === c).length !== 1))
        fail('Use the 5 coloured tokens once each and the 2 fake tokens.');
      if (s.night === 1) {
        if (crossings.some((x) => !YELLOW_CROSSINGS.includes(x))) fail('On the first night every patrol goes on a yellow crossing.');
      } else {
        const prev = Object.values(s.policemen) as number[];
        if (prev.some((x) => !crossings.includes(x))) fail("Five tokens must go where last night's policemen ended.");
        const rest = crossings.filter((x) => !prev.includes(x));
        if (rest.some((x) => !YELLOW_CROSSINGS.includes(x))) fail('The two other tokens must go on yellow crossings not occupied by policemen.');
      }
      s.patrols = ps.map((p) => ({ crossing: p.crossing, color: p.color, revealed: false }));
      s.policemen = {};
      log(s, 'The Head of the Investigation places the police patrol tokens.');
      // Hell 4: the victims are chosen
      s.wretched = s.women.filter((w) => w.marked).map((w) => w.circle);
      log(s, `The women are revealed: wretched on ${s.wretched.join(', ')}.`);
      s.women = [];
      s.timeOfCrime = 0;
      s.phase = 'kill';
      break;
    }

    case 'wait': {
      if (s.phase !== 'kill') fail('Not the time to wait.');
      if (s.timeOfCrime! >= 4) fail('The Time of the Crime is V: Jack must kill now.');
      s.timeOfCrime!++;
      log(s, `Jack waits. The Time of the Crime advances to ${slotLabel(s.timeOfCrime!)}.`);
      s.phase = 'wretched';
      s.wretchedPending = [...s.wretched];
      afterWretchedMove(s);
      break;
    }

    case 'moveWretched': {
      if (s.phase !== 'wretched') fail('Not the time to move the wretched.');
      if (!s.wretchedPending.includes(action.from)) fail('That wretched cannot move (already moved or not there).');
      if (!legalWretchedMoves(s, action.from).includes(action.to)) fail('Illegal destination for the wretched.');
      s.wretched = s.wretched.map((w) => (w === action.from ? action.to : w));
      s.wretchedPending = s.wretchedPending.filter((w) => w !== action.from);
      log(s, `A wretched moves from ${action.from} to ${action.to}.`);
      afterWretchedMove(s);
      break;
    }

    case 'revealPatrol': {
      if (s.phase !== 'reveal') fail('Not the time to reveal a patrol.');
      const p = s.patrols.find((pp) => pp.crossing === action.crossing && !pp.revealed);
      if (!p) fail('No hidden patrol token there.');
      if (p!.color === null) {
        s.patrols = s.patrols.filter((pp) => pp !== p);
        log(s, `Jack reveals the patrol token on crossing ${action.crossing}: a fake! It is removed.`);
      } else {
        p!.revealed = true;
        log(s, `Jack reveals the patrol token on crossing ${action.crossing}: the ${p!.color} policeman.`);
      }
      s.phase = 'kill';
      break;
    }

    case 'kill': {
      if (s.phase !== 'kill') fail('Not the time to kill.');
      const v = action.victims;
      if (v.length !== r.kills || new Set(v).size !== v.length) fail(`Choose exactly ${r.kills} victim(s).`);
      if (v.some((c) => !s.wretched.includes(c))) fail('Victims must be wretched on the board.');
      for (const c of v) s.crimeScenes.push({ circle: c, night: s.night });
      s.wretched = s.wretched.filter((w) => !v.includes(w));
      const t = s.timeOfCrime!;
      v.forEach((c, i) => { s.sheet[s.night - 1][t + i] = c; });
      s.track = t + v.length - 1;
      s.trails.push({ night: s.night, scenes: [...v], start: s.track, moves: [], checks: [], escaped: false });
      log(s, `Murder! A crime scene appears on ${[...v].sort((a, b) => a - b).join(' and ')} at Time of the Crime ${slotLabel(t)}.`);
      // Hell 9: alarm whistles
      for (const p of s.patrols) if (p.color) s.policemen[p.color] = p.crossing;
      s.patrols = [];
      s.wretched = [];
      log(s, 'Alarm whistles! The policemen take their posts. The hunting begins!');
      if (v.length === 2) startPoliceTurn(s, 'policeMove');
      else startJackMove(s);
      break;
    }

    case 'jackMove': {
      if (s.phase !== 'jackMove') fail('Not the time for Jack to move.');
      if (!jackNormalMoves(s).includes(action.to)) fail('Illegal move.');
      recordMove(s, action.to);
      recordTrail(s, 'walk', [...policeCrossings(s)]);
      log(s, `Jack moves (move ${slotLabel(s.track!)}).`);
      log(s, `You moved to ${action.to}.`, true);
      afterJackMove(s, !!action.escape);
      break;
    }

    case 'coach': {
      if (s.phase !== 'jackMove') fail('Not the time for Jack to move.');
      if (!jackCoachMoves(s).some(([a, b]) => a === action.via && b === action.to)) fail('Illegal coach move.');
      s.coaches--;
      s.specials.push({ slot: s.track! + 1, kind: 'coach' });
      recordMove(s, action.via);
      recordMove(s, action.to);
      recordTrail(s, 'coach', []);
      log(s, `Hooves clatter on the cobblestones: Jack takes a coach (moves ${slotLabel(s.track! - 1)}-${slotLabel(s.track!)}).`);
      log(s, `You took a coach via ${action.via} to ${action.to}.`, true);
      afterJackMove(s, false);
      break;
    }

    case 'alley': {
      if (s.phase !== 'jackMove') fail('Not the time for Jack to move.');
      if (!jackAlleyMoves(s).includes(action.to)) fail('Illegal alley move.');
      s.alleys--;
      s.specials.push({ slot: s.track! + 1, kind: 'alley' });
      recordMove(s, action.to);
      recordTrail(s, 'alley', []);
      log(s, `Jack slips through an alley (move ${slotLabel(s.track!)}).`);
      log(s, `You took an alley to ${action.to}.`, true);
      afterJackMove(s, false);
      break;
    }

    case 'policeMove': {
      if (s.phase !== 'policeMove') fail('Not the time to move policemen.');
      if (!pendingColors(s).includes(action.color)) fail('That policeman is not yours to move now.');
      if (!policeMoveTargets(s, action.color).includes(action.to)) fail('Illegal policeman move.');
      const from = s.policemen[action.color];
      s.policemen[action.color] = action.to;
      s.turn!.done.push(action.color);
      log(s, from === action.to ? `The ${action.color} policeman stays put.` : `The ${action.color} policeman moves.`);
      advancePolice(s);
      break;
    }

    case 'search': {
      if (s.phase !== 'policeAction') fail('Not the time to look for clues.');
      if (!pendingColors(s).includes(action.color)) fail('That policeman cannot act now.');
      const sr = s.turn!.searching;
      if (sr && sr.color !== action.color) fail(`Finish the ${sr.color} policeman's search first.`);
      if (!searchTargets(s, action.color).includes(action.circle)) fail('That circle cannot be searched by this policeman.');
      const row = s.sheet[s.night - 1];
      const found = row.includes(action.circle);
      recordCheck(s, action.circle, found ? 'clue' : 'nothing');
      if (found) {
        s.clues.push(action.circle);
        log(s, `The ${action.color} policeman searches ${action.circle}: a CLUE!`);
        s.turn!.searching = null;
        s.turn!.done.push(action.color);
      } else {
        log(s, `The ${action.color} policeman searches ${action.circle}: nothing.`);
        s.turn!.searching = { color: action.color, checked: [...(sr?.checked ?? []), action.circle] };
        if (searchTargets(s, action.color).length === 0) {
          s.turn!.searching = null;
          s.turn!.done.push(action.color);
        }
      }
      advancePolice(s);
      break;
    }

    case 'arrest': {
      if (s.phase !== 'policeAction') fail('Not the time to arrest.');
      if (!pendingColors(s).includes(action.color)) fail('That policeman cannot act now.');
      if (s.turn!.searching?.color === action.color) fail('This policeman is already searching for clues.');
      if (s.turn!.searching) fail(`Finish the ${s.turn!.searching.color} policeman's search first.`);
      if (!arrestTargets(s, action.color).includes(action.circle)) fail('That circle is not adjacent to this policeman.');
      if (jackLocation(s) === action.circle) {
        log(s, `The ${action.color} policeman makes an arrest on ${action.circle}...`);
        finish(s, 'police', `Jack the Ripper is arrested on ${action.circle}! The police win!`);
        break;
      }
      log(s, `The ${action.color} policeman attempts an arrest on ${action.circle}: nobody there.`);
      recordCheck(s, action.circle, 'absent');
      s.turn!.done.push(action.color);
      advancePolice(s);
      break;
    }

    case 'policeSkip': {
      if (s.phase !== 'policeAction') fail('Not the time for police actions.');
      if (!pendingColors(s).includes(action.color)) fail('That policeman cannot act now.');
      if (s.turn!.searching?.color === action.color) {
        // allowed only when the search ran out of candidates (handled automatically), so refuse
        fail('A search must continue until a clue is found or no circles remain.');
      }
      if (s.turn!.searching) fail(`Finish the ${s.turn!.searching.color} policeman's search first.`);
      s.turn!.done.push(action.color);
      log(s, `The ${action.color} policeman takes no action.`);
      advancePolice(s);
      break;
    }

    default:
      fail('Unknown action.');
  }
  return s;
}
