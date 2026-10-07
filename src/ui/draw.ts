import { LANDMARK_CONFIDENCE_THRESHOLD } from '../config';
import { jointIndex, landmarkPasses } from '../core/landmarks';
import type { PoseFrame, Side } from '../core/types';

const CONNECTIONS: [string, string][] = [
  ['shoulder', 'hip'],
  ['hip', 'knee'],
  ['knee', 'ankle'],
  ['ankle', 'heel'],
  ['heel', 'toe'],
  ['ankle', 'toe'],
];
const JOINTS = ['shoulder', 'hip', 'knee', 'ankle', 'heel', 'toe'] as const;

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export interface View {
  /** Source region (display-pixel coordinates of the full video) mapped onto the canvas. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * Skeleton overlay. Near side drawn thick in the accent color; far side thin
 * and gray. Landmarks that fail the confidence test are drawn as hollow red
 * rings and their segments are omitted (gaps are never filled).
 */
export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  frame: PoseFrame,
  near: Side,
  videoW: number,
  videoH: number,
  view: View,
): void {
  if (!frame) return;
  const c = ctx.canvas;
  const kx = c.width / view.sw;
  const ky = c.height / view.sh;
  const px = (i: number) => ({ x: (frame[i].x * videoW - view.sx) * kx, y: (frame[i].y * videoH - view.sy) * ky });
  const lw = Math.max(2, c.width / 220);
  for (const side of [near === 'left' ? 'right' : 'left', near] as Side[]) {
    const isNear = side === near;
    ctx.strokeStyle = isNear ? cssVar('--near', '#2a78d6') : 'rgba(200,200,200,0.55)';
    ctx.lineWidth = isNear ? lw * 1.6 : lw * 0.8;
    ctx.lineCap = 'round';
    for (const [a, b] of CONNECTIONS) {
      const ia = jointIndex(side, a as never);
      const ib = jointIndex(side, b as never);
      if (!landmarkPasses(frame[ia], LANDMARK_CONFIDENCE_THRESHOLD) || !landmarkPasses(frame[ib], LANDMARK_CONFIDENCE_THRESHOLD)) continue;
      const pa = px(ia);
      const pb = px(ib);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }
    for (const j of JOINTS) {
      const i = jointIndex(side, j);
      const p = px(i);
      const ok = landmarkPasses(frame[i], LANDMARK_CONFIDENCE_THRESHOLD);
      ctx.beginPath();
      ctx.arc(p.x, p.y, (isNear ? 2.4 : 1.6) * lw, 0, Math.PI * 2);
      if (ok) {
        ctx.fillStyle = isNear ? '#ffffff' : 'rgba(220,220,220,0.7)';
        ctx.fill();
      } else if (isNear) {
        ctx.strokeStyle = '#ff5252';
        ctx.lineWidth = lw;
        ctx.stroke();
        ctx.strokeStyle = cssVar('--near', '#2a78d6');
        ctx.lineWidth = lw * 1.6;
      }
    }
  }
}

/** Horizontal floor line (display-pixel y). */
export function drawFloor(ctx: CanvasRenderingContext2D, floorY: number, bandPx: number, view: View): void {
  const c = ctx.canvas;
  const ky = c.height / view.sh;
  const y = (floorY - view.sy) * ky;
  ctx.save();
  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = 'rgba(255,214,0,0.9)';
  ctx.lineWidth = Math.max(1.5, c.width / 400);
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(c.width, y);
  ctx.stroke();
  ctx.setLineDash([3, 5]);
  ctx.strokeStyle = 'rgba(255,214,0,0.5)';
  const yb = (floorY - bandPx - view.sy) * ky;
  ctx.beginPath();
  ctx.moveTo(0, yb);
  ctx.lineTo(c.width, yb);
  ctx.stroke();
  ctx.restore();
}

export interface Marker {
  frame: number;
  label: string;
}

/**
 * Single-series trace of a signal over time. Gaps (null) break the line.
 * Event markers are vertical rules with a text label (identity is never
 * color-only). Tapping or hovering shows the value at that time.
 */
export function traceChart(opts: {
  title: string;
  values: readonly (number | null)[];
  times: readonly number[];
  markers: Marker[];
  cursor?: number;
  refLine?: { value: number; label: string };
  format: (v: number) => string;
}): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'chart';
  const title = document.createElement('div');
  title.className = 'small';
  title.style.fontWeight = '600';
  title.textContent = opts.title;
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `${opts.title}; ${opts.markers.map((m) => `${m.label} at ${opts.times[m.frame]?.toFixed(3)} s`).join(', ')}`);
  const readout = document.createElement('div');
  readout.className = 'readout';
  readout.textContent = 'Tap the chart to read a value. Gaps = frames where the pose was not detected clearly.';
  wrap.append(title, canvas, readout);

  const vals = opts.values.filter((v): v is number => v !== null);
  const tMax = opts.times[opts.times.length - 1] || 1;
  let lo = Math.min(...vals, opts.refLine?.value ?? Infinity);
  let hi = Math.max(...vals, opts.refLine?.value ?? -Infinity);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    lo = 0;
    hi = 1;
  }
  if (hi - lo < 1e-9) hi = lo + 1;
  const pad = (hi - lo) * 0.08;
  lo -= pad;
  hi += pad;

  let hover: number | null = null;
  const draw = () => {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 320;
    const hgt = canvas.clientHeight || 130;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hgt * dpr);
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    const L = 4;
    const R = w - 4;
    const T = 16;
    const B = hgt - 16;
    const X = (t: number) => L + ((R - L) * t) / tMax;
    const Y = (v: number) => B - ((B - T) * (v - lo)) / (hi - lo);
    const muted = cssVar('--muted', '#74736f');
    const text2 = cssVar('--text-2', '#52514e');
    // recessive baseline grid
    ctx.strokeStyle = cssVar('--border', '#d6d8dc');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(L, B + 0.5);
    ctx.lineTo(R, B + 0.5);
    ctx.stroke();
    ctx.fillStyle = muted;
    ctx.font = '11px -apple-system, system-ui, sans-serif';
    ctx.fillText('0 s', L, hgt - 3);
    const endLabel = `${tMax.toFixed(1)} s`;
    ctx.fillText(endLabel, R - ctx.measureText(endLabel).width, hgt - 3);
    if (opts.refLine) {
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = muted;
      ctx.beginPath();
      ctx.moveTo(L, Y(opts.refLine.value));
      ctx.lineTo(R, Y(opts.refLine.value));
      ctx.stroke();
      ctx.restore();
      ctx.fillText(opts.refLine.label, L + 2, Y(opts.refLine.value) - 3);
    }
    // the series (2px line, broken at gaps)
    ctx.strokeStyle = cssVar('--series-1', '#2a78d6');
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let pen = false;
    opts.values.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      const x = X(opts.times[i]);
      const y = Y(v);
      if (pen) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      pen = true;
    });
    ctx.stroke();
    // markers
    ctx.fillStyle = text2;
    ctx.font = '600 11px -apple-system, system-ui, sans-serif';
    for (const m of opts.markers) {
      const x = X(opts.times[m.frame]);
      ctx.strokeStyle = text2;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, T - 2);
      ctx.lineTo(x + 0.5, B);
      ctx.stroke();
      ctx.fillText(m.label, Math.min(x + 3, R - ctx.measureText(m.label).width), T - 4);
    }
    const cur = hover ?? opts.cursor;
    if (cur !== undefined && cur !== null) {
      const x = X(opts.times[cur]);
      ctx.strokeStyle = cssVar('--accent', '#2a78d6');
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, T);
      ctx.lineTo(x, B);
      ctx.stroke();
      const v = opts.values[cur];
      if (v !== null && v !== undefined) {
        ctx.fillStyle = cssVar('--surface', '#fff');
        ctx.beginPath();
        ctx.arc(x, Y(v), 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = cssVar('--series-1', '#2a78d6');
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  };
  const pick = (clientX: number) => {
    const r = canvas.getBoundingClientRect();
    const t = ((clientX - r.left - 4) / (r.width - 8)) * tMax;
    let best = 0;
    for (let i = 0; i < opts.times.length; i++) if (Math.abs(opts.times[i] - t) < Math.abs(opts.times[best] - t)) best = i;
    hover = best;
    const v = opts.values[best];
    readout.textContent = `frame ${best} · ${opts.times[best].toFixed(3)} s · ${v === null ? 'no pose (gap)' : opts.format(v)}`;
    draw();
  };
  canvas.addEventListener('pointermove', (e) => pick(e.clientX));
  canvas.addEventListener('pointerdown', (e) => pick(e.clientX));
  new ResizeObserver(() => draw()).observe(canvas);
  requestAnimationFrame(draw);
  return wrap;
}
