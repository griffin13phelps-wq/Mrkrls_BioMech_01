import { describe, expect, it } from 'vitest';
import { depthFromThighAngle, jointAngleDeg, kneeAngleDeg, thighAngleDeg, trunkLeanDeg } from '../src/core/angles';
import { toPx } from '../src/core/landmarks';
import type { Landmark } from '../src/core/types';

const L = (x: number, y: number): Landmark => ({ x, y, z: 0, visibility: 1 });

describe('angle math uses pixel units', () => {
  it('1080 × 1920 portrait video: a true 90° knee stays 90°', () => {
    const W = 1080;
    const H = 1920;
    // Pixel positions: knee (540, 960); hip 200 px up-left; ankle 200 px up-right → 90° in real space.
    const knee = L(540 / W, 960 / H);
    const hip = L(340 / W, 760 / H);
    const ankle = L(740 / W, 760 / H);
    const px = kneeAngleDeg(toPx(hip, W, H), toPx(knee, W, H), toPx(ankle, W, H))!;
    expect(px).toBeCloseTo(90, 9);
    // Using normalized coordinates directly would be wrong (≈121.3°), proving the correction matters.
    const naive = jointAngleDeg(hip, knee, ankle)!;
    expect(naive).toBeCloseTo(121.3, 1);
  });

  it('straight leg = 180°', () => {
    expect(kneeAngleDeg({ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 0, y: 20 })).toBeCloseTo(180, 9);
  });

  it('trunk lean from vertical, image y pointing down', () => {
    expect(trunkLeanDeg({ x: 0, y: 100 }, { x: 0, y: 0 })).toBeCloseTo(0, 9); // shoulder straight above hip
    expect(trunkLeanDeg({ x: 0, y: 100 }, { x: 100, y: 0 })).toBeCloseTo(45, 9);
    expect(trunkLeanDeg({ x: 0, y: 100 }, { x: -100, y: 100 })).toBeCloseTo(90, 9);
    expect(trunkLeanDeg({ x: 0, y: 100 }, { x: 0, y: 200 })).toBeCloseTo(180, 9); // shoulder below hip
  });

  it('thigh angle: 0 = parallel, + = hip below knee, − = hip above knee', () => {
    expect(thighAngleDeg({ x: 0, y: 500 }, { x: 200, y: 500 })).toBeCloseTo(0, 9);
    expect(thighAngleDeg({ x: 0, y: 520 }, { x: 200, y: 500 })).toBeGreaterThan(0); // hip lower on screen = lower in world
    expect(thighAngleDeg({ x: 0, y: 480 }, { x: 200, y: 500 })).toBeLessThan(0);
    expect(thighAngleDeg({ x: 0, y: 700 }, { x: 200, y: 500 })).toBeCloseTo(45, 9);
  });

  it('thigh angle respects non-square scaling', () => {
    const W = 1080;
    const H = 1920;
    // 100 px right, 100 px down in pixels = 45°; normalized deltas (0.0926, 0.0521) would give 29.4°.
    const hip = toPx(L(540 / W, 1060 / H), W, H);
    const knee = toPx(L(640 / W, 960 / H), W, H);
    expect(thighAngleDeg(hip, knee)).toBeCloseTo(45, 9);
  });

  it('depth band', () => {
    expect(depthFromThighAngle(1.9, 2)).toBe('parallel');
    expect(depthFromThighAngle(-2, 2)).toBe('parallel');
    expect(depthFromThighAngle(2.1, 2)).toBe('below');
    expect(depthFromThighAngle(-2.1, 2)).toBe('above');
  });
});
