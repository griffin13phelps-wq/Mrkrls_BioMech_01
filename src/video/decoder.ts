/**
 * Frame sources. Both yield frames in presentation order with their
 * presentation index, so frame i always pairs with timestamp i.
 *
 *  - WebCodecs (preferred): exact frames from the file via VideoDecoder.
 *    Frames come out in CODED orientation; the caller rotates them using the
 *    container's matrix.
 *  - Seek fallback: an HTML <video> element is seeked to the middle of each
 *    frame's display interval. Used when VideoDecoder is missing or rejects the
 *    codec. Frame accuracy depends on the browser's seeking.
 */
import { readSamples, type VideoTrackInfo } from './demux';
import { rotationTransform } from '../core/videoMeta';

export type DecodeMode = 'webcodecs' | 'seek';

export interface FrameOut {
  index: number;
  /** VideoFrame (webcodecs) or the <video> element (seek). */
  source: VideoFrame | HTMLVideoElement;
  close(): void;
}

const usOf = (cts: number, timescale: number) => Math.round((cts * 1e6) / timescale);

export async function pickDecoderConfig(track: VideoTrackInfo, log: (s: string) => void): Promise<VideoDecoderConfig | null> {
  if (typeof VideoDecoder === 'undefined') {
    log('WebCodecs VideoDecoder is not available in this browser.');
    return null;
  }
  for (const codec of track.codecCandidates) {
    const cfg: VideoDecoderConfig = {
      codec,
      codedWidth: track.codedWidth,
      codedHeight: track.codedHeight,
      ...(track.description ? { description: track.description } : {}),
    };
    try {
      const sup = await VideoDecoder.isConfigSupported(cfg);
      log(`VideoDecoder.isConfigSupported(${codec}) = ${sup.supported}`);
      if (sup.supported) return cfg;
    } catch (e) {
      log(`VideoDecoder.isConfigSupported(${codec}) threw: ${String(e)}`);
    }
  }
  return null;
}

/**
 * Decode presentation frames [presFrom, presTo] with WebCodecs.
 * The consumer MUST call close() on every yielded frame.
 */
export async function* decodeWithWebCodecs(
  file: Blob,
  track: VideoTrackInfo,
  config: VideoDecoderConfig,
  presFrom: number,
  presTo: number,
  signal?: AbortSignal,
): AsyncGenerator<FrameOut> {
  const ft = track.frames;
  presFrom = Math.max(0, presFrom);
  presTo = Math.min(ft.presToDecode.length - 1, presTo);
  let minD = Infinity;
  let maxD = -Infinity;
  for (let p = presFrom; p <= presTo; p++) {
    minD = Math.min(minD, ft.presToDecode[p]);
    maxD = Math.max(maxD, ft.presToDecode[p]);
  }
  // Frames presented inside the range may depend on later decode-order frames (B-frames):
  // keep feeding until every needed frame is out; start at the previous keyframe.
  let start = minD;
  while (start > 0 && !track.samples[start].is_sync) start--;
  // Open-GOP streams can have leading frames that reference the PREVIOUS
  // group; starting one keyframe earlier keeps those decodable.
  if (start > 0 && presFrom > 0) {
    start--;
    while (start > 0 && !track.samples[start].is_sync) start--;
  }
  const tsToPres = new Map<number, number>();
  for (let p = 0; p < ft.cts.length; p++) tsToPres.set(usOf(ft.cts[p], track.timescale), p);

  const queue: VideoFrame[] = [];
  let failure: unknown = null;
  let wake: (() => void) | null = null;
  const poke = () => {
    const w = wake;
    wake = null;
    w?.();
  };
  const decoder = new VideoDecoder({
    output: (f) => {
      queue.push(f);
      poke();
    },
    error: (e) => {
      failure = e;
      poke();
    },
  });
  decoder.addEventListener?.('dequeue', poke);
  decoder.configure(config);
  let fed = start;
  let flushing: Promise<void> | null = null;
  let flushed = false;
  let remaining = presTo - presFrom + 1;
  const wait = () =>
    new Promise<void>((resolve) => {
      wake = resolve;
      setTimeout(poke, 50); // safety net if 'dequeue' is not fired by this browser
    });
  try {
    while (remaining > 0) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (failure) throw failure;
      if (queue.length) {
        const f = queue.shift()!;
        let p = tsToPres.get(f.timestamp);
        if (p === undefined) p = nearestPres(ft.cts, track.timescale, f.timestamp);
        if (p >= presFrom && p <= presTo) {
          remaining--;
          yield { index: p, source: f, close: () => f.close() };
        } else f.close();
        continue;
      }
      if (fed <= maxD && decoder.decodeQueueSize < 8) {
        const end = Math.min(maxD, fed + 15);
        const datas = await readSamples(file, track, fed, end);
        for (let k = fed; k <= end; k++) {
          const s = track.samples[k];
          decoder.decode(
            new EncodedVideoChunk({
              type: s.is_sync ? 'key' : 'delta',
              timestamp: usOf(s.cts, track.timescale),
              duration: usOf(s.duration, track.timescale),
              data: datas[k - fed],
            }),
          );
        }
        fed = end + 1;
        continue;
      }
      if (fed > maxD && !flushing) {
        flushing = decoder.flush().then(
          () => {
            flushed = true;
            poke();
          },
          (e) => {
            failure = e;
            poke();
          },
        );
      }
      if (flushed && queue.length === 0) break;
      await wait();
    }
  } finally {
    for (const f of queue) f.close();
    if (decoder.state !== 'closed') decoder.close();
  }
}

function nearestPres(cts: number[], timescale: number, us: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let p = 0; p < cts.length; p++) {
    const d = Math.abs(usOf(cts[p], timescale) - us);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

function once(el: EventTarget, ok: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for "${ok}"`));
    }, timeoutMs);
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error('The video could not be decoded by this browser.'));
    };
    const cleanup = () => {
      clearTimeout(t);
      el.removeEventListener(ok, onOk);
      el.removeEventListener('error', onErr);
    };
    el.addEventListener(ok, onOk);
    el.addEventListener('error', onErr);
  });
}

export interface SeekVideo {
  video: HTMLVideoElement;
  /** True when the browser already shows the video in display orientation. */
  browserRotates: boolean;
  dispose(): void;
}

export async function openSeekVideo(file: Blob, track: VideoTrackInfo, log: (s: string) => void): Promise<SeekVideo> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.setAttribute('playsinline', '');
  const url = URL.createObjectURL(file);
  video.src = url;
  await once(video, 'loadeddata', 20000);
  // iOS Safari may not paint a frame for drawImage until playback has started once.
  try {
    await video.play();
    video.pause();
  } catch {
    /* autoplay may be refused; seeking still works */
  }
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const browserRotates = track.rotation === 0 || (vw === track.displayWidth && vh === track.displayHeight);
  log(
    `<video> reports ${vw}×${vh}; container coded ${track.codedWidth}×${track.codedHeight}, rotation ${track.rotation}° → display ${track.displayWidth}×${track.displayHeight}. ` +
      (browserRotates ? 'Browser applies the rotation itself.' : 'Browser reports unrotated size; LiftLab rotates frames itself.'),
  );
  return { video, browserRotates, dispose: () => URL.revokeObjectURL(url) };
}

/** Seek a <video> to the middle of frame p's display interval. */
export async function seekToFrame(sv: SeekVideo, track: VideoTrackInfo, p: number): Promise<void> {
  const ft = track.frames;
  const t = ft.times[p] + track.videoElementOffset + ft.durations[p] / track.timescale / 2;
  const v = sv.video;
  if (Math.abs(v.currentTime - t) < 1e-6 && v.readyState >= 2) return;
  const seeked = once(v, 'seeked', 10000);
  v.currentTime = t;
  await seeked;
  // Wait until the frame is actually presented when the browser can tell us.
  const rvfc = (v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }).requestVideoFrameCallback;
  if (rvfc) await Promise.race([new Promise<void>((r) => rvfc.call(v, () => r())), new Promise<void>((r) => setTimeout(r, 120))]);
}

export async function* decodeWithSeeking(
  sv: SeekVideo,
  track: VideoTrackInfo,
  presFrom: number,
  presTo: number,
  signal?: AbortSignal,
): AsyncGenerator<FrameOut> {
  for (let p = Math.max(0, presFrom); p <= Math.min(track.frames.times.length - 1, presTo); p++) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    await seekToFrame(sv, track, p);
    yield { index: p, source: sv.video, close: () => {} };
  }
}

/**
 * Draw a frame into `canvas` (sized to display width/height × scale) in
 * display orientation.
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  source: VideoFrame | HTMLVideoElement,
  track: VideoTrackInfo,
  scale: number,
  sourceIsRotated: boolean,
): void {
  const c = ctx.canvas;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (sourceIsRotated) {
    ctx.drawImage(source, 0, 0, c.width, c.height);
    return;
  }
  const t = rotationTransform(track.rotation, track.codedWidth, track.codedHeight, scale);
  ctx.setTransform(t[0], t[1], t[2], t[3], t[4], t[5]);
  ctx.drawImage(source, 0, 0, track.codedWidth, track.codedHeight);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
