import type { Lift, Variant } from './types';

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** Local calendar date as YYYY-MM-DD. */
export const localDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** 4 random characters, each A–Z or 0–9 (rejection sampling avoids modulo bias). */
export function randomSuffix(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  let out = '';
  while (out.length < 4) {
    for (const b of random(8)) {
      if (b < 252 && out.length < 4) out += ALPHABET[b % 36]; // 252 = 7 × 36
    }
  }
  return out;
}

/** session_id = MC-YYYYMMDD-HHMM-XXXX using the LOCAL session start time. */
export function makeSessionId(start: Date, suffix: string = randomSuffix()): string {
  return `MC-${start.getFullYear()}${pad(start.getMonth() + 1)}${pad(start.getDate())}-${pad(start.getHours())}${pad(start.getMinutes())}-${suffix}`;
}

export interface SetKey {
  playerName: string;
  lift: Lift;
  variant: Variant | null;
  setNumber: number;
}

/** Next set number for this player + lift + variant = highest used so far + 1. */
export function suggestSetNumber(existing: readonly SetKey[], playerName: string, lift: Lift, variant: Variant | null): number {
  let max = 0;
  for (const s of existing) if (s.playerName === playerName && s.lift === lift && (s.variant ?? null) === (variant ?? null)) max = Math.max(max, s.setNumber);
  return max + 1;
}

export interface RosterParse {
  names: string[];
  duplicates: string[];
  /** Lines that are not "First Last" (at least two words). */
  malformed: string[];
}

/** Parse pasted roster text: one "First Last" per line; blank lines ignored; whitespace collapsed. */
export function parseRoster(text: string): RosterParse {
  const names: string[] = [];
  const duplicates: string[] = [];
  const malformed: string[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const name = line.trim().replace(/\s+/g, ' ');
    if (!name) continue;
    if (!/^\S+( \S+)+$/.test(name)) malformed.push(name);
    const key = name.toLowerCase();
    if (seen.has(key)) {
      if (!duplicates.includes(name)) duplicates.push(name);
      continue;
    }
    seen.add(key);
    names.push(name);
  }
  return { names, duplicates, malformed };
}
