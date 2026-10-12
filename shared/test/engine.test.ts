import { describe, expect, it } from 'vitest';
import {
  COLORS, CROSSING_IDS as CROSSINGS, GameError, LAST_SLOT, RED_CIRCLES, YELLOW_CROSSINGS, adjacentCircles, alleyDestinations,
  apply, circlesAroundCrossing, createGame, jackAlleyMoves, jackCoachMoves, jackLocation, jackNormalMoves,
  legalWretchedMoves, migrateGame, pendingColors, policeMoveTargets, searchTargets, slotLabel, viewFor,
  type Action, type GameState, type Player,
} from '../src/index.ts';

const JACK = 'j';
const D1 = 'd1';
const D2 = 'd2';
const players: Player[] = [
  { id: JACK, name: 'Jack', role: 'jack', colors: [] },
  { id: D1, name: 'Holmes', role: 'detective', colors: ['blue', 'yellow', 'brown'] },
  { id: D2, name: 'Watson', role: 'detective', colors: ['red', 'green'] },
];
const fixedRng = () => 0; // deterministic head tile order

function act(s: GameState, a: Action, who?: string): GameState {
  const actor = who ?? s.players.find((p) => p.id === (['policeMove', 'policeAction'].includes(s.phase) ? s.turn!.order[s.turn!.index] : undefined))?.id;
  if (actor) return apply(s, actor, a);
  // Jack phases or head phases: try every player
  for (const p of s.players) {
    try { return apply(s, p.id, a); } catch (e) { if (!(e instanceof GameError) || e.message !== 'It is not your turn.') throw e; }
  }
  throw new Error('nobody can act');
}

const defaultPatrols = () => YELLOW_CROSSINGS.map((crossing, i) => ({ crossing, color: i < 5 ? COLORS[i] : null }));

/** Plays night 1 up to the start of the hunting, killing immediately on `victim` (must be a red circle). */
function toHunting(hideout: number, victim: number, s = createGame(players, fixedRng)): GameState {
  s = act(s, { type: 'chooseHideout', circle: hideout });
  s = act(s, { type: 'placeWomen', marked: [victim, ...RED_CIRCLES.filter((c) => c !== victim)].slice(0, 5) });
  s = act(s, { type: 'placePatrols', patrols: defaultPatrols() });
  s = act(s, { type: 'kill', victims: [victim] });
  return s;
}

/** Police leave everything as is: every pawn stays, then every pawn skips its action. */
function policePass(s: GameState): GameState {
  while (s.phase === 'policeMove') {
    const c = pendingColors(s)[0];
    s = act(s, { type: 'policeMove', color: c, to: s.policemen[c]! });
  }
  while (s.phase === 'policeAction') s = act(s, { type: 'policeSkip', color: pendingColors(s)[0] });
  return s;
}

describe('setup and hell phases', () => {
  it('rejects a red hideout and keeps the hideout secret from detectives', () => {
    const s = createGame(players, fixedRng);
    expect(() => apply(s, JACK, { type: 'chooseHideout', circle: 3 })).toThrow(/red/);
    expect(() => apply(s, D1, { type: 'chooseHideout', circle: 90 })).toThrow(/not your turn/);
    const s2 = apply(s, JACK, { type: 'chooseHideout', circle: 90 });
    expect(viewFor(s2, JACK).hideout).toBe(90);
    expect(viewFor(s2, D1).hideout).toBeNull();
    expect(JSON.stringify(viewFor(s2, D1).log)).not.toContain('90');
  });

  it('women: marked count per night, hidden from detectives, become wretched when revealed', () => {
    let s = act(createGame(players, fixedRng), { type: 'chooseHideout', circle: 90 });
    expect(() => act(s, { type: 'placeWomen', marked: [3, 21] })).toThrow(/Exactly 5/);
    s = act(s, { type: 'placeWomen', marked: [3, 21, 27, 65, 84] });
    expect(s.women).toHaveLength(8);
    expect(viewFor(s, D1).women.every((w) => w.marked === null)).toBe(true);
    expect(viewFor(s, JACK).women.filter((w) => w.marked)).toHaveLength(5);
    expect(s.phase).toBe('patrols');
    expect(s.head).toBeTruthy();
    s = act(s, { type: 'placePatrols', patrols: defaultPatrols() });
    expect(s.wretched.sort((a, b) => a - b)).toEqual([3, 21, 27, 65, 84]);
    expect(s.timeOfCrime).toBe(4); // slot of the Roman numeral I
    expect(viewFor(s, JACK).patrols.every((p) => p.color === 'hidden')).toBe(true);
    expect(viewFor(s, D2).patrols.filter((p) => p.color === null)).toHaveLength(2);
  });

  it('first-night patrols must be on yellow crossings', () => {
    let s = act(createGame(players, fixedRng), { type: 'chooseHideout', circle: 90 });
    s = act(s, { type: 'placeWomen', marked: [3, 21, 27, 65, 84] });
    const bad = defaultPatrols();
    bad[0] = { crossing: 1, color: 'blue' };
    expect(() => act(s, { type: 'placePatrols', patrols: bad })).toThrow(/yellow/);
  });

  it('waiting: wretched moves obey the patrol rules, Jack reveals a token, and must kill at V', () => {
    let s = act(createGame(players, fixedRng), { type: 'chooseHideout', circle: 90 });
    s = act(s, { type: 'placeWomen', marked: [3, 21, 27, 65, 84] });
    s = act(s, { type: 'placePatrols', patrols: defaultPatrols() });
    for (let t = 0; t < 4; t++) {
      s = act(s, { type: 'wait' });
      expect(slotLabel(s.timeOfCrime!)).toBe(['II', 'III', 'IV', 'V'][t]);
      while (s.phase === 'wretched') {
        const from = s.wretchedPending[0];
        const moves = legalWretchedMoves(s, from);
        const near = new Set(s.patrols.flatMap((p) => circlesAroundCrossing(p.crossing)));
        for (const m of moves) expect(near.has(m)).toBe(false);
        s = act(s, { type: 'moveWretched', from, to: moves[0] });
      }
      expect(s.phase).toBe('reveal');
      const hidden = s.patrols.find((p) => !p.revealed)!;
      s = act(s, { type: 'revealPatrol', crossing: hidden.crossing });
      expect(s.phase).toBe('kill');
    }
    expect(() => act(s, { type: 'wait' })).toThrow(/must kill/);
    const victim = s.wretched[0];
    s = act(s, { type: 'kill', victims: [victim] });
    // killed on V: the move track gives Jack 4 extra moves (IV, III, II, I) before 1..15
    expect(s.sheet[0][0]).toBe(victim);
    expect(s.track).toBe(0);
    expect(slotLabel(s.track! + 1)).toBe('IV');
    expect(s.phase).toBe('jackMove');
    expect(Object.keys(s.policemen).sort()).toEqual([...COLORS].sort());
    expect(s.wretched).toEqual([]);
  });
});

describe('crime scene off the red circles', () => {
  it('night 2: Jack chooses which of the 8 free red circles stay empty', () => {
    let s = act(createGame(players, fixedRng), { type: 'chooseHideout', circle: 90 });
    s = act(s, { type: 'placeWomen', marked: [3, 21, 27, 65, 84] });
    s = act(s, { type: 'placePatrols', patrols: defaultPatrols() });
    s = act(s, { type: 'wait' });
    while (s.phase === 'wretched') {
      const from = s.wretchedPending[0];
      s = act(s, { type: 'moveWretched', from, to: legalWretchedMoves(s, from)[0] });
    }
    s = act(s, { type: 'revealPatrol', crossing: s.patrols.find((p) => !p.revealed)!.crossing });
    const victim = s.wretched.find((w) => !RED_CIRCLES.includes(w))!;
    expect(victim).toBeDefined();
    s = act(s, { type: 'kill', victims: [victim] });
    s.hideout = jackNormalMoves(s)[0];
    s = act(s, { type: 'jackMove', to: s.hideout, escape: true });
    expect(s.phase).toBe('women');
    // all 8 red circles are free but only 7 women: Jack must say which circles get one
    expect(() => act(s, { type: 'placeWomen', marked: [3, 21, 27, 65] })).toThrow(/exactly 7/);
    expect(() => act(s, { type: 'placeWomen', circles: RED_CIRCLES, marked: [3, 21, 27, 65] })).toThrow(/exactly 7/);
    const circles = RED_CIRCLES.filter((c) => c !== 158);
    expect(() => act(s, { type: 'placeWomen', circles, marked: [3, 21, 27, 158] })).toThrow(/Marked/);
    s = act(s, { type: 'placeWomen', circles, marked: [3, 21, 27, 65] });
    expect(s.women.map((w) => w.circle)).toEqual(circles);
    expect(s.women.filter((w) => w.marked)).toHaveLength(4);
  });
});

describe('hunting', () => {
  it('Jack starts on the crime scene; normal moves cannot pass policemen, coaches can', () => {
    const s = toHunting(90, 65);
    expect(jackLocation(s)).toBe(65);
    const police = new Set(Object.values(s.policemen) as number[]);
    const normal = jackNormalMoves(s);
    expect(normal.every((c) => adjacentCircles(65).includes(c))).toBe(true);
    // a coach route may start with any adjacent circle, policemen or not
    const firstLegs = new Set(jackCoachMoves(s).map(([a]) => a));
    expect([...firstLegs].sort((a, b) => a - b)).toEqual(adjacentCircles(65));
    expect(police.size).toBe(5);
  });

  it('records moves on the sheet, specials on the track, and cycles police turns head-first', () => {
    let s = toHunting(90, 65);
    const to = jackNormalMoves(s)[0];
    s = act(s, { type: 'jackMove', to });
    // killed on I: the first move is 1
    expect(s.sheet[0][4]).toBe(65);
    expect(s.sheet[0][5]).toBe(to);
    expect(slotLabel(s.track!)).toBe('1');
    expect(viewFor(s, D1).sheet).toBeNull();
    expect(viewFor(s, D1).jackLocation).toBeNull();
    expect(s.phase).toBe('policeMove');
    const headOwner = s.players.find((p) => p.colors.includes(s.head!))!.id;
    expect(s.turn!.order[0]).toBe(headOwner);
    s = policePass(s);
    expect(s.phase).toBe('jackMove');
    const [via, dest] = jackCoachMoves(s)[0];
    s = act(s, { type: 'coach', via, to: dest });
    expect(s.sheet[0].slice(6, 8)).toEqual([via, dest]);
    expect(s.specials).toEqual([{ slot: 6, kind: 'coach' }]);
    expect(s.coaches).toBe(2);
    s = policePass(s);
    const alley = jackAlleyMoves(s)[0];
    expect(alleyDestinations(dest)).toContain(alley);
    s = act(s, { type: 'alley', to: alley });
    expect(s.specials[1]).toEqual({ slot: 8, kind: 'alley' });
  });

  it('policemen move up to two crossings and never share a crossing', () => {
    let s = toHunting(90, 65);
    s = act(s, { type: 'jackMove', to: jackNormalMoves(s)[0] });
    const c = pendingColors(s)[0];
    const targets = policeMoveTargets(s, c);
    const others = Object.entries(s.policemen).filter(([k]) => k !== c).map(([, x]) => x);
    expect(targets.some((x) => others.includes(x))).toBe(false);
    expect(targets).toContain(s.policemen[c]);
    const far = Math.max(...YELLOW_CROSSINGS) + 1000;
    expect(() => act(s, { type: 'policeMove', color: c, to: far })).toThrow(/Illegal/);
  });

  it('a clue is found on the first searched circle in tonight\'s row; arrest on Jack wins', () => {
    let s = toHunting(90, 65);
    s = act(s, { type: 'jackMove', to: jackNormalMoves(s)[0] });
    // teleport the first policeman next to the crime scene to test searching deterministically
    const occupied = Object.values(s.policemen);
    s.policemen[pendingColors(s)[0]] = CROSSINGS.find((x) => circlesAroundCrossing(x).includes(65) && !occupied.includes(x))!;
    s = policePassMovesOnly(s);
    const c = pendingColors(s)[0];
    expect(searchTargets(s, c)).toContain(65);
    const others = searchTargets(s, c).filter((x) => x !== 65 && !s.sheet[0].includes(x));
    if (others.length) {
      s = act(s, { type: 'search', color: c, circle: others[0] });
      expect(s.clues).toEqual([]);
      expect(() => act(s, { type: 'arrest', color: c, circle: 65 })).toThrow(/searching/);
    }
    s = act(s, { type: 'search', color: c, circle: 65 });
    expect(s.clues).toEqual([65]);
    // next policeman arrests on Jack's real location if adjacent, otherwise teleport to test arrest
    const loc = jackLocation(s)!;
    const c2 = pendingColors(s)[0] ?? null;
    if (c2) {
      const x = CROSSINGS.find((xx) => circlesAroundCrossing(xx).includes(loc) && !Object.values(s.policemen).includes(xx))!;
      s.policemen[c2] = x;
      s = act(s, { type: 'arrest', color: c2, circle: loc });
      expect(s.phase).toBe('gameOver');
      expect(s.winner).toBe('police');
      expect(viewFor(s, D1).sheet).not.toBeNull();
    }
  });

  it('Jack loses when the move track runs out', () => {
    let s = toHunting(90, 65);
    while (s.phase !== 'gameOver') {
      if (s.phase === 'jackMove') {
        const moves = jackNormalMoves(s).filter((c) => c !== s.hideout);
        if (!moves.length) break;
        s = act(s, { type: 'jackMove', to: moves[0] });
      } else s = policePass(s);
    }
    expect(s.track).toBe(LAST_SLOT);
    expect(s.winner).toBe('police');
  });

  it('escape is only possible after a normal move onto the hideout', () => {
    let s = toHunting(90, 65);
    const hideout = jackNormalMoves(s)[0];
    s.hideout = hideout;
    expect(() => act(s, { type: 'jackMove', to: jackNormalMoves(s).find((c) => c !== hideout)!, escape: true })).toThrow(/hideout/);
    s = act(s, { type: 'jackMove', to: hideout, escape: true });
    expect(s.night).toBe(2);
    expect(s.phase).toBe('women');
    expect(s.coaches).toBe(2);
    expect(s.clues).toEqual([]);
    expect(Object.keys(s.policemen)).toHaveLength(5);
  });
});

describe('later nights', () => {
  function escapeNight(s: GameState): GameState {
    // put the hideout next to Jack and escape at once
    s.hideout = jackNormalMoves(s)[0];
    return act(s, { type: 'jackMove', to: s.hideout, escape: true });
  }

  it('night 2 patrols must cover last night\'s policemen; night 3 is the double event; Jack wins after night 4', () => {
    let s = escapeNight(toHunting(90, 65));
    expect(s.night).toBe(2);
    expect(() => act(s, { type: 'placeWomen', marked: [3, 21, 27, 84] })).not.toThrow();
    expect(() => act(s, { type: 'placeWomen', marked: [65, 3, 21, 27] })).toThrow(/free red/);
    s = act(s, { type: 'placeWomen', marked: [3, 21, 27, 84] });
    const prev = Object.values(s.policemen) as number[];
    const spare = YELLOW_CROSSINGS.filter((x) => !prev.includes(x));
    const bad = [...prev.slice(0, 4), CROSSINGS.find((x) => !YELLOW_CROSSINGS.includes(x))!, spare[0], spare[1]].map((crossing, i) => ({ crossing, color: i < 5 ? COLORS[i] : null }));
    expect(() => act(s, { type: 'placePatrols', patrols: bad })).toThrow(/last night/);
    const good = [...prev, spare[0], spare[1]].map((crossing, i) => ({ crossing, color: i < 5 ? COLORS[i] : null }));
    s = act(s, { type: 'placePatrols', patrols: good });
    s = act(s, { type: 'kill', victims: [21] });
    s = escapeNight(s);
    // night 3: double event
    expect(s.night).toBe(3);
    s = act(s, { type: 'placeWomen', marked: [3, 27, 84] });
    const prev3 = Object.values(s.policemen) as number[];
    const spare3 = YELLOW_CROSSINGS.filter((x) => !prev3.includes(x));
    s = act(s, { type: 'placePatrols', patrols: [...prev3, spare3[0], spare3[1]].map((crossing, i) => ({ crossing, color: i < 5 ? COLORS[i] : null })) });
    expect(() => act(s, { type: 'kill', victims: [27] })).toThrow(/exactly 2/);
    s = act(s, { type: 'kill', victims: [27, 3] });
    // the two crime scenes fill I and 1
    expect(s.sheet[2].slice(4, 6)).toEqual([27, 3]);
    expect(jackLocation(s)).toBe(3);
    expect(s.track).toBe(5);
    expect(s.phase).toBe('policeMove');
    expect(viewFor(s, D1).jackLocation).toBeNull();
    s = policePass(s);
    s = escapeNight(s);
    // night 4
    expect(s.night).toBe(4);
    expect(s.crimeScenes).toHaveLength(4);
    s = act(s, { type: 'placeWomen', marked: [84] });
    const prev4 = Object.values(s.policemen) as number[];
    const spare4 = YELLOW_CROSSINGS.filter((x) => !prev4.includes(x));
    s = act(s, { type: 'placePatrols', patrols: [...prev4, spare4[0], spare4[1]].map((crossing, i) => ({ crossing, color: i < 5 ? COLORS[i] : null })) });
    s = act(s, { type: 'kill', victims: [84] });
    s = escapeNight(s);
    expect(s.crimeScenes).toHaveLength(5);
    // the final guess (on by default): only the Head of the Investigation's player names the hideout
    expect(s.phase).toBe('hideoutGuess');
    const headOwner = s.players.find((p) => p.colors.includes(s.head!))!.id;
    expect(() => apply(s, JACK, { type: 'guessHideout', circle: 1 })).toThrow(/not your turn/);
    expect(() => apply(s, headOwner, { type: 'guessHideout', circle: 3 })).toThrow(/red/);
    const right = apply(s, headOwner, { type: 'guessHideout', circle: s.hideout! });
    expect(right.winner).toBe('police');
    expect(right.events!.at(-1)).toMatchObject({ kind: 'raid', circle: s.hideout, result: 'caught' });
    const wrongCircle = [1, 2].find((c) => c !== s.hideout)!;
    const wrong = apply(s, headOwner, { type: 'guessHideout', circle: wrongCircle });
    expect(wrong.phase).toBe('gameOver');
    expect(wrong.winner).toBe('jack');
    expect(wrong.winReason).toContain(String(s.hideout));
  });

  it('without the final guess option Jack wins as soon as he escapes on night 4', () => {
    let s = toHunting(90, 65, createGame(players, fixedRng, { finalGuess: false }));
    // jump to the last night's hunting
    s.night = 4;
    s.sheet[3] = s.sheet[0];
    s = escapeNight(s);
    expect(s.phase).toBe('gameOver');
    expect(s.winner).toBe('jack');
  });
});

describe('events for animations', () => {
  it('searches and arrests are published with the acting policeman', () => {
    let s = toHunting(90, 65);
    s = act(s, { type: 'jackMove', to: jackNormalMoves(s)[0] });
    s = policePassMovesOnly(s);
    const c = pendingColors(s)[0];
    const circle = searchTargets(s, c)[0];
    s = act(s, { type: 'search', color: c, circle });
    expect(s.events!.at(-1)).toMatchObject({ seq: 1, kind: 'search', color: c, circle, from: s.policemen[c] });
    expect(viewFor(s, JACK).events).toEqual(viewFor(s, D1).events);
  });
});

/** Police keep their positions; stop at the action phase. */
function policePassMovesOnly(s: GameState): GameState {
  while (s.phase === 'policeMove') {
    const c = pendingColors(s)[0];
    s = act(s, { type: 'policeMove', color: c, to: s.policemen[c]! });
  }
  return s;
}

describe('saved games', () => {
  it('converts the old track layout (I..V then 1..15) to the board layout (V..I then 1..15)', () => {
    let s = toHunting(90, 65);
    s = act(s, { type: 'jackMove', to: jackNormalMoves(s)[0] });
    const route = s.sheet[0].filter((c) => c !== null);
    // the same position as saved by the old version: kill on I = slot 0, first move on slot 1
    const old = structuredClone(s);
    delete old.version;
    old.sheet[0] = [...route, ...Array(18).fill(null)];
    old.track = 1;
    old.timeOfCrime = 0;
    old.trails[0].start = 0;
    old.trails[0].moves[0].slot = 1;
    const m = migrateGame(old);
    expect(m.sheet[0]).toEqual(s.sheet[0]);
    expect([m.track, m.timeOfCrime, m.trails[0].moves[0].slot]).toEqual([s.track, s.timeOfCrime, 5]);
    // before the murder, the Time of the Crime was counted up from I
    const waiting = { ...structuredClone(createGame(players, fixedRng)), version: undefined, timeOfCrime: 2 };
    expect(slotLabel(migrateGame(waiting).timeOfCrime!)).toBe('III');
  });
});
