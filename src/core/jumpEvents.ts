/**
 * Jump event detection: takeoff, landing and (drop jump) ground contact.
 *
 * Works on UNSMOOTHED pixel positions so smoothing can never shift an event.
 * The foot signal is the lowest image point of the near-side heel and toe
 * (foot_index) in each frame: lowY = max(heel.y, toe.y) because image y grows
 * downward. A frame is null when either point fails the confidence test.
 *
 *   height above floor (leg) = (floorY − lowY) ÷ legPx
 *   on the ground            = height <= contact band
 *
 * Frame definitions (spec section 4):
 *   takeoff        = first frame where both feet are off the ground
 *   landing        = first frame where any foot touches the ground
 *   ground contact = first floor-touch frame after stepping off the box
 * Only the near-side foot is visible from a side view, so it stands in for
 * "both feet" / "any foot" (see README, Known limitations).
 */
import { median, percentile } from './timing';

export interface JumpDetectConfig {
  restMaxRangeLeg: number;
  restMinMs: number;
  surfaceClusterLeg: number;
  floorMinTotalMs: number;
  boxMinHeightLeg: number;
  groundBandMinLeg: number;
  groundBandNoiseK: number;
  flightMinPeakLeg: number;
  jumpMinHipRiseLeg: number;
  flightMinMs: number;
  flightMaxMs: number;
  groundBlipMaxMs: number;
  dropContactMaxMs: number;
}

export interface RestSegment {
  start: number; // first frame (inclusive)
  end: number; // last frame (inclusive)
  levelY: number; // median lowY (px)
}

export interface Surface {
  levelY: number;
  totalMs: number;
  segments: RestSegment[];
}

export interface FloorInfo {
  floorY: number;
  /** Contact band in px: a foot within this distance of floorY is on the ground. */
  bandPx: number;
  /** Most-used elevated surface (box top), if any. */
  boxY: number | null;
  surfaces: Surface[];
}

export interface SuggestedJump {
  /** Drop jump only. */
  contact?: number;
  takeoff: number;
  landing: number;
  /** Notes for the reviewer (e.g., missing frames right before an event). */
  warnings: string[];
}

export type JumpDetectResult =
  | { ok: true; floor: FloorInfo; jumps: SuggestedJump[] }
  | { ok: false; error: string };

/** Frames where the foot is at rest: inside some window >= restMinMs whose lowY range <= restMaxRange. */
export function findRestSegments(
  lowY: readonly (number | null)[],
  times: readonly number[],
  legPx: number,
  cfg: Pick<JumpDetectConfig, 'restMaxRangeLeg' | 'restMinMs'>,
): RestSegment[] {
  const n = lowY.length;
  const rest = new Array<boolean>(n).fill(false);
  const maxRange = cfg.restMaxRangeLeg * legPx;
  const minS = cfg.restMinMs / 1000;
  for (let i = 0; i < n; i++) {
    if (lowY[i] === null) continue;
    let lo = lowY[i]!;
    let hi = lo;
    let j = i;
    let ok = true;
    while (j + 1 < n && times[j] - times[i] < minS) {
      j++;
      const v = lowY[j];
      if (v === null) {
        ok = false;
        break;
      }
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
      if (hi - lo > maxRange) {
        ok = false;
        break;
      }
    }
    if (ok && times[j] - times[i] >= minS) for (let k = i; k <= j; k++) rest[k] = true;
  }
  const segs: RestSegment[] = [];
  let i = 0;
  while (i < n) {
    if (!rest[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < n && rest[j + 1]) j++;
    const vals: number[] = [];
    for (let k = i; k <= j; k++) vals.push(lowY[k]!);
    segs.push({ start: i, end: j, levelY: median(vals) });
    i = j + 1;
  }
  return segs;
}

/** Group rest segments into surfaces (floor, box) by level. */
export function clusterSurfaces(segs: readonly RestSegment[], times: readonly number[], legPx: number, clusterLeg: number): Surface[] {
  const sorted = [...segs].sort((a, b) => a.levelY - b.levelY);
  const groups: RestSegment[][] = [];
  for (const s of sorted) {
    const g = groups[groups.length - 1];
    if (g && s.levelY - g[g.length - 1].levelY <= clusterLeg * legPx) g.push(s);
    else groups.push([s]);
  }
  return groups.map((g) => ({
    levelY: median(g.map((s) => s.levelY)),
    totalMs: g.reduce((a, s) => a + (times[s.end] - times[s.start]) * 1000, 0),
    segments: g.sort((a, b) => a.start - b.start),
  }));
}

export function estimateFloor(
  lowY: readonly (number | null)[],
  times: readonly number[],
  legPx: number,
  cfg: JumpDetectConfig,
): FloorInfo | null {
  const segs = findRestSegments(lowY, times, legPx, cfg);
  const surfaces = clusterSurfaces(segs, times, legPx, cfg.surfaceClusterLeg);
  // Floor = the lowest surface in the real world (largest image y) that was stood on long enough.
  const candidates = surfaces.filter((s) => s.totalMs >= cfg.floorMinTotalMs).sort((a, b) => b.levelY - a.levelY);
  const floor = candidates[0];
  if (!floor) return null;
  // Noise of the foot signal while standing on the floor.
  const dev: number[] = [];
  for (const s of floor.segments) for (let k = s.start; k <= s.end; k++) dev.push(lowY[k]! - s.levelY);
  const sd = dev.length > 1 ? Math.sqrt(dev.reduce((a, d) => a + d * d, 0) / (dev.length - 1)) : 0;
  const bandPx = Math.max(cfg.groundBandMinLeg * legPx, cfg.groundBandNoiseK * sd);
  const elevated = surfaces
    .filter((s) => floor.levelY - s.levelY >= cfg.boxMinHeightLeg * legPx)
    .sort((a, b) => b.totalMs - a.totalMs);
  return { floorY: floor.levelY, bandPx, boxY: elevated[0]?.levelY ?? null, surfaces };
}

type State = 'G' | 'A';

interface Run {
  state: State;
  start: number; // first known frame of the run
  end: number; // last known frame of the run
  /** True when unknown (null) frames sit right before `start`. */
  gapBefore: boolean;
}

/** Split the foot signal into ground (G) and airborne (A) runs. Null frames never start a run. */
export function contactRuns(
  lowY: readonly (number | null)[],
  floorY: number,
  bandPx: number,
): Run[] {
  const runs: Run[] = [];
  let pendingGap = false;
  for (let i = 0; i < lowY.length; i++) {
    const v = lowY[i];
    if (v === null) {
      pendingGap = true;
      continue;
    }
    const st: State = floorY - v <= bandPx ? 'G' : 'A';
    const last = runs[runs.length - 1];
    if (last && last.state === st) {
      last.end = i;
    } else {
      runs.push({ state: st, start: i, end: i, gapBefore: pendingGap && runs.length > 0 });
    }
    pendingGap = false;
  }
  return runs;
}

/** Merge ground runs shorter than maxMs that sit between two airborne runs (noise). */
export function mergeGroundBlips(runs: Run[], times: readonly number[], maxMs: number): Run[] {
  const out: Run[] = [];
  for (let k = 0; k < runs.length; k++) {
    const r = runs[k];
    const next = runs[k + 1];
    const prev = out[out.length - 1];
    if (r.state === 'G' && prev && prev.state === 'A' && next && next.state === 'A') {
      const durMs = (times[next.start] - times[r.start]) * 1000;
      if (durMs < maxMs) {
        prev.end = next.end;
        k++; // swallow the next airborne run too
        continue;
      }
    }
    if (prev && prev.state === r.state) prev.end = r.end;
    else out.push({ ...r });
  }
  return out;
}

export interface JumpInputs {
  /** Raw near-side lowest foot point per frame (px, y down). */
  footLowY: readonly (number | null)[];
  /** Raw near-side hip y per frame (px, y down). */
  hipY: readonly (number | null)[];
  times: readonly number[];
  legPx: number;
}

function peakHeightLeg(lowY: readonly (number | null)[], r: Run, floorY: number, legPx: number): number {
  let best = -Infinity;
  for (let k = r.start; k <= r.end; k++) if (lowY[k] !== null) best = Math.max(best, (floorY - lowY[k]!) / legPx);
  return best;
}

/** Highest hip position (leg, up positive, relative to standing) during frames [a, b]. null = no hip data. */
function hipRiseLeg(hipY: readonly (number | null)[], a: number, b: number, standingHipY: number | null, legPx: number): number | null {
  if (standingHipY === null) return null;
  let minY = Infinity;
  for (let k = a; k <= b; k++) if (hipY[k] !== null) minY = Math.min(minY, hipY[k]!);
  return Number.isFinite(minY) ? (standingHipY - minY) / legPx : null;
}

export function detectJumps(input: JumpInputs, kind: 'cmj' | 'squat_jump' | 'drop_jump', cfg: JumpDetectConfig): JumpDetectResult {
  const { footLowY, hipY, times, legPx } = input;
  const floor = estimateFloor(footLowY, times, legPx, cfg);
  if (!floor) {
    return {
      ok: false,
      error:
        'Could not find the floor. The athlete must stand still on the floor for a moment with both feet fully in frame.',
    };
  }
  if (kind === 'drop_jump' && floor.boxY === null) {
    return {
      ok: false,
      error:
        'Could not find both the box and the floor. Start filming with the athlete standing still on the box, and keep filming until they stand still after landing.',
    };
  }
  // Standing hip level: hip height while the feet rest on the floor (90th percentile = most upright).
  const floorSurface = floor.surfaces.find((s) => s.levelY === floor.floorY)!;
  const restHip: number[] = [];
  for (const s of floorSurface.segments) for (let k = s.start; k <= s.end; k++) if (hipY[k] !== null) restHip.push(hipY[k]!);
  const standingHipY = restHip.length ? percentile(restHip, 10) : null; // 10th pct of y = highest 90% hip

  let runs = contactRuns(footLowY, floor.floorY, floor.bandPx);
  runs = mergeGroundBlips(runs, times, cfg.groundBlipMaxMs);

  const isFlight = (k: number): boolean => {
    const r = runs[k];
    const prev = runs[k - 1];
    const next = runs[k + 1];
    if (r.state !== 'A' || !prev || prev.state !== 'G' || !next || next.state !== 'G') return false;
    const durMs = (times[next.start] - times[r.start]) * 1000;
    if (durMs < cfg.flightMinMs || durMs > cfg.flightMaxMs) return false;
    if (peakHeightLeg(footLowY, r, floor.floorY, legPx) < cfg.flightMinPeakLeg) return false;
    const rise = hipRiseLeg(hipY, r.start, r.end, standingHipY, legPx);
    if (rise !== null && rise < cfg.jumpMinHipRiseLeg) return false;
    return true;
  };

  const boxSegs = floor.boxY === null ? [] : floor.surfaces.filter((s) => floor.floorY - s.levelY >= cfg.boxMinHeightLeg * legPx).flatMap((s) => s.segments);
  const isBoxRun = (r: Run): boolean => r.state === 'A' && boxSegs.some((s) => s.start <= r.end && s.end >= r.start);

  const warn = (r: Run, label: string): string[] =>
    r.gapBefore ? [`Pose missing for some frames just before the suggested ${label}; check it carefully.`] : [];

  const jumps: SuggestedJump[] = [];
  if (kind === 'drop_jump') {
    for (let k = 0; k + 3 < runs.length; k++) {
      if (!isBoxRun(runs[k])) continue;
      const contactRun = runs[k + 1];
      if (contactRun.state !== 'G') continue;
      if (!isFlight(k + 2)) continue;
      const flight = runs[k + 2];
      const landRun = runs[k + 3];
      const contactMs = (times[flight.start] - times[contactRun.start]) * 1000;
      if (contactMs > cfg.dropContactMaxMs) continue;
      jumps.push({
        contact: contactRun.start,
        takeoff: flight.start,
        landing: landRun.start,
        warnings: [...warn(contactRun, 'ground contact'), ...warn(flight, 'takeoff'), ...warn(landRun, 'landing')],
      });
      k += 2;
    }
  } else {
    for (let k = 1; k + 1 < runs.length; k++) {
      if (!isFlight(k)) continue;
      const flight = runs[k];
      const landRun = runs[k + 1];
      jumps.push({
        takeoff: flight.start,
        landing: landRun.start,
        warnings: [...warn(flight, 'takeoff'), ...warn(landRun, 'landing')],
      });
    }
  }
  return { ok: true, floor, jumps };
}
