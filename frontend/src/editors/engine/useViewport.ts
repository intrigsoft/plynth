import { useCallback, useEffect, useRef, useState } from 'react';
import { clamp, type BBox } from './geometry';

const MIN = 0.3;
const MAX = 2.4;

export interface Viewport {
  vpRef: React.RefObject<HTMLDivElement>;
  tx: number;
  ty: number;
  scale: number;
  panning: boolean;
  /** screen (client) coords → world coords */
  toWorld: (clientX: number, clientY: number) => { x: number; y: number };
  /** begin a pan drag from a pointer-down event */
  beginPan: (e: { clientX: number; clientY: number }) => void;
  /** zoom by a factor, anchored at the viewport center */
  zoomBy: (factor: number) => void;
  /** fit a world bbox into the viewport */
  fitTo: (b: BBox, maxScale?: number) => void;
  setTransform: (t: { tx: number; ty: number; scale: number }) => void;
}

export function useViewport(): Viewport {
  const vpRef = useRef<HTMLDivElement>(null);
  const [{ tx, ty, scale }, setT] = useState({ tx: 40, ty: 30, scale: 1 });
  const [panning, setPanning] = useState(false);
  const t = useRef({ tx, ty, scale });
  t.current = { tx, ty, scale };

  const toWorld = useCallback((cx: number, cy: number) => {
    const r = vpRef.current?.getBoundingClientRect();
    const { tx: x, ty: y, scale: s } = t.current;
    const left = r?.left ?? 0;
    const top = r?.top ?? 0;
    return { x: (cx - left - x) / s, y: (cy - top - y) / s };
  }, []);

  const setTransform = useCallback((nt: { tx: number; ty: number; scale: number }) => setT(nt), []);

  const beginPan = useCallback((e: { clientX: number; clientY: number }) => {
    const start = { sx: e.clientX, sy: e.clientY, otx: t.current.tx, oty: t.current.ty };
    setPanning(true);
    const move = (ev: PointerEvent) => {
      setT((cur) => ({ ...cur, tx: start.otx + (ev.clientX - start.sx), ty: start.oty + (ev.clientY - start.sy) }));
    };
    const up = () => {
      setPanning(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, []);

  const zoomAt = useCallback((cx: number, cy: number, factor: number) => {
    setT((cur) => {
      const ns = clamp(cur.scale * factor, MIN, MAX);
      const r = vpRef.current?.getBoundingClientRect();
      const mx = cx - (r?.left ?? 0);
      const my = cy - (r?.top ?? 0);
      const wx = (mx - cur.tx) / cur.scale;
      const wy = (my - cur.ty) / cur.scale;
      return { scale: ns, tx: mx - wx * ns, ty: my - wy * ns };
    });
  }, []);

  const zoomBy = useCallback((factor: number) => {
    const r = vpRef.current?.getBoundingClientRect();
    if (!r) return;
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
  }, [zoomAt]);

  const fitTo = useCallback((b: BBox, maxScale = 1.15) => {
    const r = vpRef.current?.getBoundingClientRect();
    if (!r) return;
    const pad = 70;
    const bw = Math.max(1, b.maxX - b.minX);
    const bh = Math.max(1, b.maxY - b.minY);
    const s = clamp(Math.min((r.width - pad * 2) / bw, (r.height - pad * 2) / bh), MIN, maxScale);
    const ntx = (r.width - (b.maxX + b.minX) * s) / 2;
    const nty = (r.height - (b.maxY + b.minY) * s) / 2;
    setT({ tx: ntx, ty: nty, scale: s });
  }, []);

  // wheel zoom (non-passive so we can preventDefault)
  useEffect(() => {
    const el = vpRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, 1 - e.deltaY * 0.0014);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  return { vpRef, tx, ty, scale, panning, toWorld, beginPan, zoomBy, fitTo, setTransform };
}
