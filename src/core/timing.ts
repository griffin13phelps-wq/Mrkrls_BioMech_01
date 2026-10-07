/**
 * Frame timing. Every time measurement in LiftLab is computed as
 *   time(frame B) − time(frame A)
 * from a per-frame time array (seconds). That array comes either from the
 * container's per-frame presentation timestamps or, when those are not usable,
 * from frame index ÷ frame rate.
 */

export type TimingMethod = 'container-timestamps' | 'frame-count';

/** Times (s) for frame-count timing: frame i is at i ÷ fps. */
export function frameCountTimes(frameCount: number, fps: number): number[] {
  return Array.from({ length: frameCount }, (_, i) => i / fps);
}

/** Milliseconds between two frames. */
export function msBetween(times: readonly number[], fromFrame: number, toFrame: number): number {
  return (times[toFrame] - times[fromFrame]) * 1000;
}

/** Are these timestamps usable (finite and strictly increasing)? */
export function timestampsUsable(times: readonly number[]): boolean {
  if (times.length < 2) return false;
  for (let i = 0; i < times.length; i++) {
    if (!Number.isFinite(times[i])) return false;
    if (i > 0 && !(times[i] > times[i - 1])) return false;
  }
  return true;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

export interface FrameRateInfo {
  /** Mean frame rate = frame count ÷ total duration of all frames. */
  meanFps: number;
  /** 1 ÷ median frame interval. */
  medianFps: number;
  /** Fraction of frame intervals that differ from the median by more than the tolerance. */
  irregularFraction: number;
  variable: boolean;
}

/**
 * Frame rate from container sample durations (in timescale units).
 * durations[i] = duration of frame i, in the order frames are presented.
 */
export function frameRateFromDurations(durations: readonly number[], timescale: number, vfrTolerance: number): FrameRateInfo {
  const total = durations.reduce((a, b) => a + b, 0);
  const meanFps = durations.length > 0 && total > 0 ? (durations.length * timescale) / total : NaN;
  const intervals = durations.filter((d) => d > 0);
  const med = median(intervals);
  const medianFps = med > 0 ? timescale / med : NaN;
  const irregular = intervals.filter((d) => Math.abs(d - med) > vfrTolerance * med).length;
  const irregularFraction = intervals.length ? irregular / intervals.length : 0;
  return { meanFps, medianFps, irregularFraction, variable: irregularFraction > 0.01 };
}

/** Index of the frame whose time is closest to t (times sorted ascending). */
export function nearestFrame(times: readonly number[], t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  if (hi < 0) return -1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(times[lo - 1] - t) <= Math.abs(times[lo] - t)) return lo - 1;
  return lo;
}

/** First frame index whose time is >= t (clamped to the array). */
export function firstFrameAtOrAfter(times: readonly number[], t: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return Math.min(lo, times.length - 1);
}

/** Median sample rate (Hz) implied by a time array. */
export function sampleRateHz(times: readonly number[]): number {
  const d: number[] = [];
  for (let i = 1; i < times.length; i++) d.push(times[i] - times[i - 1]);
  const m = median(d.filter((x) => x > 0));
  return m > 0 ? 1 / m : NaN;
}
