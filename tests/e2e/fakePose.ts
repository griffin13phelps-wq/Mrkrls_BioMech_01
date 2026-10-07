/**
 * Stand-in pose detector for the browser smoke test (the real MediaPipe model
 * cannot be downloaded in the build sandbox). It returns landmarks for a known
 * synthetic movement as a function of the frame timestamp, and records what
 * the decoded, rotated frame looked like so the test can check orientation.
 */
import { FLOOR_Y, LEG, PX_PER_M, STAND_HIP_ABOVE_ANKLE, ankleOn, ease, flightHeightPx, frameFrom } from '../synth';
import type { PoseFrame } from '../../src/core/types';

type Scenario = 'cmj' | 'squat';
const STAND = STAND_HIP_ABOVE_ANKLE;
const ANKLE_FLOOR = ankleOn(FLOOR_Y);

/** CMJ, flight 0.5 s: stand 1.0 · down 0.5 · up 0.3 · flight 0.5 · absorb 0.3 · stand 1.0 */
function cmj(t: number): PoseFrame {
  const low = STAND - 0.25 * LEG;
  const T = 0.5;
  const marks = [0, 1.0, 1.5, 1.8, 1.8 + T, 2.1 + T, 3.1 + T];
  let hip = STAND;
  let lift = 0;
  if (t >= marks[1] && t < marks[2]) hip = STAND - (STAND - low) * ease((t - marks[1]) / 0.5);
  else if (t >= marks[2] && t < marks[3]) hip = low + (STAND + 0.02 * LEG - low) * ease((t - marks[2]) / 0.3);
  else if (t >= marks[3] && t < marks[4]) {
    hip = STAND + 0.02 * LEG;
    lift = flightHeightPx(t - marks[3], T);
  } else if (t >= marks[4] && t < marks[5]) hip = STAND - 0.15 * LEG * Math.sin((Math.PI * (t - marks[4])) / 0.3);
  const ankleY = ANKLE_FLOOR - lift;
  return frameFrom({ ankleX: 400, ankleY, hipX: 400 - 0.05 * LEG, hipY: ankleY - hip, trunkLeanDeg: 10 });
}

/** 3 squats: stand 1.5, then (down 1.2, up 1.0, stand 1.0) × 3 */
function squat(t: number): PoseFrame {
  const top = { a: STAND, b: 0.05 * LEG, l: 10 };
  const bot = { a: 0.5 * LEG, b: 0.3 * LEG, l: 40 };
  let u = 0;
  if (t >= 1.5) {
    const k = (t - 1.5) % 3.2;
    u = k < 1.2 ? ease(k / 1.2) : k < 2.2 ? 1 - ease((k - 1.2) / 1.0) : 0;
    if (t >= 1.5 + 3 * 3.2) u = 0;
  }
  const lerp = (x: number, y: number) => x + (y - x) * u;
  return frameFrom({ ankleX: 500, ankleY: ANKLE_FLOOR, hipX: 500 - lerp(top.b, bot.b), hipY: ANKLE_FLOOR - lerp(top.a, bot.a), trunkLeanDeg: lerp(top.l, bot.l) });
}

interface Probe {
  width: number;
  height: number;
  topLeft: number[];
  topRight: number[];
  bottomLeft: number[];
  calls: number;
  timestamps: number[];
}

const w = window as unknown as { __SCENARIO__?: Scenario; __POSE_PROBE__?: Probe; __LIFTLAB_TEST_POSE__?: unknown };
w.__LIFTLAB_TEST_POSE__ = {
  label: 'TEST STAND-IN DETECTOR (synthetic landmarks)',
  detect(image: HTMLCanvasElement, tsMs: number) {
    if (!w.__POSE_PROBE__) {
      const c = image.getContext('2d')!;
      const px = (x: number, y: number) => Array.from(c.getImageData(x, y, 1, 1).data.slice(0, 3));
      w.__POSE_PROBE__ = {
        width: image.width,
        height: image.height,
        topLeft: px(3, 3),
        topRight: px(image.width - 4, 3),
        bottomLeft: px(3, image.height - 4),
        calls: 0,
        timestamps: [],
      };
    }
    const p = w.__POSE_PROBE__;
    p.calls++;
    if (p.timestamps.length < 5) p.timestamps.push(tsMs);
    const t = tsMs / 1000;
    return (w.__SCENARIO__ === 'squat' ? squat : cmj)(t);
  },
};
void PX_PER_M;
