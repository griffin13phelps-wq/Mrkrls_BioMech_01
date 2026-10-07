/** One pose landmark as reported by MediaPipe Pose Landmarker (image coordinates, normalized 0–1). */
export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
  /** Only present when the model/library reports it (tasks-vision >= 1.1.0). */
  presence?: number;
}

/** 33 landmarks for one person in one frame, or null when no person was detected. */
export type PoseFrame = Landmark[] | null;

export type Side = 'left' | 'right';

export type Lift = 'cmj' | 'squat_jump' | 'drop_jump' | 'squat' | 'hinge';
export type Variant = 'back' | 'front' | 'goblet' | 'trap_bar' | 'rdl' | 'conventional';

export const JUMP_LIFTS: readonly Lift[] = ['cmj', 'squat_jump', 'drop_jump'];
export const isJump = (l: Lift): boolean => JUMP_LIFTS.includes(l);

export const VARIANTS: Record<Lift, readonly Variant[]> = {
  cmj: [],
  squat_jump: [],
  drop_jump: [],
  squat: ['back', 'front', 'goblet'],
  hinge: ['trap_bar', 'rdl', 'conventional'],
};

export const LIFT_LABELS: Record<Lift, string> = {
  cmj: 'Countermovement jump',
  squat_jump: 'Squat jump',
  drop_jump: 'Drop jump',
  squat: 'Squat',
  hinge: 'Hinge',
};

export const VARIANT_LABELS: Record<Variant, string> = {
  back: 'Back squat',
  front: 'Front squat',
  goblet: 'Goblet squat',
  trap_bar: 'Trap bar deadlift',
  rdl: 'RDL',
  conventional: 'Conventional deadlift',
};

/**
 * Pose data for one video, everything in display orientation.
 * times[i] is the presentation time of frame i in seconds (first frame = 0).
 */
export interface PoseSeries {
  width: number;
  height: number;
  frames: PoseFrame[];
  times: number[];
}

/** Unrounded measurements for one rep or jump. undefined/null = not measured. */
export interface RepMeasures {
  bodyDetectedPct: number | null;
  framesAdjusted?: boolean;
  flightTimeMs?: number | null;
  jumpHeightCm?: number | null;
  holdTimeMs?: number | null;
  startKneeAngleDeg?: number | null;
  dipBeforeTakeoff?: boolean | null;
  contactTimeMs?: number | null;
  rsi?: number | null;
  depth?: 'above' | 'parallel' | 'below' | null;
  bottomKneeAngleDeg?: number | null;
  bottomHipAngleDeg?: number | null;
  maxTrunkLeanDeg?: number | null;
  downTimeMs?: number | null;
  upTimeMs?: number | null;
  bottomThighAngleDeg?: number | null;
}
