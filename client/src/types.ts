import type { Color, Role } from '@jtr/shared';

/** Mirror of the server's RoomInfo (lobby state shared with everyone in the room). */
export interface RoomInfo {
  code: string;
  hostId: string;
  started: boolean;
  players: { id: string; name: string; role: Role | null; colors: Color[]; connected: boolean; bot: boolean }[];
}

export const COLOR_HEX: Record<Color, string> = {
  blue: '#2f6fd6',
  yellow: '#e8c31a',
  brown: '#8a5a2b',
  red: '#d22b2b',
  green: '#2e9e44',
};
