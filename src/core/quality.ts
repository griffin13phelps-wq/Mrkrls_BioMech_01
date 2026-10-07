import { jointsPass, type Joint } from './landmarks';
import type { PoseFrame, Side } from './types';
import { firstFrameAtOrAfter } from './timing';

/**
 * body_detected_pct for one rep: the % of frames in [first, last] (inclusive)
 * where every key near-side landmark passes the confidence test
 * (visibility >= threshold, presence >= threshold when reported, inside the image).
 */
export function bodyDetectedPct(
  frames: readonly PoseFrame[],
  side: Side,
  joints: readonly Joint[],
  first: number,
  last: number,
  threshold: number,
): number | null {
  const a = Math.max(0, first);
  const b = Math.min(frames.length - 1, last);
  if (b < a) return null;
  let ok = 0;
  for (let i = a; i <= b; i++) if (jointsPass(frames[i], side, joints, threshold)) ok++;
  return (100 * ok) / (b - a + 1);
}

/** Jump window: from `windowMs` before the start event (takeoff, or ground contact for drop jumps) through landing. */
export function jumpQualityWindow(times: readonly number[], startEvent: number, landing: number, windowMs: number): [number, number] {
  // 1 µs tolerance so float rounding never drops the frame exactly at the window start
  const first = firstFrameAtOrAfter(times, times[startEvent] - windowMs / 1000 - 1e-6);
  return [first, landing];
}

/** % of frames that contain any detected person. */
export function personDetectedPct(frames: readonly PoseFrame[]): number {
  if (frames.length === 0) return 0;
  return (100 * frames.filter((f) => f !== null).length) / frames.length;
}
