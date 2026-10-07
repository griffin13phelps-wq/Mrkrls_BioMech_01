/**
 * Squat jump extras: hold_time_ms, start_knee_angle_deg, dip_before_takeoff.
 *
 * Uses the SMOOTHED (zero-lag) near-side hip height, in leg lengths, up
 * positive. Smoothing is needed because raw hip jitter at 240 fps would break
 * up any "still" period; the filter is zero-lag, so it does not move the hold
 * in time. Takeoff itself always comes from the unsmoothed foot signal.
 *
 * Rule:
 *  1. Hip vertical speed v (central difference). "Still" = |v| < stillSpeed.
 *  2. Still runs separated by short breaks (<= stillGapMergeMs, level change
 *     < dip threshold) are merged.
 *  3. Walking backward from takeoff (within the search window), the most
 *     recent still run lasting >= minHoldMs is examined:
 *       – median knee angle < holdMaxKneeDeg → it is the hold;
 *       – otherwise (athlete standing) → no hold.
 *     Shorter still runs are skipped (e.g., the instant of a dip's bottom).
 *  4. hold_time_ms = time(last still frame) − time(first still frame).
 *  5. start_knee_angle_deg = median knee angle over the hold.
 *  6. dip = (hold median hip height − lowest hip height between the end of the
 *     hold and takeoff) > dip threshold.
 *  No hold → hold_time_ms = 0; start_knee_angle_deg and dip_before_takeoff are
 *  left blank because both are defined relative to the hold.
 */
import { median } from './timing';

export interface SquatJumpConfig {
  stillSpeedLegPerS: number;
  minHoldMs: number;
  holdMaxKneeDeg: number;
  dipThresholdLeg: number;
  searchWindowMs: number;
  stillGapMergeMs: number;
}

export interface SquatJumpResult {
  holdTimeMs: number;
  holdStart: number | null;
  holdEnd: number | null;
  startKneeAngleDeg: number | null;
  dipBeforeTakeoff: boolean | null;
  dipDepthLeg: number | null;
}

export function verticalSpeed(h: readonly (number | null)[], times: readonly number[]): (number | null)[] {
  return h.map((_, i) => {
    const a = h[i - 1];
    const b = h[i + 1];
    if (i === 0 || i === h.length - 1 || a === null || b === null || a === undefined || b === undefined) return null;
    const dt = times[i + 1] - times[i - 1];
    return dt > 0 ? (b - a) / dt : null;
  });
}

export function analyzeSquatJumpHold(
  hipHeightLeg: readonly (number | null)[],
  kneeAngleDeg: readonly (number | null)[],
  times: readonly number[],
  takeoff: number,
  cfg: SquatJumpConfig,
): SquatJumpResult {
  const none: SquatJumpResult = {
    holdTimeMs: 0,
    holdStart: null,
    holdEnd: null,
    startKneeAngleDeg: null,
    dipBeforeTakeoff: null,
    dipDepthLeg: null,
  };
  const v = verticalSpeed(hipHeightLeg, times);
  const tMin = times[takeoff] - cfg.searchWindowMs / 1000;
  let first = takeoff;
  while (first > 0 && times[first - 1] >= tMin) first--;

  // Still runs inside [first, takeoff).
  type R = { start: number; end: number };
  const runs: R[] = [];
  for (let i = first; i < takeoff; i++) {
    const s = v[i] !== null && Math.abs(v[i]!) < cfg.stillSpeedLegPerS;
    if (!s) continue;
    const last = runs[runs.length - 1];
    if (last && last.end === i - 1) last.end = i;
    else runs.push({ start: i, end: i });
  }
  // Merge runs separated by short breaks with little level change.
  const level = (r: R): number => median(rangeVals(hipHeightLeg, r.start, r.end));
  const merged: R[] = [];
  for (const r of runs) {
    const p = merged[merged.length - 1];
    if (
      p &&
      (times[r.start] - times[p.end]) * 1000 <= cfg.stillGapMergeMs &&
      Math.abs(level(r) - level(p)) < cfg.dipThresholdLeg
    ) {
      p.end = r.end;
    } else merged.push({ ...r });
  }

  for (let k = merged.length - 1; k >= 0; k--) {
    const r = merged[k];
    const durMs = (times[r.end] - times[r.start]) * 1000;
    if (durMs < cfg.minHoldMs) continue;
    const knees = rangeVals(kneeAngleDeg, r.start, r.end);
    const kneeMed = knees.length ? median(knees) : null;
    if (kneeMed === null || kneeMed >= cfg.holdMaxKneeDeg) return none; // standing still, not a bottom hold
    const holdLevel = level(r);
    const after = rangeVals(hipHeightLeg, r.end + 1, takeoff - 1);
    const dipDepth = after.length ? holdLevel - Math.min(...after) : null;
    return {
      holdTimeMs: durMs,
      holdStart: r.start,
      holdEnd: r.end,
      startKneeAngleDeg: kneeMed,
      dipBeforeTakeoff: dipDepth === null ? null : dipDepth > cfg.dipThresholdLeg,
      dipDepthLeg: dipDepth,
    };
  }
  return none;
}

function rangeVals(arr: readonly (number | null)[], a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = Math.max(0, a); i <= Math.min(arr.length - 1, b); i++) if (arr[i] !== null) out.push(arr[i]!);
  return out;
}
