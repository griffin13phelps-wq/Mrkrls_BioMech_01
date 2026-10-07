import { describe, expect, it } from 'vitest';
import { CSV_COLUMNS, buildCsv, csvField, fmtFixed, fmtUpTo, formatRow, roundHalfAway, toCsv, validateRows, type RowInput } from '../src/core/csv';
import type { Lift, Variant } from '../src/core/types';

/** Minimal RFC 4180 parser used only to check the output. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let f = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        f += '"';
        i++;
      } else if (c === '"') q = false;
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(f);
      f = '';
    } else if (c === '\n') {
      row.push(f);
      rows.push(row);
      row = [];
      f = '';
    } else f += c;
  }
  row.push(f);
  rows.push(row);
  return rows;
}

const ROSTER = ['Alex Smith', 'Jordan "JJ" Lee', 'Sam Smith, Jr.'];

function base(lift: Lift, variant: Variant | null = null): RowInput {
  return {
    playerName: 'Alex Smith',
    date: '2026-10-07',
    sessionId: 'MC-20261007-0930-AB12',
    lift,
    variant,
    setNumber: 1,
    repNumber: 1,
    side: 'left',
    videoFileName: 'IMG_0412.MOV',
    appVersion: '0.1.0',
    frameRateFps: 240,
    boxHeightCm: lift === 'drop_jump' ? 40 : null,
    loadLb: lift === 'squat' || lift === 'hinge' ? 225 : null,
    measures: {
      bodyDetectedPct: 98.76,
      framesAdjusted: true,
      flightTimeMs: 470.4,
      jumpHeightCm: 27.0878,
      holdTimeMs: 3012.6,
      startKneeAngleDeg: 91.25,
      dipBeforeTakeoff: false,
      contactTimeMs: 210.2,
      rsi: 1.28989,
      depth: 'below',
      bottomKneeAngleDeg: 70.04,
      bottomHipAngleDeg: 55.55,
      maxTrunkLeanDeg: 40.05,
      downTimeMs: 1099.5,
      upTimeMs: 950.49,
      bottomThighAngleDeg: 4.249,
    },
  };
}

const ALL_LIFTS: [Lift, Variant | null][] = [
  ['cmj', null],
  ['squat_jump', null],
  ['drop_jump', null],
  ['squat', 'back'],
  ['hinge', 'trap_bar'],
];

describe('CSV structure', () => {
  it('header is exactly the 32 columns in order', () => {
    const csv = toCsv([]);
    expect(csv).toBe(
      'player_name,player_id,date,session_id,lift,variant,set_number,rep_number,camera_view,side_facing_camera,video_file_name,app_version,frame_rate_fps,body_detected_pct,frames_adjusted,flight_time_ms,jump_height_cm,hold_time_ms,start_knee_angle_deg,dip_before_takeoff,box_height_cm,contact_time_ms,rsi,depth,bottom_knee_angle_deg,bottom_hip_angle_deg,max_trunk_lean_deg,down_time_ms,up_time_ms,load_lb,bottom_thigh_angle_deg,spec_version',
    );
    expect(CSV_COLUMNS).toHaveLength(32);
  });

  it('every row has exactly 32 fields, even with commas and quotes in values', () => {
    const rows = ALL_LIFTS.map(([l, v], i) => formatRow({ ...base(l, v), playerName: ROSTER[i % 3], videoFileName: 'clip, "take 2".MOV' }));
    const parsed = parseCsv(toCsv(rows));
    expect(parsed).toHaveLength(6);
    parsed.forEach((r) => expect(r).toHaveLength(32));
    // parsed[0] is the header; data row i is parsed[i + 1]
    expect(parsed[3][0]).toBe('Sam Smith, Jr.');
    expect(parsed[3][10]).toBe('clip, "take 2".MOV');
    expect(parsed[2][0]).toBe('Jordan "JJ" Lee');
  });

  it('quotes fields containing a comma or a double quote, doubling inner quotes', () => {
    expect(csvField('Sam Smith, Jr.')).toBe('"Sam Smith, Jr."');
    expect(csvField('Jordan "JJ" Lee')).toBe('"Jordan ""JJ"" Lee"');
    expect(csvField('Alex Smith')).toBe('Alex Smith');
  });
});

describe('blanks per lift', () => {
  const filled = (lift: Lift, v: Variant | null) => {
    const r = formatRow(base(lift, v));
    return CSV_COLUMNS.filter((c) => r[c] !== '');
  };
  const common = ['player_name', 'date', 'session_id', 'lift', 'set_number', 'rep_number', 'camera_view', 'side_facing_camera', 'video_file_name', 'app_version', 'frame_rate_fps', 'body_detected_pct', 'spec_version'];

  it('cmj', () => expect(filled('cmj', null).sort()).toEqual([...common, 'frames_adjusted', 'flight_time_ms', 'jump_height_cm'].sort()));
  it('squat_jump', () =>
    expect(filled('squat_jump', null).sort()).toEqual(
      [...common, 'frames_adjusted', 'flight_time_ms', 'jump_height_cm', 'hold_time_ms', 'start_knee_angle_deg', 'dip_before_takeoff'].sort(),
    ));
  it('drop_jump', () =>
    expect(filled('drop_jump', null).sort()).toEqual(
      [...common, 'frames_adjusted', 'flight_time_ms', 'jump_height_cm', 'box_height_cm', 'contact_time_ms', 'rsi'].sort(),
    ));
  it('squat', () =>
    expect(filled('squat', 'back').sort()).toEqual(
      [...common, 'variant', 'depth', 'bottom_knee_angle_deg', 'bottom_hip_angle_deg', 'max_trunk_lean_deg', 'down_time_ms', 'up_time_ms', 'load_lb', 'bottom_thigh_angle_deg'].sort(),
    ));
  it('hinge', () =>
    expect(filled('hinge', 'trap_bar').sort()).toEqual(
      [...common, 'variant', 'bottom_knee_angle_deg', 'bottom_hip_angle_deg', 'max_trunk_lean_deg', 'down_time_ms', 'up_time_ms', 'load_lb'].sort(),
    ));
  it('player_id is always blank; blank cells are empty strings', () => {
    for (const [l, v] of ALL_LIFTS) {
      const r = formatRow(base(l, v));
      expect(r.player_id).toBe('');
      for (const c of CSV_COLUMNS) expect(['N/A', 'null', '-', 'NaN', 'undefined']).not.toContain(r[c]);
    }
  });
  it('rsi is blank when contact time is missing', () => {
    const b = base('drop_jump');
    b.measures.contactTimeMs = null;
    expect(formatRow(b).rsi).toBe('');
  });
});

describe('rounding', () => {
  it('angles, cm and lb: 1 decimal; ms: whole numbers; RSI: 2 decimals', () => {
    const sq = formatRow(base('squat', 'front'));
    expect(sq.bottom_knee_angle_deg).toBe('70.0');
    expect(sq.bottom_hip_angle_deg).toBe('55.6'); // 55.55 → half away from zero
    expect(sq.max_trunk_lean_deg).toBe('40.1'); // 40.05
    expect(sq.down_time_ms).toBe('1100'); // 1099.5
    expect(sq.up_time_ms).toBe('950');
    expect(sq.load_lb).toBe('225.0');
    expect(sq.bottom_thigh_angle_deg).toBe('4.2');
    expect(sq.body_detected_pct).toBe('98.8');
    const dj = formatRow(base('drop_jump'));
    expect(dj.flight_time_ms).toBe('470');
    expect(dj.jump_height_cm).toBe('27.1');
    expect(dj.contact_time_ms).toBe('210');
    expect(dj.rsi).toBe('1.29');
    expect(dj.box_height_cm).toBe('40.0');
    expect(dj.frame_rate_fps).toBe('240');
  });

  it('frame rate: up to 2 decimals', () => {
    expect(fmtUpTo(239.9761, 2)).toBe('239.98');
    expect(fmtUpTo(29.97002997, 2)).toBe('29.97');
    expect(fmtUpTo(60, 2)).toBe('60');
  });

  it('round half away from zero without binary-float surprises; no "-0.0"', () => {
    expect(roundHalfAway(1.005, 2)).toBe(1.01);
    expect(roundHalfAway(-2.25, 1)).toBe(-2.3);
    expect(fmtFixed(-0.04, 1)).toBe('0.0');
    expect(fmtFixed(null, 1)).toBe('');
    expect(fmtFixed(NaN, 1)).toBe('');
  });
});

describe('validation blocks export', () => {
  const valid = ALL_LIFTS.map(([l, v], i) => formatRow({ ...base(l, v), setNumber: i + 1 }));

  it('a valid file exports', () => {
    expect(validateRows(valid, ROSTER)).toEqual([]);
    expect(buildCsv(valid, ROSTER).ok).toBe(true);
  });

  it('missing load_lb on a squat blocks export and names the row', () => {
    const bad = formatRow({ ...base('squat', 'back'), loadLb: null, setNumber: 9 });
    const res = buildCsv([...valid, bad], ROSTER);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.problems).toHaveLength(1);
    expect(res.problems[0].row).toBe(6);
    expect(res.problems[0].messages.join(' ')).toMatch(/load_lb is required/);
  });

  it('a row with every expected column blank is invalid', () => {
    const b = base('cmj');
    b.measures = { bodyDetectedPct: null, framesAdjusted: false, flightTimeMs: null, jumpHeightCm: null };
    const p = validateRows([formatRow(b)], ROSTER);
    expect(p[0].messages.join(' ')).toMatch(/every measurement column is blank/);
  });

  it('duplicates, date mismatch, bad session id, unknown player, wrong variant', () => {
    const dup = validateRows([valid[0], valid[0]], ROSTER);
    expect(dup[0].row).toBe(2);
    expect(dup[0].messages.join(' ')).toMatch(/duplicate of row 1/);

    const mismatch = formatRow({ ...base('cmj'), date: '2026-10-08' });
    expect(validateRows([mismatch], ROSTER)[0].messages.join(' ')).toMatch(/does not match/);

    const badId = formatRow({ ...base('cmj'), sessionId: 'MC-20261007-0930-ab12' });
    expect(validateRows([badId], ROSTER)[0].messages.join(' ')).toMatch(/MC-YYYYMMDD-HHMM-XXXX/);

    const unknown = formatRow({ ...base('cmj'), playerName: 'Pat Jones' });
    expect(validateRows([unknown], ROSTER)[0].messages.join(' ')).toMatch(/not on the roster/);

    const wrongVariant = formatRow({ ...base('squat', 'rdl') });
    expect(validateRows([wrongVariant], ROSTER)[0].messages.join(' ')).toMatch(/variant "rdl" is not allowed/);
  });

  it('values out of range are caught', () => {
    const r = formatRow(base('squat', 'back'));
    r.bottom_thigh_angle_deg = '95.0';
    r.down_time_ms = '0';
    const msgs = validateRows([r], ROSTER)[0].messages.join(' ');
    expect(msgs).toMatch(/bottom_thigh_angle_deg/);
    expect(msgs).toMatch(/down_time_ms/);
  });

  it('a field that must be blank for the lift is caught', () => {
    const r = formatRow(base('cmj'));
    r.load_lb = '0.0';
    expect(validateRows([r], ROSTER)[0].messages.join(' ')).toMatch(/load_lb must be blank for cmj/);
  });
});
