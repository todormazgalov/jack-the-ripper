import type { BotLevel, Color, GameOptions, Role } from '@jtr/shared';

/** Mirror of the server's RoomInfo (lobby state shared with everyone in the room). */
export interface RoomInfo {
  code: string;
  hostId: string;
  started: boolean;
  /** 'random': the role is drawn when the game starts */
  players: { id: string; name: string; role: Role | 'random' | null; colors: Color[]; connected: boolean; bot: boolean; level?: BotLevel }[];
  options: GameOptions;
}

export const COLOR_HEX: Record<Color, string> = {
  blue: '#2f6fd6',
  yellow: '#e8c31a',
  brown: '#8a5a2b',
  red: '#d22b2b',
  green: '#2e9e44',
};

/** What each bot difficulty means, in a line. */
export const LEVEL_HINTS: Record<BotLevel, string> = {
  easy: 'Easy: the bots often misjudge and make plain mistakes. Good for learning the rules.',
  normal: 'Normal: sensible play with the occasional slip.',
  hard: 'Hard: the bots read every clue and track every route Jack could have taken.',
  expert: 'Expert: team play. The police wall in the likely hideout; Jack bluffs about where home is.',
};
