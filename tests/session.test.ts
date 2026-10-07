import { describe, expect, it } from 'vitest';
import { localDate, makeSessionId, parseRoster, randomSuffix, suggestSetNumber } from '../src/core/session';
import { SESSION_ID_RE } from '../src/core/csv';
import { detectSide } from '../src/core/side';
import { bodyDetectedPct, jumpQualityWindow } from '../src/core/quality';
import { KEY_JOINTS_JUMP } from '../src/core/landmarks';
import { frameCountTimes } from '../src/core/timing';
import { frameFrom, LEG, ankleOn, FLOOR_Y, STAND_HIP_ABOVE_ANKLE } from './synth';

describe('session id', () => {
  it('MC-YYYYMMDD-HHMM-XXXX from local start time; date matches', () => {
    const d = new Date(2026, 9, 7, 9, 5); // local 2026-10-07 09:05
    const id = makeSessionId(d, 'Z9K0');
    expect(id).toBe('MC-20261007-0905-Z9K0');
    expect(localDate(d)).toBe('2026-10-07');
    expect(SESSION_ID_RE.test(makeSessionId(d))).toBe(true);
  });
  it('random suffix: 4 chars, A–Z / 0–9', () => {
    for (let i = 0; i < 200; i++) expect(randomSuffix()).toMatch(/^[A-Z0-9]{4}$/);
  });
});

describe('set number suggestion', () => {
  it('next number per player + lift + variant', () => {
    const sets = [
      { playerName: 'A B', lift: 'squat' as const, variant: 'back' as const, setNumber: 1 },
      { playerName: 'A B', lift: 'squat' as const, variant: 'back' as const, setNumber: 2 },
      { playerName: 'A B', lift: 'squat' as const, variant: 'front' as const, setNumber: 1 },
      { playerName: 'C D', lift: 'cmj' as const, variant: null, setNumber: 3 },
    ];
    expect(suggestSetNumber(sets, 'A B', 'squat', 'back')).toBe(3);
    expect(suggestSetNumber(sets, 'A B', 'squat', 'goblet')).toBe(1);
    expect(suggestSetNumber(sets, 'C D', 'cmj', null)).toBe(4);
  });
});

describe('roster', () => {
  it('one name per line, warns on duplicates and malformed lines', () => {
    const r = parseRoster('Alex Smith\n  jordan   lee \n\nAlex Smith\nalex smith\nMadonna\n');
    expect(r.names).toEqual(['Alex Smith', 'jordan lee', 'Madonna']);
    expect(r.duplicates).toEqual(['Alex Smith', 'alex smith']);
    expect(r.malformed).toEqual(['Madonna']);
  });
});

describe('side detection and body_detected_pct', () => {
  const standing = () =>
    frameFrom({ ankleX: 500, ankleY: ankleOn(FLOOR_Y), hipX: 470, hipY: ankleOn(FLOOR_Y) - STAND_HIP_ABOVE_ANKLE, trunkLeanDeg: 5 });

  it('picks the side with higher visibility; undetermined when too close', () => {
    expect(detectSide([standing(), standing()], 0.05).side).toBe('left');
    const mirrored = [frameFrom({ ankleX: 500, ankleY: 1600, hipX: 470, hipY: 1000, trunkLeanDeg: 5 }, 0.3, 0.99)];
    expect(detectSide(mirrored, 0.05).side).toBe('right');
    const close = [frameFrom({ ankleX: 500, ankleY: 1600, hipX: 470, hipY: 1000, trunkLeanDeg: 5 }, 0.9, 0.88)];
    expect(detectSide(close, 0.05).side).toBeNull();
    expect(detectSide([null, null], 0.05).side).toBeNull();
  });

  it('per-rep %: frames where all key near-side landmarks pass', () => {
    const frames = Array.from({ length: 10 }, standing);
    frames[3] = null; // no person
    frames[4] = frames[4]!.map((p, i) => (i === 29 ? { ...p, visibility: 0.2 } : p)); // heel fails
    frames[5] = frames[5]!.map((p, i) => (i === 31 ? { ...p, presence: 0.4 } : p)); // toe presence fails
    frames[6] = frames[6]!.map((p, i) => (i === 25 ? { ...p, y: 1.02 } : p)); // knee outside image
    expect(bodyDetectedPct(frames, 'left', KEY_JOINTS_JUMP, 0, 9, 0.5)).toBe(60);
    expect(bodyDetectedPct(frames, 'left', KEY_JOINTS_JUMP, 7, 9, 0.5)).toBe(100);
  });

  it('jump window starts 1 s before the start event', () => {
    const t = frameCountTimes(1000, 240);
    expect(jumpQualityWindow(t, 500, 620, 1000)).toEqual([260, 620]);
    expect(jumpQualityWindow(t, 100, 220, 1000)).toEqual([0, 220]);
  });

  it('LEG constant sanity', () => expect(LEG).toBeGreaterThan(0));
});
