/**
 * Persistent app state in localStorage: roster, current session (rep data
 * only, never video), and settings. Every read/write is guarded because
 * storage can be unavailable (private mode, blocked site data).
 */
import { DEFAULT_MAX_VIDEO_SECONDS } from './config';
import type { Lift, RepMeasures, Side, Variant } from './core/types';
import { localDate, makeSessionId } from './core/session';
import { formatRow, type CsvRow } from './core/csv';

export const DEFAULT_PROTOCOL = `Side view only. Camera square to the athlete, at hip height, phone LEVEL (not tilted), on a tripod or held still. Whole body and feet in frame.

Jumps: hands on hips, no arm swing. Land with legs straight, in the same position as takeoff.

Squat jump: sink to a 90° knee angle, hold 3 seconds, jump with no dip.

Drop jump: step off the box (don't jump off). Cue: "Jump as high as you can, as fast as you can."

Frame rate: jumps in slo-mo (240 fps preferred, never below 120). Squats/hinges: normal video (30 or 60 fps) is fine.`;

export interface Settings {
  protocolText: string;
  maxVideoSeconds: number;
  lastBoxHeightCm: number | null;
  protocolOpen: boolean;
}

export interface SavedSet {
  id: string;
  playerName: string;
  lift: Lift;
  variant: Variant | null;
  setNumber: number;
  loadLb: number | null;
  boxHeightCm: number | null;
  side: Side;
  videoFileName: string;
  frameRateFps: number;
  appVersion: string;
  savedAt: string;
  /** In rep order; rep_number = position + 1. */
  reps: RepMeasures[];
}

export interface Session {
  sessionId: string;
  date: string;
  startedAt: string;
  sets: SavedSet[];
}

const KEYS = {
  roster: 'liftlab.roster.v1',
  session: 'liftlab.session.v1',
  settings: 'liftlab.settings.v1',
};

let storageOk = true;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    storageOk = false;
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    storageOk = true;
  } catch {
    storageOk = false;
  }
}

export const storageAvailable = () => storageOk;

export const store = {
  roster: read<string[]>(KEYS.roster, []),
  session: read<Session | null>(KEYS.session, null),
  settings: {
    protocolText: DEFAULT_PROTOCOL,
    maxVideoSeconds: DEFAULT_MAX_VIDEO_SECONDS,
    lastBoxHeightCm: null,
    protocolOpen: true,
    ...read<Partial<Settings>>(KEYS.settings, {}),
  } as Settings,
};

export function saveRoster(names: string[]): void {
  store.roster = names;
  write(KEYS.roster, names);
}

export function saveSettings(patch: Partial<Settings>): void {
  store.settings = { ...store.settings, ...patch };
  write(KEYS.settings, store.settings);
}

export function startSession(now = new Date()): Session {
  const s: Session = { sessionId: makeSessionId(now), date: localDate(now), startedAt: now.toISOString(), sets: [] };
  store.session = s;
  write(KEYS.session, s);
  return s;
}

export function saveSession(): void {
  write(KEYS.session, store.session);
}

export function clearSession(): void {
  store.session = null;
  write(KEYS.session, null);
}

/** Ask the browser not to evict our storage (best effort). */
export async function requestPersistentStorage(): Promise<boolean | null> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* ignore */
  }
  return null;
}

export interface RowRef {
  setId: string;
  repIndex: number;
}

/** All CSV rows for the session, in set then rep order, with a back-reference for error messages. */
export function sessionRows(session: Session): { rows: CsvRow[]; refs: RowRef[] } {
  const rows: CsvRow[] = [];
  const refs: RowRef[] = [];
  for (const set of session.sets) {
    set.reps.forEach((m, i) => {
      rows.push(
        formatRow({
          playerName: set.playerName,
          date: session.date,
          sessionId: session.sessionId,
          lift: set.lift,
          variant: set.variant,
          setNumber: set.setNumber,
          repNumber: i + 1,
          side: set.side,
          videoFileName: set.videoFileName,
          appVersion: set.appVersion,
          frameRateFps: set.frameRateFps,
          boxHeightCm: set.boxHeightCm,
          loadLb: set.loadLb,
          measures: m,
        }),
      );
      refs.push({ setId: set.id, repIndex: i });
    });
  }
  return { rows, refs };
}

export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
