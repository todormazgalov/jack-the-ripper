import { io } from 'socket.io-client';

export const socket = io({ autoConnect: true });

type AckRes = { ok: true; [k: string]: unknown } | { ok: false; error: string };

/** Emit and wait for the server's acknowledgement; rejects with the server's error message. */
export function call<T = Record<string, unknown>>(event: string, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    socket.timeout(10000).emit(event, payload, (err: Error | null, res: AckRes) => {
      if (err) reject(new Error('The server did not answer.'));
      else if (!res.ok) reject(new Error(res.error));
      else resolve(res as T);
    });
  });
}

/** Session is per browser tab, so several tabs can play on one computer. */
export interface Session { code: string; playerId: string; token: string }
const KEY = 'jtr-session';
const read = (store: Storage): Session | null => {
  try { return JSON.parse(store.getItem(KEY) ?? 'null'); } catch { return null; }
};
/** The session of this tab (auto-resumed). */
export const loadSession = () => read(sessionStorage);
/** The last session used in this browser (offered as "rejoin" in a fresh tab). */
export const lastSession = () => read(localStorage);
export const saveSession = (s: Session | null) => {
  if (s) { sessionStorage.setItem(KEY, JSON.stringify(s)); localStorage.setItem(KEY, JSON.stringify(s)); }
  else { sessionStorage.removeItem(KEY); localStorage.removeItem(KEY); }
};
