import { memo, useState, type ReactNode } from 'react';
import { MAP, circleById, crossingById, slotLabel, type Color, type GameView } from '@jtr/shared';
import { COLOR_HEX } from '../types.ts';
import { usePanZoom } from './usePanZoom.tsx';
import Effects from './Effects.tsx';

export interface BoardProps {
  view: GameView;
  targetCircles?: ReadonlySet<number>;
  targetCrossings?: ReadonlySet<number>;
  /** ordered selection, numbered when more than one */
  selectedCircles?: number[];
  selectedCrossing?: number | null;
  /** local previews (not yet sent to the server) */
  previewPatrols?: { crossing: number; color: Color | null }[];
  previewWomen?: { circle: number; marked: boolean }[];
  /** game-over routes, one per night */
  routes?: (number | null)[][];
  onCircle?: (c: number) => void;
  onCrossing?: (x: number) => void;
}

const W = MAP.board.width;
const H = MAP.board.height;
/** 2x upscale of MAP.board.image (tools/upscale_board.py), same board coordinates */
const PHOTO = '/board-hd.webp';
const NIGHT_COLORS = ['#ffd84d', '#4dd2ff', '#ff7ad9', '#7dff7a'];

/** The move track printed at the bottom of the board (V IV III II I, then 1..15), in board pixels. */
const TRACK_Y = 775;
const trackX = (slot: number) => (slot < 5 ? 216.7 + 40.4 * slot : 420 + 40.47 * (slot - 5));
/** The Night track: four blood stains at the bottom right, nights 1 to 4. */
const NIGHT_SPOTS = [[952, 570], [920, 622], [894, 697], [976, 713]];

function Pawn({ x, y, fill, h = 18, stroke = '#111', onClick }: {
  x: number; y: number; fill: string; h?: number; stroke?: string; onClick?: () => void;
}) {
  const s = h / 18;
  return (
    <g transform={`translate(${x},${y}) scale(${s})`} pointerEvents={onClick ? undefined : 'none'}
      style={onClick ? { cursor: 'pointer' } : undefined} onClick={onClick}>
      <path d="M -6 9 L 6 9 L 4 4 Q 2 1 3 -2 A 4.5 4.5 0 1 0 -3 -2 Q -2 1 -4 4 Z" fill={fill} stroke={stroke} strokeWidth={1.2} />
    </g>
  );
}

const nodeXY = (k: string) => {
  const id = Number(k.slice(1));
  const n = k[0] === 'C' ? circleById.get(id) : k[0] === 'X' ? crossingById.get(id) : MAP.junctions.find((j) => j.id === id);
  return n ? { x: n.x, y: n.y } : null;
};

/**
 * The playing elements of the board redrawn as vectors from the map data, on top of the photo:
 * they stay sharp at any zoom, while the (low resolution) photo only gives the backdrop.
 */
const VectorBoard = memo(function VectorBoard() {
  return (
    <g className="vec" pointerEvents="none">
      <g className="vec-streets">
        {MAP.edges.map(([a, b]) => {
          const p = nodeXY(a);
          const q = nodeXY(b);
          return p && q ? <line key={`${a}-${b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} /> : null;
        })}
      </g>
      {MAP.crossings.map((x) => x.yellow
        ? <rect key={x.id} x={x.x - 6} y={x.y - 6} width={12} height={12} className="vec-x yellow" />
        : <rect key={x.id} x={x.x - 2.6} y={x.y - 2.6} width={5.2} height={5.2} className="vec-x" />)}
      {MAP.circles.map((c) => (
        <g key={c.id} className={c.red ? 'vec-c red' : 'vec-c'}>
          <circle cx={c.x} cy={c.y} r={9} />
          <text x={c.x} y={c.y + 3}>{c.id}</text>
        </g>
      ))}
    </g>
  );
});

export default function Board(p: BoardProps) {
  const { view } = p;
  const pz = usePanZoom(W, H);
  const [photo, setPhoto] = useState(() => localStorage.getItem('jtr-photo') !== 'dim');
  const togglePhoto = () => setPhoto((v) => { localStorage.setItem('jtr-photo', v ? 'dim' : 'full'); return !v; });
  const [fx, setFx] = useState(() => localStorage.getItem('jtr-fx') !== 'off');
  const toggleFx = () => setFx((v) => { localStorage.setItem('jtr-fx', v ? 'off' : 'on'); return !v; });
  const click = pz.guard;

  const C = (id: number) => circleById.get(id)!;
  const X = (id: number) => crossingById.get(id)!;
  const tc = p.targetCircles ?? new Set<number>();
  const tx = p.targetCrossings ?? new Set<number>();
  const layers: ReactNode[] = [];

  // crime scenes and clues: translucent discs so the printed numbers stay readable
  for (const cs of view.crimeScenes) {
    const c = C(cs.circle);
    layers.push(<circle key={`cs${cs.circle}`} cx={c.x} cy={c.y} r={11} className="crime" />);
  }
  for (const cl of view.clues) {
    const c = C(cl);
    layers.push(<circle key={`cl${cl}`} cx={c.x} cy={c.y} r={11} className="clue" />);
  }
  // tonight's police results (public): circles searched in vain, failed arrests
  const tonight = view.trails.find((t) => t.night === view.night);
  const checked = new Map<number, Set<string>>();
  for (const ch of tonight?.checks ?? []) {
    if (ch.result === 'clue' || view.clues.includes(ch.circle)) continue;
    checked.set(ch.circle, (checked.get(ch.circle) ?? new Set()).add(ch.result));
  }
  for (const [id, results] of checked) {
    const c = C(id);
    layers.push(
      <g key={`chk${id}`} className="searched" pointerEvents="none">
        <circle cx={c.x} cy={c.y} r={11.5} />
        {results.has('absent') && <path d={`M ${c.x + 7} ${c.y + 7} l 5 5 M ${c.x + 12} ${c.y + 7} l -5 5`} />}
      </g>,
    );
  }
  // woman tokens (face down)
  for (const w of view.women) {
    const c = C(w.circle);
    const marked = w.marked ?? false;
    layers.push(
      <g key={`w${w.circle}`} pointerEvents="none">
        <circle cx={c.x + 10} cy={c.y - 10} r={6.5} fill="#f5f0e6" stroke="#222" strokeWidth={1} />
        {marked ? <circle cx={c.x + 10} cy={c.y - 10} r={3} fill="#c00" /> : w.marked === null && <text x={c.x + 10} y={c.y - 7} className="tok-q">?</text>}
      </g>,
    );
  }
  for (const w of p.previewWomen ?? []) {
    const c = C(w.circle);
    layers.push(
      <g key={`pw${w.circle}`} pointerEvents="none">
        <circle cx={c.x + 10} cy={c.y - 10} r={6.5} fill="#f5f0e6" stroke="#222" strokeWidth={1} />
        {w.marked && <circle cx={c.x + 10} cy={c.y - 10} r={3} fill="#c00" />}
      </g>,
    );
  }
  for (const w of view.wretched) {
    const c = C(w);
    // the figure is clickable too when its circle is a target (choosing a victim, moving a wretched)
    const onClick = tc.has(w) && p.onCircle ? click(() => p.onCircle!(w)) : undefined;
    layers.push(<Pawn key={`wr${w}`} x={c.x + 10} y={c.y - 12} fill="#f7f3ea" h={17} onClick={onClick} />);
  }
  // Jack's private markers
  if (view.hideout !== null) {
    const c = C(view.hideout);
    layers.push(<circle key="hideout" cx={c.x} cy={c.y} r={16} className="hideout" />);
  }
  // Jack's own route tonight (his secret sheet), from the crime scene to where he is now
  if (view.sheet && view.track !== null && view.phase !== 'gameOver') {
    const row = view.sheet[view.night - 1];
    const from = tonight?.start ?? row.findIndex((v) => v !== null);
    const steps: { slot: number; id: number }[] = [];
    for (let i = Math.max(0, from); i <= view.track; i++) if (row[i] != null) steps.push({ slot: i, id: row[i]! });
    if (steps.length > 1) {
      layers.push(
        <polyline key="jack-route" className="jack-route" points={steps.map((st) => `${C(st.id).x},${C(st.id).y}`).join(' ')} />,
      );
    }
    steps.forEach((st, i) => {
      const c = C(st.id);
      layers.push(
        <g key={`jr${st.slot}`} className="jack-step" pointerEvents="none">
          <circle cx={c.x - 11} cy={c.y + 10} r={5} />
          <text x={c.x - 11} y={c.y + 12.2}>{i === 0 ? '✝' : slotLabel(st.slot)}</text>
        </g>,
      );
    });
  }
  if (view.jackLocation !== null && view.phase !== 'gameOver') {
    const c = C(view.jackLocation);
    layers.push(
      <g key="jack" pointerEvents="none">
        <circle cx={c.x} cy={c.y} r={14} fill="none" stroke="#000" strokeWidth={3.5} />
        <circle cx={c.x - 12} cy={c.y - 12} r={6} fill="#000" />
        <text x={c.x - 12} y={c.y - 9.3} className="tok-j">J</text>
      </g>,
    );
  }
  // game-over routes
  p.routes?.forEach((row, n) => {
    const pts = row.filter((v): v is number => v !== null).map((id) => C(id));
    if (pts.length < 2) return;
    layers.push(
      <polyline key={`route${n}`} points={pts.map((q) => `${q.x},${q.y}`).join(' ')} fill="none"
        stroke={NIGHT_COLORS[n]} strokeWidth={3} strokeDasharray="7 4" strokeLinejoin="round" opacity={0.9} pointerEvents="none" />,
    );
  });
  // patrol tokens (board state or local preview)
  const patrols = p.previewPatrols
    ? p.previewPatrols.map((pp) => ({ crossing: pp.crossing, color: pp.color as Color | null | 'hidden', revealed: false }))
    : view.patrols;
  for (const pt of patrols) {
    const x = X(pt.crossing);
    const known = pt.color !== 'hidden';
    const fill = pt.revealed && pt.color && pt.color !== 'hidden' ? COLOR_HEX[pt.color] : '#111';
    const ring = known ? (pt.color ? COLOR_HEX[pt.color as Color] : '#888') : '#555';
    layers.push(
      <g key={`pt${pt.crossing}`} pointerEvents="none">
        <circle cx={x.x} cy={x.y} r={8.5} fill={fill} stroke={ring} strokeWidth={known ? 3 : 1.5} />
        {!known && <text x={x.x} y={x.y + 3.5} className="tok-q light">?</text>}
        {known && pt.color === null && <text x={x.x} y={x.y + 3.5} className="tok-q light">✕</text>}
      </g>,
    );
  }
  // move track: special movement tokens, the Time of the Crime token and Jack's pawn
  for (const sp of view.specials) {
    const x1 = trackX(sp.slot) - 15;
    const x2 = trackX(sp.kind === 'coach' ? sp.slot + 1 : sp.slot) + 15;
    layers.push(
      <g key={`sp${sp.slot}`} pointerEvents="none">
        <rect x={x1} y={TRACK_Y - 13} width={x2 - x1} height={26} rx={13} className={`track-token ${sp.kind}`} />
        <text x={(x1 + x2) / 2} y={TRACK_Y + 2.5} className="track-label">{sp.kind === 'coach' ? 'COACH' : 'ALLEY'}</text>
      </g>,
    );
  }
  if (view.timeOfCrime !== null) {
    layers.push(<circle key="toc" cx={trackX(view.timeOfCrime)} cy={TRACK_Y} r={13} className="time-of-crime" />);
  }
  if (view.track !== null) {
    layers.push(<Pawn key="track-jack" x={trackX(view.track)} y={TRACK_Y - 8} fill="#111" stroke="#f5f0e6" h={28} />);
  }
  const night = NIGHT_SPOTS[view.night - 1];
  if (night) layers.push(<Pawn key="night-jack" x={night[0]} y={night[1] - 8} fill="#111" stroke="#f5f0e6" h={28} />);
  // policemen
  for (const [color, xid] of Object.entries(view.policemen) as [Color, number][]) {
    if (p.previewPatrols?.some((pp) => pp.crossing === xid)) continue;
    const x = X(xid);
    layers.push(<Pawn key={`pm-${color}`} x={x.x} y={x.y - 6} fill={COLOR_HEX[color]} h={22} stroke={view.head === color ? '#fff' : '#111'} />);
  }

  const sel = p.selectedCircles ?? [];

  return (
    <div className="board-wrap">
      <svg className={photo ? 'board' : 'board dim'} {...pz.svgProps}>
        <image href={PHOTO} x={0} y={0} width={W} height={H} className="photo" />
        <VectorBoard />
        {layers}
        {fx && <Effects events={view.events} />}
        {MAP.crossings.map((x) => (
          <rect key={`hx${x.id}`} x={x.x - 7} y={x.y - 7} width={14} height={14}
            className={`hit-x ${tx.has(x.id) ? 'target' : ''} ${p.selectedCrossing === x.id ? 'selected' : ''}`}
            onClick={tx.has(x.id) || p.onCrossing ? click(() => p.onCrossing?.(x.id)) : undefined} />
        ))}
        {MAP.circles.map((c) => (
          <circle key={`hc${c.id}`} cx={c.x} cy={c.y} r={12}
            className={`hit-c ${tc.has(c.id) ? 'target' : ''} ${sel.includes(c.id) ? 'selected' : ''}`}
            onClick={click(() => p.onCircle?.(c.id))}>
            <title>{c.id}</title>
          </circle>
        ))}
        {sel.length > 1 && sel.map((id, i) => (
          <text key={`sn${id}`} x={C(id).x - 13} y={C(id).y + 18} className="sel-num">{i + 1}</text>
        ))}
      </svg>
      {pz.controls}
      <button className="small secondary fx-toggle" onClick={toggleFx} title="Animate searches, arrests and the final raid">
        Animations: {fx ? 'on' : 'off'}
      </button>
      <button className="small secondary photo-toggle" onClick={togglePhoto} title="Fade the board photo to make the streets and numbers stand out">
        {photo ? 'Fade photo' : 'Show photo'}
      </button>
    </div>
  );
}
