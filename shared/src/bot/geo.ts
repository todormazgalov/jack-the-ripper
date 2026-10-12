import {
  CIRCLE_IDS, CROSSING_IDS, adjacentCircles, alleyDestinations, circlesAroundCrossing, crossingSteps,
} from '../map/graph.ts';

/** Breadth-first distances from `sources` over `next`. */
export function bfs(sources: Iterable<number>, next: (n: number) => number[]): Map<number, number> {
  const dist = new Map<number, number>();
  let frontier: number[] = [];
  for (const s of sources) if (!dist.has(s)) { dist.set(s, 0); frontier.push(s); }
  for (let d = 1; frontier.length; d++) {
    const nx: number[] = [];
    for (const u of frontier) for (const w of next(u)) if (!dist.has(w)) { dist.set(w, d); nx.push(w); }
    frontier = nx;
  }
  return dist;
}

const memo = <T>(fn: (n: number) => T) => {
  const cache = new Map<number, T>();
  return (n: number): T => {
    if (!cache.has(n)) cache.set(n, fn(n));
    return cache.get(n)!;
  };
};

const FAR = 99;

/** Walking distance between circles, ignoring policemen. */
const walkFrom = memo((c) => bfs([c], adjacentCircles));
export const walkDist = (a: number, b: number) => walkFrom(a).get(b) ?? FAR;

/** Lower bound on Jack's moves between circles when alleys are allowed. */
const walkOrAlley = (c: number) => [...adjacentCircles(c), ...alleyDestinations(c)];
const alleyFrom = memo((c) => bfs([c], walkOrAlley));
export const alleyDist = (a: number, b: number) => alleyFrom(a).get(b) ?? FAR;

/** Fewest moves from `c` to any circle of `targets` (walking, plus alleys when allowed). */
export function distToSet(targets: Iterable<number>, alleys: boolean): Map<number, number> {
  return bfs(targets, alleys ? walkOrAlley : adjacentCircles);
}

/** Police steps between crossings. */
const stepsFrom = memo((x) => bfs([x], crossingSteps));
export const crossingDist = (a: number, b: number) => stepsFrom(a).get(b) ?? FAR;

/** Crossings whose policeman can search / arrest on circle `c`. */
const crossingsAround = (() => {
  const inv = new Map<number, number[]>(CIRCLE_IDS.map((c) => [c, []]));
  for (const x of CROSSING_IDS) for (const c of circlesAroundCrossing(x)) inv.get(c)?.push(x);
  return (c: number) => inv.get(c) ?? [];
})();
export { crossingsAround };

/** Police steps a policeman on crossing `x` needs before he can arrest on circle `c` (0: right now). */
export function reachCircle(x: number, c: number): number {
  let best = FAR;
  for (const y of crossingsAround(c)) best = Math.min(best, crossingDist(x, y));
  return best;
}

export const sum = (xs: Iterable<number>) => { let t = 0; for (const x of xs) t += x; return t; };

export function shuffle<T>(xs: T[], rng: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Item with the lowest score (ties keep the first). */
export function minBy<T>(xs: T[], score: (x: T) => number): T | undefined {
  let best: T | undefined;
  let bs = Infinity;
  for (const x of xs) { const v = score(x); if (v < bs) { bs = v; best = x; } }
  return best;
}
