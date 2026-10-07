import { describe, expect, it } from 'vitest';
import { buildContext, detectJumpEvents, measureJump } from '../src/core/analysis';
import type { PoseFrame } from '../src/core/types';
import {
  FLOOR_Y,
  LEG,
  PX_PER_M,
  STAND_HIP_ABOVE_ANKLE,
  addNoise,
  ankleOn,
  ease,
  flightHeightPx,
  frameFrom,
  series,
} from './synth';

const FPS = 240;
const ANKLE_FLOOR = ankleOn(FLOOR_Y);

/** Squat-depth hip (above ankle) for a ~90° knee with the hip 0.25 leg behind the ankle. */
const HIP90_ABOVE_ANKLE = Math.sqrt(0.5 - 0.0625) * LEG;

interface Seg {
  dur: number; // seconds
  /** hip height above ankle (px) and body lift (px above floor contact), as functions of u ∈ [0, 1] */
  hip: (u: number, t: number) => number;
  lift?: (u: number, t: number) => number;
  hipBack?: (u: number) => number;
}

interface Built {
  frames: PoseFrame[];
  /** Times (s) of segment boundaries. */
  marks: number[];
}

/** Build frames from segments on a flat floor. */
function build(segs: Seg[], ankleX = 400): Built {
  const total = segs.reduce((a, s) => a + s.dur, 0);
  const n = Math.round(total * FPS);
  const marks: number[] = [];
  let acc = 0;
  for (const s of segs) {
    marks.push(acc);
    acc += s.dur;
  }
  marks.push(acc);
  const frames: PoseFrame[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / FPS;
    let k = segs.length - 1;
    for (let j = 0; j < segs.length; j++)
      if (t < marks[j + 1]) {
        k = j;
        break;
      }
    const s = segs[k];
    const u = (t - marks[k]) / s.dur;
    const local = t - marks[k];
    const lift = s.lift ? s.lift(u, local) : 0;
    const back = s.hipBack ? s.hipBack(u) : 0.05 * LEG;
    const ankleY = ANKLE_FLOOR - lift;
    frames.push(
      frameFrom({ ankleX, ankleY, hipX: ankleX - back, hipY: ankleY - s.hip(u, local), trunkLeanDeg: 10 }),
    );
  }
  return { frames, marks };
}

const STAND = STAND_HIP_ABOVE_ANKLE;
const stand = (dur: number): Seg => ({ dur, hip: () => STAND });

function cmjSegs(T: number): Seg[] {
  const low = STAND - 0.25 * LEG;
  return [
    stand(1.0),
    { dur: 0.5, hip: (u) => STAND - (STAND - low) * ease(u) },
    { dur: 0.3, hip: (u) => low + (STAND + 0.02 * LEG - low) * ease(u) },
    { dur: T, hip: () => STAND + 0.02 * LEG, lift: (_u, t) => flightHeightPx(t, T) },
    { dur: 0.3, hip: (u) => STAND - 0.15 * LEG * Math.sin(Math.PI * u) },
    stand(1.0),
  ];
}

describe('CMJ event detection', () => {
  it('finds both jumps; suggested frames are within 3 frames of the true events', () => {
    const a = cmjSegs(0.5);
    const b = cmjSegs(0.42);
    const built = build([...a, ...b]);
    const s = series(built.frames, FPS);
    const ctx = buildContext(s, 'left');
    expect(ctx.ok).toBe(true);
    if (!ctx.ok) return;
    const res = detectJumpEvents(ctx.value, 'cmj');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.jumps).toHaveLength(2);
    const trueTakeoffs = [built.marks[3], built.marks[6 + 3]];
    const trueLandings = [built.marks[4], built.marks[6 + 4]];
    res.jumps.forEach((j, k) => {
      const takeoffT = s.times[j.takeoff];
      const landingT = s.times[j.landing];
      expect(takeoffT).toBeGreaterThan(trueTakeoffs[k]);
      expect(takeoffT - trueTakeoffs[k]).toBeLessThanOrEqual(3 / FPS + 1e-9);
      expect(landingT).toBeLessThanOrEqual(trueLandings[k] + 1e-9);
      expect(trueLandings[k] - landingT).toBeLessThanOrEqual(3 / FPS + 1e-9);
    });
    const m = measureJump(ctx.value, 'cmj', res.jumps[0], false).measures;
    expect(m.flightTimeMs!).toBeGreaterThan(470);
    expect(m.flightTimeMs!).toBeLessThanOrEqual(500);
    expect(m.bodyDetectedPct).toBe(100);
    expect(m.framesAdjusted).toBe(false);
  });

  it('still finds the jump with 2 px landmark noise', () => {
    const built = build(cmjSegs(0.5));
    const s = series(addNoise(built.frames, 2, 7), FPS);
    const ctx = buildContext(s, 'left');
    if (!ctx.ok) throw new Error(ctx.error);
    const res = detectJumpEvents(ctx.value, 'cmj');
    if (!res.ok) throw new Error(res.error);
    expect(res.jumps).toHaveLength(1);
    const flight = measureJump(ctx.value, 'cmj', res.jumps[0], false).measures.flightTimeMs!;
    expect(Math.abs(flight - 500)).toBeLessThan(40);
  });

  it('reports a clear error when the floor cannot be found', () => {
    const built = build(cmjSegs(0.5));
    // heel and toe never detected → no floor can be established
    const frames = built.frames.map((f) => (f ? f.map((p, i) => (i >= 29 ? { ...p, visibility: 0.1 } : p)) : f));
    const ctx = buildContext(series(frames, FPS), 'left');
    if (!ctx.ok) throw new Error(ctx.error);
    const res = detectJumpEvents(ctx.value, 'cmj');
    expect(res.ok).toBe(false);
  });
});

describe('Drop jump', () => {
  it('ignores the step-down from the box; measures ground contact and the rebound only', () => {
    const boxPx = 0.4 * PX_PER_M; // 40 cm box
    const boxTop = FLOOR_Y - boxPx;
    const fall = Math.sqrt((2 * 0.4) / 9.81); // ≈ 0.286 s to fall 40 cm
    const T = 0.47;
    const contact = 0.22;
    const frames: PoseFrame[] = [];
    const tStep = 1.0;
    const tContact = tStep + fall;
    const tTakeoff = tContact + contact;
    const tLanding = tTakeoff + T;
    const end = tLanding + 1.3;
    for (let i = 0; i < Math.round(end * FPS); i++) {
      const t = i / FPS;
      let ankleX = 300;
      let ankleY = ankleOn(boxTop);
      let hipAbove = STAND;
      if (t >= tStep && t < tContact) {
        const tt = t - tStep;
        ankleX = 300 + 0.3 * PX_PER_M * (tt / fall);
        ankleY = ankleOn(boxTop) + 0.5 * 9.81 * tt * tt * PX_PER_M;
      } else if (t >= tContact && t < tTakeoff) {
        ankleX = 300 + 0.3 * PX_PER_M;
        ankleY = ankleOn(FLOOR_Y);
        hipAbove = STAND - 0.2 * LEG * Math.sin((Math.PI * (t - tContact)) / contact);
      } else if (t >= tTakeoff && t < tLanding) {
        ankleX = 300 + 0.3 * PX_PER_M;
        ankleY = ankleOn(FLOOR_Y) - flightHeightPx(t - tTakeoff, T);
        hipAbove = STAND + 0.02 * LEG;
      } else if (t >= tLanding) {
        ankleX = 300 + 0.3 * PX_PER_M;
        ankleY = ankleOn(FLOOR_Y);
        hipAbove = t < tLanding + 0.3 ? STAND - 0.15 * LEG * Math.sin((Math.PI * (t - tLanding)) / 0.3) : STAND;
      }
      frames.push(frameFrom({ ankleX, ankleY, hipX: ankleX - 0.05 * LEG, hipY: ankleY - hipAbove, trunkLeanDeg: 10 }));
    }
    const s = series(frames, FPS);
    const ctx = buildContext(s, 'left');
    if (!ctx.ok) throw new Error(ctx.error);
    const res = detectJumpEvents(ctx.value, 'drop_jump');
    if (!res.ok) throw new Error(res.error);
    expect(res.floor.boxY).not.toBeNull();
    expect(res.jumps).toHaveLength(1);
    const j = res.jumps[0];
    // The ground contact is the floor touch after the step-down (not the step-off from the box).
    expect(Math.abs(s.times[j.contact!] - tContact)).toBeLessThanOrEqual(3 / FPS);
    expect(Math.abs(s.times[j.takeoff] - tTakeoff)).toBeLessThanOrEqual(3 / FPS);
    expect(Math.abs(s.times[j.landing] - tLanding)).toBeLessThanOrEqual(3 / FPS);
    const m = measureJump(ctx.value, 'drop_jump', j, false).measures;
    // Flight is the rebound (≈470 ms), NOT the ≈286 ms step-down.
    expect(Math.abs(m.flightTimeMs! - 470)).toBeLessThan(30);
    expect(Math.abs(m.flightTimeMs! - fall * 1000)).toBeGreaterThan(100);
    expect(Math.abs(m.contactTimeMs! - 220)).toBeLessThan(30);
    expect(m.rsi).toBeCloseTo(m.jumpHeightCm! / 100 / (m.contactTimeMs! / 1000), 9);
  });

  it('errors clearly when no box is found', () => {
    const built = build(cmjSegs(0.5));
    const ctx = buildContext(series(built.frames, FPS), 'left');
    if (!ctx.ok) throw new Error(ctx.error);
    expect(detectJumpEvents(ctx.value, 'drop_jump').ok).toBe(false);
  });
});

describe('Squat jump hold and dip', () => {
  const low = HIP90_ABOVE_ANKLE;
  const sjSegs = (holdS: number, dipLeg = 0): Seg[] => {
    const T = 0.45;
    const segs: Seg[] = [stand(1.0), { dur: 0.8, hip: (u) => STAND - (STAND - low) * ease(u), hipBack: (u) => 0.05 * LEG + 0.2 * LEG * ease(u) }];
    if (holdS > 0) segs.push({ dur: holdS, hip: () => low, hipBack: () => 0.25 * LEG });
    let bottom = low;
    if (dipLeg > 0) {
      segs.push({ dur: 0.15, hip: (u) => low - dipLeg * LEG * ease(u), hipBack: () => 0.25 * LEG });
      bottom = low - dipLeg * LEG;
    }
    segs.push(
      { dur: 0.35, hip: (u) => bottom + (STAND + 0.02 * LEG - bottom) * ease(u), hipBack: (u) => 0.25 * LEG - 0.2 * LEG * ease(u) },
      { dur: T, hip: () => STAND + 0.02 * LEG, lift: (_u, t) => flightHeightPx(t, T) },
      { dur: 0.3, hip: (u) => STAND - 0.15 * LEG * Math.sin(Math.PI * u) },
      stand(1.0),
    );
    return segs;
  };

  const run = (segs: Seg[]) => {
    const s = series(build(segs).frames, FPS);
    const ctx = buildContext(s, 'left');
    if (!ctx.ok) throw new Error(ctx.error);
    const ev = detectJumpEvents(ctx.value, 'squat_jump');
    if (!ev.ok) throw new Error(ev.error);
    expect(ev.jumps).toHaveLength(1);
    return measureJump(ctx.value, 'squat_jump', ev.jumps[0], false).measures;
  };

  it('no pause at the bottom → hold_time_ms = 0', () => {
    const m = run(sjSegs(0));
    expect(m.holdTimeMs).toBe(0);
    expect(m.startKneeAngleDeg).toBeNull();
    expect(m.dipBeforeTakeoff).toBeNull();
  });

  it('3 s hold at 90° → hold ≈ 3000 ms, start knee ≈ 90°, no dip', () => {
    const m = run(sjSegs(3));
    expect(Math.abs(m.holdTimeMs! - 3000)).toBeLessThan(150);
    expect(Math.abs(m.startKneeAngleDeg! - 90)).toBeLessThan(2);
    expect(m.dipBeforeTakeoff).toBe(false);
  });

  it('hips dropping 6% of leg length after the hold → dip = Y', () => {
    const m = run(sjSegs(3, 0.06));
    expect(m.holdTimeMs!).toBeGreaterThan(2800);
    expect(m.dipBeforeTakeoff).toBe(true);
  });
});
