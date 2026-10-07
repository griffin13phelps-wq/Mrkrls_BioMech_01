import type { Px } from './landmarks';

const DEG = 180 / Math.PI;

/**
 * Angle at vertex B formed by A–B–C, in degrees (0–180), from pixel
 * coordinates. 180 = the three points in a straight line.
 * Knee angle = angle(hip, knee, ankle); hip angle = angle(shoulder, hip, knee).
 */
export function jointAngleDeg(a: Px, b: Px, c: Px): number | null {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const n1 = Math.hypot(v1x, v1y);
  const n2 = Math.hypot(v2x, v2y);
  if (n1 === 0 || n2 === 0) return null;
  const cos = Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y) / (n1 * n2)));
  return Math.acos(cos) * DEG;
}

export const kneeAngleDeg = (hip: Px, knee: Px, ankle: Px) => jointAngleDeg(hip, knee, ankle);
export const hipAngleDeg = (shoulder: Px, hip: Px, knee: Px) => jointAngleDeg(shoulder, hip, knee);

/**
 * Trunk lean: the hip→shoulder line measured from vertical, 0–180°.
 * 0 = upright, 90 = horizontal, >90 = shoulder below hip.
 * Image y points down, so "up" is −y.
 */
export function trunkLeanDeg(hip: Px, shoulder: Px): number | null {
  const dx = shoulder.x - hip.x;
  const up = hip.y - shoulder.y; // positive when the shoulder is above the hip
  if (dx === 0 && up === 0) return null;
  return Math.atan2(Math.abs(dx), up) * DEG;
}

/**
 * Thigh angle: the hip→knee line measured from horizontal, −90 to 90°.
 * 0 = thigh parallel to the floor; positive = hip below knee; negative = hip above knee.
 * Image y points down, so the hip is below the knee when hip.y > knee.y.
 */
export function thighAngleDeg(hip: Px, knee: Px): number | null {
  const below = hip.y - knee.y; // positive when the hip is lower than the knee
  const dx = Math.abs(knee.x - hip.x);
  if (dx === 0 && below === 0) return null;
  return Math.atan2(below, dx) * DEG;
}

/** depth from bottom_thigh_angle_deg with a ± band around 0. */
export function depthFromThighAngle(thighDeg: number, bandDeg: number): 'above' | 'parallel' | 'below' {
  if (Math.abs(thighDeg) <= bandDeg) return 'parallel';
  return thighDeg > 0 ? 'below' : 'above';
}
