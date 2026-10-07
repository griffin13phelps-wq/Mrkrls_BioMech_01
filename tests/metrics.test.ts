import { describe, expect, it } from 'vitest';
import { jumpHeightCm, reactiveStrengthIndex } from '../src/core/jumpMetrics';
import { fmtFixed } from '../src/core/csv';
import { frameCountTimes, msBetween, frameRateFromDurations, timestampsUsable, nearestFrame } from '../src/core/timing';

describe('jump height = 9.81 × t² ÷ 8 × 100', () => {
  it.each([
    [520, '33.2'],
    [480, '28.3'],
    [470, '27.1'],
  ])('%i ms → %s cm', (ms, cm) => {
    expect(fmtFixed(jumpHeightCm(ms), 1)).toBe(cm);
  });

  it('shows the calculation for 520 ms', () => {
    // t = 0.52 s; 9.81 × 0.2704 = 2.652624; ÷ 8 = 0.331578 m; × 100 = 33.1578 cm → 33.2
    expect(jumpHeightCm(520)).toBeCloseTo(33.1578, 4);
  });
});

describe('frame counting at 240 fps', () => {
  it('takeoff frame 100, landing frame 220 → 500 ms → 30.7 cm', () => {
    const times = frameCountTimes(300, 240);
    const flight = msBetween(times, 100, 220);
    expect(flight).toBeCloseTo(500, 9); // (220 − 100) ÷ 240 = 0.5 s
    expect(fmtFixed(flight, 0)).toBe('500');
    expect(fmtFixed(jumpHeightCm(flight), 1)).toBe('30.7'); // 9.81 × 0.25 ÷ 8 = 0.30656 m
  });
});

describe('RSI', () => {
  it('470 ms flight + 210 ms contact → 1.29', () => {
    const h = jumpHeightCm(470); // 27.0878 cm
    const rsi = reactiveStrengthIndex(h, 210); // 0.270878 m ÷ 0.21 s = 1.28989
    expect(rsi).toBeCloseTo(1.28989, 4);
    expect(fmtFixed(rsi, 2)).toBe('1.29');
  });
});

describe('timing helpers', () => {
  it('frame rate from container durations', () => {
    // Durations alternating 2 and 3 units in a 1200 timescale → mean 2.5 units → 480 fps
    const durations = Array.from({ length: 480 }, (_, i) => (i % 2 ? 3 : 2));
    const info = frameRateFromDurations(durations, 1200, 0.25);
    expect(info.meanFps).toBeCloseTo(480, 6);
    const cfr = frameRateFromDurations(Array(240).fill(25), 6000, 0.25);
    expect(cfr.meanFps).toBe(240);
    expect(cfr.variable).toBe(false);
  });

  it('flags variable frame timing (e.g., a slow-motion ramp baked into the file)', () => {
    const d = [...Array(100).fill(25), ...Array(100).fill(200), ...Array(100).fill(25)];
    expect(frameRateFromDurations(d, 6000, 0.25).variable).toBe(true);
  });

  it('timestamp sanity check', () => {
    expect(timestampsUsable([0, 0.004, 0.008])).toBe(true);
    expect(timestampsUsable([0, 0.004, 0.004])).toBe(false);
    expect(timestampsUsable([0, NaN])).toBe(false);
  });

  it('nearest frame lookup', () => {
    const t = frameCountTimes(10, 10);
    expect(nearestFrame(t, 0.34)).toBe(3);
    expect(nearestFrame(t, 0.36)).toBe(4);
    expect(nearestFrame(t, 5)).toBe(9);
  });
});
