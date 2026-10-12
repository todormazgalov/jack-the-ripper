import { describe, expect, it } from 'vitest';
import {
  BOT_LEVELS, actors, apply, believe, botAction, createGame, hideoutBelief, hideoutCandidates, jackLocation, viewFor,
  type GameState, type Player,
} from '../src/index.ts';

/** Small seeded generator so simulated games are reproducible. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const players: Player[] = [
  { id: 'j', name: 'Jack', role: 'jack', colors: [] },
  { id: 'd1', name: 'Holmes', role: 'detective', colors: ['blue', 'yellow', 'brown'] },
  { id: 'd2', name: 'Watson', role: 'detective', colors: ['red', 'green'] },
];

/** Plays a whole game with bots in every seat; `check` runs after every action. */
export function simulate(seed: number, check?: (s: GameState) => void): GameState {
  const rng = mulberry32(seed);
  let s = createGame(players, rng);
  for (let i = 0; i < 3000 && s.phase !== 'gameOver'; i++) {
    const id = actors(s)[0];
    s = apply(s, id, botAction(viewFor(s, id), rng));
    check?.(s);
  }
  return s;
}

describe('bots', () => {
  it('play complete games against each other with legal moves only', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const s = simulate(seed);
      expect(s.phase).toBe('gameOver');
      expect(s.winner).toMatch(/jack|police/);
    }
  });

  it("the police's deductions always include Jack's true location, and his hideout", () => {
    for (let seed = 11; seed <= 14; seed++) {
      simulate(seed, (s) => {
        const loc = jackLocation(s);
        const t = s.trails.find((tr) => tr.night === s.night);
        if (s.phase === 'gameOver' || loc === null || !t || t.escaped) return;
        const belief = believe(s.trails, s.night, s.alleys)!;
        expect(belief.location.get(loc) ?? 0).toBeGreaterThan(0);
        for (const c of s.sheet[s.night - 1]) if (c !== null && !t.scenes.includes(c)) expect(belief.visited.get(c) ?? 0).toBeGreaterThan(0);
        expect(hideoutCandidates(s.trails)).toContain(s.hideout);
      });
    }
  });

  it('every difficulty level plays complete games with legal moves, final guess included', () => {
    for (const [i, level] of BOT_LEVELS.entries()) {
      const rng = mulberry32(100 + i);
      let s = createGame(players, rng, { finalGuess: true });
      let guessed = false;
      for (let n = 0; n < 4000 && s.phase !== 'gameOver'; n++) {
        const id = actors(s)[0];
        if (s.phase === 'hideoutGuess') guessed = true;
        s = apply(s, id, botAction(viewFor(s, id), rng, level));
      }
      expect(s.phase).toBe('gameOver');
      if (guessed) expect(s.events!.at(-1)!.kind).toBe('raid');
    }
  }, 60_000);

  it('the hideout belief always keeps the true hideout possible', () => {
    simulate(21, (s) => {
      if (!s.trails.some((t) => t.escaped)) return;
      expect(hideoutBelief(s.trails).get(s.hideout!) ?? 0).toBeGreaterThan(0);
    });
  });

  it('detective bots only see the detective view', () => {
    let s = createGame(players, mulberry32(3));
    s = apply(s, 'j', botAction(viewFor(s, 'j')));
    const v = viewFor(s, 'd1');
    expect(v.hideout).toBeNull();
    expect(v.sheet).toBeNull();
    expect(v.jackLocation).toBeNull();
  });
});
