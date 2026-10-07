import { describe, expect, it } from 'vitest';
import { butterworthCoefs, smoothSeries } from '../src/core/smoothing';

describe('zero-lag smoothing', () => {
  it('unity gain at DC', () => {
    const c = butterworthCoefs(6, 240);
    expect((c.a0 + c.a1 + c.a2) / (1 - c.b1 - c.b2)).toBeCloseTo(1, 12);
    const out = smoothSeries(Array(100).fill(7), 240, 6);
    out.forEach((v) => expect(v).toBeCloseTo(7, 9));
  });

  it('does not shift a peak in time (forward-backward)', () => {
    const fs = 240;
    const x = Array.from({ length: 600 }, (_, i) => Math.exp(-(((i - 300) / 40) ** 2)));
    const y = smoothSeries(x, fs, 6) as number[];
    const peak = y.indexOf(Math.max(...y));
    expect(peak).toBe(300);
  });

  it('keeps gaps as gaps and never fills them', () => {
    const x: (number | null)[] = Array.from({ length: 100 }, (_, i) => i);
    for (let i = 40; i < 50; i++) x[i] = null;
    const y = smoothSeries(x, 30, 6);
    for (let i = 40; i < 50; i++) expect(y[i]).toBeNull();
    expect(y[39]).not.toBeNull();
    expect(y[50]).not.toBeNull();
  });

  it('keeps a straight line straight (odd-reflection padding)', () => {
    const x = Array.from({ length: 50 }, (_, i) => 3 * i + 2);
    const y = smoothSeries(x, 30, 6) as number[];
    y.forEach((v, i) => expect(v).toBeCloseTo(3 * i + 2, 4));
  });
});
