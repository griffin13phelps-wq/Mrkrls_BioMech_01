/**
 * Squat and hinge rep detection and phase timing (pure; SMOOTHED signals).
 *
 * Movement signal s (bigger = closer to standing tall):
 *   squat → hip height in leg lengths (−hip.y ÷ legPx; image y grows downward)
 *   hinge → hip angle in degrees (shoulder–hip–knee)
 *
 * Order of phases comes from the lift:
 *   lower-first (all squats, RDL): top → down → bottom → up → top
 *   lift-first  (conventional, trap bar; bar starts on the floor):
 *               bottom → up → top → down → bottom
 *
 * Rep finding (lower-first):
 *   T = 95th percentile of s (the standing level).
 *   Each frame is "top" if s >= T − topBand, "low" if s <= T − minRom,
 *   otherwise it keeps the previous label (hysteresis). Each run of "low"
 *   frames is one rep; its turnaround is the minimum of s in that run.
 * Lift-first uses the same procedure on −s, so the rest level is the bottom
 * and each "excursion" is a pull to the top.
 *
 * Phase boundaries (PHASE_BAND_FRAC = f):
 *   For each phase, ROM = |rest level − turnaround value|, where the rest level
 *   is the extreme of s in the rest region on that side of the turnaround.
 *   The phase runs from the LAST frame inside the band (f × ROM) around the
 *   level it leaves, to the FIRST frame inside the band around the level it
 *   reaches. Pauses at the top or bottom are therefore excluded from both
 *   phases.
 * A rep without a rest region on one side (the video starts or ends mid-rep,
 * e.g., the athlete walking in before setting up at the bar, or standing up
 * after releasing it) is NOT reported; it is counted in `partial` instead.
 */
import { percentile } from './timing';

export type PhaseOrder = 'lower-first' | 'lift-first';

export interface RepDetectConfig {
  /** Excursion needed to count a rep (signal units). */
  minRom: number;
  /** Band around the rest level that counts as "at rest" for labeling (signal units). */
  restBand: number;
  phaseBandFrac: number;
  minRepMs: number;
}

export interface Phase {
  start: number;
  end: number;
}

export interface DetectedRep {
  /** Frame range of the rep used for max trunk lean and body_detected_pct. */
  start: number;
  end: number;
  /** Turnaround frame: lowest point (lower-first) or highest point (lift-first) of s. */
  turn: number;
  down: Phase;
  up: Phase;
}

export interface RepDetectResult {
  reps: DetectedRep[];
  /** Movements cut off by the start or end of the video (not reported as reps). */
  partial: number;
}

type Label = 'rest' | 'out' | null;

interface Excursion {
  /** First and last frames labeled "out". */
  start: number;
  end: number;
}

/** Excursions away from the rest level (the rest level is the high side of x). */
function excursions(x: readonly (number | null)[], cfg: RepDetectConfig): { rest: number; list: Excursion[]; labels: Label[] } {
  const vals = x.filter((v): v is number => v !== null);
  const rest = percentile(vals, 95);
  const labels: Label[] = new Array(x.length).fill(null);
  let cur: Label = null;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    if (v !== null) {
      if (v >= rest - cfg.restBand) cur = 'rest';
      else if (v <= rest - cfg.minRom) cur = 'out';
    }
    labels[i] = cur;
  }
  const list: Excursion[] = [];
  let i = 0;
  while (i < x.length) {
    if (labels[i] !== 'out') {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < x.length && labels[j + 1] === 'out') j++;
    // Trim to frames that actually have data.
    let a = i;
    let b = j;
    while (a < b && x[a] === null) a++;
    while (b > a && x[b] === null) b--;
    list.push({ start: a, end: b });
    i = j + 1;
  }
  return { rest, list, labels };
}

function argExtreme(x: readonly (number | null)[], a: number, b: number, mode: 'min' | 'max'): number | null {
  let best: number | null = null;
  for (let i = Math.max(0, a); i <= Math.min(x.length - 1, b); i++) {
    const v = x[i];
    if (v === null) continue;
    if (best === null || (mode === 'min' ? v < x[best]! : v > x[best]!)) best = i;
  }
  return best;
}

/** Was any frame in [a, b] labeled "rest"? */
function hasRest(labels: readonly Label[], a: number, b: number): boolean {
  for (let i = Math.max(0, a); i <= Math.min(labels.length - 1, b); i++) if (labels[i] === 'rest') return true;
  return false;
}

/**
 * Lower-first detection on x (rest = high side). Returns reps where `down` is
 * the phase leaving the rest level and `up` the phase returning to it.
 */
function detectLeaveReturn(x: readonly (number | null)[], times: readonly number[], cfg: RepDetectConfig): RepDetectResult {
  if (x.filter((v) => v !== null).length < 3) return { reps: [], partial: 0 };
  const { list, labels } = excursions(x, cfg);
  const reps: DetectedRep[] = [];
  let partial = 0;
  for (let k = 0; k < list.length; k++) {
    const ex = list[k];
    const turn = argExtreme(x, ex.start, ex.end, 'min');
    if (turn === null) continue;
    const prevEnd = k > 0 ? list[k - 1].end + 1 : 0;
    const nextStart = k + 1 < list.length ? list[k + 1].start - 1 : x.length - 1;
    const xt = x[turn]!;

    let leave: Phase | null = null;
    if (hasRest(labels, prevEnd, ex.start - 1)) {
      const restIdx = argExtreme(x, prevEnd, ex.start - 1, 'max')!;
      const rom = x[restIdx]! - xt;
      const restThr = x[restIdx]! - cfg.phaseBandFrac * rom;
      const turnThr = xt + cfg.phaseBandFrac * rom;
      let s = -1;
      for (let i = turn - 1; i >= prevEnd; i--)
        if (x[i] !== null && x[i]! >= restThr) {
          s = i;
          break;
        }
      if (s >= 0) {
        let e = turn;
        for (let i = s; i <= turn; i++)
          if (x[i] !== null && x[i]! <= turnThr) {
            e = i;
            break;
          }
        leave = { start: s, end: e };
      }
    }

    let back: Phase | null = null;
    if (hasRest(labels, ex.end + 1, nextStart)) {
      const restIdx = argExtreme(x, ex.end + 1, nextStart, 'max')!;
      const rom = x[restIdx]! - xt;
      const restThr = x[restIdx]! - cfg.phaseBandFrac * rom;
      const turnThr = xt + cfg.phaseBandFrac * rom;
      let e = -1;
      for (let i = turn + 1; i <= nextStart; i++)
        if (x[i] !== null && x[i]! >= restThr) {
          e = i;
          break;
        }
      if (e >= 0) {
        let s = turn;
        for (let i = e; i >= turn; i--)
          if (x[i] !== null && x[i]! <= turnThr) {
            s = i;
            break;
          }
        back = { start: s, end: e };
      }
    }

    if (!leave || !back) {
      partial++;
      continue;
    }
    if ((times[back.end] - times[leave.start]) * 1000 < cfg.minRepMs) continue;
    reps.push({ start: leave.start, end: back.end, turn, down: leave, up: back });
  }
  return { reps, partial };
}

/**
 * Detect reps in signal s (bigger = more upright).
 * For lift-first lifts the analysis runs on −s and the phases are renamed:
 * leaving the bottom = up, returning to it = down.
 */
export function detectReps(
  s: readonly (number | null)[],
  times: readonly number[],
  order: PhaseOrder,
  cfg: RepDetectConfig,
): RepDetectResult {
  if (order === 'lower-first') return detectLeaveReturn(s, times, cfg);
  const neg = s.map((v) => (v === null ? null : -v));
  const r = detectLeaveReturn(neg, times, cfg);
  return { partial: r.partial, reps: r.reps.map((rep) => ({ ...rep, down: rep.up, up: rep.down })) };
}

/** Bottom frame of a rep: where s is smallest within the rep's frame range. */
export function bottomFrame(s: readonly (number | null)[], rep: DetectedRep): number | null {
  return argExtreme(s, rep.start, rep.end, 'min');
}

export function phaseOrderFor(lift: 'squat' | 'hinge', variant: string): PhaseOrder {
  if (lift === 'hinge' && (variant === 'conventional' || variant === 'trap_bar')) return 'lift-first';
  return 'lower-first';
}
