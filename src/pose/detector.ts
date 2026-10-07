import type { Landmark } from '../core/types';

/** Anything that can return one person's 33 landmarks for an image at a timestamp. */
export interface PoseDetector {
  /** Short description for the processing log (model, delegate). */
  label: string;
  /** timestampMs must strictly increase across calls on the same detector. */
  detect(image: TexImageSource, timestampMs: number): Landmark[] | null;
}

/**
 * Test hook: if a page sets window.__LIFTLAB_TEST_POSE__ before the app starts,
 * that detector is used instead of MediaPipe. Used only by the automated
 * browser smoke test (the model cannot be downloaded in the build sandbox).
 */
export function testDetector(): PoseDetector | null {
  const w = globalThis as unknown as { __LIFTLAB_TEST_POSE__?: PoseDetector };
  return w.__LIFTLAB_TEST_POSE__ ?? null;
}
