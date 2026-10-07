import { buildCsv } from '../core/csv';
import { parseRoster } from '../core/session';
import { LIFT_LABELS, VARIANT_LABELS, isJump } from '../core/types';
import { canShareFile, csvFileName, exportCsv, makeCsvFile, shareFile } from '../export';
import { prefetchForOffline } from '../pose/mediapipe';
import {
  DEFAULT_PROTOCOL,
  clearSession,
  requestPersistentStorage,
  saveRoster,
  saveSession,
  saveSettings,
  sessionRows,
  startSession,
  storageAvailable,
  store,
  type SavedSet,
} from '../state';
import { APP_VERSION, SPEC_VERSION } from '../version';
import { clear, h } from './h';
import { app, go, rerender, resetWork } from './nav';
import { renderReviewJump, renderReviewLift } from './review';
import { renderError, renderProcessing, renderSetup, renderSide } from './setScreens';
import { fmt, honestyNote, protocolCard } from './shared';

export function mountApp(root: HTMLElement): void {
  app.render = () => {
    clear(root);
    root.append(header());
    if (!storageAvailable())
      root.append(h('div.note.error', 'This browser is not letting LiftLab save data (private browsing or blocked site data?). Work will be lost if the page reloads.'));
    if (app.toast) {
      root.append(h('div.note.ok', { role: 'status' }, app.toast));
      app.toast = null;
    }
    root.append(screen());
  };
  app.render();
}

function header(): HTMLElement {
  const nav = (label: string, s: typeof app.screen) =>
    h('button.link', { onclick: () => go(s), 'aria-current': app.screen === s ? 'page' : undefined }, label);
  const busy = app.screen === 'processing';
  return h(
    'header.top',
    h('h1', 'LiftLab'),
    busy ? null : nav('Session', 'home'),
    busy ? null : nav('Roster', 'roster'),
    busy ? null : nav('Settings', 'settings'),
  );
}

function screen(): HTMLElement {
  switch (app.screen) {
    case 'home':
      return renderHome();
    case 'roster':
      return renderRoster();
    case 'settings':
      return renderSettings();
    case 'setup':
      return renderSetup();
    case 'processing':
      return renderProcessing();
    case 'error':
      return renderError();
    case 'side':
      return renderSide();
    case 'review-jump':
      return renderReviewJump();
    case 'review-lift':
      return renderReviewLift();
  }
}

// ---------------------------------------------------------------------------
// Session (home)
// ---------------------------------------------------------------------------

let exportState: { problems?: { row: number; label: string; messages: string[] }[]; done?: string; file?: File } = {};

function renderHome(): HTMLElement {
  const s = store.session;
  if (!s) {
    return h(
      'div',
      h('h2', 'Session'),
      h(
        'div.card',
        h('p', store.roster.length ? `Roster: ${store.roster.length} players.` : 'No roster yet — add your players first.'),
        h(
          'button.primary.big',
          {
            onclick: () => {
              startSession();
              void requestPersistentStorage();
              exportState = {};
              resetWork();
              rerender();
            },
          },
          'Start session',
        ),
        store.roster.length ? null : h('button.big', { style: { marginTop: '8px' }, onclick: () => go('roster') }, 'Edit roster'),
      ),
      protocolCard(),
    );
  }
  const nReps = s.sets.reduce((a, x) => a + x.reps.length, 0);
  return h(
    'div',
    h('h2', 'Session'),
    h(
      'div.card',
      h('div', h('strong', s.sessionId)),
      h('p.small.muted', `Date ${s.date} · ${s.sets.length} set(s) · ${nReps} rep(s) · saved on this phone`),
      h(
        'button.primary.big',
        {
          onclick: () => {
            app.work.file = null;
            app.work.probe = null;
            app.work.processed = null;
            app.work.setNumberTouched = false;
            go('setup');
          },
        },
        'Add a set (pick one video)',
      ),
    ),
    s.sets.length ? honestyNote() : null,
    s.sets.map((set) => setCard(set)),
    exportCard(),
    h(
      'div.card',
      h('h3', 'Clear session'),
      h('p.small.muted', 'Deletes every saved set and rep in this session from this phone. Export first.'),
      h(
        'button.danger.big',
        {
          onclick: () => {
            if (!confirm(`Clear session ${s.sessionId}? All ${nReps} rep(s) will be deleted from this phone. This cannot be undone.`)) return;
            clearSession();
            exportState = {};
            resetWork();
            app.toast = 'Session cleared.';
            rerender();
          },
        },
        'Clear session',
      ),
    ),
    protocolCard(),
  );
}

function setTitle(set: SavedSet): string {
  return `Set ${set.setNumber} · ${set.playerName} · ${LIFT_LABELS[set.lift]}${set.variant ? ` (${VARIANT_LABELS[set.variant]})` : ''}`;
}

function setCard(set: SavedSet): HTMLElement {
  const s = store.session!;
  const persist = () => {
    saveSession();
    exportState = {};
    rerender();
  };
  const isLift = set.lift === 'squat' || set.lift === 'hinge';
  const repRows = set.reps.map((m, i) => {
    const vals: string[] = isJump(set.lift)
      ? [fmt.ms(m.flightTimeMs), fmt.cm(m.jumpHeightCm)]
      : [fmt.deg(m.bottomKneeAngleDeg), fmt.deg(m.bottomHipAngleDeg)];
    if (set.lift === 'drop_jump') vals.push(`RSI ${fmt.rsi(m.rsi)}`);
    if (set.lift === 'squat_jump') vals.push(`hold ${fmt.ms(m.holdTimeMs)}`);
    if (set.lift === 'squat') vals.push(m.depth ?? '—');
    return h(
      'tr',
      h('td', `Rep ${i + 1}`),
      h('td', vals.join(' · ')),
      h(
        'td',
        h(
          'button.link.danger',
          {
            onclick: () => {
              if (!confirm(`Delete rep ${i + 1} of ${setTitle(set)}? Remaining reps will be renumbered.`)) return;
              set.reps.splice(i, 1);
              if (set.reps.length === 0) s.sets.splice(s.sets.indexOf(set), 1);
              persist();
            },
          },
          'Delete',
        ),
      ),
    );
  });
  const numInput = (label: string, value: number | null, onSet: (v: number | null) => void, step = '0.5') =>
    h(
      'label.field',
      h('span', label),
      h('input', {
        type: 'number',
        inputMode: 'decimal',
        step,
        value: value ?? '',
        onchange: (e: Event) => {
          const v = (e.target as HTMLInputElement).value.trim();
          onSet(v === '' ? null : Number(v));
          persist();
        },
      }),
    );
  return h(
    'div.card',
    h('strong', setTitle(set)),
    h(
      'p.small.muted',
      `${set.reps.length} rep(s) · ${set.side} side · ${set.frameRateFps.toFixed(2)} fps · ${set.videoFileName}` +
        (isLift ? ` · ${set.loadLb ?? '?'} lb` : '') +
        (set.lift === 'drop_jump' ? ` · box ${set.boxHeightCm ?? '?'} cm` : '') +
        ` · v${set.appVersion}`,
    ),
    h('div.table-wrap', h('table.reps', h('tbody', repRows))),
    h(
      'details',
      h('summary.small', 'Edit or delete this set'),
      numInput('Set number', set.setNumber, (v) => (set.setNumber = v ?? 0), '1'),
      isLift ? numInput('Load (lb)', set.loadLb, (v) => (set.loadLb = v)) : null,
      set.lift === 'drop_jump' ? numInput('Box height (cm)', set.boxHeightCm, (v) => (set.boxHeightCm = v)) : null,
      h(
        'label.field',
        h('span', 'Video file name'),
        h('input', {
          type: 'text',
          value: set.videoFileName,
          onchange: (e: Event) => {
            set.videoFileName = (e.target as HTMLInputElement).value.trim();
            persist();
          },
        }),
      ),
      h(
        'button.danger',
        {
          onclick: () => {
            if (!confirm(`Delete ${setTitle(set)} and its ${set.reps.length} rep(s)?`)) return;
            s.sets.splice(s.sets.indexOf(set), 1);
            persist();
          },
        },
        'Delete set',
      ),
    ),
  );
}

function exportCard(): HTMLElement {
  const s = store.session!;
  const doExport = async () => {
    const { rows, refs } = sessionRows(s);
    if (rows.length === 0) {
      exportState = { problems: [{ row: 0, label: 'Session', messages: ['There are no reps to export yet.'] }] };
      rerender();
      return;
    }
    const res = buildCsv(rows, store.roster);
    if (!res.ok) {
      exportState = {
        problems: res.problems.map((p) => {
          const ref = refs[p.row - 1];
          const set = s.sets.find((x) => x.id === ref.setId)!;
          return { row: p.row, label: `${setTitle(set)}, rep ${ref.repIndex + 1}`, messages: p.messages };
        }),
      };
      rerender();
      return;
    }
    const file = makeCsvFile(res.csv, csvFileName(s.sessionId));
    const r = await exportCsv(file);
    exportState = {
      file,
      done:
        r === 'downloaded'
          ? `Download started: ${file.name} (${rows.length} rows). If nothing appeared, use Share below.`
          : r === 'shared'
            ? `Shared ${file.name} (${rows.length} rows).`
            : r === 'cancelled'
              ? 'Sharing was cancelled.'
              : 'This browser could not download or share the file.',
    };
    rerender();
  };
  return h(
    'div.card',
    h('h3', 'Export CSV'),
    h('p.small.muted', `Writes mocap_${s.sessionId}.csv (spec_version ${SPEC_VERSION}). Every row is checked first; export is blocked if any row fails.`),
    h('button.primary.big', { onclick: () => void doExport() }, 'Export CSV'),
    exportState.problems
      ? h(
          'div.note.error',
          h('strong', `Export blocked: ${exportState.problems.length} row(s) need fixing or deleting.`),
          h(
            'ul',
            exportState.problems.map((p) => h('li', `${p.row ? `Row ${p.row} (${p.label})` : p.label}: ${p.messages.join('; ')}`)),
          ),
        )
      : null,
    exportState.done ? h('div.note.ok', exportState.done) : null,
    exportState.file && canShareFile(exportState.file)
      ? h(
          'button.big',
          {
            style: { marginTop: '8px' },
            onclick: async () => {
              const r = await shareFile(exportState.file!);
              exportState.done = r === 'shared' ? `Shared ${exportState.file!.name}.` : r === 'cancelled' ? 'Sharing was cancelled.' : 'Sharing is not available here.';
              rerender();
            },
          },
          'Share CSV (iOS share sheet)',
        )
      : null,
  );
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

function renderRoster(): HTMLElement {
  const ta = h('textarea', { placeholder: 'First Last\nFirst Last', 'aria-label': 'Roster, one player per line' }) as HTMLTextAreaElement;
  ta.value = store.roster.join('\n');
  const msg = h('div');
  const check = () => {
    const r = parseRoster(ta.value);
    clear(msg);
    if (r.duplicates.length) msg.append(h('div.note.warn', `Duplicate names (kept once): ${r.duplicates.join(', ')}`));
    if (r.malformed.length) msg.append(h('div.note.warn', `Not in "First Last" format: ${r.malformed.join(', ')}`));
    return r;
  };
  ta.addEventListener('input', check);
  return h(
    'div',
    h('h2', 'Roster'),
    h(
      'div.card',
      h('p.small.muted', 'Paste player names, one per line, as "First Last". Saved on this phone. Names are written to the CSV exactly as entered here.'),
      ta,
      msg,
      h(
        'button.primary.big',
        {
          style: { marginTop: '8px' },
          onclick: () => {
            const r = check();
            saveRoster(r.names);
            app.toast = `Roster saved: ${r.names.length} players.${r.duplicates.length ? ` ${r.duplicates.length} duplicate(s) removed.` : ''}`;
            rerender();
          },
        },
        'Save roster',
      ),
    ),
    protocolCard(),
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

let offlineLog: string[] = [];

function renderSettings(): HTMLElement {
  const ta = h('textarea', { 'aria-label': 'Filming protocol text' }) as HTMLTextAreaElement;
  ta.value = store.settings.protocolText;
  const logEl = h('pre.log', offlineLog.join('\n') || 'Not run yet in this visit.');
  return h(
    'div',
    h('h2', 'Settings'),
    h(
      'div.card',
      h('h3', 'Filming protocol text'),
      ta,
      h(
        'div.row',
        { style: { marginTop: '8px' } },
        h(
          'button.primary.grow',
          {
            onclick: () => {
              saveSettings({ protocolText: ta.value });
              app.toast = 'Protocol saved.';
              rerender();
            },
          },
          'Save',
        ),
        h(
          'button.grow',
          {
            onclick: () => {
              if (!confirm('Replace the protocol text with the default?')) return;
              saveSettings({ protocolText: DEFAULT_PROTOCOL });
              rerender();
            },
          },
          'Reset to default',
        ),
      ),
    ),
    h(
      'div.card',
      h('h3', 'Video length warning'),
      h(
        'label.field',
        h('span', 'Warn before processing videos longer than (seconds)'),
        h('input', {
          type: 'number',
          inputMode: 'numeric',
          min: 1,
          value: store.settings.maxVideoSeconds,
          onchange: (e: Event) => {
            const v = Number((e.target as HTMLInputElement).value);
            if (v > 0) saveSettings({ maxVideoSeconds: v });
          },
        }),
      ),
    ),
    h(
      'div.card',
      h('h3', 'Offline use'),
      h(
        'p.small.muted',
        'Downloads the pose library, its WebAssembly runtime and the pose model so LiftLab works at the field without a signal. Run this on Wi-Fi, then test once in airplane mode.',
      ),
      h(
        'button.big',
        {
          onclick: async () => {
            offlineLog = ['Downloading…'];
            logEl.textContent = offlineLog.join('\n');
            try {
              const res = await prefetchForOffline((s) => {
                offlineLog.push(s);
                logEl.textContent = offlineLog.join('\n');
              });
              const sw = navigator.serviceWorker?.controller ? 'Service worker active: files are cached for offline use.' : 'Service worker NOT active yet: reload the page and run this again.';
              offlineLog.push(res.every((r) => r.ok) ? `All ${res.length} files downloaded. ${sw}` : 'Some files failed; check your connection and try again.');
              const persisted = await requestPersistentStorage();
              offlineLog.push(`Persistent storage: ${persisted === null ? 'not supported' : persisted ? 'granted' : 'not granted'}.`);
            } catch (e) {
              offlineLog.push(`Failed: ${String(e)}`);
            }
            logEl.textContent = offlineLog.join('\n');
          },
        },
        'Prepare for offline use',
      ),
      logEl,
    ),
    h(
      'div.card',
      h('h3', 'About'),
      h('p.small', `LiftLab app_version ${APP_VERSION} · CSV spec_version ${SPEC_VERSION}`),
      h('p.small.muted', 'All processing happens in this browser. Videos never leave the phone. Only the roster, settings and the current session’s rep data are stored on this phone.'),
      honestyNote(),
    ),
    protocolCard(),
  );
}
