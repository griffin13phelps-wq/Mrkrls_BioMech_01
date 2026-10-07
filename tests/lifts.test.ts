import { describe, expect, it } from 'vitest';
import { analyzeLift, buildContext } from '../src/core/analysis';
import type { PoseFrame } from '../src/core/types';
import { FLOOR_Y, LEG, STAND_HIP_ABOVE_ANKLE, ankleOn, ease, frameFrom, series } from './synth';

const FPS = 30;
const ANKLE_X = 500;
const ANKLE_Y = ankleOn(FLOOR_Y);

interface Pose {
  hipAbove: number; // px above ankle
  hipBack: number; // px behind ankle
  lean: number; // deg
}
interface Seg {
  dur: number;
  from: Pose;
  to: Pose;
}

function build(segs: Seg[]): { frames: PoseFrame[]; marks: number[] } {
  const marks: number[] = [0];
  for (const s of segs) marks.push(marks[marks.length - 1] + s.dur);
  const n = Math.round(marks[marks.length - 1] * FPS);
  const frames: PoseFrame[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / FPS;
    let k = segs.findIndex((_, j) => t < marks[j + 1]);
    if (k < 0) k = segs.length - 1;
    const s = segs[k];
    const e = ease((t - marks[k]) / s.dur);
    const lerp = (a: number, b: number) => a + (b - a) * e;
    frames.push(
      frameFrom({
        ankleX: ANKLE_X,
        ankleY: ANKLE_Y,
        hipX: ANKLE_X - lerp(s.from.hipBack, s.to.hipBack),
        hipY: ANKLE_Y - lerp(s.from.hipAbove, s.to.hipAbove),
        trunkLeanDeg: lerp(s.from.lean, s.to.lean),
      }),
    );
  }
  return { frames, marks };
}

const hold = (dur: number, p: Pose): Seg => ({ dur, from: p, to: p });
const move = (dur: number, from: Pose, to: Pose): Seg => ({ dur, from, to });

describe('Squat', () => {
  const top: Pose = { hipAbove: STAND_HIP_ABOVE_ANKLE, hipBack: 0.05 * LEG, lean: 10 };
  const bottom: Pose = { hipAbove: 0.5 * LEG, hipBack: 0.3 * LEG, lean: 40 };
  const segs: Seg[] = [hold(1.5, top)];
  for (let r = 0; r < 3; r++) segs.push(move(1.2, top, bottom), move(1.0, bottom, top), hold(1.0, top));
  const built = build(segs);
  const s = series(built.frames, FPS);
  const ctx = buildContext(s, 'left');
  if (!ctx.ok) throw new Error(ctx.error);
  const res = analyzeLift(ctx.value, 'squat', 'back');

  it('counts 3 reps', () => {
    expect(res.reps).toHaveLength(3);
    expect(res.partial).toBe(0);
  });

  it('bottom frame = lowest hip, at the true bottom (±1 frame)', () => {
    res.reps.forEach((r, k) => {
      const trueBottom = built.marks[1 + 3 * k + 1]; // end of the k-th "down" segment
      expect(Math.abs(s.times[r.bottom] - trueBottom)).toBeLessThanOrEqual(1 / FPS + 1e-9);
      // lowest hip y (largest pixel y) inside the rep
      const ys = ctx.value.smooth.hip.slice(r.rep.start, r.rep.end + 1).map((p) => p!.y);
      expect(ctx.value.smooth.hip[r.bottom]!.y).toBe(Math.max(...ys));
    });
  });

  it('down/up phase times follow the 5%–95% band rule', () => {
    // Cosine ease: the 5% and 95% points are 71.3% of the movement duration apart.
    for (const r of res.reps) {
      expect(Math.abs(r.measures.downTimeMs! - 0.7128 * 1200)).toBeLessThanOrEqual(70);
      expect(Math.abs(r.measures.upTimeMs! - 0.7128 * 1000)).toBeLessThanOrEqual(70);
    }
  });

  it('bottom angles, thigh angle, depth and trunk lean', () => {
    for (const r of res.reps) {
      const m = r.measures;
      expect(m.bottomKneeAngleDeg!).toBeGreaterThan(0);
      expect(m.bottomKneeAngleDeg!).toBeLessThan(120);
      expect(m.bottomHipAngleDeg!).toBeLessThan(120);
      expect(Math.abs(m.maxTrunkLeanDeg! - 40)).toBeLessThan(1.5);
      expect(m.bottomThighAngleDeg).not.toBeNull();
      const t = m.bottomThighAngleDeg!;
      expect(m.depth).toBe(Math.abs(t) <= 2 ? 'parallel' : t > 0 ? 'below' : 'above');
      expect(m.bodyDetectedPct).toBe(100);
    }
  });
});

describe('Hinge', () => {
  // RDL: hips travel BACK a lot and drop only a little; trunk leans far forward.
  const top: Pose = { hipAbove: STAND_HIP_ABOVE_ANKLE, hipBack: 0.05 * LEG, lean: 8 };
  const bottom: Pose = { hipAbove: STAND_HIP_ABOVE_ANKLE - 0.06 * LEG, hipBack: 0.3 * LEG, lean: 75 };
  const segs: Seg[] = [hold(1.0, top)];
  for (let r = 0; r < 3; r++) segs.push(move(1.4, top, bottom), move(1.1, bottom, top), hold(0.8, top));
  const built = build(segs);
  const s = series(built.frames, FPS);
  const ctx = buildContext(s, 'left');
  if (!ctx.ok) throw new Error(ctx.error);

  it('detects 3 reps from the hip angle', () => {
    const res = analyzeLift(ctx.value, 'hinge', 'rdl');
    expect(res.reps).toHaveLength(3);
    res.reps.forEach((r, k) => {
      const trueBottom = built.marks[1 + 3 * k + 1];
      expect(Math.abs(s.times[r.bottom] - trueBottom)).toBeLessThanOrEqual(1 / FPS + 1e-9);
      // bottom frame = smallest hip angle in the rep
      const angles = ctx.value.hipAngle.slice(r.rep.start, r.rep.end + 1) as number[];
      expect(ctx.value.hipAngle[r.bottom]).toBe(Math.min(...angles));
      expect(r.measures.depth).toBeUndefined();
      expect(r.measures.bottomThighAngleDeg).toBeUndefined();
    });
  });

  it('the same movement is NOT found from hip height (hips mostly move back, not down)', () => {
    expect(analyzeLift(ctx.value, 'squat', 'back').reps).toHaveLength(0);
  });
});

describe('Deadlift from the floor (lift first, then lower)', () => {
  const stand: Pose = { hipAbove: STAND_HIP_ABOVE_ANKLE, hipBack: 0.05 * LEG, lean: 5 };
  const setup: Pose = { hipAbove: 0.62 * LEG, hipBack: 0.3 * LEG, lean: 60 };
  const segs: Seg[] = [
    hold(1.0, stand), // walk-in, standing
    move(0.8, stand, setup), // bend down to the bar (not a rep)
    hold(1.0, setup),
    move(1.0, setup, stand), // rep 1 up
    hold(0.5, stand),
    move(1.2, stand, setup), // rep 1 down
    hold(0.6, setup),
    move(1.0, setup, stand), // rep 2 up
    hold(0.5, stand),
    move(1.2, stand, setup), // rep 2 down
    hold(0.6, setup),
    move(0.8, setup, stand), // stand up after releasing the bar (not a rep)
    hold(1.0, stand),
  ];
  const built = build(segs);
  const s = series(built.frames, FPS);
  const ctx = buildContext(s, 'left');
  if (!ctx.ok) throw new Error(ctx.error);
  const res = analyzeLift(ctx.value, 'hinge', 'conventional');

  it('finds 2 reps and ignores the walk-in and the final stand-up', () => {
    expect(res.reps).toHaveLength(2);
    expect(res.partial).toBe(2);
  });

  it('up phase comes before down phase', () => {
    for (const r of res.reps) {
      expect(r.rep.up.start).toBeLessThan(r.rep.down.start);
      expect(Math.abs(r.measures.upTimeMs! - 0.7128 * 1000)).toBeLessThanOrEqual(70);
      expect(Math.abs(r.measures.downTimeMs! - 0.7128 * 1200)).toBeLessThanOrEqual(70);
    }
  });
});
