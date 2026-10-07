/**
 * Glue between pose data and the pure measurement functions.
 * Everything here is deterministic and free of DOM/browser dependencies.
 */
import * as C from '../config';
import { depthFromThighAngle, hipAngleDeg, kneeAngleDeg, thighAngleDeg, trunkLeanDeg } from './angles';
import { detectJumps, type JumpDetectConfig, type JumpDetectResult } from './jumpEvents';
import { jumpHeightCm, reactiveStrengthIndex } from './jumpMetrics';
import { jointTrack, KEY_JOINTS_JUMP, KEY_JOINTS_LIFT, type Px } from './landmarks';
import { bodyDetectedPct, jumpQualityWindow, personDetectedPct } from './quality';
import { bottomFrame, detectReps, phaseOrderFor, type DetectedRep } from './reps';
import { detectSide, type SideDetection } from './side';
import { smoothTrack } from './smoothing';
import { analyzeSquatJumpHold, type SquatJumpConfig, type SquatJumpResult } from './squatJump';
import { median, msBetween, sampleRateHz } from './timing';
import type { Lift, PoseSeries, RepMeasures, Side, Variant } from './types';

export const JUMP_CONFIG: JumpDetectConfig = {
  restMaxRangeLeg: C.REST_MAX_RANGE_LEG,
  restMinMs: C.REST_MIN_MS,
  surfaceClusterLeg: C.SURFACE_CLUSTER_LEG,
  floorMinTotalMs: C.FLOOR_MIN_TOTAL_MS,
  boxMinHeightLeg: C.BOX_MIN_HEIGHT_LEG,
  groundBandMinLeg: C.GROUND_BAND_MIN_LEG,
  groundBandNoiseK: C.GROUND_BAND_NOISE_K,
  flightMinPeakLeg: C.FLIGHT_MIN_PEAK_LEG,
  jumpMinHipRiseLeg: C.JUMP_MIN_HIP_RISE_LEG,
  flightMinMs: C.FLIGHT_MIN_MS,
  flightMaxMs: C.FLIGHT_MAX_MS,
  groundBlipMaxMs: C.GROUND_BLIP_MAX_MS,
  dropContactMaxMs: C.DROP_CONTACT_MAX_MS,
};

export const SJ_CONFIG: SquatJumpConfig = {
  stillSpeedLegPerS: C.SJ_STILL_SPEED_LEG_PER_S,
  minHoldMs: C.SJ_MIN_HOLD_MS,
  holdMaxKneeDeg: C.SJ_HOLD_MAX_KNEE_DEG,
  dipThresholdLeg: C.SJ_DIP_THRESHOLD_LEG,
  searchWindowMs: C.SJ_SEARCH_WINDOW_MS,
  stillGapMergeMs: C.SJ_STILL_GAP_MERGE_MS,
};

export interface AnalysisContext {
  series: PoseSeries;
  side: Side;
  legPx: number;
  sampleRateHz: number;
  /** Raw near-side pixel tracks (null = failed confidence test). */
  raw: Record<'shoulder' | 'hip' | 'knee' | 'ankle' | 'heel' | 'toe', (Px | null)[]>;
  /** Zero-lag smoothed near-side pixel tracks used for angles. */
  smooth: Record<'shoulder' | 'hip' | 'knee' | 'ankle', (Px | null)[]>;
  kneeAngle: (number | null)[];
  hipAngle: (number | null)[];
  trunkLean: (number | null)[];
  thighAngle: (number | null)[];
  /** Smoothed hip height in leg lengths (up positive). */
  hipHeightLeg: (number | null)[];
  /** Raw lowest near-side foot point per frame (px, y down). */
  footLowY: (number | null)[];
}

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

export const FILMING_TIPS = [
  'Film from the side, camera square to the athlete at hip height, phone level.',
  'Keep the whole body, including both feet, in frame the entire time.',
  'Use good, even lighting; avoid strong backlight (e.g., facing a window or the sun).',
  'Keep other people out of the frame.',
];

/** Checks that apply before any lift-specific analysis. */
export function checkPerson(series: PoseSeries): Checked<SideDetection> {
  if (series.frames.length === 0) return { ok: false, error: 'The video has no frames that could be decoded.' };
  const pct = personDetectedPct(series.frames);
  if (pct < C.MIN_FRAMES_WITH_PERSON_PCT) {
    return {
      ok: false,
      error: `No person was detected in most of the video (person found in ${pct.toFixed(0)}% of frames).`,
    };
  }
  return { ok: true, value: detectSide(series.frames, C.SIDE_MIN_VISIBILITY_MARGIN) };
}

const map3 = <T>(a: (Px | null)[], b: (Px | null)[], c: (Px | null)[], f: (a: Px, b: Px, c: Px) => T | null): (T | null)[] =>
  a.map((p, i) => (p && b[i] && c[i] ? f(p, b[i]!, c[i]!) : null));
const map2 = <T>(a: (Px | null)[], b: (Px | null)[], f: (a: Px, b: Px) => T | null): (T | null)[] =>
  a.map((p, i) => (p && b[i] ? f(p, b[i]!) : null));

export function buildContext(series: PoseSeries, side: Side): Checked<AnalysisContext> {
  const { frames, width, height, times } = series;
  const thr = C.LANDMARK_CONFIDENCE_THRESHOLD;
  const t = (j: 'shoulder' | 'hip' | 'knee' | 'ankle' | 'heel' | 'toe') => jointTrack(frames, side, j, width, height, thr);
  const raw = { shoulder: t('shoulder'), hip: t('hip'), knee: t('knee'), ankle: t('ankle'), heel: t('heel'), toe: t('toe') };
  const legs: number[] = [];
  for (let i = 0; i < frames.length; i++) {
    const h = raw.hip[i];
    const k = raw.knee[i];
    const a = raw.ankle[i];
    if (h && k && a) legs.push(Math.hypot(h.x - k.x, h.y - k.y) + Math.hypot(k.x - a.x, k.y - a.y));
  }
  if (legs.length < 3) {
    return { ok: false, error: `The ${side} hip, knee and ankle were not detected clearly enough to measure.` };
  }
  const legPx = median(legs);
  const fs = sampleRateHz(times);
  const sm = (track: (Px | null)[]) => smoothTrack(track, fs, C.LOWPASS_CUTOFF_HZ);
  const smooth = { shoulder: sm(raw.shoulder), hip: sm(raw.hip), knee: sm(raw.knee), ankle: sm(raw.ankle) };
  return {
    ok: true,
    value: {
      series,
      side,
      legPx,
      sampleRateHz: fs,
      raw,
      smooth,
      kneeAngle: map3(smooth.hip, smooth.knee, smooth.ankle, kneeAngleDeg),
      hipAngle: map3(smooth.shoulder, smooth.hip, smooth.knee, hipAngleDeg),
      trunkLean: map2(smooth.hip, smooth.shoulder, trunkLeanDeg),
      thighAngle: map2(smooth.hip, smooth.knee, thighAngleDeg),
      hipHeightLeg: smooth.hip.map((p) => (p ? -p.y / legPx : null)),
      footLowY: raw.heel.map((h, i) => (h && raw.toe[i] ? Math.max(h.y, raw.toe[i]!.y) : null)),
    },
  };
}

// ---------------------------------------------------------------------------
// Jumps
// ---------------------------------------------------------------------------

export function detectJumpEvents(ctx: AnalysisContext, lift: 'cmj' | 'squat_jump' | 'drop_jump'): JumpDetectResult {
  return detectJumps(
    { footLowY: ctx.footLowY, hipY: ctx.raw.hip.map((p) => (p ? p.y : null)), times: ctx.series.times, legPx: ctx.legPx },
    lift,
    JUMP_CONFIG,
  );
}

export interface JumpEventsFrames {
  contact?: number;
  takeoff: number;
  landing: number;
}

export interface JumpMeasurement {
  measures: RepMeasures;
  squatJump?: SquatJumpResult;
}

export function measureJump(
  ctx: AnalysisContext,
  lift: 'cmj' | 'squat_jump' | 'drop_jump',
  ev: JumpEventsFrames,
  framesAdjusted: boolean,
): JumpMeasurement {
  const times = ctx.series.times;
  const flight = ev.landing > ev.takeoff ? msBetween(times, ev.takeoff, ev.landing) : null;
  const height = flight !== null && flight > 0 ? jumpHeightCm(flight) : null;
  const startEvent = lift === 'drop_jump' && ev.contact !== undefined ? ev.contact : ev.takeoff;
  const [qa, qb] = jumpQualityWindow(times, startEvent, ev.landing, C.JUMP_QUALITY_WINDOW_MS);
  const measures: RepMeasures = {
    bodyDetectedPct: bodyDetectedPct(ctx.series.frames, ctx.side, KEY_JOINTS_JUMP, qa, qb, C.LANDMARK_CONFIDENCE_THRESHOLD),
    framesAdjusted,
    flightTimeMs: flight,
    jumpHeightCm: height,
  };
  let squatJump: SquatJumpResult | undefined;
  if (lift === 'squat_jump') {
    squatJump = analyzeSquatJumpHold(ctx.hipHeightLeg, ctx.kneeAngle, times, ev.takeoff, SJ_CONFIG);
    measures.holdTimeMs = squatJump.holdTimeMs;
    measures.startKneeAngleDeg = squatJump.startKneeAngleDeg;
    measures.dipBeforeTakeoff = squatJump.dipBeforeTakeoff;
  }
  if (lift === 'drop_jump') {
    const contact =
      ev.contact !== undefined && ev.takeoff > ev.contact ? msBetween(times, ev.contact, ev.takeoff) : null;
    measures.contactTimeMs = contact;
    measures.rsi = height !== null && contact !== null && contact > 0 ? reactiveStrengthIndex(height, contact) : null;
  }
  return { measures, squatJump };
}

// ---------------------------------------------------------------------------
// Squat and hinge
// ---------------------------------------------------------------------------

export interface LiftRep {
  rep: DetectedRep;
  bottom: number;
  measures: RepMeasures;
}

export interface LiftAnalysis {
  reps: LiftRep[];
  partial: number;
  /** The movement signal used for rep detection (for the review chart). */
  signal: (number | null)[];
  signalLabel: string;
}

export function analyzeLift(ctx: AnalysisContext, lift: 'squat' | 'hinge', variant: Variant): LiftAnalysis {
  const times = ctx.series.times;
  const order = phaseOrderFor(lift, variant);
  const signal = lift === 'squat' ? ctx.hipHeightLeg : ctx.hipAngle;
  const cfg =
    lift === 'squat'
      ? { minRom: C.SQUAT_REP_MIN_DROP_LEG, restBand: C.SQUAT_TOP_BAND_LEG }
      : { minRom: C.HINGE_REP_MIN_DEG, restBand: C.HINGE_TOP_BAND_DEG };
  const found = detectReps(signal, times, order, {
    ...cfg,
    phaseBandFrac: C.PHASE_BAND_FRAC,
    minRepMs: C.REP_MIN_DURATION_MS,
  });
  const reps: LiftRep[] = [];
  for (const rep of found.reps) {
    const b = bottomFrame(signal, rep);
    if (b === null) continue;
    let maxLean: number | null = null;
    for (let i = rep.start; i <= rep.end; i++) {
      const v = ctx.trunkLean[i];
      if (v !== null && (maxLean === null || v > maxLean)) maxLean = v;
    }
    const thigh = lift === 'squat' ? ctx.thighAngle[b] : null;
    const measures: RepMeasures = {
      bodyDetectedPct: bodyDetectedPct(ctx.series.frames, ctx.side, KEY_JOINTS_LIFT, rep.start, rep.end, C.LANDMARK_CONFIDENCE_THRESHOLD),
      bottomKneeAngleDeg: ctx.kneeAngle[b],
      bottomHipAngleDeg: ctx.hipAngle[b],
      maxTrunkLeanDeg: maxLean,
      downTimeMs: msBetween(times, rep.down.start, rep.down.end),
      upTimeMs: msBetween(times, rep.up.start, rep.up.end),
    };
    if (lift === 'squat') {
      measures.bottomThighAngleDeg = thigh;
      measures.depth = thigh === null ? null : depthFromThighAngle(thigh, C.DEPTH_PARALLEL_BAND_DEG);
    }
    reps.push({ rep, bottom: b, measures });
  }
  return {
    reps,
    partial: found.partial,
    signal,
    signalLabel: lift === 'squat' ? 'Hip height (leg lengths)' : 'Hip angle (°)',
  };
}

export const isLiftJump = (l: Lift): l is 'cmj' | 'squat_jump' | 'drop_jump' =>
  l === 'cmj' || l === 'squat_jump' || l === 'drop_jump';
