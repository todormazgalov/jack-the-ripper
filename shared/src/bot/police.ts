import { arrestTargets, legalWretchedMoves, policeMoveTargets, searchTargets } from '../engine/engine.ts';
import { COLORS, type Action, type Color, type GameState } from '../engine/types.ts';
import type { GameView } from '../engine/view.ts';
import { YELLOW_CROSSINGS, circlesAroundCrossing } from '../map/graph.ts';
import { minBy, reachCircle, shuffle, sum } from './geo.ts';
import { believe, hideoutCandidates, type Belief } from './inference.ts';

type Rng = () => number;

/**
 * Detectives deduce every place Jack can be from what they have seen (see inference.ts), then
 * close in on the likely locations, search where his trail probably passed and arrest when sure enough.
 * They only use the detectives' view of the game.
 */
export function policeBotAction(v: GameView, rng: Rng): Action {
  switch (v.phase) {
    case 'patrols': return placePatrols(v, rng);
    case 'wretched': return moveWretched(v, rng);
    case 'policeMove': return movePoliceman(v, rng);
    case 'policeAction': return investigate(v);
    default: throw new Error(`The police have nothing to do in phase ${v.phase}`);
  }
}

/** The engine's query helpers only read public fields, which the view has too. */
const asState = (v: GameView) => v as unknown as GameState;

const hideouts = (v: GameView) => hideoutCandidates(v.trails.filter((t) => t.night !== v.night));

/** How well a policeman on `x` watches over the circles in `targets` (and the possible hideouts once few are left). */
function coverage(x: number, targets: number[], homes: number[]) {
  const near = sum(targets.map((c) => 1 / (1 + reachCircle(x, c))));
  const guard = homes.length <= 15 ? sum(homes.map((h) => 1 / (1 + reachCircle(x, h)))) / homes.length : 0;
  return near + 2 * guard;
}

function placePatrols(v: GameView, rng: Rng): Action {
  const women = v.women.map((w) => w.circle);
  const homes = hideouts(v);
  const value = (x: number) => coverage(x, women, homes) + rng() * 0.3;
  let crossings: number[];
  if (v.night === 1) crossings = [...YELLOW_CROSSINGS];
  else {
    const kept = Object.values(v.policemen) as number[];
    const extra = YELLOW_CROSSINGS.filter((x) => !kept.includes(x)).sort((a, b) => value(b) - value(a)).slice(0, 2);
    crossings = [...kept, ...extra];
  }
  // real policemen where they watch the most women, fakes on the rest
  const ranked = crossings.map((x) => ({ x, s: value(x) })).sort((a, b) => b.s - a.s).map((e) => e.x);
  const colors = shuffle([...COLORS], rng);
  return { type: 'placePatrols', patrols: ranked.map((crossing, i) => ({ crossing, color: i < 5 ? colors[i] : null })) };
}

/** Lead each wretched towards the real policemen, so the murder happens under their noses. */
function moveWretched(v: GameView, rng: Rng): Action {
  const from = v.wretchedPending[0];
  const real = v.patrols.filter((p) => p.color && p.color !== 'hidden').map((p) => p.crossing);
  const near = (c: number) => (real.length ? Math.min(...real.map((x) => reachCircle(x, c))) : 0);
  const to = minBy(legalWretchedMoves(asState(v), from), (c) => near(c) + rng() * 0.5)!;
  return { type: 'moveWretched', from, to };
}

const clueless = (v: GameView, c: number) => !v.clues.includes(c) && !v.crimeScenes.some((cs) => cs.circle === c);

function movePoliceman(v: GameView, rng: Rng): Action {
  const color = v.pendingColors[0];
  const belief = believe(v.trails, v.night, v.alleys);
  const targets = policeMoveTargets(asState(v), color);
  if (!belief) return { type: 'policeMove', color, to: v.policemen[color]! };

  const loc = [...belief.location];
  const watched = new Set(
    (Object.entries(v.policemen) as [Color, number][]).filter(([c]) => c !== color).flatMap(([, x]) => circlesAroundCrossing(x)),
  );
  const homes = hideouts(v);
  const score = (x: number) => {
    const around = circlesAroundCrossing(x);
    const arrest = sum(around.map((c) => (belief.location.get(c) ?? 0) * (watched.has(c) ? 0.3 : 1)));
    const search = Math.max(0, ...around.filter((c) => clueless(v, c)).map((c) => belief.visited.get(c) ?? 0));
    const chase = sum(loc.map(([c, p]) => p / (1 + reachCircle(x, c))));
    const guard = homes.length <= 15 ? sum(homes.map((h) => 1 / (1 + reachCircle(x, h)))) / homes.length : 0;
    return 4 * arrest + 2 * search + 1.5 * chase + guard + rng() * 0.05;
  };
  const to = minBy(targets, (x) => -score(x))!;
  return { type: 'policeMove', color, to };
}

/** Best search / arrest for one policeman. */
function options(v: GameView, belief: Belief, color: Color) {
  const gs = asState(v);
  const arrest = minBy(arrestTargets(gs, color), (c) => -(belief.location.get(c) ?? 0));
  const search = minBy(searchTargets(gs, color).filter((c) => clueless(v, c)), (c) => -(belief.visited.get(c) ?? 0));
  return {
    color,
    arrest, pArrest: arrest === undefined ? 0 : belief.location.get(arrest) ?? 0,
    search, pSearch: search === undefined ? 0 : belief.visited.get(search) ?? 0,
  };
}

function investigate(v: GameView): Action {
  const belief = believe(v.trails, v.night, v.alleys);
  const searching = v.turn?.searching;
  if (searching) {
    // a search goes on until a clue turns up: next most promising circle
    const left = searchTargets(asState(v), searching.color);
    const circle = minBy(left, (c) => -(belief?.visited.get(c) ?? 0))!;
    return { type: 'search', color: searching.color, circle };
  }
  const color0 = v.pendingColors[0];
  if (!belief) return { type: 'policeSkip', color: color0 };

  const opts = v.pendingColors.map((c) => options(v, belief, c));
  const best = minBy(opts, (o) => -Math.max(o.pArrest >= 0.3 ? 2 * o.pArrest : 0, o.pSearch))!;
  if (best.arrest !== undefined && best.pArrest >= 0.3) return { type: 'arrest', color: best.color, circle: best.arrest };
  if (best.search !== undefined && best.pSearch >= 0.05) return { type: 'search', color: best.color, circle: best.search };
  // nothing promising: a free shot at an arrest beats doing nothing
  const shot = minBy(opts, (o) => -o.pArrest)!;
  if (shot.arrest !== undefined && shot.pArrest > 0) return { type: 'arrest', color: shot.color, circle: shot.arrest };
  return { type: 'policeSkip', color: color0 };
}
