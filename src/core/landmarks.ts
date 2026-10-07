import type { Landmark, PoseFrame, Side } from './types';

/** MediaPipe Pose landmark indices (33-point BlazePose topology). */
export const LM = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const;

export type Joint = 'shoulder' | 'hip' | 'knee' | 'ankle' | 'heel' | 'toe';

const INDEX: Record<Side, Record<Joint, number>> = {
  left: {
    shoulder: LM.leftShoulder,
    hip: LM.leftHip,
    knee: LM.leftKnee,
    ankle: LM.leftAnkle,
    heel: LM.leftHeel,
    toe: LM.leftFootIndex,
  },
  right: {
    shoulder: LM.rightShoulder,
    hip: LM.rightHip,
    knee: LM.rightKnee,
    ankle: LM.rightAnkle,
    heel: LM.rightHeel,
    toe: LM.rightFootIndex,
  },
};

export const jointIndex = (side: Side, joint: Joint): number => INDEX[side][joint];

/** Landmarks used for side detection (both sides compared). */
export const SIDE_JOINTS: readonly Joint[] = ['shoulder', 'hip', 'knee', 'ankle', 'heel', 'toe'];

/** Key near-side landmarks that must pass the confidence test for a frame to count in body_detected_pct. */
export const KEY_JOINTS_JUMP: readonly Joint[] = ['hip', 'knee', 'ankle', 'heel', 'toe'];
export const KEY_JOINTS_LIFT: readonly Joint[] = ['shoulder', 'hip', 'knee', 'ankle'];

/** Does this landmark pass the confidence test? (see LANDMARK_CONFIDENCE_THRESHOLD) */
export function landmarkPasses(lm: Landmark | undefined, threshold: number): boolean {
  if (!lm) return false;
  if (!(lm.visibility >= threshold)) return false;
  if (lm.presence !== undefined && !(lm.presence >= threshold)) return false;
  return lm.x >= 0 && lm.x <= 1 && lm.y >= 0 && lm.y <= 1;
}

/** Do all of these near-side joints pass in this frame? */
export function jointsPass(frame: PoseFrame, side: Side, joints: readonly Joint[], threshold: number): boolean {
  if (!frame) return false;
  return joints.every((j) => landmarkPasses(frame[jointIndex(side, j)], threshold));
}

export interface Px {
  x: number;
  y: number;
}

/**
 * Convert a normalized landmark to pixels: x × width, y × height. Both axes
 * then share one scale, so angles are not distorted by non-square video.
 * Image y increases DOWNWARD.
 */
export const toPx = (lm: Landmark, width: number, height: number): Px => ({
  x: lm.x * width,
  y: lm.y * height,
});

/**
 * Pixel track of one near-side joint across all frames; null where the joint
 * fails the confidence test (gaps are never filled).
 */
export function jointTrack(
  frames: readonly PoseFrame[],
  side: Side,
  joint: Joint,
  width: number,
  height: number,
  threshold: number,
): (Px | null)[] {
  const idx = jointIndex(side, joint);
  return frames.map((f) => {
    const lm = f?.[idx];
    return f && landmarkPasses(lm, threshold) ? toPx(lm!, width, height) : null;
  });
}
