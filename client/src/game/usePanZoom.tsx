import { useRef, useState } from 'react';

/** Wheel zoom + drag pan on an SVG viewBox. A drag never counts as a click. */
export function usePanZoom(W: number, H: number) {
  const [vb, setVb] = useState({ x: 0, y: 0, w: W, h: H });
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const clamp = (v: typeof vb) => ({ ...v, x: Math.min(Math.max(0, v.x), W - v.w), y: Math.min(Math.max(0, v.y), H - v.h) });

  /** client (screen) coordinates -> board coordinates (viewBox uses the default "xMidYMid meet") */
  const toSvg = (cx: number, cy: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    const scale = Math.min(r.width / vb.w, r.height / vb.h);
    const ox = (r.width - vb.w * scale) / 2;
    const oy = (r.height - vb.h * scale) / 2;
    return { x: vb.x + (cx - r.left - ox) / scale, y: vb.y + (cy - r.top - oy) / scale, scale };
  };

  const zoomAt = (x: number, y: number, f: number) => setVb((v) => {
    const w = Math.min(W, Math.max(W / 10, v.w * f));
    const h = (w / W) * H;
    const k = w / v.w;
    return clamp({ x: x - (x - v.x) * k, y: y - (y - v.y) * k, w, h });
  });

  const svgProps = {
    ref: svgRef,
    viewBox: `${vb.x} ${vb.y} ${vb.w} ${vb.h}`,
    onWheel: (e: React.WheelEvent) => {
      const { x, y } = toSvg(e.clientX, e.clientY);
      zoomAt(x, y, e.deltaY > 0 ? 1.15 : 1 / 1.15);
    },
    onPointerDown: (e: React.PointerEvent) => {
      drag.current = { x: e.clientX, y: e.clientY, vx: vb.x, vy: vb.y, moved: false };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 5) return;
      d.moved = true;
      const { scale } = toSvg(e.clientX, e.clientY);
      setVb((v) => clamp({ ...v, x: d.vx - dx / scale, y: d.vy - dy / scale }));
    },
    onPointerUp: () => {
      suppressClick.current = !!drag.current?.moved;
      drag.current = null;
    },
    onPointerLeave: () => { drag.current = null; },
  };

  /** Wrap a click handler so it is ignored right after a drag. */
  const guard = (fn?: () => void) => () => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    fn?.();
  };

  const controls = (
    <div className="zoom">
      <button className="small" onClick={() => zoomAt(vb.x + vb.w / 2, vb.y + vb.h / 2, 0.7)}>+</button>
      <button className="small" onClick={() => zoomAt(vb.x + vb.w / 2, vb.y + vb.h / 2, 1 / 0.7)}>−</button>
      <button className="small" onClick={() => setVb({ x: 0, y: 0, w: W, h: H })}>Fit</button>
    </div>
  );

  return { vb, svgProps, guard, controls, toSvg, drag };
}
