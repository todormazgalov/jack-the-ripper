export const COLORS = ['blue', 'yellow', 'brown', 'red', 'green'] as const;
export type Color = (typeof COLORS)[number];

/** Head of the Investigation names, from the rulebook's historical notes. */
export const HEADS: Record<Color, string> = {
  blue: 'Charles Warren',
  yellow: 'George Lusk',
  brown: 'Donald Swanson',
  red: 'Frederick Abberline',
  green: 'Edmund Reid',
};

/**
 * Move track, in the board's left-to-right order: slots 0..4 are the yellow Roman numerals V IV III II I,
 * slots 5..19 are the moves 1..15. The Time of the Crime starts on I and moves left each time Jack waits;
 * Jack's pawn always moves right, so every wait gives him one more move to get home.
 */
export const SLOT_COUNT = 20;
export const LAST_SLOT = SLOT_COUNT - 1;
/** slot of the Roman numeral I, where the Time of the Crime starts */
export const CRIME_START = 4;
export const slotLabel = (slot: number) => (slot < 5 ? ['V', 'IV', 'III', 'II', 'I'][slot] : String(slot - 4));
/** Saved games older than this used another track layout (see migrateGame). */
export const GAME_VERSION = 2;

export interface NightRules { date: string; coach: number; alley: number; women: number; marked: number; kills: number }
export const NIGHTS: NightRules[] = [
  { date: 'August 31st, 1888', coach: 3, alley: 2, women: 8, marked: 5, kills: 1 },
  { date: 'September 8th, 1888', coach: 2, alley: 2, women: 7, marked: 4, kills: 1 },
  { date: 'September 30th, 1888', coach: 2, alley: 1, women: 6, marked: 3, kills: 2 },
  { date: 'November 9th, 1888', coach: 1, alley: 1, women: 4, marked: 1, kills: 1 },
];

export type Role = 'jack' | 'detective';
export interface Player { id: string; name: string; role: Role; colors: Color[] }

export type Phase =
  | 'hideout' // Jack secretly chooses his hideout
  | 'women' // Hell 2: Jack places the woman tokens
  | 'patrols' // Hell 3: the head of the investigation places the patrol tokens
  | 'kill' // Hell 5: Jack kills or waits
  | 'wretched' // Hell 6: the head of the investigation moves the wretched
  | 'reveal' // Hell 7: Jack reveals a patrol token
  | 'jackMove' // Hunting 1
  | 'policeMove' // Hunting 2
  | 'policeAction' // Hunting 3
  | 'hideoutGuess' // optional: after Jack escapes on the last night, the detectives name his hideout
  | 'gameOver';

/** Settings chosen in the lobby before the game starts. */
export interface GameOptions {
  /** after the fourth night the detectives get one guess at Jack's hideout: right means the police win */
  finalGuess: boolean;
}
export const DEFAULT_OPTIONS: GameOptions = { finalGuess: true };

/** A public moment worth animating (a search, an arrest attempt, the final raid). */
export interface GameEvent {
  seq: number;
  kind: 'search' | 'arrest' | 'raid';
  circle: number;
  /** the policeman acting and the crossing he acts from (none for the raid) */
  color?: Color;
  from?: number;
  result: 'clue' | 'nothing' | 'absent' | 'caught' | 'wrong';
}

export interface Woman { circle: number; marked: boolean }
export interface Patrol { crossing: number; color: Color | null; revealed: boolean }
export interface SpecialUse { slot: number; kind: 'coach' | 'alley' }
export interface LogEntry { text: string; jackOnly?: boolean; night: number }

/** Public record of Jack's route on one night: everything the detectives know about it. */
export interface Trail {
  night: number;
  /** the night's crime scenes: Jack starts on (the last) one of them */
  scenes: number[];
  /** track slot of Jack's position right after the kill */
  start: number;
  /** Jack's moves in order. `slot`: track slot reached (a coach also fills slot - 1). `blocked`: crossings held by policemen. */
  moves: { slot: number; kind: 'walk' | 'coach' | 'alley'; blocked: number[] }[];
  /** search and arrest results. `slot`: Jack's track slot at that moment. */
  checks: { slot: number; circle: number; result: 'clue' | 'nothing' | 'absent' }[];
  escaped: boolean;
  /** the marked women revealed that night (Jack picks targets he can get home from); missing in older saves */
  targets?: number[];
}

export interface PoliceTurn {
  /** detective player ids, head of the investigation first, then clockwise */
  order: string[];
  index: number;
  done: Color[];
  /** a search in progress must be finished by the same policeman */
  searching: { color: Color; checked: number[] } | null;
}

export interface GameState {
  players: Player[];
  phase: Phase;
  night: number;
  hideout: number | null;
  /** Jack's move track sheet: one row per night, SLOT_COUNT slots */
  sheet: (number | null)[][];
  timeOfCrime: number | null;
  /** slot of Jack's latest recorded location (the Jack pawn on the move track) */
  track: number | null;
  coaches: number;
  alleys: number;
  specials: SpecialUse[];
  women: Woman[];
  wretched: number[];
  /** wretched still to be moved by the head of the investigation this phase */
  wretchedPending: number[];
  crimeScenes: { circle: number; night: number }[];
  patrols: Patrol[];
  policemen: Partial<Record<Color, number>>;
  headTiles: Color[];
  head: Color | null;
  clues: number[];
  turn: PoliceTurn | null;
  winner: 'jack' | 'police' | null;
  winReason: string | null;
  log: LogEntry[];
  /** one per night with a murder (missing in games saved before it existed) */
  trails: Trail[];
  /** missing in games saved before GAME_VERSION 2 */
  version?: number;
  /** missing in games saved before these features existed */
  options?: GameOptions;
  events?: GameEvent[];
  /** tonight's revealed targets, kept until the murder starts tonight's trail */
  nightTargets?: number[];
}

export type Action =
  | { type: 'chooseHideout'; circle: number }
  /** `circles`: the red circles that get a woman (may be omitted when every free red circle gets one) */
  | { type: 'placeWomen'; circles?: number[]; marked: number[] }
  | { type: 'placePatrols'; patrols: { crossing: number; color: Color | null }[] }
  | { type: 'kill'; victims: number[] }
  | { type: 'wait' }
  | { type: 'moveWretched'; from: number; to: number }
  | { type: 'revealPatrol'; crossing: number }
  | { type: 'jackMove'; to: number; escape?: boolean }
  | { type: 'coach'; via: number; to: number }
  | { type: 'alley'; to: number }
  | { type: 'policeMove'; color: Color; to: number }
  | { type: 'search'; color: Color; circle: number }
  | { type: 'arrest'; color: Color; circle: number }
  | { type: 'policeSkip'; color: Color }
  | { type: 'guessHideout'; circle: number };

export class GameError extends Error {}
