import { CRIME_START, LAST_SLOT, NIGHTS, type Action, type Trail } from '../engine/types.ts';
import type { GameView } from '../engine/view.ts';
import { CIRCLE_IDS, RED_CIRCLES, YELLOW_CROSSINGS, adjacentCircles, alleyDestinations, circleNeighbors, coachRoutes } from '../map/graph.ts';
import { alleyDist, minBy, reachCircle, shuffle, sum, walkDist } from './geo.ts';
import { believe, hideoutBelief } from './inference.ts';
import { choose, type Skill } from './skill.ts';

type Rng = () => number;

/** Expert Jack's tuning (scripts/arena.ts against Expert police). */
const URGENCY = 10; // how much he hurries once the police can tell where home is
const BLUFF = 0.3; // chance of walking past home (when a detour is safe), so "he escapes at once" cannot be relied on
const MIN_DETOUR = 4; // moves he must have left to risk a detour

/**
 * Jack plays against the police's own reasoning: for every possible move he works out what the
 * detectives can deduce from it (the same inference the detective bots use) and prefers moves
 * that keep him hidden among many possible locations, away from policemen, with time to get home.
 * Expert also predicts where the police will strike next, keeps escape routes open and, when
 * going home would give his hideout away, takes a detour first.
 */
export function jackBotAction(v: GameView, rng: Rng, sk: Skill): Action {
  switch (v.phase) {
    case 'hideout': return { type: 'chooseHideout', circle: chooseHideout(rng, sk) };
    case 'women': return placeWomen(v, rng, sk);
    case 'kill': return killOrWait(v, rng, sk);
    case 'reveal': return reveal(v);
    case 'jackMove': return move(v, rng, sk);
    default: throw new Error(`Jack has nothing to do in phase ${v.phase}`);
  }
}

/** A hideout from which every red circle is within easy reach (random among the best, so it is not predictable). */
function chooseHideout(rng: Rng, sk: Skill): number {
  const scored = CIRCLE_IDS.filter((c) => !RED_CIRCLES.includes(c))
    .map((c) => {
      const reach = sum(RED_CIRCLES.map((r) => walkDist(c, r))) / RED_CIRCLES.length;
      // Expert: many streets and big blocks around the hideout make the last steps home hard to block
      const exits = sk.expert ? adjacentCircles(c).length + 0.5 * alleyDestinations(c).length : 0;
      return { c, d: reach - 0.15 * exits };
    })
    .sort((a, b) => a.d - b.d);
  const pool = sk.level === 'easy' ? 80 : sk.level === 'normal' ? 50 : 30;
  return scored[Math.floor(rng() * Math.min(pool, scored.length))].c;
}

/** Marked women a comfortable distance from home: close enough to get back, not so close the route gives it away. */
function placeWomen(v: GameView, rng: Rng, sk: Skill): Action {
  const r = NIGHTS[v.night - 1];
  const free = RED_CIRCLES.filter((c) => !v.crimeScenes.some((cs) => cs.circle === c));
  // Expert also keeps the targets away from where the policemen will start
  const posts = v.night === 1 ? YELLOW_CROSSINGS : (Object.values(v.policemen) as number[]);
  const watched = (c: number) => sum(posts.map((x) => (reachCircle(x, c) <= 1 ? 1 : reachCircle(x, c) === 2 ? 0.4 : 0)));
  // Expert: any distance from 2 to 6 is as good (a fixed favourite distance would point at home)
  const homeFit = (c: number) => {
    const d = walkDist(c, v.hideout!);
    return sk.expert ? (d < 2 ? 2 - d : d > 6 ? d - 6 : 0) : Math.abs(d - 5);
  };
  const value = (c: number) => homeFit(c) + (sk.expert ? 1.5 * watched(c) : 0);
  const ranked: number[] = [];
  const pool = [...free];
  while (pool.length) {
    const c = choose(pool, (x) => value(x) + rng() * (sk.expert ? 1 : 3), sk, rng);
    ranked.push(c);
    pool.splice(pool.indexOf(c), 1);
  }
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

function killOrWait(v: GameView, rng: Rng, sk: Skill): Action {
  const kills = NIGHTS[v.night - 1].kills;
  const ranked = [...v.wretched].sort((a, b) => victimRisk(v, a) - victimRisk(v, b));
  const best = victimRisk(v, ranked[0]);
  const mustKill = v.timeOfCrime! <= 0;
  const waited = CRIME_START - v.timeOfCrime!;
  if (!mustKill && sk.level === 'easy' && rng() < 0.3) return { type: 'wait' };
  if (!mustKill && best > 1 && waited < 3 && rng() < 0.75) return { type: 'wait' };
  if (sk.level === 'easy' && rng() < 0.3) {
    // an easy Jack strikes at random
    const pick = shuffle(v.wretched, rng).slice(0, kills);
    return { type: 'kill', victims: pick };
  }
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

/** The trails as the police will see them after a move of this kind. */
function trailsAfter(v: GameView, kind: Option['kind'], slot: number, police: number[], escaped = false): Trail[] {
  return v.trails.map((t) => t.night !== v.night ? t : {
    ...t,
    moves: [...t.moves, { slot: kind === 'coach' ? slot + 2 : slot + 1, kind, blocked: kind === 'walk' ? police : [] }],
    escaped,
  });
}

/**
 * Where the police would arrest next if they played their odds: each policeman can move up to two
 * crossings, then arrest on one circle next to him. The most likely circles get claimed first.
 */
function policeTargets(belief: Map<number, number>, police: number[]): Map<number, number> {
  const ranked = [...belief].filter(([, p]) => p > 0.01).sort((a, b) => b[1] - a[1]);
  const free = new Set(police);
  const out = new Map<number, number>();
  for (const [c, p] of ranked) {
    if (!free.size) break;
    const x = [...free].find((y) => reachCircle(y, c) <= 2);
    if (x === undefined) continue;
    free.delete(x);
    out.set(c, p);
  }
  return out;
}

function move(v: GameView, rng: Rng, sk: Skill): Action {
  const loc = v.jackLocation!;
  const slot = v.track!;
  const home = v.hideout!;
  const police = Object.values(v.policemen) as number[];

  const walks = circleNeighbors(loc, new Set(police));
  if (walks.includes(home) && (!sk.expert || (shouldEscape(v, slot, police) && rng() >= BLUFF))) {
    return { type: 'jackMove', to: home, escape: true };
  }

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
  // a bluffing Expert does not walk onto home without escaping: that would only waste the move
  const detours = options.filter((o) => !(sk.expert && o.kind === 'walk' && o.to === home));
  const candidates = detours.length ? detours : options;

  // what the police would believe after each kind of move
  const beliefs = new Map<Option['kind'], Map<number, number> | null>();
  for (const kind of new Set(candidates.map((o) => o.kind))) {
    beliefs.set(kind, believe(trailsAfter(v, kind, slot, police), v.night, v.alleys - (kind === 'alley' ? 1 : 0))?.location ?? null);
  }
  const targets = new Map<Option['kind'], Map<number, number>>();
  if (sk.expert) for (const [kind, b] of beliefs) targets.set(kind, b ? policeTargets(b, police) : new Map());

  // Expert: if the police can already tell where home is, they will soon wall it in: hurry
  const exposure = sk.expert ? (hideoutBelief(v.trails).get(home) ?? 0) : 0;
  const urgency = URGENCY * exposure;
  const timeCost = (o: Option) => {
    const left = LAST_SLOT - o.slot;
    const slack = left - walkDist(o.to, home);
    const alleysLeft = v.alleys - (o.kind === 'alley' ? 1 : 0);
    const base = slack >= 0 ? 1.5 / (1 + slack) : alleysLeft > 0 && left - alleyDist(o.to, home) >= 0 ? 2.5 : 50;
    return base * (1 + urgency) + urgency * 0.3 * walkDist(o.to, home);
  };

  const score = (o: Option) => {
    const p = beliefs.get(o.kind)?.get(o.to) ?? 0.1;
    const token = o.kind === 'coach' ? 0.35 : o.kind === 'alley' ? 0.3 : 0;
    if (!sk.expert) {
      const chasers = police.filter((x) => reachCircle(x, o.to) <= 2).length;
      const risk = chasers ? p * (1 + 0.25 * (chasers - 1)) : 0.05 * p;
      return 8 * risk + 1.5 * p + timeCost(o) + token + rng() * 0.1;
    }
    // Expert: will the police (playing their odds) arrest right where he stands?
    const t = targets.get(o.kind)!;
    const reachable = police.some((x) => reachCircle(x, o.to) <= 2);
    const risk = t.has(o.to) ? Math.min(1, Math.max(0.2, 3 * p)) : reachable ? 0.25 * p : 0;
    // keep streets open for the next move, so a cordon cannot corner him
    const exits = circleNeighbors(o.to, new Set(police)).filter((n) => !police.some((x) => reachCircle(x, n) === 0)).length;
    const cornered = exits === 0 ? 1.5 : 0.6 / exits;
    // spending a token now leaves fewer for emergencies later in the night
    const save = o.kind === 'coach' ? 0.25 + 0.15 * (v.coaches <= 1 ? 1 : 0) : o.kind === 'alley' ? 0.2 : 0;
    return 12 * risk + 1.2 * p + timeCost(o) + cornered + save + rng() * 0.05;
  };

  // easy / normal Jacks only blunder among moves that still get him home in time
  const safe = sk.blunder > 0 ? candidates.filter((o) => timeCost(o) < 50) : candidates;
  return choose(safe.length ? safe : candidates, score, sk, rng).action;
}

/**
 * Expert: escape now, or take a detour first? Going home reveals that the hideout is among the
 * places tonight's route can end. If that would leave his home the police's best guess (and a lost
 * game on the final night when they get to name it), he keeps moving while he can afford it.
 */
function shouldEscape(v: GameView, slot: number, police: number[]): boolean {
  const left = LAST_SLOT - (slot + 1);
  if (left < MIN_DETOUR) return true; // no time for a detour
  const after = trailsAfter(v, 'walk', slot, police, true);
  const belief = hideoutBelief(after);
  const pHome = belief.get(v.hideout!) ?? 0;
  const top = Math.max(...belief.values());
  const finalGuess = v.night === NIGHTS.length && v.options.finalGuess;
  // is a detour itself safe? home must stay reachable and he must not be next to a policeman
  const homeNext = circleNeighbors(v.jackLocation!, new Set(police)).filter((n) => n !== v.hideout!)
    .some((n) => walkDist(n, v.hideout!) <= left - 1 && !police.some((x) => reachCircle(x, n) <= 1));
  if (!homeNext) return true;
  if (finalGuess) return pHome < top * 0.6 || left < 3;
  return pHome < 0.5 || pHome < top;
}
