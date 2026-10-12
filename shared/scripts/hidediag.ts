/** How well the police can name the hideout after each night (bots on both sides). */
import { actors, apply, botAction, createGame, hideoutBelief, hideoutCandidates, viewFor, type BotLevel, type GameState, type Player } from '../src/index.ts';
function mulberry32(seed: number) { return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const players: Player[] = [
  { id: 'j', name: 'Jack', role: 'jack', colors: [] },
  { id: 'd1', name: 'Holmes', role: 'detective', colors: ['blue', 'yellow', 'brown'] },
  { id: 'd2', name: 'Watson', role: 'detective', colors: ['red', 'green'] },
];
const games = Number(process.argv[2] ?? 20);
const jl = (process.argv[3] ?? 'hard') as BotLevel;
const stats = [0, 1, 2, 3, 4].map(() => ({ n: 0, cands: 0, pTrue: 0, top1: 0, rank: 0 }));
const t0 = Date.now();
for (let seed = 1; seed <= games; seed++) {
  const rng = mulberry32(seed * 7919);
  let s: GameState = createGame(players, rng);
  let lastNight = 0;
  for (let i = 0; i < 5000 && s.phase !== 'gameOver'; i++) {
    const done = s.trails.filter((t) => t.escaped).length;
    if (done > lastNight) {
      lastNight = done;
      const b = hideoutBelief(s.trails);
      const ranked = [...b].sort((a, c) => c[1] - a[1]).map(([c]) => c);
      const st = stats[done];
      st.n++; st.cands += hideoutCandidates(s.trails).length; st.pTrue += b.get(s.hideout!) ?? 0;
      st.top1 += ranked[0] === s.hideout ? 1 : 0; st.rank += ranked.indexOf(s.hideout!) + 1;
    }
    const id = actors(s)[0];
    s = apply(s, id, botAction(viewFor(s, id), rng, id === 'j' ? jl : 'hard'));
  }
}
for (let n = 1; n <= 4; n++) {
  const st = stats[n];
  if (st.n) console.log(`after night ${n} (${st.n} games): candidates ${(st.cands / st.n).toFixed(1)}, P(true) ${(st.pTrue / st.n).toFixed(3)}, best guess right ${(100 * st.top1 / st.n).toFixed(0)}%, mean rank ${(st.rank / st.n).toFixed(1)}`);
}
console.log(`${((Date.now() - t0) / games).toFixed(0)} ms/game`);
