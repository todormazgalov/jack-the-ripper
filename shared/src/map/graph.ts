import raw from './whitechapel.json' with { type: 'json' };

/**
 * Board graph for Whitechapel.
 *
 * Node keys: `C<n>` numbered circle (1..195), `X<n>` crossing (police squares),
 * `J<n>` plain line junction (a point where dotted lines merge without a crossing;
 * transparent for every rule).
 */
export interface Circle { id: number; x: number; y: number; red: boolean }
export interface Crossing { id: number; x: number; y: number; yellow: boolean; goulston: boolean }
export interface Junction { id: number; x: number; y: number }
export interface MapData {
  board: { image: string; width: number; height: number };
  circles: Circle[];
  crossings: Crossing[];
  junctions: Junction[];
  edges: [string, string][];
  blocks: number[][];
}

const num = (k: string) => Number(k.slice(1));

/** Builds the movement queries for a map (the game uses MAP; the map editor uses its working copy). */
export function makeGraph(map: MapData) {
  const adj = new Map<string, string[]>();
  for (const [a, b] of map.edges) {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  }
  const nb = (k: string) => adj.get(k) ?? [];

  /** Walk from `start` through nodes accepted by `pass`, collecting the nodes accepted by `collect` (not walked through). */
  function walk(start: string, collect: (k: string) => boolean, pass: (k: string) => boolean): number[] {
    const seen = new Set([start]);
    const stack = [start];
    const out = new Set<number>();
    while (stack.length) {
      const u = stack.pop()!;
      for (const w of nb(u)) {
        if (seen.has(w)) continue;
        seen.add(w);
        if (collect(w)) out.add(num(w));
        else if (pass(w)) stack.push(w);
      }
    }
    return [...out].sort((a, b) => a - b);
  }
  const cached = <T>(fn: (n: number) => T) => {
    const cache = new Map<number, T>();
    return (n: number): T => {
      if (!cache.has(n)) cache.set(n, fn(n));
      return cache.get(n)!;
    };
  };

  /**
   * Circles reachable from circle `from` along dotted lines without passing another circle
   * and without passing any crossing in `blocked` (policemen / patrol tokens).
   */
  const circleNeighbors = (from: number, blocked: ReadonlySet<number> = new Set()) =>
    walk(`C${from}`, (k) => k[0] === 'C', (k) => !(k[0] === 'X' && blocked.has(num(k))));

  /** Unblocked circle adjacency. */
  const adjacentCircles = cached((c) => circleNeighbors(c));

  /** Crossings one police step away from crossing `x` (numbered circles and junctions are ignored). */
  const crossingSteps = cached((x) => walk(`X${x}`, (k) => k[0] === 'X', () => true));

  /** Circles directly connected to crossing `x` (no intervening crossing or circle). */
  const circlesAroundCrossing = cached((x) => walk(`X${x}`, (k) => k[0] === 'C', (k) => k[0] === 'J'));

  /** Crossings a policeman on `x` may end on, moving 0..maxSteps crossings (passing others is allowed). */
  function policeDestinations(x: number, maxSteps = 2): number[] {
    const out = new Set([x]);
    let frontier = [x];
    for (let s = 0; s < maxSteps; s++) {
      const next: number[] = [];
      for (const f of frontier) for (const y of crossingSteps(f)) if (!out.has(y)) { out.add(y); next.push(y); }
      frontier = next;
    }
    return [...out].sort((a, b) => a - b);
  }

  /** Circles reachable with an Alley move: any other circle on the perimeter of a block that `c` borders. */
  const alleyDestinations = cached((c) => {
    const out = new Set<number>();
    for (const b of map.blocks) if (b.includes(c)) for (const o of b) if (o !== c) out.add(o);
    return [...out].sort((a, b) => a - b);
  });

  /** Coach move options from `c`: two successive adjacent circles, ignoring policemen. */
  function coachRoutes(c: number): [number, number][] {
    const out: [number, number][] = [];
    for (const a of adjacentCircles(c)) for (const b of adjacentCircles(a)) if (b !== c && b !== a) out.push([a, b]);
    return out;
  }

  return { circleNeighbors, adjacentCircles, crossingSteps, circlesAroundCrossing, policeDestinations, alleyDestinations, coachRoutes };
}

export const MAP = raw as unknown as MapData;

export const CIRCLE_IDS = MAP.circles.map((c) => c.id);
export const CROSSING_IDS = MAP.crossings.map((c) => c.id);
export const RED_CIRCLES = MAP.circles.filter((c) => c.red).map((c) => c.id);
export const YELLOW_CROSSINGS = MAP.crossings.filter((c) => c.yellow).map((c) => c.id);
export const GOULSTON_CROSSING = MAP.crossings.find((c) => c.goulston)?.id ?? null;

export const circleById = new Map(MAP.circles.map((c) => [c.id, c]));
export const crossingById = new Map(MAP.crossings.map((c) => [c.id, c]));

export const {
  circleNeighbors, adjacentCircles, crossingSteps, circlesAroundCrossing, policeDestinations, alleyDestinations, coachRoutes,
} = makeGraph(MAP);
