import { measureJump } from '../core/analysis';
import { LIFT_LABELS, VARIANT_LABELS, type RepMeasures, type Side } from '../core/types';
import { nearestFrame } from '../core/timing';
import { APP_VERSION } from '../version';
import { newId, saveSession, saveSettings, store, type SavedSet } from '../state';
import { drawFloor, drawSkeleton, traceChart, type Marker, type View } from './draw';
import { clear, h } from './h';
import { app, go, rerender, resetWork } from './nav';
import { runAnalysis } from './setScreens';
import { errorPanel, fmt, honestyNote, kvTable, protocolCard, type JumpEvents, type JumpItem, type Work } from './shared';

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function setHeader(w: Work): HTMLElement {
  const p = w.processed!;
  const sd = w.sideDetection;
  const sideSel = h(
    'select',
    {
      'aria-label': 'Side facing the camera',
      onchange: (e: Event) => {
        const s = (e.target as HTMLSelectElement).value as Side;
        if (w.jumps.some((j) => j.confirmed.takeoff || j.confirmed.landing) && !confirm('Changing the side re-detects everything and clears your confirmations. Continue?')) {
          (e.target as HTMLSelectElement).value = w.side!;
          return;
        }
        runAnalysis(w, s);
        rerender();
      },
    },
    (['left', 'right'] as Side[]).map((s) => h('option', { value: s, selected: s === w.side }, s === 'left' ? 'Left' : 'Right')),
  );
  return h(
    'div.card',
    h('strong', `${w.playerName} · ${LIFT_LABELS[w.lift]}${w.variant ? ` · ${VARIANT_LABELS[w.variant]}` : ''} · Set ${w.setNumber}`),
    h('p.small.muted', `${w.file?.name} · ${p.fps.toFixed(2)} fps (from file) · ${p.series.frames.length} frames · ${p.mode === 'webcodecs' ? 'WebCodecs' : 'seek fallback'}`),
    h(
      'label.field',
      h('span', 'Side facing the camera'),
      sideSel,
      h(
        'div.small.muted',
        sd?.side
          ? `Auto-detected: ${sd.side} (mean visibility left ${sd.leftMeanVisibility.toFixed(2)}, right ${sd.rightMeanVisibility.toFixed(2)}). Change it if this is wrong.`
          : 'Chosen manually (auto-detection was inconclusive).',
      ),
    ),
    h('details', h('summary.small', 'Processing log'), h('pre.log', p.log.join('\n'))),
  );
}

function saveSet(w: Work, reps: RepMeasures[]): void {
  const s = store.session!;
  const set: SavedSet = {
    id: newId(),
    playerName: w.playerName,
    lift: w.lift,
    variant: w.variant,
    setNumber: w.setNumber,
    loadLb: w.lift === 'squat' || w.lift === 'hinge' ? w.loadLb : null,
    boxHeightCm: w.lift === 'drop_jump' ? w.boxHeightCm : null,
    side: w.side!,
    videoFileName: w.file!.name,
    frameRateFps: w.processed!.fps,
    appVersion: APP_VERSION,
    savedAt: new Date().toISOString(),
    reps,
  };
  s.sets.push(set);
  saveSession();
  if (w.lift === 'drop_jump') saveSettings({ lastBoxHeightCm: w.boxHeightCm });
  app.toast = `Saved set ${set.setNumber} for ${set.playerName}: ${reps.length} ${reps.length === 1 ? 'rep' : 'reps'}.`;
  const keep = { playerName: w.playerName, lift: w.lift, variant: w.variant, loadLb: w.loadLb, boxHeightCm: w.boxHeightCm };
  resetWork();
  Object.assign(app.work, keep);
  go('home');
}

function noResults(w: Work, title: string, message: string): HTMLElement {
  return h(
    'div',
    h('h2', 'Review'),
    setHeader(w),
    errorPanel(title, message),
    h('button.primary.big', { onclick: () => go('setup') }, 'Back to set'),
    protocolCard(),
  );
}

// ---------------------------------------------------------------------------
// Jumps
// ---------------------------------------------------------------------------

type EvKey = 'contact' | 'takeoff' | 'landing';
const EV_LABEL: Record<EvKey, string> = { contact: 'Ground contact', takeoff: 'Takeoff', landing: 'Landing' };
const EV_HELP: Record<EvKey, string> = {
  contact: 'First frame where a foot touches the floor after stepping off the box.',
  takeoff: 'First frame where BOTH feet are off the ground.',
  landing: 'First frame where ANY foot touches the ground.',
};

let zoomFeet = true;

function eventsValid(e: JumpEvents): string | null {
  if (e.contact !== undefined && !(e.contact < e.takeoff)) return 'Ground contact must come before takeoff.';
  if (!(e.takeoff < e.landing)) return 'Takeoff must come before landing.';
  return null;
}

function adjusted(j: JumpItem): boolean {
  return j.current.takeoff !== j.suggested.takeoff || j.current.landing !== j.suggested.landing || j.current.contact !== j.suggested.contact;
}

function jumpMeasures(w: Work, j: JumpItem): RepMeasures {
  return measureJump(w.ctx!, w.lift as 'cmj' | 'squat_jump' | 'drop_jump', j.current, adjusted(j)).measures;
}

function isConfirmed(j: JumpItem): boolean {
  return j.confirmed.takeoff && j.confirmed.landing && (j.current.contact === undefined || j.confirmed.contact);
}

export function renderReviewJump(): HTMLElement {
  const w = app.work;
  if (!w.processed) return h('div', h('p', 'Nothing to review.'), h('button.big', { onclick: () => go('home') }, 'Back'));
  if (w.jumpError) return noResults(w, 'Jumps could not be measured', w.jumpError);
  if (w.jumps.length === 0)
    return noResults(w, 'No jumps were found', 'No flight phase was detected in this video. Check that the feet stay in frame and the athlete stands still on the floor before and after each jump.');

  const series = w.processed.series;
  const ctx = w.ctx!;
  const floor = w.floor!;
  const chartHost = h('div');
  const saveBtn = h('button.primary.big', { onclick: () => doSave() }, 'Save set');
  const status = h('p.small.muted');

  const footHeight = ctx.footLowY.map((y) => (y === null ? null : ((floor.floorY - y) / ctx.legPx) * 100));
  const refreshChart = () => {
    clear(chartHost);
    const markers: Marker[] = [];
    let n = 0;
    w.jumps.forEach((j) => {
      if (j.deleted) return;
      n++;
      if (j.current.contact !== undefined) markers.push({ frame: j.current.contact, label: `C${n}` });
      markers.push({ frame: j.current.takeoff, label: `T${n}` }, { frame: j.current.landing, label: `L${n}` });
    });
    chartHost.append(
      traceChart({
        title: 'Near-side foot height above the floor (% of leg length) · C = contact, T = takeoff, L = landing',
        values: footHeight,
        times: series.times,
        markers,
        refLine: { value: (floor.bandPx / ctx.legPx) * 100, label: 'contact band' },
        format: (v) => `${v.toFixed(1)}% leg`,
      }),
    );
  };
  const refreshSave = () => {
    const live = w.jumps.filter((j) => !j.deleted);
    const pending = live.filter((j) => !isConfirmed(j)).length;
    saveBtn.disabled = live.length === 0 || pending > 0;
    status.textContent =
      live.length === 0 ? 'All jumps deleted — nothing to save.' : pending ? `${pending} of ${live.length} jump(s) still need every frame confirmed.` : `All ${live.length} jump(s) confirmed.`;
  };
  const doSave = () => {
    const reps = w.jumps.filter((j) => !j.deleted).map((j) => jumpMeasures(w, j));
    saveSet(w, reps);
  };

  const cards = h('div');
  const buildCards = () => {
    clear(cards);
    let n = 0;
    w.jumps.forEach((j) => {
      if (j.deleted) return;
      n++;
      cards.append(jumpCard(w, j, n, () => {
        refreshChart();
        refreshSave();
      }, () => {
        buildCards();
        refreshChart();
        refreshSave();
      }));
    });
  };
  buildCards();
  refreshChart();
  refreshSave();

  return h(
    'div',
    h('h2', 'Review jumps'),
    honestyNote(),
    setHeader(w),
    h('div.card', chartHost),
    h(
      'p.small.muted',
      'Every suggested frame must be confirmed: step through frames with −1 / +1 until the definition is met, then press Confirm. Moving any frame records frames_adjusted = Y for that jump.',
    ),
    cards,
    h('div.sticky-actions', status, saveBtn, h('button.link', { onclick: () => confirm('Discard this set?') && go('setup') }, 'Discard and go back')),
    protocolCard(),
  );
}

function jumpCard(w: Work, j: JumpItem, n: number, onChange: () => void, onDelete: () => void): HTMLElement {
  const keys: EvKey[] = j.current.contact !== undefined ? ['contact', 'takeoff', 'landing'] : ['takeoff', 'landing'];
  let active: EvKey = keys.find((k) => !j.confirmed[k]) ?? keys[0];
  const tabs = h('div.tabs');
  const viewerHost = h('div');
  const metricsHost = h('div');
  const badge = h('span.badge');
  const card = h(
    'div.card',
    h(
      'div.row',
      h('h3.grow', `Jump ${n}`),
      badge,
      h(
        'button.danger',
        {
          onclick: () => {
            if (!confirm(`Delete jump ${n}? Remaining jumps will be renumbered.`)) return;
            j.deleted = true;
            onDelete();
          },
        },
        'Delete',
      ),
    ),
    j.warnings.length ? h('div.note.warn', j.warnings.join(' ')) : null,
    tabs,
    viewerHost,
    metricsHost,
  );

  const refresh = () => {
    badge.className = `badge ${isConfirmed(j) ? 'ok' : 'warn'}`;
    badge.textContent = isConfirmed(j) ? 'Confirmed' : 'Needs review';
    clear(tabs);
    for (const k of keys) {
      const moved = (j.current[k] ?? 0) - (j.suggested[k] ?? 0);
      tabs.append(
        h(
          'button',
          {
            class: k === active ? 'active' : '',
            onclick: () => {
              active = k;
              refresh();
              renderViewer();
            },
          },
          `${j.confirmed[k] ? '✓ ' : ''}${EV_LABEL[k]}${moved ? ` (${moved > 0 ? '+' : ''}${moved})` : ''}`,
        ),
      );
    }
    const m = jumpMeasures(w, j);
    const rows: [string, string][] = [
      ['Flight time', fmt.ms(m.flightTimeMs)],
      ['Jump height', fmt.cm(m.jumpHeightCm)],
    ];
    if (w.lift === 'drop_jump') rows.push(['Contact time', fmt.ms(m.contactTimeMs)], ['RSI', fmt.rsi(m.rsi)]);
    if (w.lift === 'squat_jump')
      rows.push(['Hold before jump', fmt.ms(m.holdTimeMs)], ['Start knee angle (median in hold)', fmt.deg(m.startKneeAngleDeg)], ['Dip before takeoff', fmt.yn(m.dipBeforeTakeoff)]);
    rows.push(['Body detected', fmt.pct(m.bodyDetectedPct)], ['Frames adjusted', adjusted(j) ? 'Yes' : 'No']);
    clear(metricsHost);
    metricsHost.append(kvTable(rows));
    onChange();
  };

  const canvas = h('canvas');
  const posLabel = h('div.pos');
  const defLabel = h('p.small.muted');
  const errLabel = h('div');
  const confirmBtn = h('button.primary.big');
  let paintToken = 0;

  const footView = (i: number): View => {
    const s = w.processed!.series;
    const full: View = { sx: 0, sy: 0, sw: s.width, sh: s.height };
    if (!zoomFeet) return full;
    const ctx = w.ctx!;
    const side = Math.min(s.width, s.height, 1.1 * ctx.legPx);
    const toe = ctx.raw.toe[i] ?? ctx.raw.toe[j.suggested[active] ?? i];
    const heel = ctx.raw.heel[i] ?? ctx.raw.heel[j.suggested[active] ?? i];
    const cx = toe && heel ? (toe.x + heel.x) / 2 : s.width / 2;
    const cy = w.floor!.floorY - 0.3 * side;
    return {
      sx: Math.max(0, Math.min(s.width - side, cx - side / 2)),
      sy: Math.max(0, Math.min(s.height - side, cy - side / 2)),
      sw: side,
      sh: side,
    };
  };

  const paint = async () => {
    const token = ++paintToken;
    const i = j.current[active]!;
    const s = w.processed!.series;
    const frames = w.frames!;
    const view = footView(i);
    posLabel.textContent = `frame ${i}\n${s.times[i].toFixed(3)} s`;
    try {
      const bmp = await frames.get(i);
      if (token !== paintToken) {
        bmp.close();
        return;
      }
      const k = frames.width / s.width;
      canvas.width = Math.round(Math.min(frames.width, frames.height) * (view.sw / Math.min(s.width, s.height)) * (zoomFeet ? 1.2 : 1));
      canvas.height = Math.round((canvas.width * view.sh) / view.sw);
      const c = canvas.getContext('2d')!;
      c.drawImage(bmp, view.sx * k, view.sy * k, view.sw * k, view.sh * k, 0, 0, canvas.width, canvas.height);
      bmp.close();
      drawFloor(c, w.floor!.floorY, w.floor!.bandPx, view);
      drawSkeleton(c, s.frames[i], w.side!, s.width, s.height, view);
    } catch (e) {
      const c = canvas.getContext('2d')!;
      canvas.width = 320;
      canvas.height = 180;
      c.fillStyle = '#fff';
      c.fillText(`Frame ${i} could not be shown: ${String(e)}`, 10, 90);
    }
  };

  const step = (d: number) => {
    const n = w.processed!.series.frames.length;
    const v = Math.max(0, Math.min(n - 1, j.current[active]! + d));
    j.current = { ...j.current, [active]: v };
    j.confirmed[active] = false;
    updateViewerState();
    refresh();
    void paint();
  };

  const updateViewerState = () => {
    const err = eventsValid(j.current);
    clear(errLabel);
    if (err) errLabel.append(h('div.note.error', err));
    confirmBtn.disabled = !!err || j.confirmed[active];
    confirmBtn.textContent = j.confirmed[active] ? `${EV_LABEL[active]} confirmed ✓` : `Confirm ${EV_LABEL[active].toLowerCase()} at frame ${j.current[active]}`;
    defLabel.textContent = `${EV_LABEL[active]}: ${EV_HELP[active]} Suggested frame: ${j.suggested[active]}.`;
  };

  confirmBtn.addEventListener('click', () => {
    j.confirmed[active] = true;
    const next = keys.find((k) => !j.confirmed[k]);
    if (next) active = next;
    refresh();
    renderViewer();
  });

  const renderViewer = () => {
    clear(viewerHost);
    updateViewerState();
    viewerHost.append(
      defLabel,
      h('div.frame-wrap', canvas),
      h(
        'div.stepper',
        h('button.icon', { onclick: () => step(-10), 'aria-label': 'Back 10 frames' }, '−10'),
        h('button.icon', { onclick: () => step(-1), 'aria-label': 'Back 1 frame' }, '−1'),
        posLabel,
        h('button.icon', { onclick: () => step(1), 'aria-label': 'Forward 1 frame' }, '+1'),
        h('button.icon', { onclick: () => step(10), 'aria-label': 'Forward 10 frames' }, '+10'),
      ),
      h(
        'div.row',
        h(
          'label.row.grow',
          h('input', {
            type: 'checkbox',
            checked: zoomFeet,
            style: { width: '26px', minHeight: '26px' },
            onchange: (e: Event) => {
              zoomFeet = (e.target as HTMLInputElement).checked;
              void paint();
            },
          }),
          h('span.small', 'Zoom on feet'),
        ),
        h(
          'button.link',
          {
            onclick: () => {
              j.current = { ...j.current, [active]: j.suggested[active] };
              j.confirmed[active] = false;
              updateViewerState();
              refresh();
              void paint();
            },
          },
          'Reset to suggested',
        ),
      ),
      errLabel,
      confirmBtn,
    );
    void paint();
  };

  refresh();
  renderViewer();
  return card;
}

// ---------------------------------------------------------------------------
// Squat and hinge
// ---------------------------------------------------------------------------

export function renderReviewLift(): HTMLElement {
  const w = app.work;
  if (!w.processed) return h('div', h('p', 'Nothing to review.'), h('button.big', { onclick: () => go('home') }, 'Back'));
  if (w.jumpError) return noResults(w, 'This lift could not be measured', w.jumpError);
  const res = w.liftResult!;
  if (res.reps.length === 0)
    return noResults(
      w,
      'No reps were found',
      w.lift === 'hinge'
        ? 'No hip-angle change large enough for a rep was detected. Check the side view, that shoulders, hips and knees stay in frame, and the variant.'
        : 'No hip drop large enough for a rep was detected. Check the side view and that the hips and knees stay in frame.',
    );
  const s = w.processed.series;
  const live = res.reps.map((r, i) => ({ r, i })).filter((x) => !w.deletedReps.has(x.i));

  // Video with skeleton overlay
  const video = h('video', { controls: true, playsInline: true, muted: true, preload: 'auto' }) as HTMLVideoElement;
  video.setAttribute('playsinline', '');
  const overlay = h('canvas');
  const url = URL.createObjectURL(w.file!);
  video.src = url;
  const wrap = h('div.video-wrap', { style: { aspectRatio: `${s.width} / ${s.height}`, maxHeight: '60vh', maxWidth: `calc(60vh * ${s.width / s.height})` } }, video, overlay);
  const track = w.processed.track;
  const videoTimes = s.times.map((t) => t + track.videoElementOffset);
  const drawOverlay = (mediaTime: number) => {
    const i = nearestFrame(videoTimes, mediaTime);
    const r = overlay.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    overlay.width = Math.max(1, Math.round(r.width * dpr));
    overlay.height = Math.max(1, Math.round(r.height * dpr));
    const c = overlay.getContext('2d')!;
    c.clearRect(0, 0, overlay.width, overlay.height);
    drawSkeleton(c, s.frames[i], w.side!, s.width, s.height, { sx: 0, sy: 0, sw: s.width, sh: s.height });
  };
  type RVFC = (cb: (now: number, meta: { mediaTime: number }) => void) => number;
  const rvfc = (video as unknown as { requestVideoFrameCallback?: RVFC }).requestVideoFrameCallback?.bind(video);
  const loop = () => {
    if (!video.isConnected) {
      URL.revokeObjectURL(url);
      return;
    }
    if (rvfc)
      rvfc((_n, meta) => {
        drawOverlay(meta.mediaTime);
        loop();
      });
  };
  if (rvfc) loop();
  else video.addEventListener('timeupdate', () => drawOverlay(video.currentTime));
  video.addEventListener('seeked', () => drawOverlay(video.currentTime));
  video.addEventListener('loadeddata', () => drawOverlay(video.currentTime));

  const signal = res.signal.map((v) => (v === null ? null : w.lift === 'squat' ? v * 100 : v));
  const chart = traceChart({
    title: `${w.lift === 'squat' ? 'Near-side hip height (% of leg length, up = higher)' : 'Near-side hip angle (°)'} · B = bottom frame of each rep`,
    values: signal,
    times: s.times,
    markers: live.map((x, k) => ({ frame: x.r.bottom, label: `B${k + 1}` })),
    format: (v) => (w.lift === 'squat' ? `${v.toFixed(1)}% leg` : `${v.toFixed(1)}°`),
  });

  const table = h(
    'div.table-wrap',
    h(
      'table.reps',
      h(
        'thead',
        h(
          'tr',
          h('th', 'Rep'),
          w.lift === 'squat' ? h('th', 'Depth') : null,
          w.lift === 'squat' ? h('th', 'Thigh') : null,
          h('th', 'Knee'),
          h('th', 'Hip'),
          h('th', 'Max lean'),
          h('th', 'Down'),
          h('th', 'Up'),
          h('th', 'Body %'),
        ),
      ),
      h(
        'tbody',
        live.map(({ r }, k) =>
          h(
            'tr',
            h('td', String(k + 1)),
            w.lift === 'squat' ? h('td', r.measures.depth ?? '—') : null,
            w.lift === 'squat' ? h('td', fmt.deg(r.measures.bottomThighAngleDeg)) : null,
            h('td', fmt.deg(r.measures.bottomKneeAngleDeg)),
            h('td', fmt.deg(r.measures.bottomHipAngleDeg)),
            h('td', fmt.deg(r.measures.maxTrunkLeanDeg)),
            h('td', fmt.ms(r.measures.downTimeMs)),
            h('td', fmt.ms(r.measures.upTimeMs)),
            h('td', fmt.pct(r.measures.bodyDetectedPct)),
          ),
        ),
      ),
    ),
  );

  const repCards = live.map(({ r, i }, k) => {
    const canvas = h('canvas.thumb');
    void (async () => {
      try {
        const bmp = await w.frames!.get(r.bottom);
        canvas.width = w.frames!.width;
        canvas.height = w.frames!.height;
        const c = canvas.getContext('2d')!;
        c.drawImage(bmp, 0, 0);
        bmp.close();
        drawSkeleton(c, s.frames[r.bottom], w.side!, s.width, s.height, { sx: 0, sy: 0, sw: s.width, sh: s.height });
      } catch {
        /* thumbnail is optional */
      }
    })();
    const m = r.measures;
    return h(
      'div.card',
      h(
        'div.row',
        { style: { alignItems: 'flex-start' } },
        canvas,
        h(
          'div.grow',
          h('div.row', h('strong.grow', `Rep ${k + 1}`), h('button.danger', { onclick: () => confirm(`Delete rep ${k + 1}? Remaining reps will be renumbered.`) && (w.deletedReps.add(i), rerender()) }, 'Delete')),
          h('p.small.muted', `Bottom frame ${r.bottom} (${s.times[r.bottom].toFixed(2)} s)`),
          kvTable(
            [
              ...(w.lift === 'squat' ? ([['Depth', m.depth ?? '—'], ['Thigh angle', fmt.deg(m.bottomThighAngleDeg)]] as [string, string][]) : []),
              ['Bottom knee angle', fmt.deg(m.bottomKneeAngleDeg)],
              ['Bottom hip angle', fmt.deg(m.bottomHipAngleDeg)],
              ['Max trunk lean', fmt.deg(m.maxTrunkLeanDeg)],
              ['Down / up', `${fmt.ms(m.downTimeMs)} / ${fmt.ms(m.upTimeMs)}`],
            ],
          ),
          h('button.link', { onclick: () => (video.currentTime = videoTimes[r.bottom]) }, 'Show bottom in video'),
        ),
      ),
    );
  });

  return h(
    'div',
    h('h2', 'Review reps'),
    honestyNote(),
    setHeader(w),
    h('div.card', wrap, h('p.small.muted', 'Skeleton: near side in blue; hollow red rings = landmark not detected clearly (excluded).'), chart),
    res.partial ? h('div.note.info', `${res.partial} movement(s) cut off by the start or end of the video were not counted as reps.`) : null,
    h('div.card', h('h3', `${live.length} rep(s)`), table),
    repCards,
    h(
      'div.sticky-actions',
      h(
        'button.primary.big',
        { disabled: live.length === 0, onclick: () => saveSet(w, live.map((x) => x.r.measures)) },
        `Save set (${live.length} ${live.length === 1 ? 'rep' : 'reps'})`,
      ),
      h('button.link', { onclick: () => confirm('Discard this set?') && go('setup') }, 'Discard and go back'),
    ),
    protocolCard(),
  );
}
