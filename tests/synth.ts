/**
 * Synthetic pose generator for tests. Builds 33-landmark MediaPipe-style frames
 * from a simple side-view stick figure whose LEFT side faces the camera.
 * All geometry is in pixels, then normalized by the video width/height.
 */
import type { Landmark, PoseFrame, PoseSeries } from '../src/core/types';
import { LM } from '../src/core/landmarks';

export const W = 1080;
export const H = 1920;
/** Leg length (thigh + shank) in px. */
export const LEG = 600;
/** Pixels per metre implied by LEG ≈ 0.9 m. */
export const PX_PER_M = LEG / 0.9;
export const FLOOR_Y = 1700;

export interface Figure {
  /** Ankle position (px). */
  ankleX: number;
  ankleY: number;
  /** Hip position (px). */
  hipX: number;
  hipY: number;
  /** Trunk lean from vertical (deg, forward = toward +x). */
  trunkLeanDeg: number;
  /** Extra vertical offset of the foot points relative to the ankle (px, negative = up, e.g., toe-off). */
}

const TRUNK = 0.55 * LEG;

function lm(x: number, y: number, vis: number): Landmark {
  return { x: x / W, y: y / H, z: 0, visibility: vis };
}

/** Knee from 2-link IK (thigh = shank = LEG/2), knee pointing forward (+x). */
export function kneeFor(hipX: number, hipY: number, ankleX: number, ankleY: number): { x: number; y: number } {
  const dx = ankleX - hipX;
  const dy = ankleY - hipY;
  const d = Math.min(Math.hypot(dx, dy), LEG - 1e-6);
  const half = LEG / 2;
  const h = Math.sqrt(Math.max(0, half * half - (d / 2) * (d / 2)));
  const mx = hipX + dx / 2;
  const my = hipY + dy / 2;
  const ux = dx / (Math.hypot(dx, dy) || 1);
  const uy = dy / (Math.hypot(dx, dy) || 1);
  // perpendicular toward +x
  let px = -uy;
  let py = ux;
  if (px < 0) {
    px = -px;
    py = -py;
  }
  return { x: mx + px * h, y: my + py * h };
}

export function frameFrom(f: Figure, nearVis = 0.99, farVis = 0.3): PoseFrame {
  const out: Landmark[] = Array.from({ length: 33 }, () => lm(W / 2, H / 2, 0.1));
  const knee = kneeFor(f.hipX, f.hipY, f.ankleX, f.ankleY);
  const lean = (f.trunkLeanDeg * Math.PI) / 180;
  const sh = { x: f.hipX + TRUNK * Math.sin(lean), y: f.hipY - TRUNK * Math.cos(lean) };
  const heel = { x: f.ankleX - 0.06 * LEG, y: f.ankleY + 0.07 * LEG };
  const toe = { x: f.ankleX + 0.2 * LEG, y: f.ankleY + 0.07 * LEG };
  const put = (li: number, ri: number, p: { x: number; y: number }) => {
    out[li] = lm(p.x, p.y, nearVis);
    out[ri] = lm(p.x + 4, p.y, farVis);
  };
  put(LM.leftShoulder, LM.rightShoulder, sh);
  put(LM.leftHip, LM.rightHip, { x: f.hipX, y: f.hipY });
  put(LM.leftKnee, LM.rightKnee, knee);
  put(LM.leftAnkle, LM.rightAnkle, { x: f.ankleX, y: f.ankleY });
  put(LM.leftHeel, LM.rightHeel, heel);
  put(LM.leftFootIndex, LM.rightFootIndex, toe);
  return out;
}

/** Ankle y when the foot rests on a surface whose top is at surfaceY. */
export const ankleOn = (surfaceY: number) => surfaceY - 0.07 * LEG;

/** Standing hip height above the ankle (slightly bent knees: 0.97 of leg). */
export const STAND_HIP_ABOVE_ANKLE = 0.97 * LEG;

export function series(frames: PoseFrame[], fps: number): PoseSeries {
  return { width: W, height: H, frames, times: frames.map((_, i) => i / fps) };
}

/** Seeded PRNG (mulberry32) and Gaussian noise for robustness tests. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => {
    const u = Math.max(next(), 1e-12);
    const v = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return { next, gauss };
}

export function addNoise(frames: PoseFrame[], sdPx: number, seed = 1): PoseFrame[] {
  const r = rng(seed);
  return frames.map((f) => (f ? f.map((p) => ({ ...p, x: p.x + (r.gauss() * sdPx) / W, y: p.y + (r.gauss() * sdPx) / H })) : null));
}

/** Projectile height (px, up positive) t seconds after takeoff with flight time T. */
export function flightHeightPx(t: number, T: number): number {
  const v0 = (9.81 * T) / 2;
  return Math.max(0, (v0 * t - 0.5 * 9.81 * t * t) * PX_PER_M);
}

/** Smooth 0→1 ramp (cosine). */
export const ease = (u: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));
