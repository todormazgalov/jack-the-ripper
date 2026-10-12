import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  COLORS, HEADS, LAST_SLOT, NIGHTS, RED_CIRCLES, YELLOW_CROSSINGS, arrestTargets, jackAlleyMoves, jackCoachMoves,
  jackNormalMoves, legalWretchedMoves, policeMoveTargets, searchTargets, slotLabel,
  type Action, type Color, type GameState, type GameView,
} from '@jtr/shared';
import { call } from '../socket.ts';
import { COLOR_HEX, type RoomInfo } from '../types.ts';
import Board, { type BoardProps } from './Board.tsx';
import { JackSheet } from './Track.tsx';
import Log from './Log.tsx';

interface Props { view: GameView; room: RoomInfo; onLeave: () => void }

const NIGHT_NOTES = [
  'Mary Ann Nichols will be found in Buck\'s Row [21].',
  'Annie Chapman will be found in Hanbury Street [3].',
  'The "double event": Elizabeth Stride [158] and Catherine Eddowes [149]. Jack must kill twice tonight.',
  'Mary Jane Kelly, Miller\'s Court [27]. The last night.',
];

type Ctrl = { prompt: ReactNode; board: Partial<BoardProps> };

export default function Game({ view, room, onLeave }: Props) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // local, per-phase selections
  const [selC, setSelC] = useState<number[]>([]);
  const [selColor, setSelColor] = useState<Color | null>(null);
  const [mode, setMode] = useState<'normal' | 'coach' | 'alley' | 'search' | 'arrest'>('normal');
  const [patrols, setPatrols] = useState<{ crossing: number; color: Color | null }[]>([]);
  const [token, setToken] = useState<Color | null | undefined>(undefined);
  const [escapeAsk, setEscapeAsk] = useState<number | null>(null);
  const [emptyRed, setEmptyRed] = useState<number[]>([]);

  const stepKey = `${view.phase}|${view.night}|${view.track}|${view.timeOfCrime}|${view.turn?.index}|${view.turn?.done.length}|${view.wretchedPending.length}|${view.turn?.searching?.checked.length}`;
  useEffect(() => {
    setSelC([]); setEscapeAsk(null); setErr(null); setEmptyRed([]);
    if (view.phase !== 'policeAction') setMode('normal');
    if (!view.turn?.searching) setSelColor(null);
    if (view.phase !== 'patrols') { setPatrols([]); setToken(undefined); }
  }, [stepKey]);

  const me = view.you;
  const isJack = me.role === 'jack';
  const myTurn = view.actors.includes(me.id);
  const gs = view as unknown as GameState; // the shared query helpers only read public fields
  const r = NIGHTS[view.night - 1];
  const name = (id: string) => view.players.find((p) => p.id === id)?.name ?? '?';
  const headName = view.head ? view.players.find((p) => p.colors.includes(view.head!))?.name : null;

  async function send(a: Action) {
    setBusy(true);
    setErr(null);
    try { await call('game:action', a); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  const waiting = (who: string, what: string): Ctrl => ({ prompt: <p>Waiting for <b>{who}</b> {what}...</p>, board: {} });

  const ctrl: Ctrl = useMemo((): Ctrl => {
    const jackName = name(view.players.find((p) => p.role === 'jack')!.id);
    switch (view.phase) {
      case 'hideout': {
        if (!myTurn) return waiting(jackName, 'to choose a secret hideout');
        const targets = new Set(Array.from({ length: 195 }, (_, i) => i + 1).filter((c) => !RED_CIRCLES.includes(c)));
        return {
          prompt: <>
            <p>Choose your <b>hideout</b>: any circle except the red ones. You must return there every night.</p>
            <button disabled={!selC.length || busy} onClick={() => send({ type: 'chooseHideout', circle: selC[0] })}>
              Hide in {selC[0] ?? '...'}
            </button>
          </>,
          board: { targetCircles: targets, selectedCircles: selC, onCircle: (c) => targets.has(c) && setSelC([c]) },
        };
      }

      case 'women': {
        if (!myTurn) return waiting(jackName, 'to place the woman tokens');
        const free = RED_CIRCLES.filter((c) => !view.crimeScenes.some((cs) => cs.circle === c));
        const toEmpty = free.length - r.women; // red circles that must stay without a woman
        const women = free.filter((c) => !emptyRed.includes(c));
        // click cycles: decoy -> real target -> empty (only if some must stay empty) -> decoy
        const cycle = (c: number) => {
          if (!free.includes(c)) return;
          if (emptyRed.includes(c)) setEmptyRed((e) => e.filter((x) => x !== c));
          else if (selC.includes(c)) {
            setSelC((s) => s.filter((x) => x !== c));
            if (toEmpty > 0) setEmptyRed((e) => [...e, c]);
          } else if (selC.length < r.marked) setSelC((s) => [...s, c]);
          else if (toEmpty > 0) setEmptyRed((e) => [...e, c]);
        };
        const ready = selC.length === r.marked && women.length === r.women;
        return {
          prompt: <>
            <p>Tonight there are {r.women} women: choose the <b>{r.marked}</b> real targets (marked red). The others are decoys.</p>
            {toEmpty > 0 && <p className="hint">There are {free.length} free red circles but only {r.women} women: leave <b>{toEmpty}</b> red circle(s) empty.
              Click a circle to cycle decoy → real target → empty.</p>}
            <button disabled={!ready || busy} onClick={() => send({ type: 'placeWomen', circles: women, marked: selC })}>
              Place the women ({selC.length}/{r.marked} real{toEmpty > 0 ? `, ${emptyRed.length}/${toEmpty} empty` : ''})
            </button>
          </>,
          board: {
            targetCircles: new Set(free),
            previewWomen: women.map((c) => ({ circle: c, marked: selC.includes(c) })),
            onCircle: cycle,
          },
        };
      }

      case 'patrols': {
        if (!myTurn) return waiting(`${headName} (Head of the Investigation)`, 'to place the patrol tokens');
        const prev = Object.values(view.policemen) as number[];
        const onPrev = patrols.filter((p) => prev.includes(p.crossing)).length;
        // from night 2: every one of last night's posts must be covered, plus at most 2 free yellow crossings
        const allowed = new Set(view.night === 1 ? YELLOW_CROSSINGS : [
          ...prev,
          ...(patrols.length - onPrev < 2 ? YELLOW_CROSSINGS.filter((x) => !prev.includes(x)) : []),
        ]);
        const placedColors = patrols.map((p) => p.color);
        const left: (Color | null)[] = [...COLORS.filter((c) => !placedColors.includes(c)),
          ...Array(2 - placedColors.filter((c) => c === null).length).fill(null)];
        const current = token !== undefined && left.includes(token) ? token : left[0];
        const onX = (x: number) => {
          if (patrols.some((p) => p.crossing === x)) setPatrols((ps) => ps.filter((p) => p.crossing !== x));
          else if (allowed.has(x) && current !== undefined && patrols.length < 7) {
            setPatrols((ps) => [...ps, { crossing: x, color: current }]);
            setToken(undefined);
          }
        };
        const missing = prev.filter((x) => !patrols.some((p) => p.crossing === x));
        return {
          prompt: <>
            <p>You are the <b>Head of the Investigation</b>. Place 7 patrol tokens face down (5 policemen and 2 fakes)
              {view.night === 1 ? ' on the yellow crossings.' : <>: 5 where last night's policemen stood, 2 on free yellow crossings.</>}
              {' '}Click a placed token to take it back.</p>
            {view.night > 1 && missing.length > 0 && <p className="hint">{missing.length} of last night's posts (shown by the pawns) still to cover.</p>}
            <div className="tokens">
              {[...new Set(left.map(String))].map((k) => {
                const c = k === 'null' ? null : (k as Color);
                const n = left.filter((l) => l === c).length;
                return (
                  <button key={k} className={`token ${current === c ? 'sel' : ''}`} onClick={() => setToken(c)}
                    style={{ borderColor: c ? COLOR_HEX[c] : '#888' }}>
                    {c ?? 'fake'}{n > 1 ? ` ×${n}` : ''}
                  </button>
                );
              })}
            </div>
            <button disabled={patrols.length !== 7 || busy} onClick={() => send({ type: 'placePatrols', patrols })}>
              Confirm patrols ({patrols.length}/7)
            </button>
          </>,
          board: { targetCrossings: new Set([...allowed].filter((x) => !patrols.some((p) => p.crossing === x))), previewPatrols: patrols, onCrossing: onX },
        };
      }

      case 'kill': {
        if (!myTurn) return waiting(jackName, 'to decide: kill now or wait');
        const kills = r.kills;
        const targets = new Set(view.wretched);
        const toggle = (c: number) => {
          if (!targets.has(c)) return;
          // a new pick replaces the oldest one once enough victims are chosen
          setSelC((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c].slice(-kills)));
        };
        return {
          prompt: <>
            <p>Time of the Crime: <b>{slotLabel(view.timeOfCrime ?? 0)}</b>.
              {' '}Click {kills === 2 ? 'two wretched' : 'a wretched'} (the pulsing circles with a white figure) to choose your victim{kills === 2 ? 's' : ''}, then press Kill.</p>
            <p className="hint">Or wait: the Time of the Crime moves one Roman numeral to the left, giving you one more move to get home,
              but the police move the wretched and you must reveal a patrol.</p>
            {kills === 2 && <p className="hint">Double event: pick two victims. The <b>second</b> one is where you start your escape.</p>}
            <div className="row">
              <button className="danger" disabled={selC.length !== kills || busy} onClick={() => send({ type: 'kill', victims: selC })}>
                {selC.length ? `Kill ${selC.join(' then ')}` : 'Kill (choose a victim first)'}
              </button>
              <button className="secondary" disabled={(view.timeOfCrime ?? 0) <= 0 || busy} onClick={() => send({ type: 'wait' })}>Wait</button>
            </div>
          </>,
          board: { targetCircles: targets, selectedCircles: selC, onCircle: toggle },
        };
      }

      case 'wretched': {
        if (!myTurn) return waiting(`${headName} (Head of the Investigation)`, 'to move the wretched');
        const from = selC[0];
        const pending = new Set(view.wretchedPending);
        const dests = from !== undefined ? new Set(legalWretchedMoves(gs, from)) : new Set<number>();
        return {
          prompt: <p>Move every wretched one circle (not next to a patrol, not through one, not onto a crime scene).
            {' '}Click a wretched, then its destination. {view.wretchedPending.length} left.</p>,
          board: {
            targetCircles: from !== undefined ? dests : pending,
            selectedCircles: selC,
            onCircle: (c) => {
              if (pending.has(c)) setSelC([c]);
              else if (from !== undefined && dests.has(c)) send({ type: 'moveWretched', from, to: c });
            },
          },
        };
      }

      case 'reveal': {
        if (!myTurn) return waiting(jackName, 'to reveal a patrol token');
        const hidden = new Set(view.patrols.filter((p) => !p.revealed).map((p) => p.crossing));
        return {
          prompt: <p>Ready to kill: choose a hidden patrol token to reveal.</p>,
          board: { targetCrossings: hidden, onCrossing: (x) => hidden.has(x) && send({ type: 'revealPatrol', crossing: x }) },
        };
      }

      case 'jackMove': {
        if (!myTurn) return waiting(jackName, 'to slip through the streets');
        const moveNo = (view.track ?? 0) + 1;
        let targets = new Set<number>();
        let onCircle: (c: number) => void = () => {};
        if (mode === 'normal') {
          targets = new Set(jackNormalMoves(gs));
          onCircle = (c) => {
            if (!targets.has(c)) return;
            if (c === view.hideout) setEscapeAsk(c);
            else send({ type: 'jackMove', to: c });
          };
        } else if (mode === 'coach') {
          const routes = jackCoachMoves(gs);
          if (!selC.length) {
            targets = new Set(routes.map(([a]) => a));
            onCircle = (c) => targets.has(c) && setSelC([c]);
          } else {
            targets = new Set(routes.filter(([a]) => a === selC[0]).map(([, b]) => b));
            onCircle = (c) => {
              if (targets.has(c)) send({ type: 'coach', via: selC[0], to: c });
              else if (routes.some(([a]) => a === c)) setSelC([c]);
            };
          }
        } else if (mode === 'alley') {
          targets = new Set(jackAlleyMoves(gs));
          onCircle = (c) => targets.has(c) && send({ type: 'alley', to: c });
        }
        const canCoach = jackCoachMoves(gs).length > 0;
        const canAlley = jackAlleyMoves(gs).length > 0;
        return {
          prompt: <>
            <p>Move <b>{slotLabel(moveNo)}</b>: you are on <b>{view.jackLocation}</b>, hideout <b>{view.hideout}</b>. Moves left after this one: {LAST_SLOT - moveNo}.</p>
            <div className="row">
              <button className={mode === 'normal' ? '' : 'secondary'} onClick={() => { setMode('normal'); setSelC([]); }}>Walk</button>
              <button className={mode === 'coach' ? '' : 'secondary'} disabled={!canCoach} onClick={() => { setMode('coach'); setSelC([]); }}>Coach ({view.coaches})</button>
              <button className={mode === 'alley' ? '' : 'secondary'} disabled={!canAlley} onClick={() => { setMode('alley'); setSelC([]); }}>Alley ({view.alleys})</button>
            </div>
            {mode === 'coach' && <p className="hint">Coach: two circles in a row, through policemen. {selC.length ? `First stop ${selC[0]}; now pick the second.` : 'Pick the first stop.'}</p>}
            {mode === 'alley' && <p className="hint">Alley: cross a block of houses to any circle around it.</p>}
            {escapeAsk !== null && (
              <div className="ask">
                <p>You reach your hideout. Declare your escape?</p>
                <div className="row">
                  <button disabled={busy} onClick={() => send({ type: 'jackMove', to: escapeAsk, escape: true })}>Escape!</button>
                  <button className="secondary" disabled={busy} onClick={() => send({ type: 'jackMove', to: escapeAsk, escape: false })}>Keep moving (bluff)</button>
                  <button className="secondary" onClick={() => setEscapeAsk(null)}>Cancel</button>
                </div>
              </div>
            )}
          </>,
          board: { targetCircles: targets, selectedCircles: selC, onCircle },
        };
      }

      case 'policeMove': case 'policeAction': {
        const current = view.turn ? view.turn.order[view.turn.index] : '';
        if (!myTurn) return waiting(name(current), view.phase === 'policeMove' ? 'to move policemen' : 'to search or arrest');
        const pend = view.pendingColors;
        const locked = view.turn?.searching?.color ?? null;
        const color = locked ?? (selColor && pend.includes(selColor) ? selColor : pend[0]);
        const pickers = (
          <div className="tokens">
            {pend.map((c) => (
              <button key={c} className={`token ${c === color ? 'sel' : ''}`} style={{ borderColor: COLOR_HEX[c] }}
                disabled={!!locked && c !== locked} onClick={() => setSelColor(c)}>{c}</button>
            ))}
          </div>
        );
        const selectByPawn = (x: number) => {
          const c = (Object.entries(view.policemen) as [Color, number][]).find(([, xx]) => xx === x)?.[0];
          if (c && pend.includes(c) && c !== color && !locked) { setSelColor(c); return true; }
          return false;
        };
        if (view.phase === 'policeMove') {
          const targets = new Set(policeMoveTargets(gs, color));
          return {
            prompt: <>
              <p>Move your policemen up to 2 crossings (you may pass others, never stop on one). Selected: <b style={{ color: COLOR_HEX[color] }}>{color}</b>.</p>
              {pickers}
              <button className="secondary" disabled={busy} onClick={() => send({ type: 'policeMove', color, to: view.policemen[color]! })}>Stay put</button>
            </>,
            board: {
              targetCrossings: targets, selectedCrossing: view.policemen[color],
              onCrossing: (x) => { if (!selectByPawn(x) && targets.has(x)) send({ type: 'policeMove', color, to: x }); },
            },
          };
        }
        const m = locked ? 'search' : mode === 'arrest' ? 'arrest' : 'search';
        const targets = new Set(m === 'search' ? searchTargets(gs, color) : arrestTargets(gs, color));
        return {
          prompt: <>
            <p>Policeman <b style={{ color: COLOR_HEX[color] }}>{color}</b>: look for clues (circle by circle until one is found) or attempt an arrest (one circle).</p>
            {pickers}
            <div className="row">
              <button className={m === 'search' ? '' : 'secondary'} onClick={() => setMode('search')}>Search for clues</button>
              <button className={m === 'arrest' ? 'danger' : 'secondary'} disabled={!!locked} onClick={() => setMode('arrest')}>Arrest!</button>
              <button className="secondary" disabled={!!locked || busy} onClick={() => send({ type: 'policeSkip', color })}>No action</button>
            </div>
            {locked && <p className="hint">Keep searching: {view.turn!.searching!.checked.join(', ')} had nothing.</p>}
          </>,
          board: {
            targetCircles: targets, selectedCrossing: view.policemen[color],
            onCrossing: (x) => { selectByPawn(x); },
            onCircle: (c) => targets.has(c) && send({ type: m, color, circle: c }),
          },
        };
      }

      case 'hideoutGuess': {
        if (!myTurn) {
          return waiting(`${headName} (Head of the Investigation)`, isJack
            ? 'to name your hideout. One guess: if it is right, you are caught'
            : 'to name Jack\'s hideout (talk it over!)');
        }
        const targets = new Set(Array.from({ length: 195 }, (_, i) => i + 1).filter((c) => !RED_CIRCLES.includes(c)));
        return {
          prompt: <>
            <p>Jack has escaped for the last time. <b>One last chance:</b> name his hideout.
              If you are right, the police raid it and win; if not, Jack wins.</p>
            <p className="hint">Think back: every night ended on his hideout, and Jack usually heads home as soon as he can
              (unless he is bluffing). His real targets are rarely far from it either.</p>
            <button className="danger" disabled={!selC.length || busy} onClick={() => send({ type: 'guessHideout', circle: selC[0] })}>
              {selC.length ? `Raid circle ${selC[0]}!` : 'Click the circle you suspect'}
            </button>
          </>,
          board: { targetCircles: targets, selectedCircles: selC, onCircle: (c) => targets.has(c) && setSelC([c]) },
        };
      }

      case 'gameOver':
        return {
          prompt: <>
            <h2 className={view.winner === 'jack' ? 'jack-wins' : 'police-wins'}>{view.winner === 'jack' ? 'Jack the Ripper wins!' : 'The police win!'}</h2>
            <p>{view.winReason}</p>
            <p>Jack's hideout was <b>{view.hideout}</b>. His routes are drawn on the map (one colour per night).</p>
            {room.hostId === me.id && <button onClick={() => call('game:lobby').catch(() => {})}>Back to the lobby</button>}
          </>,
          board: { routes: view.sheet ?? undefined },
        };
    }
  }, [view, selC, selColor, mode, patrols, token, escapeAsk, emptyRed, busy, myTurn]);

  return (
    <div className="game">
      <div className="main">
        <Board view={view} {...ctrl.board} />
      </div>
      <aside className="side">
        <header>
          <div>
            <b>Night {view.night}</b> of 4 · {r.date}
            <div className="hint">{NIGHT_NOTES[view.night - 1]}</div>
          </div>
          <button className="small secondary" onClick={onLeave}>Leave</button>
        </header>
        <div className="you">
          You are <b>{me.role === 'jack' ? 'Jack the Ripper' : me.role === 'detective' ? 'a detective' : 'a spectator'}</b>
          {me.colors.length > 0 && <> controlling {me.colors.map((c) => <span key={c} className="chip" style={{ background: COLOR_HEX[c] }}>{c}</span>)}</>}
        </div>
        {view.head && <div className="hint">Head of the Investigation: <span className="chip" style={{ background: COLOR_HEX[view.head] }}>{view.head}</span> {HEADS[view.head]} ({headName})</div>}
        <div className={`prompt ${myTurn ? 'mine' : ''}`}>
          {ctrl.prompt}
          {err && <p className="error">{err}</p>}
        </div>
        <div className="status">
          Coaches {view.coaches} · Alleys {view.alleys} · Clues {view.clues.length} · Victims {view.crimeScenes.length}/5
        </div>
        {isJack && view.sheet && <JackSheet view={view} />}
        <Log entries={view.log} />
        <div className="players-mini">
          {room.players.map((p) => {
            const seat = view.players.find((gp) => gp.id === p.id) ?? p;
            return (
              <span key={p.id} className={view.actors.includes(p.id) ? 'acting' : ''}>
                <span className={`dot ${p.connected ? 'on' : 'off'}`} /> {p.name}
                {seat.role === 'jack' ? ' (Jack)' : seat.colors.map((c) => <span key={c} className="chip mini" style={{ background: COLOR_HEX[c] }} />)}
              </span>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
