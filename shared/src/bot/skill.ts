/**
 * Bot difficulty. Every level uses the same deductions; lower levels add noise to their judgement
 * and sometimes make a plain mistake, Expert adds deeper planning (see jack.ts / police.ts).
 */
export type BotLevel = 'easy' | 'normal' | 'hard' | 'expert';
export const BOT_LEVELS: BotLevel[] = ['easy', 'normal', 'hard', 'expert'];
export const LEVEL_NAMES: Record<BotLevel, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard', expert: 'Expert' };

export interface Skill {
  level: BotLevel;
  /** random noise added to every score, as a fraction of the spread between the best and worst option */
  noise: number;
  /** chance of picking any reasonable option at random instead of the best one */
  blunder: number;
  /** deeper planning (team play for the police, look-ahead and hideout bluffing for Jack) */
  expert: boolean;
}

/**
 * Calibrated with scripts/arena.ts (200 games each, against a Hard opponent): Jack's win rate
 * against police of each level, and each Jack's win rate against Hard police.
 */
const SKILLS: Record<'jack' | 'detective', Record<BotLevel, Skill>> = {
  jack: {
    easy: { level: 'easy', noise: 0.8, blunder: 0.15, expert: false },
    normal: { level: 'normal', noise: 0.35, blunder: 0.08, expert: false },
    hard: { level: 'hard', noise: 0, blunder: 0, expert: false },
    expert: { level: 'expert', noise: 0, blunder: 0, expert: true },
  },
  detective: {
    easy: { level: 'easy', noise: 2, blunder: 0.4, expert: false },
    normal: { level: 'normal', noise: 1.2, blunder: 0.2, expert: false },
    hard: { level: 'hard', noise: 0, blunder: 0, expert: false },
    expert: { level: 'expert', noise: 0, blunder: 0, expert: true },
  },
};

export const skillOf = (level: BotLevel | undefined, role: 'jack' | 'detective'): Skill =>
  SKILLS[role][level ?? 'hard'] ?? SKILLS[role].hard;

/**
 * The option with the lowest score, judged with this skill: noise relative to the spread of the
 * scores, and now and then a blunder (a random option).
 */
export function choose<T>(xs: T[], score: (x: T) => number, sk: Skill, rng: () => number): T {
  if (xs.length <= 1) return xs[0];
  if (sk.blunder > 0 && rng() < sk.blunder) return xs[Math.floor(rng() * xs.length)];
  const scored = xs.map((x) => ({ x, s: score(x) }));
  const finite = scored.filter((e) => Number.isFinite(e.s));
  const spread = finite.length ? Math.max(...finite.map((e) => e.s)) - Math.min(...finite.map((e) => e.s)) : 0;
  let best = scored[0];
  let bs = Infinity;
  for (const e of scored) {
    const v = e.s + (sk.noise > 0 ? rng() * sk.noise * spread : 0);
    if (v < bs) { bs = v; best = e; }
  }
  return best.x;
}
