import { LAST_SLOT, NIGHTS, type Action, type Trail } from '../engine/types.ts';
import type { GameView } from '../engine/view.ts';
import { CIRCLE_IDS, RED_CIRCLES, alleyDestinations, circleNeighbors, coachRoutes } from '../map/graph.ts';
import { alleyDist, minBy, reachCircle, shuffle, sum, walkDist } from './geo.ts';
import { believe } from './inference.ts';

type Rng = () => number;

/**
 * Jack plays against the police's own reasoning: for every possible move he works out what the
 * detectives can deduce from it (the same inference the detective bots use) and prefers moves
 * that keep him hidden among many possible locations, away from policemen, with time to get home.
 */
export function jackBotAction(v: GameView, rng: Rng): Action {
  switch (v.phase) {
    case 'hideout': return { type: 'chooseHideout', circle: chooseHideout(rng) };
    case 'women': return placeWomen(v, rng);
    case 'kill': return killOrWait(v, rng);
    case 'reveal': return reveal(v);
    case 'jackMove': return move(v, rng);
    default: throw new Error(`Jack has nothing to do in phase ${v.phase}`);
  }
}

/** A hideout from which every red circle is within easy reach (random among the best, so it is not predictable). */
function chooseHideout(rng: Rng): number {
  const scored = CIRCLE_IDS.filter((c) => !RED_CIRCLES.includes(c))
    .map((c) => ({ c, d: sum(RED_CIRCLES.map((r) => walkDist(c, r))) / RED_CIRCLES.length }))
    .sort((a, b) => a.d - b.d);
  return scored[Math.floor(rng() * Math.min(30, scored.length))].c;
}

/** Marked women a comfortable distance from home: close enough to get back, not so close the route gives it away. */
function placeWomen(v: GameView, rng: Rng): Action {
  const r = NIGHTS[v.night - 1];
  const free = RED_CIRCLES.filter((c) => !v.crimeScenes.some((cs) => cs.circle === c));
  const ranked = free
    .map((c) => ({ c, s: Math.abs(walkDist(c, v.hideout!) - 5) + rng() * 3 }))
    .sort((a, b) => a.s - b.s)
    .map((x) => x.c);
  return { type: 'placeWomen', circles: ranked.slice(0, r.women), marked: ranked.slice(0, r.marked) };
}

/** How dangerous it is to kill on `w`: patrols that could reach it, and how far home is. */
function victimRisk(v: GameView, w: number): number {
  const hidden = v.patrols.filter((p) => !p.revealed);
  const realLeft = 5 - v.patrols.filter((p) => p.revealed && p.color).length;
  let threat = 0;
  for (const p of v.patrols) {
    const real = p.revealed ? (p.color ? 1 : 0) : realLeft / Math.max(1, hidden.length);
    const d = reachCircle(p.crossing, w);
    threat += real * (d <= 1 ? 1 : d === 2 ? 0.4 : 0);
  }
  const left = LAST_SLOT - v.timeOfCrime! - NIGHTS[v.night - 1].kills + 1;
  const home = walkDist(w, v.hideout!);
  return 2 * threat + 3 * Math.max(0, home - (left - 4)) + 0.1 * home;
}

function killOrWait(v: GameView, rng: Rng): Action {
  const kills = NIGHTS[v.night - 1].kills;
  const ranked = [...v.wretched].sort((a, b) => victimRisk(v, a) - victimRisk(v, b));
  const best = victimRisk(v, ranked[0]);
  const mustKill = v.timeOfCrime! >= 4;
  if (!mustKill && best > 1 && v.timeOfCrime! < 3 && rng() < 0.75) return { type: 'wait' };
  // Jack ends on the last victim, so the safest one goes last
  return { type: 'kill', victims: ranked.slice(0, kills).reverse() };
}

/** Reveal the hidden patrol closest to the victim he has in mind. */
function reveal(v: GameView): Action {
  const target = minBy(v.wretched, (w) => victimRisk(v, w)) ?? v.wretched[0];
  const p = minBy(v.patrols.filter((pp) => !pp.revealed), (pp) => reachCircle(pp.crossing, target))!;
  return { type: 'revealPatrol', crossing: p.crossing };
}

interface Option { action: Action; to: number; kind: Trail['moves'][number]['kind']; slot: number }

function move(v: GameView, rng: Rng): Action {
  const loc = v.jackLocation!;
  const slot = v.track!;
  const home = v.hideout!;
  const police = Object.values(v.policemen) as number[];

  const walks = circleNeighbors(loc, new Set(police));
  if (walks.includes(home)) return { type: 'jackMove', to: home, escape: true };

  const options: Option[] = walks.map((to) => ({ action: { type: 'jackMove', to }, to, kind: 'walk', slot: slot + 1 }));
  if (v.coaches > 0 && slot + 2 <= LAST_SLOT) {
    const seen = new Set<number>();
    for (const [via, to] of shuffle(coachRoutes(loc), rng)) {
      if (seen.has(to)) continue;
      seen.add(to);
      options.push({ action: { type: 'coach', via, to }, to, kind: 'coach', slot: slot + 2 });
    }
  }
  if (v.alleys > 0) for (const to of alleyDestinations(loc)) options.push({ action: { type: 'alley', to }, to, kind: 'alley', slot: slot + 1 });

  // what the police would believe after each kind of move
  const beliefs = new Map<Option['kind'], Map<number, number> | null>();
  for (const kind of new Set(options.map((o) => o.kind))) {
    const trails = v.trails.map((t) => t.night !== v.night ? t : {
      ...t, moves: [...t.moves, { slot: kind === 'coach' ? slot + 2 : slot + 1, kind, blocked: kind === 'walk' ? police : [] }],
    });
    beliefs.set(kind, believe(trails, v.night, v.alleys - (kind === 'alley' ? 1 : 0))?.location ?? null);
  }

  const score = (o: Option) => {
    const p = beliefs.get(o.kind)?.get(o.to) ?? 0.1;
    const chasers = police.filter((x) => reachCircle(x, o.to) <= 2).length;
    const risk = chasers ? p * (1 + 0.25 * (chasers - 1)) : 0.05 * p;
    const left = LAST_SLOT - o.slot;
    const slack = left - walkDist(o.to, home);
    const alleysLeft = v.alleys - (o.kind === 'alley' ? 1 : 0);
    const late = slack >= 0 ? 1.5 / (1 + slack) : alleysLeft > 0 && left - alleyDist(o.to, home) >= 0 ? 2.5 : 50;
    const token = o.kind === 'coach' ? 0.35 : o.kind === 'alley' ? 0.3 : 0;
    return 8 * risk + 1.5 * p + late + token + rng() * 0.1;
  };
  return minBy(options, score)!.action;
}
