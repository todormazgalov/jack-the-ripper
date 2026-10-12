import { LAST_SLOT, type Trail } from '../engine/types.ts';
import { CIRCLE_IDS, RED_CIRCLES, adjacentCircles, alleyDestinations, circleNeighbors } from '../map/graph.ts';
import { distToSet } from './geo.ts';

/**
 * Where can Jack be? Exact reasoning over everything the police know (the public Trail):
 * every route that starts on a crime scene, follows the recorded kinds of moves (walks cannot pass
 * the policemen of that moment), passes each clue in time and avoids every circle searched in vain.
 * Routes are counted, so circles reached by many routes are more likely.
 */
export interface Belief {
  /** probability of each circle being Jack's current location */
  location: Map<number, number>;
  /** probability that Jack's route tonight passed each circle (what a search would find) */
  visited: Map<number, number>;
}

/** Clue constraints tracked exactly (each one doubles the work); older clues beyond this are dropped. */
const MAX_CLUES = 6;

interface Step { slot: number; next: (loc: number) => number[] }

function steps(trail: Trail): Step[] {
  const out: Step[] = [];
  for (const m of trail.moves) {
    if (m.kind === 'walk') {
      const blocked = new Set(m.blocked);
      out.push({ slot: m.slot, next: (c) => circleNeighbors(c, blocked) });
    } else if (m.kind === 'alley') {
      out.push({ slot: m.slot, next: alleyDestinations });
    } else {
      out.push({ slot: m.slot - 1, next: adjacentCircles }, { slot: m.slot, next: adjacentCircles });
    }
  }
  return out;
}

/** Forward-backward over (circle, clues passed). `finalWeight` scores the current location (e.g. can he still get home?). */
function analyze(trail: Trail, finalWeight: (loc: number) => number, useClues = true): Belief | null {
  const clues = useClues
    ? trail.checks.filter((c) => c.result === 'clue' && !trail.scenes.includes(c.circle)).slice(-MAX_CLUES)
    : [];
  const K = 1 << clues.length;
  const full = K - 1;
  const nothingUpTo = new Map<number, number>();
  const absent = new Set<string>();
  for (const c of trail.checks) {
    if (c.result === 'nothing') nothingUpTo.set(c.circle, Math.max(nothingUpTo.get(c.circle) ?? -1, c.slot));
    if (c.result === 'absent') absent.add(`${c.slot}:${c.circle}`);
  }
  const allowed = (loc: number, slot: number) => (nothingUpTo.get(loc) ?? -1) < slot && !absent.has(`${slot}:${loc}`);
  const enter = (loc: number, slot: number, mask: number) => {
    clues.forEach((c, i) => { if (c.circle === loc && slot <= c.slot) mask |= 1 << i; });
    return mask;
  };

  const st = steps(trail);
  const alpha: Map<number, number>[] = [new Map()];
  for (const sc of trail.scenes) if (allowed(sc, trail.start)) alpha[0].set(sc * K + enter(sc, trail.start, 0), 1);
  const nextCache: Map<number, number[]>[] = st.map(() => new Map());
  const nexts = (i: number, loc: number) => {
    let ns = nextCache[i].get(loc);
    if (!ns) nextCache[i].set(loc, (ns = st[i].next(loc).filter((n) => allowed(n, st[i].slot))));
    return ns;
  };

  for (let i = 0; i < st.length; i++) {
    const nx = new Map<number, number>();
    for (const [key, w] of alpha[i]) {
      const loc = Math.floor(key / K);
      const mask = key % K;
      for (const n of nexts(i, loc)) {
        const k2 = n * K + enter(n, st[i].slot, mask);
        nx.set(k2, (nx.get(k2) ?? 0) + w);
      }
    }
    normalize(nx);
    alpha.push(nx);
  }

  // backward pass
  const last = alpha.length - 1;
  const beta: Map<number, number>[] = [];
  beta[last] = new Map();
  for (const key of alpha[last].keys()) {
    if (key % K !== full) continue;
    const w = finalWeight(Math.floor(key / K));
    if (w > 0) beta[last].set(key, w);
  }
  if (beta[last].size === 0) return null;
  for (let i = last - 1; i >= 0; i--) {
    const b = new Map<number, number>();
    for (const key of alpha[i].keys()) {
      const loc = Math.floor(key / K);
      const mask = key % K;
      let t = 0;
      for (const n of nexts(i, loc)) t += beta[i + 1].get(n * K + enter(n, st[i].slot, mask)) ?? 0;
      if (t > 0) b.set(key, t);
    }
    normalize(b);
    beta[i] = b;
  }

  const notVisited = new Map<number, number>();
  let location = new Map<number, number>();
  for (let i = 0; i <= last; i++) {
    const here = new Map<number, number>();
    for (const [key, a] of alpha[i]) {
      const g = a * (beta[i].get(key) ?? 0);
      if (g > 0) here.set(Math.floor(key / K), (here.get(Math.floor(key / K)) ?? 0) + g);
    }
    normalize(here);
    for (const [c, p] of here) notVisited.set(c, (notVisited.get(c) ?? 1) * (1 - p));
    location = here;
  }
  const visited = new Map([...notVisited].map(([c, q]) => [c, 1 - q]));
  return { location, visited };
}

function normalize(m: Map<number, number>) {
  let t = 0;
  for (const v of m.values()) t += v;
  if (t > 0) for (const [k, v] of m) m.set(k, v / t);
}

const cache = new Map<string, Belief | null>();
function cached(key: string, fn: () => Belief | null): Belief | null {
  if (cache.has(key)) return cache.get(key)!;
  const out = fn();
  if (cache.size > 500) cache.clear();
  cache.set(key, out);
  return out;
}

const NON_RED = CIRCLE_IDS.filter((c) => !RED_CIRCLES.includes(c));

/** Circles that can still be Jack's hideout: he ended every finished night on it. */
export function hideoutCandidates(trails: Trail[]): number[] {
  let cands = NON_RED;
  for (const t of trails) {
    if (!t.escaped) continue;
    const b = cached(`end|${JSON.stringify(t)}`, () => analyze(t, () => 1) ?? analyze(t, () => 1, false));
    if (!b) continue;
    const next = cands.filter((c) => (b.location.get(c) ?? 0) > 0);
    if (next.length) cands = next;
  }
  return cands;
}

/**
 * The police's belief about tonight. `alleys`: alley tokens Jack has left (they let him get home faster).
 * Jack must still be able to reach one of the hideout candidates before the end of the track,
 * and he tends to head home, so locations nearer to a candidate weigh a little more.
 */
export function believe(trails: Trail[], night: number, alleys: number): Belief | null {
  const trail = trails.find((t) => t.night === night);
  if (!trail) return null;
  const slot = trail.moves.at(-1)?.slot ?? trail.start;
  const hideouts = hideoutCandidates(trails.filter((t) => t.night !== night));
  return cached(`now|${alleys}|${hideouts.length}|${JSON.stringify(trails)}`, () => {
    const home = distToSet(hideouts, alleys > 0);
    const left = LAST_SLOT - slot;
    const reachable = (c: number) => { const d = home.get(c) ?? 99; return d <= left ? 0.9 ** d : 0; };
    return analyze(trail, reachable) ?? analyze(trail, () => 1) ?? analyze(trail, () => 1, false);
  });
}
