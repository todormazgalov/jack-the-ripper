import { arrestTargets, legalWretchedMoves, policeMoveTargets, searchTargets } from '../engine/engine.ts';
import { COLORS, LAST_SLOT, type Action, type Color, type GameState } from '../engine/types.ts';
import type { GameView } from '../engine/view.ts';
import {
  CIRCLE_IDS, RED_CIRCLES, YELLOW_CROSSINGS, adjacentCircles, circleNeighbors, circlesAroundCrossing, policeDestinations,
} from '../map/graph.ts';
import { minBy, reachCircle, shuffle, sum } from './geo.ts';
import { believe, hideoutBelief, hideoutCandidates, type Belief } from './inference.ts';
import { choose, type Skill } from './skill.ts';

type Rng = () => number;


/**
 * Detectives deduce every place Jack can be from what they have seen (see inference.ts), then
 * close in on the likely locations, search where his trail probably passed and arrest when sure enough.
 * Expert plans all its policemen together and walls in the likely hideouts.
 * They only use the detectives' view of the game.
 */
export function policeBotAction(v: GameView, rng: Rng, sk: Skill): Action {
  switch (v.phase) {
    case 'patrols': return placePatrols(v, rng, sk);
    case 'wretched': return moveWretched(v, rng, sk);
    case 'policeMove': return sk.expert ? planMoves(v, rng) : movePoliceman(v, rng, sk);
    case 'policeAction': return investigate(v, rng, sk);
    case 'hideoutGuess': return guessHideout(v, rng, sk);
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

function placePatrols(v: GameView, rng: Rng, sk: Skill): Action {
  const women = v.women.map((w) => w.circle);
  const homes = hideouts(v);
  const noise = sk.level === 'easy' ? 3 : sk.level === 'normal' ? 1 : 0.3;
  const value = (x: number) => coverage(x, women, homes) + rng() * noise;
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
function moveWretched(v: GameView, rng: Rng, sk: Skill): Action {
  const from = v.wretchedPending[0];
  const real = v.patrols.filter((p) => p.color && p.color !== 'hidden').map((p) => p.crossing);
  const near = (c: number) => (real.length ? Math.min(...real.map((x) => reachCircle(x, c))) : 0);
  const to = choose(legalWretchedMoves(asState(v), from), (c) => near(c) + rng() * 0.5, sk, rng);
  return { type: 'moveWretched', from, to };
}

const clueless = (v: GameView, c: number) => !v.clues.includes(c) && !v.crimeScenes.some((cs) => cs.circle === c);

function movePoliceman(v: GameView, rng: Rng, sk: Skill): Action {
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
  const to = choose(targets, (x) => -score(x), sk, rng);
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

function investigate(v: GameView, rng: Rng, sk: Skill): Action {
  const belief = believe(v.trails, v.night, v.alleys);
  const searching = v.turn?.searching;
  if (searching) {
    // a search goes on until a clue turns up: next most promising circle
    const left = searchTargets(asState(v), searching.color);
    const circle = choose(left, (c) => -(belief?.visited.get(c) ?? 0), sk, rng);
    return { type: 'search', color: searching.color, circle };
  }
  const color0 = v.pendingColors[0];
  if (!belief) return { type: 'policeSkip', color: color0 };

  // lower levels are more timid about arresting and sometimes just poke around
  const nerve = sk.level === 'easy' ? 0.55 : sk.level === 'normal' ? 0.4 : 0.3;
  if (sk.blunder > 0 && rng() < sk.blunder) {
    const c = v.pendingColors[Math.floor(rng() * v.pendingColors.length)];
    const any = searchTargets(asState(v), c);
    if (any.length) return { type: 'search', color: c, circle: any[Math.floor(rng() * any.length)] };
  }
  const opts = v.pendingColors.map((c) => options(v, belief, c));
  const best = minBy(opts, (o) => -Math.max(o.pArrest >= nerve ? 2 * o.pArrest : 0, o.pSearch))!;
  if (best.arrest !== undefined && best.pArrest >= nerve) return { type: 'arrest', color: best.color, circle: best.arrest };
  if (best.search !== undefined && best.pSearch >= 0.05) return { type: 'search', color: best.color, circle: best.search };
  // nothing promising: a free shot at an arrest beats doing nothing
  const shot = minBy(opts, (o) => -o.pArrest)!;
  if (shot.arrest !== undefined && shot.pArrest > 0) return { type: 'arrest', color: shot.color, circle: shot.arrest };
  return { type: 'policeSkip', color: color0 };
}

// ---------------------------------------------------------------- Expert

/** The likely locations, trimmed to the ones that matter. */
function topLocations(b: Belief, n = 70): [number, number][] {
  return [...b.location].filter(([, p]) => p > 0.002).sort((a, b2) => b2[1] - a[1]).slice(0, n);
}

/**
 * Expert team move: plan where all of this detective's waiting policemen should go, then move the
 * first of them (the others follow on the next calls, re-planned from the fresh position).
 * Each policeman is scored like the Hard bot but against the planned team (no two watching the
 * same circles), and the team seals the likely hideouts: Jack's last move home must be a walk, so
 * a hideout with every street around it held by a policeman cannot be reached at all.
 * (Weights tuned with scripts/arena.ts: against a Hard Jack this halves his wins compared to Hard police.)
 */
function planMoves(v: GameView, rng: Rng): Action {
  const mine = v.pendingColors;
  const color = mine[0];
  const belief = believe(v.trails, v.night, v.alleys);
  if (!belief) return { type: 'policeMove', color, to: v.policemen[color]! };

  const locs = topLocations(belief);
  const homeW = hideoutBelief(v.trails.filter((t) => t.night !== v.night));
  const ranked = [...homeW].sort((a, b) => b[1] - a[1]);
  const others = (Object.entries(v.policemen) as [Color, number][]).filter(([c]) => !mine.includes(c)).map(([, x]) => x);
  const trail = v.trails.find((t) => t.night === v.night);
  const slot = trail?.moves.at(-1)?.slot ?? trail?.start ?? 0;
  const late = LAST_SLOT - slot <= 5;
  const finished = v.trails.some((t) => t.escaped);
  const guardHomes = finished && ranked.length <= 30 ? ranked.slice(0, 10) : [];
  const sealable = finished ? ranked.slice(0, 6).filter(([, p]) => p >= 0.05) : [];
  const sealWeight = 10 * (v.night === 4 ? 2 : 1) * (late ? 1.5 : 1);

  const value = (posts: number[]) => {
    let total = 0;
    posts.forEach((x, i) => {
      const watched = new Set(posts.filter((_, j) => j !== i).flatMap((y) => circlesAroundCrossing(y)));
      const around = circlesAroundCrossing(x);
      const arrest = sum(around.map((c) => (belief.location.get(c) ?? 0) * (watched.has(c) ? 0.3 : 1)));
      const search = Math.max(0, ...around.filter((c) => clueless(v, c)).map((c) => belief.visited.get(c) ?? 0));
      const chase = sum(locs.map(([c, p]) => p / (1 + reachCircle(x, c))));
      // late in the night: stand between Jack and the likely hideouts
      const guard = late ? sum(guardHomes.map(([h, p]) => p / (1 + reachCircle(x, h)))) : 0;
      total += 4 * arrest + 2 * search + 1.5 * chase + 0.8 * guard;
    });
    const blocked = new Set(posts);
    const seal = sum(sealable.map(([h, p]) => {
      const open = circleNeighbors(h, blocked).length;
      return p * (open === 0 ? 1 : 0.25 * (1 - open / adjacentCircles(h).length));
    }));
    return total + sealWeight * seal;
  };

  // coordinate ascent over this detective's policemen
  const plan = new Map<Color, number>(mine.map((c) => [c, v.policemen[c]!]));
  for (let pass = 0; pass < 2; pass++) {
    for (const c of mine) {
      const taken = new Set([...others, ...mine.filter((m) => m !== c).map((m) => plan.get(m)!)]);
      const choices = policeDestinations(v.policemen[c]!).filter((x) => !taken.has(x));
      let best = plan.get(c)!;
      let bv = -Infinity;
      for (const x of choices) {
        const val = value([...others, ...mine.map((m) => (m === c ? x : plan.get(m)!))]) + rng() * 1e-3;
        if (val > bv) { bv = val; best = x; }
      }
      plan.set(c, best);
    }
  }
  // the engine wants one move at a time: make sure the first one is legal right now
  const to = plan.get(color)!;
  return { type: 'policeMove', color, to: policeMoveTargets(asState(v), color).includes(to) ? to : v.policemen[color]! };
}

/** The final raid: the most likely hideout (lower levels guess more loosely). */
function guessHideout(v: GameView, rng: Rng, sk: Skill): Action {
  const belief = [...hideoutBelief(v.trails)].sort((a, b) => b[1] - a[1]);
  if (!belief.length) return { type: 'guessHideout', circle: CIRCLE_IDS.find((c) => !RED_CIRCLES.includes(c))! };
  if (sk.level === 'easy') return { type: 'guessHideout', circle: belief[Math.floor(rng() * belief.length)][0] };
  if (sk.level === 'normal') {
    // weighted draw among the likely ones
    let r = rng() * sum(belief.map(([, p]) => p));
    for (const [c, p] of belief) { r -= p; if (r <= 0) return { type: 'guessHideout', circle: c }; }
  }
  return { type: 'guessHideout', circle: belief[0][0] };
}

