/**
 * Zero-lag low-pass smoothing for offline data.
 *
 * A 2nd-order Butterworth low-pass filter is run forward and then backward
 * over the data (the backward pass cancels the forward pass's delay, so the
 * result has no time shift). The cut-off is corrected for the two passes as
 * described by D. A. Winter, "Biomechanics and Motor Control of Human
 * Movement" (correction factor C = (2^(1/2) − 1)^(1/4) ≈ 0.802).
 *
 * Gaps (null) are never filled: each unbroken run of valid samples is
 * filtered on its own and gaps stay null.
 */

const WINTER_C = Math.pow(Math.SQRT2 - 1, 0.25); // ≈ 0.802 for 2 passes

export interface BiquadCoefs {
  a0: number;
  a1: number;
  a2: number;
  b1: number;
  b2: number;
}

export function butterworthCoefs(cutoffHz: number, sampleRateHz: number): BiquadCoefs {
  // Keep the corrected cut-off safely below Nyquist.
  const fc = Math.min(cutoffHz, 0.45 * sampleRateHz * WINTER_C);
  const wc = Math.tan((Math.PI * fc) / sampleRateHz) / WINTER_C;
  const k1 = Math.SQRT2 * wc;
  const k2 = wc * wc;
  const a0 = k2 / (1 + k1 + k2);
  const a1 = 2 * a0;
  const a2 = a0;
  const k3 = (2 * a0) / k2;
  const b1 = -2 * a0 + k3;
  const b2 = 1 - 2 * a0 - k3;
  return { a0, a1, a2, b1, b2 };
}

function filterOnce(x: number[], c: BiquadCoefs): number[] {
  const y = new Array<number>(x.length);
  // Start in steady state at the first value so the filter does not ring.
  let x1 = x[0],
    x2 = x[0],
    y1 = x[0],
    y2 = x[0];
  for (let i = 0; i < x.length; i++) {
    const v = c.a0 * x[i] + c.a1 * x1 + c.a2 * x2 + c.b1 * y1 + c.b2 * y2;
    y[i] = v;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
  }
  return y;
}

/** Forward-backward filter one contiguous run, with odd-reflection padding at both ends. */
export function filtfiltRun(x: number[], c: BiquadCoefs, padLen: number): number[] {
  const n = x.length;
  if (n < 3) return x.slice();
  const p = Math.max(0, Math.min(padLen, n - 1));
  const padded: number[] = [];
  for (let k = p; k >= 1; k--) padded.push(2 * x[0] - x[k]);
  for (const v of x) padded.push(v);
  for (let k = 1; k <= p; k++) padded.push(2 * x[n - 1] - x[n - 1 - k]);
  const fwd = filterOnce(padded, c);
  const back = filterOnce(fwd.reverse(), c).reverse();
  return back.slice(p, p + n);
}

/** Zero-lag smoothing of a series with gaps. */
export function smoothSeries(
  values: readonly (number | null)[],
  sampleRateHz: number,
  cutoffHz: number,
): (number | null)[] {
  const out: (number | null)[] = values.map(() => null);
  if (!(sampleRateHz > 0)) return values.slice();
  const c = butterworthCoefs(cutoffHz, sampleRateHz);
  const padLen = Math.ceil((3 * sampleRateHz) / cutoffHz);
  let i = 0;
  while (i < values.length) {
    if (values[i] === null || !Number.isFinite(values[i] as number)) {
      i++;
      continue;
    }
    let j = i;
    const run: number[] = [];
    while (j < values.length && values[j] !== null && Number.isFinite(values[j] as number)) {
      run.push(values[j] as number);
      j++;
    }
    const f = filtfiltRun(run, c, padLen);
    for (let k = 0; k < f.length; k++) out[i + k] = f[k];
    i = j;
  }
  return out;
}

/** Smooth a 2D pixel track (x and y separately). */
export function smoothTrack<T extends { x: number; y: number }>(
  track: readonly (T | null)[],
  sampleRateHz: number,
  cutoffHz: number,
): ({ x: number; y: number } | null)[] {
  const xs = smoothSeries(
    track.map((p) => (p ? p.x : null)),
    sampleRateHz,
    cutoffHz,
  );
  const ys = smoothSeries(
    track.map((p) => (p ? p.y : null)),
    sampleRateHz,
    cutoffHz,
  );
  return track.map((p, i) => (p && xs[i] !== null && ys[i] !== null ? { x: xs[i]!, y: ys[i]! } : null));
}
