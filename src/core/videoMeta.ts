/**
 * Pure helpers for video container metadata: orientation, display size,
 * frame table (presentation order, timestamps) and codec strings.
 */
import { frameRateFromDurations, timestampsUsable, type FrameRateInfo } from './timing';

export type Rotation = 0 | 90 | 180 | 270;

/**
 * Clockwise display rotation from a track-header matrix
 * [a, b, u, c, d, v, x, y, w] (a–d are 16.16 fixed point). The matrix maps a
 * coded pixel (x, y) to display (a·x + c·y + tx, b·x + d·y + ty) with y pointing
 * down, so the clockwise angle is atan2(b, a). Rounded to the nearest 90°.
 * `mirrored` is true when the matrix also flips the image (rare).
 */
export function rotationFromMatrix(m: ArrayLike<number> | null | undefined): { rotation: Rotation; mirrored: boolean; exact: boolean } {
  if (!m || m.length < 5) return { rotation: 0, mirrored: false, exact: true };
  const a = m[0] / 65536;
  const b = m[1] / 65536;
  const c = m[3] / 65536;
  const d = m[4] / 65536;
  const det = a * d - b * c;
  let deg = (Math.atan2(b, a) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  const snapped = (Math.round(deg / 90) * 90) % 360;
  return { rotation: snapped as Rotation, mirrored: det < 0, exact: Math.abs(deg - snapped) < 0.5 || Math.abs(deg - snapped - 360) < 0.5 };
}

/** Display size after rotation. */
export function displaySize(codedWidth: number, codedHeight: number, rotation: Rotation): { width: number; height: number } {
  return rotation === 90 || rotation === 270 ? { width: codedHeight, height: codedWidth } : { width: codedWidth, height: codedHeight };
}

/**
 * Canvas setTransform(a, b, c, d, e, f) that draws a coded frame (codedWidth ×
 * codedHeight) rotated clockwise by `rotation` and scaled by `scale` into a
 * canvas of the display size × scale.
 */
export function rotationTransform(rotation: Rotation, codedWidth: number, codedHeight: number, scale: number): [number, number, number, number, number, number] {
  const s = scale;
  switch (rotation) {
    case 90:
      return [0, s, -s, 0, s * codedHeight, 0];
    case 180:
      return [-s, 0, 0, -s, s * codedWidth, s * codedHeight];
    case 270:
      return [0, -s, s, 0, 0, s * codedWidth];
    default:
      return [s, 0, 0, s, 0, 0];
  }
}

/** Apply a canvas transform to a point (for tests). */
export const applyTransform = (t: readonly number[], x: number, y: number) => ({ x: t[0] * x + t[2] * y + t[4], y: t[1] * x + t[3] * y + t[5] });

export interface SampleLike {
  cts: number;
  dts: number;
  duration: number;
  is_sync: boolean;
}

export interface FrameTable {
  /** presentation index → decode index */
  presToDecode: number[];
  /** decode index → presentation index */
  decodeToPres: number[];
  /** Presentation timestamps in timescale units, presentation order. */
  cts: number[];
  /** Seconds from the first presented frame. */
  times: number[];
  durations: number[];
  timesUsable: boolean;
  rate: FrameRateInfo;
}

/** Order samples by presentation time and derive per-frame times and the frame rate. */
export function buildFrameTable(samples: readonly SampleLike[], timescale: number, vfrTolerance: number): FrameTable {
  const presToDecode = samples.map((_, i) => i).sort((i, j) => samples[i].cts - samples[j].cts || i - j);
  const decodeToPres = new Array<number>(samples.length);
  presToDecode.forEach((d, p) => (decodeToPres[d] = p));
  const cts = presToDecode.map((d) => samples[d].cts);
  const t0 = cts[0] ?? 0;
  const times = cts.map((c) => (c - t0) / timescale);
  // Duration of each presented frame = gap to the next presented frame (last: its own sample duration).
  const durations = cts.map((c, p) => (p + 1 < cts.length ? cts[p + 1] - c : samples[presToDecode[p]].duration));
  return {
    presToDecode,
    decodeToPres,
    cts,
    times,
    durations,
    timesUsable: timestampsUsable(times),
    rate: frameRateFromDurations(durations, timescale, vfrTolerance),
  };
}

/** Bit-reverse a 32-bit value (HEVC codec string compatibility flags). */
function reverse32(v: number): number {
  let r = 0;
  for (let i = 0; i < 32; i++) {
    r = (r << 1) | (v & 1);
    v >>>= 1;
  }
  return r >>> 0;
}

export interface HevcConfigFields {
  general_profile_space: number;
  general_tier_flag: number;
  general_profile_idc: number;
  general_profile_compatibility: number;
  general_constraint_indicator: ArrayLike<number>;
  general_level_idc: number;
}

/**
 * RFC 6381 / ISO/IEC 14496-15 codec string for HEVC, e.g. "hvc1.1.6.L93.B0".
 * Used to try plain-HEVC decoding of Dolby Vision ("dvh1") iPhone files, whose
 * base layer is HEVC.
 */
export function hevcCodecString(h: HevcConfigFields, prefix = 'hvc1'): string {
  const space = ['', 'A', 'B', 'C'][h.general_profile_space] ?? '';
  const compat = reverse32(h.general_profile_compatibility >>> 0).toString(16).toUpperCase();
  const tier = h.general_tier_flag ? 'H' : 'L';
  const cons = Array.from(h.general_constraint_indicator);
  while (cons.length && cons[cons.length - 1] === 0) cons.pop();
  const consStr = cons.map((b) => '.' + b.toString(16).toUpperCase()).join('');
  return `${prefix}.${space}${h.general_profile_idc}.${compat}.${tier}${h.general_level_idc}${consStr}`;
}
