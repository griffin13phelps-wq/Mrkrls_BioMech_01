/**
 * CSV export, spec_version 0.2 (see README "CSV format").
 * Values are kept unrounded until formatRow(); validation runs on the exact
 * strings that will be written.
 */
import type { Lift, RepMeasures, Side, Variant } from './types';
import { VARIANTS, isJump } from './types';
import { SPEC_VERSION } from '../version';

export const CSV_COLUMNS = [
  'player_name',
  'player_id',
  'date',
  'session_id',
  'lift',
  'variant',
  'set_number',
  'rep_number',
  'camera_view',
  'side_facing_camera',
  'video_file_name',
  'app_version',
  'frame_rate_fps',
  'body_detected_pct',
  'frames_adjusted',
  'flight_time_ms',
  'jump_height_cm',
  'hold_time_ms',
  'start_knee_angle_deg',
  'dip_before_takeoff',
  'box_height_cm',
  'contact_time_ms',
  'rsi',
  'depth',
  'bottom_knee_angle_deg',
  'bottom_hip_angle_deg',
  'max_trunk_lean_deg',
  'down_time_ms',
  'up_time_ms',
  'load_lb',
  'bottom_thigh_angle_deg',
  'spec_version',
] as const;

export type Column = (typeof CSV_COLUMNS)[number];
export type CsvRow = Record<Column, string>;

/** Line separator between rows. LF (no trailing newline, no BOM). */
export const CSV_EOL = '\n';

/** Everything needed to write one row (unrounded numbers). */
export interface RowInput {
  playerName: string;
  date: string;
  sessionId: string;
  lift: Lift;
  variant: Variant | null;
  setNumber: number;
  repNumber: number;
  side: Side;
  videoFileName: string;
  appVersion: string;
  frameRateFps: number;
  boxHeightCm: number | null;
  loadLb: number | null;
  measures: RepMeasures;
}

/** Round half away from zero to `d` decimals, avoiding binary-float surprises (e.g., 1.005 → 1.01). */
export function roundHalfAway(x: number, d: number): number {
  const sign = x < 0 ? -1 : 1;
  const r = Number(Math.round(Number(Math.abs(x) + 'e' + d)) + 'e-' + d);
  return r === 0 ? 0 : sign * r;
}

/** Fixed number of decimals. null/undefined/NaN → blank. */
export function fmtFixed(x: number | null | undefined, d: number): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '';
  const r = roundHalfAway(x, d);
  return (r === 0 ? 0 : r).toFixed(d); // avoid "-0.0"
}

/** Up to `d` decimals, trailing zeros removed (used for frame_rate_fps). */
export function fmtUpTo(x: number | null | undefined, d: number): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '';
  return String(roundHalfAway(x, d));
}

const yn = (b: boolean | null | undefined): string => (b === null || b === undefined ? '' : b ? 'Y' : 'N');

/** Build the row strings. Columns that do not apply to the lift are always blank. */
export function formatRow(r: RowInput): CsvRow {
  const m = r.measures;
  const jump = isJump(r.lift);
  const lift = r.lift;
  const row: CsvRow = Object.fromEntries(CSV_COLUMNS.map((c) => [c, ''])) as CsvRow;
  row.player_name = r.playerName;
  row.player_id = '';
  row.date = r.date;
  row.session_id = r.sessionId;
  row.lift = lift;
  row.variant = jump ? '' : (r.variant ?? '');
  row.set_number = String(r.setNumber);
  row.rep_number = String(r.repNumber);
  row.camera_view = 'side';
  row.side_facing_camera = r.side;
  row.video_file_name = r.videoFileName;
  row.app_version = r.appVersion;
  row.frame_rate_fps = fmtUpTo(r.frameRateFps, 2);
  row.body_detected_pct = fmtFixed(m.bodyDetectedPct, 1);
  if (jump) {
    row.frames_adjusted = yn(m.framesAdjusted ?? false);
    row.flight_time_ms = fmtFixed(m.flightTimeMs, 0);
    row.jump_height_cm = fmtFixed(m.jumpHeightCm, 1);
  }
  if (lift === 'squat_jump') {
    row.hold_time_ms = fmtFixed(m.holdTimeMs, 0);
    row.start_knee_angle_deg = fmtFixed(m.startKneeAngleDeg, 1);
    row.dip_before_takeoff = yn(m.dipBeforeTakeoff);
  }
  if (lift === 'drop_jump') {
    row.box_height_cm = fmtFixed(r.boxHeightCm, 1);
    row.contact_time_ms = fmtFixed(m.contactTimeMs, 0);
    row.rsi = row.jump_height_cm !== '' && row.contact_time_ms !== '' ? fmtFixed(m.rsi, 2) : '';
  }
  if (lift === 'squat') {
    row.depth = m.depth ?? '';
    row.bottom_thigh_angle_deg = fmtFixed(m.bottomThighAngleDeg, 1);
  }
  if (lift === 'squat' || lift === 'hinge') {
    row.bottom_knee_angle_deg = fmtFixed(m.bottomKneeAngleDeg, 1);
    row.bottom_hip_angle_deg = fmtFixed(m.bottomHipAngleDeg, 1);
    row.max_trunk_lean_deg = fmtFixed(m.maxTrunkLeanDeg, 1);
    row.down_time_ms = fmtFixed(m.downTimeMs, 0);
    row.up_time_ms = fmtFixed(m.upTimeMs, 0);
    row.load_lb = fmtFixed(r.loadLb, 1);
  }
  row.spec_version = SPEC_VERSION;
  return row;
}

/** Quote a field if it contains a comma, a double quote, or a line break; double any quotes. */
export function csvField(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(rows: readonly CsvRow[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of rows) lines.push(CSV_COLUMNS.map((c) => csvField(r[c])).join(','));
  return lines.join(CSV_EOL);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface RowProblem {
  /** 1-based data row number (header excluded). */
  row: number;
  messages: string[];
}

const LIFTS: readonly Lift[] = ['cmj', 'squat_jump', 'drop_jump', 'squat', 'hinge'];
const isInt = (s: string) => /^-?\d+$/.test(s);
const isNum = (s: string) => /^-?\d+(\.\d+)?$/.test(s);
const decimals = (s: string) => (s.includes('.') ? s.split('.')[1].length : 0);

export const SESSION_ID_RE = /^MC-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})-[A-Z0-9]{4}$/;

function validDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

type Applic = 'R' | 'E' | '-';

/** Which columns apply to which lift (R = required, E = expected, - = must be blank). */
export function applicability(lift: Lift, col: Column): Applic {
  const jump = isJump(lift);
  const lifting = lift === 'squat' || lift === 'hinge';
  switch (col) {
    case 'player_name':
    case 'date':
    case 'session_id':
    case 'lift':
    case 'set_number':
    case 'rep_number':
    case 'camera_view':
    case 'side_facing_camera':
    case 'video_file_name':
    case 'app_version':
    case 'frame_rate_fps':
    case 'spec_version':
      return 'R';
    case 'player_id':
      return '-';
    case 'body_detected_pct':
      return 'E';
    case 'variant':
    case 'load_lb':
      return lifting ? 'R' : '-';
    case 'frames_adjusted':
      return jump ? 'R' : '-';
    case 'flight_time_ms':
    case 'jump_height_cm':
      return jump ? 'E' : '-';
    case 'hold_time_ms':
    case 'start_knee_angle_deg':
    case 'dip_before_takeoff':
      return lift === 'squat_jump' ? 'E' : '-';
    case 'box_height_cm':
      return lift === 'drop_jump' ? 'R' : '-';
    case 'contact_time_ms':
    case 'rsi':
      return lift === 'drop_jump' ? 'E' : '-';
    case 'depth':
    case 'bottom_thigh_angle_deg':
      return lift === 'squat' ? 'E' : '-';
    case 'bottom_knee_angle_deg':
    case 'bottom_hip_angle_deg':
    case 'max_trunk_lean_deg':
    case 'down_time_ms':
    case 'up_time_ms':
      return lifting ? 'E' : '-';
  }
}

/** Format check for a non-blank value. Returns an error message or null. */
function checkValue(col: Column, v: string, lift: Lift): string | null {
  const range = (lo: number, hi: number, d: number) =>
    isNum(v) && Number(v) >= lo && Number(v) <= hi && decimals(v) <= d ? null : `${col} must be a number from ${lo} to ${hi} with at most ${d} decimal(s) (got "${v}")`;
  const posInt = () => (isInt(v) && Number(v) > 0 ? null : `${col} must be a whole number greater than 0 (got "${v}")`);
  switch (col) {
    case 'lift':
      return LIFTS.includes(v as Lift) ? null : `lift "${v}" is not one of ${LIFTS.join(', ')}`;
    case 'variant':
      return VARIANTS[lift].includes(v as Variant) ? null : `variant "${v}" is not allowed for ${lift} (allowed: ${VARIANTS[lift].join(', ')})`;
    case 'set_number':
    case 'rep_number':
      return isInt(v) && Number(v) >= 1 ? null : `${col} must be a whole number >= 1 (got "${v}")`;
    case 'camera_view':
      return v === 'side' ? null : `camera_view must be "side"`;
    case 'side_facing_camera':
      return v === 'left' || v === 'right' ? null : `side_facing_camera must be left or right`;
    case 'video_file_name':
      return /\.[A-Za-z0-9]+$/.test(v) ? null : `video_file_name "${v}" has no file extension`;
    case 'app_version':
      return /^\d+\.\d+\.\d+$/.test(v) ? null : `app_version "${v}" is not MAJOR.MINOR.PATCH`;
    case 'frame_rate_fps':
      return isNum(v) && Number(v) > 0 && decimals(v) <= 2 ? null : `frame_rate_fps must be > 0 with at most 2 decimals (got "${v}")`;
    case 'body_detected_pct':
      return range(0, 100, 1);
    case 'frames_adjusted':
    case 'dip_before_takeoff':
      return v === 'Y' || v === 'N' ? null : `${col} must be Y or N`;
    case 'flight_time_ms':
    case 'contact_time_ms':
    case 'down_time_ms':
    case 'up_time_ms':
      return posInt();
    case 'hold_time_ms':
      return isInt(v) && Number(v) >= 0 ? null : `hold_time_ms must be a whole number >= 0 (got "${v}")`;
    case 'jump_height_cm':
      return isNum(v) && Number(v) >= 0 && decimals(v) <= 1 ? null : `jump_height_cm must be a number >= 0 with 1 decimal (got "${v}")`;
    case 'box_height_cm':
      return isNum(v) && Number(v) > 0 && decimals(v) <= 1 ? null : `box_height_cm must be > 0 with 1 decimal (got "${v}")`;
    case 'rsi':
      return isNum(v) && Number(v) >= 0 && decimals(v) <= 2 ? null : `rsi must be a number with 2 decimals (got "${v}")`;
    case 'depth':
      return ['above', 'parallel', 'below'].includes(v) ? null : `depth must be above, parallel or below`;
    case 'start_knee_angle_deg':
    case 'bottom_knee_angle_deg':
    case 'bottom_hip_angle_deg':
    case 'max_trunk_lean_deg':
      return range(0, 180, 1);
    case 'bottom_thigh_angle_deg':
      return range(-90, 90, 1);
    case 'load_lb':
      return isNum(v) && Number(v) >= 0 && decimals(v) <= 1 ? null : `load_lb must be a number >= 0 with 1 decimal (got "${v}")`;
    case 'spec_version':
      return v === SPEC_VERSION ? null : `spec_version must be "${SPEC_VERSION}"`;
    default:
      return null;
  }
}

/**
 * Check every row against the spec. `roster` = exact player names allowed.
 * Returns one entry per failing row; an empty array means the file can be exported.
 */
export function validateRows(rows: readonly CsvRow[], roster: readonly string[]): RowProblem[] {
  const problems: RowProblem[] = [];
  const seen = new Map<string, number>();
  const rosterSet = new Set(roster);
  rows.forEach((row, idx) => {
    const msgs: string[] = [];
    if (Object.keys(row).length !== CSV_COLUMNS.length) msgs.push(`row has ${Object.keys(row).length} fields, expected ${CSV_COLUMNS.length}`);
    const lift = row.lift as Lift;
    if (!LIFTS.includes(lift)) {
      msgs.push(`lift "${row.lift}" is not one of ${LIFTS.join(', ')}`);
      problems.push({ row: idx + 1, messages: msgs });
      return;
    }
    let expectedFilled = 0;
    let expectedCount = 0;
    for (const col of CSV_COLUMNS) {
      const v = row[col] ?? '';
      if (/^(N\/A|null|NULL|-)$/.test(v)) msgs.push(`${col} contains "${v}"; blanks must be empty cells`);
      const a = applicability(lift, col);
      if (a === '-' && v !== '') msgs.push(`${col} must be blank for ${lift}`);
      if (a === 'R' && v === '') msgs.push(`${col} is required`);
      if (a === 'E') {
        expectedCount++;
        if (v !== '') expectedFilled++;
      }
      if (v !== '' && a !== '-') {
        const err = checkValue(col, v, lift);
        if (err) msgs.push(err);
      }
    }
    if (row.player_name && !rosterSet.has(row.player_name)) msgs.push(`player "${row.player_name}" is not on the roster`);
    const m = SESSION_ID_RE.exec(row.session_id);
    if (row.session_id && !m) msgs.push(`session_id "${row.session_id}" is not MC-YYYYMMDD-HHMM-XXXX`);
    if (m) {
      const [, y, mo, d, hh, mm] = m;
      if (!validDate(+y, +mo, +d) || +hh > 23 || +mm > 59) msgs.push(`session_id "${row.session_id}" has an invalid date or time`);
      if (row.date !== `${y}-${mo}-${d}`) msgs.push(`date ${row.date} does not match the date in session_id (${y}-${mo}-${d})`);
    }
    if (row.date && !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) msgs.push(`date "${row.date}" is not YYYY-MM-DD`);
    else if (row.date) {
      const [y, mo, d] = row.date.split('-').map(Number);
      if (!validDate(y, mo, d)) msgs.push(`date "${row.date}" is not a real date`);
    }
    if (lift === 'drop_jump' && row.rsi !== '' && (row.jump_height_cm === '' || row.contact_time_ms === ''))
      msgs.push('rsi must be blank when jump_height_cm or contact_time_ms is blank');
    if (expectedCount > 0 && expectedFilled === 0) msgs.push('every measurement column is blank (nothing was measured)');
    const key = [row.session_id, row.player_name, row.lift, row.variant, row.set_number, row.rep_number].join('\u0000');
    const prev = seen.get(key);
    if (prev !== undefined) msgs.push(`duplicate of row ${prev}: same session, player, lift, variant, set and rep`);
    else seen.set(key, idx + 1);
    if (msgs.length) problems.push({ row: idx + 1, messages: msgs });
  });
  return problems;
}

/** Build the CSV only if every row is valid. */
export function buildCsv(rows: readonly CsvRow[], roster: readonly string[]): { ok: true; csv: string } | { ok: false; problems: RowProblem[] } {
  const problems = validateRows(rows, roster);
  return problems.length ? { ok: false, problems } : { ok: true, csv: toCsv(rows) };
}
