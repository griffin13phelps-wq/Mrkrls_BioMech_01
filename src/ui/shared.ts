import type { AnalysisContext, LiftAnalysis } from '../core/analysis';
import { FILMING_TIPS } from '../core/analysis';
import type { FloorInfo } from '../core/jumpEvents';
import type { SideDetection } from '../core/side';
import type { Lift, Side, Variant } from '../core/types';
import type { ProcessedVideo, VideoProbe } from '../pose/runner';
import { saveSettings, store } from '../state';
import type { ReviewFrames } from '../video/frameCache';
import { h } from './h';

export type Screen = 'home' | 'roster' | 'settings' | 'setup' | 'processing' | 'error' | 'side' | 'review-jump' | 'review-lift';

export interface JumpEvents {
  contact?: number;
  takeoff: number;
  landing: number;
}

export interface JumpItem {
  suggested: JumpEvents;
  current: JumpEvents;
  confirmed: { contact: boolean; takeoff: boolean; landing: boolean };
  warnings: string[];
  deleted: boolean;
}

/** In-memory state of the set being filmed/reviewed (never persisted; holds the File). */
export interface Work {
  playerName: string;
  lift: Lift;
  variant: Variant | null;
  setNumber: number;
  setNumberTouched: boolean;
  loadLb: number | null;
  boxHeightCm: number | null;
  file: File | null;
  probe: VideoProbe | null;
  probeError: string | null;
  processed: ProcessedVideo | null;
  sideDetection: SideDetection | null;
  side: Side | null;
  ctx: AnalysisContext | null;
  frames: ReviewFrames | null;
  jumps: JumpItem[];
  floor: FloorInfo | null;
  jumpError: string | null;
  liftResult: LiftAnalysis | null;
  deletedReps: Set<number>;
  error: { title: string; message: string; detail?: string } | null;
}

export function emptyWork(): Work {
  return {
    playerName: '',
    lift: 'cmj',
    variant: null,
    setNumber: 1,
    setNumberTouched: false,
    loadLb: null,
    boxHeightCm: store.settings.lastBoxHeightCm,
    file: null,
    probe: null,
    probeError: null,
    processed: null,
    sideDetection: null,
    side: null,
    ctx: null,
    frames: null,
    jumps: [],
    floor: null,
    jumpError: null,
    liftResult: null,
    deletedReps: new Set(),
    error: null,
  };
}

export function protocolCard(): HTMLElement {
  const d = h('details.protocol', {}, h('summary', 'Filming protocol'), h('div.body', store.settings.protocolText));
  d.open = store.settings.protocolOpen;
  d.addEventListener('toggle', () => saveSettings({ protocolOpen: d.open }));
  return d;
}

export function honestyNote(): HTMLElement {
  return h(
    'div.honesty',
    { role: 'note' },
    'Single-camera estimates. Knee angles and jump height are the most reliable; hip angles and trunk lean are moderate confidence. Not a substitute for lab testing.',
  );
}

export function errorPanel(title: string, message: string, detail?: string): HTMLElement {
  return h(
    'div.card',
    h('div.note.error', h('strong', title), h('p', message)),
    h('h3', 'Filming tips'),
    h(
      'ul',
      FILMING_TIPS.map((t) => h('li', t)),
    ),
    detail ? h('details', h('summary.small', 'Technical details'), h('pre.log', detail)) : null,
  );
}

export const fmt = {
  ms: (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v)} ms`),
  cm: (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toFixed(1)} cm`),
  deg: (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toFixed(1)}°`),
  pct: (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toFixed(1)}%`),
  rsi: (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toFixed(2)),
  yn: (v: boolean | null | undefined) => (v === null || v === undefined ? '—' : v ? 'Yes' : 'No'),
};

export function kvTable(rows: [string, string][]): HTMLElement {
  return h(
    'table.kv',
    h(
      'tbody',
      rows.map(([k, v]) => h('tr', h('td', k), h('td', v))),
    ),
  );
}
