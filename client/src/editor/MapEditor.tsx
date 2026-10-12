import { useMemo, useRef, useState } from 'react';
import { MAP, makeGraph, type MapData } from '@jtr/shared';
import { usePanZoom } from '../game/usePanZoom.tsx';

/**
 * Map verification / editing tool (open /editor).
 * Inspect: click a circle to see its walking neighbours (cyan) and alley neighbours (orange);
 * click a crossing to see its police steps (cyan) and the circles it watches (green).
 * Edit: drag nodes, toggle edges, add/delete crossings, toggle yellow. Download the JSON and
 * replace shared/src/map/whitechapel.json with it.
 */
type Mode = 'inspect' | 'move' | 'edge' | 'add' | 'delete';
const DRAFT = 'jtr-map-draft';
const W = MAP.board.width;
const H = MAP.board.height;

const key = (k: string) => ({ t: k[0], id: Number(k.slice(1)) });

export default function MapEditor() {
  const [map, setMap] = useState<MapData>(() => JSON.parse(localStorage.getItem(DRAFT) ?? 'null') ?? structuredClone(MAP));
  const [mode, setMode] = useState<Mode>('inspect');
  const [sel, setSel] = useState<string | null>(null);
  const [showEdges, setShowEdges] = useState(true);
  const [dirty, setDirty] = useState(false);
  const g = useMemo(() => makeGraph(map), [map]);
  const pz = usePanZoom(W, H);
  const dragNode = useRef<string | null>(null);

  const pos = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const c of map.circles) m.set(`C${c.id}`, c);
    for (const x of map.crossings) m.set(`X${x.id}`, x);
    for (const j of map.junctions) m.set(`J${j.id}`, j);
    return m;
  }, [map]);

  const update = (fn: (m: MapData) => void) => {
    const next = structuredClone(map);
    fn(next);
    setMap(next);
    setDirty(true);
    localStorage.setItem(DRAFT, JSON.stringify(next));
  };

  function clickNode(k: string) {
    if (mode === 'edge') {
      if (!sel || sel === k) { setSel(k); return; }
      update((m) => {
        const i = m.edges.findIndex(([a, b]) => (a === sel && b === k) || (a === k && b === sel));
        if (i >= 0) m.edges.splice(i, 1);
        else m.edges.push([sel, k].sort() as [string, string]);
      });
      setSel(k);
      return;
    }
    if (mode === 'delete' && k[0] !== 'C') {
      update((m) => {
        const { t, id } = key(k);
        if (t === 'X') m.crossings = m.crossings.filter((x) => x.id !== id);
        else m.junctions = m.junctions.filter((j) => j.id !== id);
        m.edges = m.edges.filter(([a, b]) => a !== k && b !== k);
      });
      setSel(null);
      return;
    }
    setSel(k);
  }

  function clickBackground(e: React.MouseEvent) {
    if (mode !== 'add') return;
    const { x, y } = pz.toSvg(e.clientX, e.clientY);
    update((m) => {
      const id = Math.max(0, ...m.crossings.map((c) => c.id)) + 1;
      m.crossings.push({ id, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, yellow: false, goulston: false });
    });
  }

  const hl = useMemo(() => {
    const cyanC = new Set<number>(), orangeC = new Set<number>(), greenC = new Set<number>(), cyanX = new Set<number>();
    if (sel) {
      const { t, id } = key(sel);
      if (t === 'C') { g.adjacentCircles(id).forEach((n) => cyanC.add(n)); g.alleyDestinations(id).forEach((n) => orangeC.add(n)); }
      if (t === 'X') { g.crossingSteps(id).forEach((n) => cyanX.add(n)); g.circlesAroundCrossing(id).forEach((n) => greenC.add(n)); }
    }
    return { cyanC, orangeC, greenC, cyanX };
  }, [sel, g]);

  function download() {
    const lines = (arr: unknown[]) => arr.map((x) => JSON.stringify(x)).join(',\n');
    const sorted = { ...map, edges: [...map.edges].map((e) => [...e].sort()).sort() };
    const text = `{\n"board":${JSON.stringify(map.board)},\n"circles":[\n${lines(map.circles)}\n],\n"crossings":[\n${lines(map.crossings)}\n],\n"junctions":[\n${lines(map.junctions)}\n],\n"edges":[\n${lines(sorted.edges)}\n],\n"blocks":[\n${lines(map.blocks)}\n]\n}\n`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = 'whitechapel.json';
    a.click();
  }

  const selInfo = sel && (() => {
    const { t, id } = key(sel);
    if (t === 'C') return <>Circle <b>{id}</b> · walk: {g.adjacentCircles(id).join(', ')}<br />alley: {g.alleyDestinations(id).join(', ') || 'none'}</>;
    if (t === 'X') {
      const x = map.crossings.find((c) => c.id === id)!;
      return <>Crossing <b>{id}</b> {x.yellow && '(yellow)'} {x.goulston && '(Goulston St.)'} · steps: {g.crossingSteps(id).join(', ')}<br />
        watches circles: {g.circlesAroundCrossing(id).join(', ') || 'none'}<br />
        <button className="small" onClick={() => update((m) => { const c = m.crossings.find((cc) => cc.id === id)!; c.yellow = !c.yellow; })}>Toggle yellow</button></>;
    }
    return <>Junction {id}</>;
  })();

  const r = (k: string) => pos.get(k)!;

  return (
    <div className="editor">
      <div className="board-wrap">
        <svg className="board" {...pz.svgProps}
          onPointerMove={(e) => {
            if (mode === 'move' && dragNode.current) {
              const { x, y } = pz.toSvg(e.clientX, e.clientY);
              const k = dragNode.current;
              const { t, id } = key(k);
              setMap((m) => {
                const next = structuredClone(m);
                const list = t === 'C' ? next.circles : t === 'X' ? next.crossings : next.junctions;
                const n = (list as { id: number; x: number; y: number }[]).find((nn) => nn.id === id)!;
                n.x = Math.round(x * 10) / 10; n.y = Math.round(y * 10) / 10;
                return next;
              });
              setDirty(true);
            } else pz.svgProps.onPointerMove(e);
          }}
          onPointerUp={() => {
            if (dragNode.current) { dragNode.current = null; localStorage.setItem(DRAFT, JSON.stringify(map)); }
            pz.svgProps.onPointerUp();
          }}>
          <image href={`/${map.board.image}`} width={W} height={H} onClick={clickBackground} />
          {showEdges && map.edges.map(([a, b], i) => pos.has(a) && pos.has(b) && (
            <line key={i} x1={r(a).x} y1={r(a).y} x2={r(b).x} y2={r(b).y} className="ed-edge" />
          ))}
          {map.junctions.map((j) => (
            <circle key={`J${j.id}`} cx={j.x} cy={j.y} r={3} className={`ed-j ${sel === `J${j.id}` ? 'sel' : ''}`}
              onPointerDown={(e) => { if (mode === 'move') { e.stopPropagation(); dragNode.current = `J${j.id}`; } }}
              onClick={pz.guard(() => clickNode(`J${j.id}`))} />
          ))}
          {map.crossings.map((x) => (
            <rect key={`X${x.id}`} x={x.x - 5} y={x.y - 5} width={10} height={10}
              className={`ed-x ${x.yellow ? 'yellow' : ''} ${x.goulston ? 'goulston' : ''} ${hl.cyanX.has(x.id) ? 'cyan' : ''} ${sel === `X${x.id}` ? 'sel' : ''}`}
              onPointerDown={(e) => { if (mode === 'move') { e.stopPropagation(); dragNode.current = `X${x.id}`; } }}
              onClick={pz.guard(() => clickNode(`X${x.id}`))}><title>{`X${x.id}`}</title></rect>
          ))}
          {map.circles.map((c) => (
            <circle key={`C${c.id}`} cx={c.x} cy={c.y} r={11}
              className={`ed-c ${hl.cyanC.has(c.id) ? 'cyan' : ''} ${hl.orangeC.has(c.id) ? 'orange' : ''} ${hl.greenC.has(c.id) ? 'green' : ''} ${sel === `C${c.id}` ? 'sel' : ''}`}
              onPointerDown={(e) => { if (mode === 'move') { e.stopPropagation(); dragNode.current = `C${c.id}`; } }}
              onClick={pz.guard(() => clickNode(`C${c.id}`))}><title>{c.id}</title></circle>
          ))}
        </svg>
        {pz.controls}
      </div>
      <aside className="side">
        <h2>Map editor</h2>
        <div className="tokens">
          {(['inspect', 'move', 'edge', 'add', 'delete'] as Mode[]).map((m) => (
            <button key={m} className={`token ${mode === m ? 'sel' : ''}`} onClick={() => { setMode(m); setSel(null); }}>{m}</button>
          ))}
        </div>
        <p className="hint">
          {mode === 'inspect' && 'Click a circle or crossing to see its connections.'}
          {mode === 'move' && 'Drag nodes to reposition them.'}
          {mode === 'edge' && 'Click two nodes to add or remove the street segment between them.'}
          {mode === 'add' && 'Click on the board to add a crossing (then connect it in edge mode).'}
          {mode === 'delete' && 'Click a crossing or junction to delete it with its segments.'}
        </p>
        <label><input type="checkbox" checked={showEdges} onChange={(e) => setShowEdges(e.target.checked)} /> show street segments</label>
        <div className="prompt">{selInfo || 'Nothing selected.'}</div>
        <p>{map.circles.length} circles · {map.crossings.length} crossings ({map.crossings.filter((x) => x.yellow).length} yellow) · {map.edges.length} segments · {map.blocks.length} blocks</p>
        <div className="row">
          <button disabled={!dirty && !localStorage.getItem(DRAFT)} onClick={download}>Download JSON</button>
          <button className="secondary" onClick={() => { localStorage.removeItem(DRAFT); setMap(structuredClone(MAP)); setDirty(false); }}>Reset to shipped map</button>
        </div>
        <p className="hint">Legend: cyan = walking neighbours / police steps, orange = alley, green = circles a crossing watches.
          Blocks (for alleys) are not re-derived here; run tools/build_map.py after large edits.</p>
        <p><a href="/">Back to the game</a></p>
      </aside>
    </div>
  );
}
