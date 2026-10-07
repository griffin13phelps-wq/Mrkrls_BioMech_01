import { JUMP_MIN_FPS } from '../config';
import { analyzeLift, buildContext, checkPerson, detectJumpEvents, isLiftJump } from '../core/analysis';
import { suggestSetNumber } from '../core/session';
import { LIFT_LABELS, VARIANTS, VARIANT_LABELS, isJump, type Lift, type Side, type Variant } from '../core/types';
import { testDetector, type PoseDetector } from '../pose/detector';
import { loadMediaPipeDetector } from '../pose/mediapipe';
import { probeVideo, processVideo } from '../pose/runner';
import { store } from '../state';
import { DemuxError } from '../video/demux';
import { ReviewFrames } from '../video/frameCache';
import { h } from './h';
import { app, go, rerender } from './nav';
import { errorPanel, kvTable, protocolCard, type Work } from './shared';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function refreshSuggestion(w: Work): void {
  if (w.setNumberTouched || !w.playerName) return;
  w.setNumber = suggestSetNumber(store.session?.sets ?? [], w.playerName, w.lift, w.variant);
}

export function videoWarnings(w: Work): string[] {
  const out: string[] = [];
  const p = w.probe;
  if (!p) return out;
  const max = store.settings.maxVideoSeconds;
  if (p.track.durationSec > max) out.push(`This video is ${p.track.durationSec.toFixed(1)} s long (limit ${max} s). Processing will take a while.`);
  if (isJump(w.lift) && p.fps < JUMP_MIN_FPS)
    out.push(
      `Frame rate is ${p.fps.toFixed(1)} fps. Jumps need slo-mo (240 fps preferred, never below ${JUMP_MIN_FPS}). If you filmed in slo-mo, the phone may have converted the video when it was picked.`,
    );
  if (p.track.frames.rate.variable)
    out.push('Frame timing varies within this video (for example a slow-motion section edited in Photos). Time measurements may be wrong.');
  if (!p.track.rotationExact) out.push('The video has an unusual rotation that was rounded to the nearest 90°.');
  if (p.mode === 'seek') out.push('This browser cannot decode the video frame-by-frame (WebCodecs), so a slower seeking method is used; frames may be off by one.');
  return out;
}

function formErrors(w: Work): string[] {
  const e: string[] = [];
  if (!w.playerName) e.push('Pick a player.');
  if (VARIANTS[w.lift].length && !w.variant) e.push('Pick a variant.');
  if (!(Number.isInteger(w.setNumber) && w.setNumber >= 1)) e.push('Set number must be a whole number of at least 1.');
  if ((w.lift === 'squat' || w.lift === 'hinge') && !(w.loadLb !== null && w.loadLb >= 0)) e.push('Enter the load in lb (0 = bodyweight).');
  if (w.lift === 'drop_jump' && !(w.boxHeightCm !== null && w.boxHeightCm > 0)) e.push('Enter the box height in cm.');
  if (!w.file) e.push('Pick a video.');
  else if (!w.probe) e.push(w.probeError ? 'This video cannot be read.' : 'Reading the video…');
  return e;
}

export function renderSetup(): HTMLElement {
  const w = app.work;
  const roster = store.roster;
  if (!store.session) {
    return h('div', h('div.note.warn', 'Start a session first.'), h('button.primary.big', { onclick: () => go('home') }, 'Go to session'));
  }
  if (roster.length === 0) {
    return h('div', h('div.note.warn', 'Add your roster before filming.'), h('button.primary.big', { onclick: () => go('roster') }, 'Edit roster'));
  }
  if (!roster.includes(w.playerName)) w.playerName = '';
  refreshSuggestion(w);

  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  const variants = VARIANTS[w.lift];
  const errors = formErrors(w);
  const warnings = videoWarnings(w);
  let ack = false;

  const processBtn = h(
    'button.primary.big',
    {
      disabled: errors.length > 0 || (warnings.length > 0 && !ack),
      onclick: () => startProcessing(),
    },
    'Process video',
  );

  const onFile = async (file: File | undefined) => {
    w.file = file ?? null;
    w.probe = null;
    w.probeError = null;
    rerender();
    if (!file) return;
    try {
      w.probe = await probeVideo(file);
    } catch (e) {
      w.probeError = e instanceof DemuxError ? e.message : `This video could not be read: ${String(e)}`;
    }
    rerender();
  };

  return h(
    'div',
    protocolCard(),
    h('h2', 'New set'),
    h(
      'div.card',
      h(
        'label.field',
        h('span', 'Player'),
        h(
          'select',
          {
            onchange: (e: Event) => {
              w.playerName = (e.target as HTMLSelectElement).value;
              w.setNumberTouched = false;
              rerender();
            },
          },
          h('option', { value: '', selected: !w.playerName }, 'Choose…'),
          roster.map((n) => h('option', { value: n, selected: n === w.playerName }, n)),
        ),
      ),
      h(
        'label.field',
        h('span', 'Lift'),
        h(
          'select',
          {
            onchange: (e: Event) => {
              w.lift = (e.target as HTMLSelectElement).value as Lift;
              w.variant = null;
              w.setNumberTouched = false;
              rerender();
            },
          },
          (Object.keys(LIFT_LABELS) as Lift[]).map((l) => h('option', { value: l, selected: l === w.lift }, LIFT_LABELS[l])),
        ),
      ),
      variants.length
        ? h(
            'label.field',
            h('span', 'Variant'),
            h(
              'select',
              {
                onchange: (e: Event) => {
                  w.variant = ((e.target as HTMLSelectElement).value || null) as Variant | null;
                  w.setNumberTouched = false;
                  rerender();
                },
              },
              h('option', { value: '', selected: !w.variant }, 'Choose…'),
              variants.map((v) => h('option', { value: v, selected: v === w.variant }, VARIANT_LABELS[v])),
            ),
          )
        : null,
      h(
        'label.field',
        h('span', 'Set number'),
        h('input', {
          type: 'number',
          inputMode: 'numeric',
          min: 1,
          step: 1,
          value: String(w.setNumber),
          onchange: (e: Event) => {
            w.setNumber = Number((e.target as HTMLInputElement).value);
            w.setNumberTouched = true;
            rerender();
          },
        }),
        h('div.small.muted', 'Suggested: next number for this player, lift and variant.'),
      ),
      w.lift === 'squat' || w.lift === 'hinge'
        ? h(
            'label.field',
            h('span', 'Load (lb)'),
            h('input', {
              type: 'number',
              inputMode: 'decimal',
              min: 0,
              step: 0.5,
              value: w.loadLb ?? '',
              placeholder: 'Total incl. bar; goblet = the dumbbell/kettlebell',
              onchange: (e: Event) => {
                w.loadLb = num((e.target as HTMLInputElement).value);
                rerender();
              },
            }),
            h('div.small.muted', 'Total weight including the bar. Goblet = the dumbbell or kettlebell. 0 = bodyweight.'),
          )
        : null,
      w.lift === 'drop_jump'
        ? h(
            'label.field',
            h('span', 'Box height (cm)'),
            h('input', {
              type: 'number',
              inputMode: 'decimal',
              min: 1,
              step: 0.5,
              value: w.boxHeightCm ?? '',
              onchange: (e: Event) => {
                w.boxHeightCm = num((e.target as HTMLInputElement).value);
                rerender();
              },
            }),
          )
        : null,
      h(
        'label.field',
        h('span', 'Video (one video = one set)'),
        h('input', {
          type: 'file',
          accept: 'video/*,.mov,.mp4',
          onchange: (e: Event) => onFile((e.target as HTMLInputElement).files?.[0]),
        }),
        w.file ? h('div.small.muted', `Selected: ${w.file.name}`) : null,
      ),
    ),
    w.probeError ? errorPanel('This video cannot be read', w.probeError) : null,
    w.probe ? videoInfoCard(w) : w.file && !w.probeError ? h('p.muted', 'Reading video…') : null,
    warnings.length
      ? h(
          'div.note.warn',
          h('strong', 'Before processing:'),
          h(
            'ul',
            warnings.map((x) => h('li', x)),
          ),
          h(
            'label.row',
            { style: { marginTop: '8px' } },
            h('input', {
              type: 'checkbox',
              style: { width: '28px', minHeight: '28px' },
              onchange: (e: Event) => {
                ack = (e.target as HTMLInputElement).checked;
                processBtn.disabled = errors.length > 0 || !ack;
              },
            }),
            h('span', 'Process anyway'),
          ),
        )
      : null,
    errors.length && w.file ? h('div.note.info', errors.join(' ')) : null,
    h('div.sticky-actions', processBtn),
  );
}

function videoInfoCard(w: Work): HTMLElement {
  const p = w.probe!;
  const t = p.track;
  return h(
    'div.card',
    h('h3', 'Video'),
    kvTable([
      ['File name (as given by the browser)', w.file!.name],
      ['Frame rate (read from the file)', `${p.fps.toFixed(2)} fps`],
      ['Frames', String(t.samples.length)],
      ['Length', `${t.durationSec.toFixed(2)} s`],
      ['Displayed size', `${t.displayWidth} × ${t.displayHeight}`],
      ['Rotation applied', `${t.rotation}° clockwise`],
      ['Timing', p.timing === 'container-timestamps' ? 'per-frame timestamps from the file' : 'frame count ÷ frame rate'],
      ['Decoder', p.mode === 'webcodecs' ? `WebCodecs (${p.decoderConfig?.codec})` : '<video> seeking (fallback)'],
    ]),
    h('details', h('summary.small', 'How this was determined'), h('pre.log', p.log.join('\n'))),
  );
}

// ---------------------------------------------------------------------------
// Processing
// ---------------------------------------------------------------------------

let abort: AbortController | null = null;
let progressText = '';
let progressFrac = 0;

async function getDetector(status: (s: string) => void, log: string[]): Promise<PoseDetector> {
  const t = testDetector();
  if (t) return t;
  status('Loading the pose model… (the first time this needs internet; afterwards it is cached)');
  return await loadMediaPipeDetector((s) => log.push(s));
}

function startProcessing(): void {
  const w = app.work;
  abort = new AbortController();
  progressText = 'Starting…';
  progressFrac = 0;
  go('processing');
  void runProcessing(w, abort.signal);
}

async function runProcessing(w: Work, signal: AbortSignal): Promise<void> {
  const loadLog: string[] = [];
  const status = (s: string) => {
    progressText = s;
    updateProgressDom();
  };
  try {
    const detector = await getDetector(status, loadLog);
    if (signal.aborted) return;
    status('Finding the athlete in every frame…');
    const t0 = performance.now();
    const processed = await processVideo(
      w.file!,
      w.probe!,
      detector,
      (done, total) => {
        progressFrac = total ? done / total : 0;
        const el = (performance.now() - t0) / 1000;
        const eta = done > 0 ? (el / done) * (total - done) : 0;
        status(`Frame ${done} of ${total}${done > 10 ? ` · about ${Math.ceil(eta)} s left` : ''}`);
      },
      signal,
    );
    processed.log.unshift(...loadLog);
    w.processed = processed;
    const person = checkPerson(processed.series);
    if (!person.ok) {
      w.error = { title: 'No person detected', message: person.error, detail: processed.log.join('\n') };
      go('error');
      return;
    }
    w.sideDetection = person.value;
    w.frames?.dispose();
    w.frames = new ReviewFrames(w.file!, processed);
    if (!person.value.side) {
      go('side');
      return;
    }
    runAnalysis(w, person.value.side);
    go(isLiftJump(w.lift) ? 'review-jump' : 'review-lift');
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError' || signal.aborted) {
      go('setup');
      return;
    }
    const msg = e instanceof DemuxError ? e.message : `The video could not be decoded or processed: ${String((e as Error)?.message ?? e)}`;
    w.error = { title: 'Video could not be processed', message: msg, detail: [...loadLog, String((e as Error)?.stack ?? e)].join('\n') };
    go('error');
  }
}

/** (Re)run the measurement analysis for a side. Pose data is reused, so this is instant. */
export function runAnalysis(w: Work, side: Side): void {
  w.side = side;
  w.jumps = [];
  w.floor = null;
  w.jumpError = null;
  w.liftResult = null;
  w.deletedReps = new Set();
  const ctx = buildContext(w.processed!.series, side);
  if (!ctx.ok) {
    w.ctx = null;
    w.jumpError = ctx.error;
    return;
  }
  w.ctx = ctx.value;
  if (isLiftJump(w.lift)) {
    const res = detectJumpEvents(ctx.value, w.lift);
    if (!res.ok) {
      w.jumpError = res.error;
      return;
    }
    w.floor = res.floor;
    w.jumps = res.jumps.map((j) => ({
      suggested: { ...j },
      current: { contact: j.contact, takeoff: j.takeoff, landing: j.landing },
      confirmed: { contact: j.contact === undefined, takeoff: false, landing: false },
      warnings: j.warnings,
      deleted: false,
    }));
  } else {
    w.liftResult = analyzeLift(ctx.value, w.lift, w.variant!);
  }
}

function updateProgressDom(): void {
  const bar = document.getElementById('progress-bar');
  const txt = document.getElementById('progress-text');
  if (bar) bar.style.width = `${Math.round(progressFrac * 100)}%`;
  if (txt) txt.textContent = progressText;
}

export function renderProcessing(): HTMLElement {
  const w = app.work;
  const el = h(
    'div',
    h('h2', 'Processing'),
    h(
      'div.card',
      h('p', `${w.playerName} · ${w.lift}${w.variant ? ` (${w.variant})` : ''} · set ${w.setNumber}`),
      h('p.small.muted', w.file?.name ?? ''),
      h('div.progress', { role: 'progressbar' }, h('div#progress-bar')),
      h('p#progress-text', progressText),
      h('p.small.muted', 'Keep this screen open. Everything happens on this phone; the video is not uploaded.'),
      h(
        'button.big',
        {
          onclick: () => {
            abort?.abort();
          },
        },
        'Cancel',
      ),
    ),
    protocolCard(),
  );
  requestAnimationFrame(updateProgressDom);
  return el;
}

// ---------------------------------------------------------------------------
// Errors and side choice
// ---------------------------------------------------------------------------

export function renderError(): HTMLElement {
  const w = app.work;
  const e = w.error ?? { title: 'Something went wrong', message: '' };
  return h(
    'div',
    h('h2', 'No results'),
    errorPanel(e.title, e.message, e.detail),
    h('button.primary.big', { onclick: () => go('setup') }, 'Back to set'),
    protocolCard(),
  );
}

export function renderSide(): HTMLElement {
  const w = app.work;
  const sd = w.sideDetection;
  const choose = (s: Side) => {
    runAnalysis(w, s);
    go(isLiftJump(w.lift) ? 'review-jump' : 'review-lift');
  };
  return h(
    'div',
    h('h2', 'Which side faces the camera?'),
    errorPanel(
      'The side facing the camera could not be determined',
      `Left and right landmarks were detected about equally well (mean visibility left ${sd?.leftMeanVisibility.toFixed(2)}, right ${sd?.rightMeanVisibility.toFixed(2)}). This usually means the camera was not square to the side of the athlete.`,
    ),
    h('p', 'If you are sure which side faced the camera, pick it. Otherwise re-film from the side.'),
    h('div.row', h('button.big.grow', { onclick: () => choose('left') }, 'Left side'), h('button.big.grow', { onclick: () => choose('right') }, 'Right side')),
    h('button.big', { style: { marginTop: '8px' }, onclick: () => go('setup') }, 'Back to set'),
  );
}
