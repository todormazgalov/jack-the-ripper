import { legalWretchedMoves, searchTargets } from '../engine/engine.ts';
import { COLORS, LAST_SLOT, NIGHTS, type Action, type GameState } from '../engine/types.ts';
import { RED_CIRCLES, YELLOW_CROSSINGS, alleyDestinations, circleNeighbors, coachRoutes } from '../map/graph.ts';
import type { GameView } from '../engine/view.ts';
import { jackBotAction } from './jack.ts';
import { policeBotAction } from './police.ts';

export { believe, hideoutCandidates, type Belief } from './inference.ts';

/** The action a bot takes, decided only from what its player is allowed to see. */
export function botAction(view: GameView, rng: () => number = Math.random): Action {
  return view.you.role === 'jack' ? jackBotAction(view, rng) : policeBotAction(view, rng);
}

/** The plainest legal action, used if the bot's own choice is ever refused, so a game can never get stuck. */
export function fallbackAction(v: GameView): Action {
  const r = NIGHTS[v.night - 1];
  switch (v.phase) {
    case 'hideout':
      return { type: 'chooseHideout', circle: [...Array(195).keys()].map((i) => i + 1).find((c) => !RED_CIRCLES.includes(c))! };
    case 'women': {
      const free = RED_CIRCLES.filter((c) => !v.crimeScenes.some((cs) => cs.circle === c));
      return { type: 'placeWomen', circles: free.slice(0, r.women), marked: free.slice(0, r.marked) };
    }
    case 'patrols': {
      const kept = v.night === 1 ? [] : (Object.values(v.policemen) as number[]);
      const crossings = [...kept, ...YELLOW_CROSSINGS.filter((x) => !kept.includes(x))].slice(0, 7);
      return { type: 'placePatrols', patrols: crossings.map((crossing, i) => ({ crossing, color: COLORS[i] ?? null })) };
    }
    case 'kill':
      return { type: 'kill', victims: v.wretched.slice(0, r.kills) };
    case 'wretched': {
      const from = v.wretchedPending[0];
      return { type: 'moveWretched', from, to: legalWretchedMoves(v as unknown as GameState, from)[0] };
    }
    case 'reveal':
      return { type: 'revealPatrol', crossing: v.patrols.find((p) => !p.revealed)!.crossing };
    case 'jackMove': {
      const loc = v.jackLocation!;
      const walk = circleNeighbors(loc, new Set(Object.values(v.policemen) as number[]))[0];
      if (walk !== undefined) return { type: 'jackMove', to: walk, escape: walk === v.hideout };
      const coach = coachRoutes(loc)[0];
      if (v.coaches > 0 && coach && v.track! + 2 <= LAST_SLOT) return { type: 'coach', via: coach[0], to: coach[1] };
      return { type: 'alley', to: alleyDestinations(loc)[0] };
    }
    case 'policeMove': {
      const color = v.pendingColors[0];
      return { type: 'policeMove', color, to: v.policemen[color]! };
    }
    case 'policeAction': {
      const s = v.turn?.searching;
      if (s) return { type: 'search', color: s.color, circle: searchTargets(v as unknown as GameState, s.color)[0] };
      return { type: 'policeSkip', color: v.pendingColors[0] };
    }
    default:
      throw new Error(`No action in phase ${v.phase}`);
  }
}
