/**
 * Bot arena: plays bot-vs-bot games and prints win rates.
 *   npx tsx scripts/arena.ts [games=40] [jackLevel] [policeLevel]
 */
import { actors, apply, botAction, createGame, viewFor, type BotLevel, type GameState, type Player } from '../src/index.ts';

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

const games = Number(process.argv[2] ?? 40);
const jackLevel = process.argv[3] ?? 'hard';
const policeLevel = process.argv[4] ?? 'hard';
const reasons = new Map<string, number>();
let jackWins = 0;
let nights = 0;
const t0 = Date.now();
const seed0 = Number(process.env.SEED0 ?? 0);
for (let seed = seed0 + 1; seed <= seed0 + games; seed++) {
  const rng = mulberry32(seed * 7919);
  let s: GameState = createGame(players, rng, { finalGuess: process.env.GUESS !== '0' });
  for (let i = 0; i < 5000 && s.phase !== 'gameOver'; i++) {
    const id = actors(s)[0];
    const level = id === 'j' ? jackLevel : policeLevel;
    s = apply(s, id, botAction(viewFor(s, id), rng, level as BotLevel));
  }
  if (s.winner === 'jack') jackWins++;
  nights += s.night;
  const r = (s.winReason ?? '?').replace(/\d+/g, 'N');
  reasons.set(r, (reasons.get(r) ?? 0) + 1);
}
if (process.env.JSON) { console.log(JSON.stringify({ jackWins, games, reasons: Object.fromEntries(reasons) })); process.exit(0); }
console.log(`jack=${jackLevel} police=${policeLevel}: Jack won ${jackWins}/${games} (${Math.round((100 * jackWins) / games)}%), avg night reached ${(nights / games).toFixed(2)}, ${((Date.now() - t0) / games).toFixed(0)} ms/game`);
for (const [r, n] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`  ${n}x ${r}`);
