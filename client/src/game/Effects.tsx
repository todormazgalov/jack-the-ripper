import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { circleById, crossingById, type GameEvent } from '@jtr/shared';
import { COLOR_HEX } from '../types.ts';

/** How long each kind of animation runs (ms); the CSS in style.css is timed to match. */
const DURATION: Record<GameEvent['kind'], number> = { search: 1700, arrest: 1900, raid: 3200 };
/** Several events arriving at once (a bot searching quickly, a reconnect) play one after the other. */
const STAGGER = 450;

interface Active { e: GameEvent; delay: number }

/**
 * Board animations for searches, arrest attempts and the final raid. Only events that happen while
 * this page is open are played (events already in the game when it loads are skipped).
 */
export default function Effects({ events }: { events: GameEvent[] }) {
  const seen = useRef<number | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [active, setActive] = useState<Active[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  useEffect(() => {
    const last = events.at(-1)?.seq ?? 0;
    if (seen.current === null) { seen.current = last; return; }
    const fresh = events.filter((e) => e.seq > seen.current!);
    seen.current = Math.max(seen.current, last);
    if (!fresh.length) return;
    const added = fresh.map((e, i) => ({ e, delay: i * STAGGER }));
    setActive((a) => [...a, ...added]);
    for (const x of added) {
      timers.current.push(setTimeout(() => setActive((a) => a.filter((y) => y.e.seq !== x.e.seq)), x.delay + DURATION[x.e.kind] + 100));
    }
  }, [events]);

  return (
    <g className="fx" pointerEvents="none">
      {active.map(({ e, delay }) => <Effect key={e.seq} e={e} delay={delay} />)}
    </g>
  );
}

function Effect({ e, delay }: { e: GameEvent; delay: number }) {
  const c = circleById.get(e.circle);
  if (!c) return null;
  const from = e.from !== undefined ? crossingById.get(e.from) : undefined;
  const color = e.color ? COLOR_HEX[e.color] : '#f5d76e';
  const style = {
    '--d': `${delay}ms`,
    '--dx': `${from ? from.x - c.x : 0}px`,
    '--dy': `${from ? from.y - c.y : 0}px`,
    '--col': color,
  } as CSSProperties;

  if (e.kind === 'search') {
    const found = e.result === 'clue';
    return (
      <g transform={`translate(${c.x},${c.y})`} style={style}>
        {from && <line className="fx-gaze" x1={from.x - c.x} y1={from.y - c.y} x2={0} y2={0} />}
        <g className="fx-travel">
          <g className="fx-scan">
            <circle className="fx-lens" cx={-3} cy={-3} r={9} />
            <line className="fx-handle" x1={3.5} y1={3.5} x2={12} y2={12} />
          </g>
        </g>
        {found ? (
          <>
            <circle className="fx-burst" r={10} />
            <circle className="fx-burst fx-late" r={10} />
            {[0, 60, 120, 180, 240, 300].map((a) => (
              <line key={a} className="fx-ray" x1={0} y1={-13} x2={0} y2={-21} transform={`rotate(${a})`} />
            ))}
            <text className="fx-word fx-clue" y={-24}>CLUE!</text>
          </>
        ) : (
          <>
            <g className="fx-miss"><line x1={-5} y1={-5} x2={5} y2={5} /><line x1={5} y1={-5} x2={-5} y2={5} /></g>
            <text className="fx-word fx-nothing" y={-20}>nothing</text>
          </>
        )}
      </g>
    );
  }

  if (e.kind === 'arrest') {
    const caught = e.result === 'caught';
    return (
      <g transform={`translate(${c.x},${c.y})`} style={style}>
        {from && <line className="fx-gaze fx-gaze-arrest" x1={from.x - c.x} y1={from.y - c.y} x2={0} y2={0} />}
        <circle className="fx-noose" r={14} />
        <circle className="fx-noose fx-late" r={14} />
        <text className="fx-word fx-arrest-call" y={-26}>ARREST!</text>
        {caught ? (
          <>
            <circle className="fx-flash" r={14} />
            <g className="fx-cuffs">
              <circle cx={-6} cy={0} r={5} /><circle cx={6} cy={0} r={5} /><line x1={-1} y1={0} x2={1} y2={0} />
            </g>
            <text className="fx-word fx-caught" y={34}>ARRESTED!</text>
          </>
        ) : (
          <text className="fx-word fx-nobody" y={30}>Nobody!</text>
        )}
      </g>
    );
  }

  // the final raid on the suspected hideout
  const right = e.result === 'caught';
  return (
    <g className="fx-raid" transform={`translate(${c.x},${c.y})`} style={style}>
      <circle className="fx-lantern" r={60} />
      <circle className="fx-sweep" r={14} />
      <text className="fx-word fx-raid-call" y={-30}>RAID!</text>
      {right ? (
        <>
          <circle className="fx-flash" r={14} />
          <text className="fx-word fx-caught" y={38}>JACK FOUND!</text>
        </>
      ) : (
        <text className="fx-word fx-nobody" y={34}>EMPTY!</text>
      )}
    </g>
  );
}
