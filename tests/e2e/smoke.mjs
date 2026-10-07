/**
 * Browser smoke test (optional; not part of `npm test`).
 *
 * Drives the production build in headless Chromium with Playwright, using
 * AV1 test videos made by ffmpeg and a stand-in pose detector (the MediaPipe
 * model cannot be downloaded in the build sandbox). Verifies frame rate,
 * rotation, timestamps, the review flow, CSV export, persistence, offline app
 * shell, and the <video>-seeking fallback.
 *
 * Usage:
 *   BASE_PATH=/Mrkrls_BioMech_01/ npx vite build
 *   BASE_PATH=/Mrkrls_BioMech_01/ npx vite preview --port 4173 &
 *   NODE_PATH=$(npm root -g) node tests/e2e/smoke.mjs <videoDir> <outDir>
 * <videoDir> must contain cmj_240_rot.mp4 and squat_30.mp4 (see README).
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire((process.env.NODE_PATH ?? '.') + '/');
const { chromium } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const [videoDir, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const BASE = process.env.APP_URL ?? 'http://localhost:4173/Mrkrls_BioMech_01/';

const fake = execFileSync('npx', ['esbuild', join(here, 'fakePose.ts'), '--bundle', '--format=iife'], { encoding: 'utf8' });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const browser = await chromium.launch();

async function newPage({ noWebCodecs = false } = {}) {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await context.addInitScript({ content: fake });
  if (noWebCodecs) await context.addInitScript(() => { delete window.VideoDecoder; });
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
  page.on('crash', () => console.log('PAGE CRASHED'));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('CONSOLE', m.type(), m.text()); });
  return { context, page };
}

const textOf = async (page, label) => (await page.locator('table.kv tr', { hasText: label }).first().locator('td').last().textContent())?.trim();

async function addSet(page, { player, lift, variant, load, video, scenario }) {
  await page.getByRole('button', { name: /Add a set/ }).click();
  await page.locator('label.field', { hasText: 'Player' }).locator('select').selectOption(player);
  await page.locator('label.field', { hasText: 'Lift' }).locator('select').selectOption(lift);
  if (variant) await page.locator('label.field', { hasText: 'Variant' }).locator('select').selectOption(variant);
  if (load !== undefined) await page.locator('label.field', { hasText: 'Load (lb)' }).locator('input').fill(String(load));
  if (load !== undefined) await page.locator('label.field', { hasText: 'Load (lb)' }).locator('input').blur();
  await page.locator('input[type=file]').setInputFiles(join(videoDir, video));
  await page.getByText('Frame rate (read from the file)').waitFor();
  await page.evaluate((s) => { window.__SCENARIO__ = s; window.__POSE_PROBE__ = undefined; }, scenario);
}

// ---------------------------------------------------------------------------
// Main flow with WebCodecs
// ---------------------------------------------------------------------------
{
  const { context, page } = await newPage();
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Roster', exact: true }).click();
  await page.locator('textarea').fill('Alex Smith\nJordan Lee\nAlex Smith');
  await page.getByRole('button', { name: 'Save roster' }).click();
  check('roster saves and warns about duplicates', await page.getByText('Roster saved: 2 players. 1 duplicate(s) removed.').isVisible());

  await page.getByRole('button', { name: 'Session', exact: true }).click();
  await page.getByRole('button', { name: 'Start session' }).click();
  const sessionId = (await page.locator('.card strong').first().textContent()).trim();
  check('session id format', /^MC-\d{8}-\d{4}-[A-Z0-9]{4}$/.test(sessionId), sessionId);

  await addSet(page, { player: 'Alex Smith', lift: 'cmj', video: 'cmj_240_rot.mp4', scenario: 'cmj' });
  check('frame rate read from file = 240', (await textOf(page, 'Frame rate (read from the file)')) === '240.00 fps', await textOf(page, 'Frame rate (read from the file)'));
  check('rotation from container = 90° clockwise', (await textOf(page, 'Rotation applied')) === '90° clockwise');
  check('display size = 180 × 320 (portrait)', (await textOf(page, 'Displayed size')) === '180 × 320', await textOf(page, 'Displayed size'));
  check('timing uses container timestamps', (await textOf(page, 'Timing')) === 'per-frame timestamps from the file');
  check('decoder = WebCodecs', (await textOf(page, 'Decoder'))?.startsWith('WebCodecs'), await textOf(page, 'Decoder'));
  await page.screenshot({ path: join(outDir, '1-setup.png'), fullPage: true });

  await page.getByRole('button', { name: 'Process video' }).click();
  await page.getByRole('heading', { name: 'Review jumps' }).waitFor({ timeout: 120000 });
  const probe = await page.evaluate(() => window.__POSE_PROBE__);
  const isRed = (c) => c[0] > 150 && c[1] < 100 && c[2] < 100;
  check('pose input canvas is portrait 180×320', probe.width === 180 && probe.height === 320, `${probe.width}×${probe.height}`);
  check('coded top-left marker appears at display top-right (90° cw)', isRed(probe.topRight) && !isRed(probe.topLeft) && !isRed(probe.bottomLeft), JSON.stringify(probe));
  check('every frame went through pose detection', probe.calls === 864, `${probe.calls} calls`);
  check('detector timestamps = container times (4.1667 ms apart)', Math.abs(probe.timestamps[1] - probe.timestamps[0] - 1000 / 240) < 1e-6, JSON.stringify(probe.timestamps));

  // Cross-check against Chromium's own rendering of the rotated video.
  const b64 = readFileSync(join(videoDir, 'cmj_240_rot.mp4')).toString('base64');
  const chromium = await page.evaluate(async (data) => {
    const bytes = Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0));
    const v = document.createElement('video');
    v.muted = true;
    v.src = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
    await new Promise((r) => v.addEventListener('loadeddata', r, { once: true }));
    v.currentTime = 0.1;
    await new Promise((r) => v.addEventListener('seeked', r, { once: true }));
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const x = c.getContext('2d');
    x.drawImage(v, 0, 0);
    const px = (a, b) => Array.from(x.getImageData(a, b, 1, 1).data.slice(0, 3));
    return { w: v.videoWidth, h: v.videoHeight, topRight: px(c.width - 4, 3), topLeft: px(3, 3) };
  }, b64);
  check("Chromium's own <video> rendering agrees (marker top-right, 180×320)", chromium.w === 180 && chromium.h === 320 && isRed(chromium.topRight) && !isRed(chromium.topLeft), JSON.stringify(chromium));

  const sugg = await page.locator('p', { hasText: 'Suggested frame:' }).first().textContent();
  const takeoffSuggested = Number(/Suggested frame: (\d+)/.exec(sugg)[1]);
  // True takeoff is t = 1.8 s → frame 432; the first airborne frame is 433.
  check('suggested takeoff within 3 frames after the true takeoff (frame 433)', takeoffSuggested >= 433 && takeoffSuggested <= 436, `suggested ${takeoffSuggested}`);
  await page.screenshot({ path: join(outDir, '2-review-jump.png'), fullPage: true });
  const saveBtn = page.getByRole('button', { name: 'Save set' });
  check('save is blocked until frames are confirmed', await saveBtn.isDisabled());
  await page.getByRole('button', { name: 'Back 1 frame' }).click();
  await page.getByRole('button', { name: new RegExp(`Confirm takeoff at frame ${takeoffSuggested - 1}`) }).click();
  await page.getByRole('button', { name: /Confirm landing at frame/ }).click();
  const flightTxt = await textOf(page, 'Flight time');
  check('flight time shown after adjusting', /^\d+ ms$/.test(flightTxt), flightTxt);
  check('frames adjusted = Yes after moving a frame', (await textOf(page, 'Frames adjusted')) === 'Yes');
  await page.screenshot({ path: join(outDir, '3-review-jump-confirmed.png'), fullPage: true });
  await saveBtn.click();
  check('set saved', await page.getByText(/Saved set 1 for Alex Smith: 1 rep/).isVisible());

  await addSet(page, { player: 'Jordan Lee', lift: 'squat', variant: 'back', load: 135, video: 'squat_30.mp4', scenario: 'squat' });
  check('squat video: 30 fps, no rotation', (await textOf(page, 'Frame rate (read from the file)')) === '30.00 fps' && (await textOf(page, 'Rotation applied')) === '0° clockwise');
  await page.getByRole('button', { name: 'Process video' }).click();
  await page.getByRole('heading', { name: 'Review reps' }).waitFor({ timeout: 120000 });
  check('squat: 3 reps detected', await page.getByRole('heading', { name: '3 rep(s)' }).isVisible());
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(outDir, '4-review-squat.png'), fullPage: true });
  await page.getByRole('button', { name: /Save set \(3 reps\)/ }).click();

  // Export
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  const csvPath = join(outDir, download.suggestedFilename());
  await download.saveAs(csvPath);
  check('download file name = mocap_<session_id>.csv', download.suggestedFilename() === `mocap_${sessionId}.csv`, download.suggestedFilename());
  const csv = readFileSync(csvPath, 'utf8');
  const lines = csv.split('\n');
  const header = lines[0].split(',');
  check('CSV header has 32 columns, starts player_name, ends spec_version', header.length === 32 && header[0] === 'player_name' && header[31] === 'spec_version');
  check('CSV has 4 data rows (1 jump + 3 squat reps)', lines.length === 5, `${lines.length - 1} rows`);
  const rows = lines.slice(1).map((l) => l.split(','));
  const col = (r, name) => r[header.indexOf(name)];
  check('every row has 32 fields', rows.every((r) => r.length === 32));
  check('jump row: frames_adjusted Y, fps 240, spec 0.2', col(rows[0], 'frames_adjusted') === 'Y' && col(rows[0], 'frame_rate_fps') === '240' && col(rows[0], 'spec_version') === '0.2', lines[1]);
  const flight = Number(col(rows[0], 'flight_time_ms'));
  check('jump row: flight time within 25 ms of the true 500 ms', Math.abs(flight - 500) <= 25, `${flight} ms`);
  check('squat rows: load 135.0, variant back, 30 fps, depth set', rows.slice(1).every((r) => col(r, 'load_lb') === '135.0' && col(r, 'variant') === 'back' && col(r, 'frame_rate_fps') === '30' && col(r, 'depth') !== ''), lines.slice(2).join(' | '));
  check('date matches session id', rows.every((r) => col(r, 'date').replaceAll('-', '') === sessionId.slice(3, 11)));
  writeFileSync(join(outDir, 'exported.csv'), csv);
  await page.screenshot({ path: join(outDir, '5-session.png'), fullPage: true });

  // Persistence across reload
  await page.reload();
  check('session survives a page reload', await page.getByText(/2 set\(s\) · 4 rep\(s\)/).isVisible());

  // Offline app shell via the service worker
  const swState = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return { active: !!reg.active, controller: !!navigator.serviceWorker.controller };
  });
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  check('app shell loads offline after first visit (service worker)', await page.getByRole('heading', { name: 'LiftLab' }).isVisible(), JSON.stringify(swState));
  await context.setOffline(false);

  // Clear session
  await page.getByRole('button', { name: 'Clear session', exact: true }).click();
  check('clear session asks for confirmation and clears', await page.getByText('Session cleared.').isVisible());
  await context.close();
}

// ---------------------------------------------------------------------------
// Seek fallback (no WebCodecs)
// ---------------------------------------------------------------------------
{
  const { context, page } = await newPage({ noWebCodecs: true });
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Roster', exact: true }).click();
  await page.locator('textarea').fill('Alex Smith');
  await page.getByRole('button', { name: 'Save roster' }).click();
  await page.getByRole('button', { name: 'Session', exact: true }).click();
  await page.getByRole('button', { name: 'Start session' }).click();
  await addSet(page, { player: 'Alex Smith', lift: 'cmj', video: 'cmj_240_rot.mp4', scenario: 'cmj' });
  check('fallback: decoder = <video> seeking', (await textOf(page, 'Decoder')) === '<video> seeking (fallback)');
  await page.locator('label.row', { hasText: 'Process anyway' }).locator('input').check();
  await page.getByRole('button', { name: 'Process video' }).click();
  await page.getByRole('heading', { name: 'Review jumps' }).waitFor({ timeout: 300000 });
  const probe = await page.evaluate(() => window.__POSE_PROBE__);
  const isRed = (c) => c[0] > 150 && c[1] < 100 && c[2] < 100;
  check('fallback: frames drawn in display orientation (marker top-right)', probe.width === 180 && isRed(probe.topRight) && !isRed(probe.topLeft), JSON.stringify(probe));
  check('fallback: every frame processed', probe.calls === 864, `${probe.calls}`);
  await context.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 1));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
