import { jointIndex, SIDE_JOINTS } from './landmarks';
import type { PoseFrame, Side } from './types';

export interface SideDetection {
  side: Side | null;
  leftMeanVisibility: number;
  rightMeanVisibility: number;
  framesUsed: number;
}

/**
 * Near side = the side whose key landmarks (shoulder, hip, knee, ankle, heel,
 * toe) have the higher mean visibility across all frames with a detected
 * person. If the means differ by less than `margin`, side = null
 * ("could not be determined") and the user must choose.
 */
export function detectSide(frames: readonly PoseFrame[], margin: number): SideDetection {
  let l = 0;
  let r = 0;
  let n = 0;
  for (const f of frames) {
    if (!f) continue;
    let ls = 0;
    let rs = 0;
    for (const j of SIDE_JOINTS) {
      ls += f[jointIndex('left', j)]?.visibility ?? 0;
      rs += f[jointIndex('right', j)]?.visibility ?? 0;
    }
    l += ls / SIDE_JOINTS.length;
    r += rs / SIDE_JOINTS.length;
    n++;
  }
  if (n === 0) return { side: null, leftMeanVisibility: NaN, rightMeanVisibility: NaN, framesUsed: 0 };
  const lm = l / n;
  const rm = r / n;
  const side: Side | null = Math.abs(lm - rm) < margin ? null : lm > rm ? 'left' : 'right';
  return { side, leftMeanVisibility: lm, rightMeanVisibility: rm, framesUsed: n };
}
