/**
 * Runs pose estimation on EVERY frame of a video and returns a PoseSeries in
 * display orientation, plus a log of how frame rate, timing and orientation
 * were determined.
 */
import { POSE_INPUT_MAX_SIDE_PX } from '../config';
import { frameCountTimes, type TimingMethod } from '../core/timing';
import type { PoseFrame, PoseSeries } from '../core/types';
import { demuxVideo, type VideoTrackInfo } from '../video/demux';
import { decodeWithSeeking, decodeWithWebCodecs, drawFrame, openSeekVideo, pickDecoderConfig, type DecodeMode, type FrameOut } from '../video/decoder';
import type { PoseDetector } from './detector';

export interface VideoProbe {
  track: VideoTrackInfo;
  decoderConfig: VideoDecoderConfig | null;
  mode: DecodeMode;
  fps: number;
  timing: TimingMethod;
  log: string[];
}

export interface ProcessedVideo extends VideoProbe {
  series: PoseSeries;
  framesDecoded: number;
  detectorLabel: string;
  elapsedMs: number;
}

/** Read the container and choose a decoder. Fast; no frames are decoded. */
export async function probeVideo(file: Blob): Promise<VideoProbe> {
  const log: string[] = [];
  const say = (s: string) => log.push(s);
  const track = await demuxVideo(file);
  const r = track.frames.rate;
  say(`Container: brands ${track.brands.join('/')}, sample entry "${track.sampleEntryType}", codec ${track.codecCandidates[0]}.`);
  say(
    `Frame rate (from the file): ${track.samples.length} frames over ${track.durationSec.toFixed(3)} s of sample durations → mean ${r.meanFps.toFixed(3)} fps; median frame interval → ${r.medianFps.toFixed(3)} fps.`,
  );
  if (r.variable) say(`WARNING: variable frame timing — ${(r.irregularFraction * 100).toFixed(1)}% of frame intervals differ from the median by >25%.`);
  say(
    `Orientation: track matrix [${track.matrix.join(', ')}] → rotate ${track.rotation}° clockwise${track.mirrored ? ' (mirrored)' : ''}; coded ${track.codedWidth}×${track.codedHeight} → display ${track.displayWidth}×${track.displayHeight}.`,
  );
  if (!track.rotationExact) say('WARNING: the rotation matrix is not a multiple of 90°; it was rounded to the nearest 90°.');
  const timing: TimingMethod = track.frames.timesUsable ? 'container-timestamps' : 'frame-count';
  say(
    timing === 'container-timestamps'
      ? 'Timing: per-frame presentation timestamps read from the container (strictly increasing).'
      : 'Timing: container timestamps not usable (duplicate or non-increasing); using frame index ÷ frame rate.',
  );
  const decoderConfig = await pickDecoderConfig(track, say);
  const mode: DecodeMode = decoderConfig ? 'webcodecs' : 'seek';
  say(mode === 'webcodecs' ? `Decoding: WebCodecs VideoDecoder (${decoderConfig!.codec}).` : 'Decoding: <video> seeking fallback (frame accuracy depends on the browser).');
  return { track, decoderConfig, mode, fps: r.meanFps, timing, log };
}

export async function processVideo(
  file: Blob,
  probe: VideoProbe,
  detector: PoseDetector,
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal,
): Promise<ProcessedVideo> {
  const t0 = performance.now();
  const { track } = probe;
  const log = [...probe.log];
  const n = track.frames.times.length;
  const frames: PoseFrame[] = new Array(n).fill(null);
  const scale = Math.min(1, POSE_INPUT_MAX_SIDE_PX / Math.max(track.displayWidth, track.displayHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(track.displayWidth * scale);
  canvas.height = Math.round(track.displayHeight * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: false })!;
  let source: AsyncGenerator<FrameOut>;
  let sourceIsRotated = false;
  let dispose = () => {};
  if (probe.mode === 'webcodecs') {
    source = decodeWithWebCodecs(file, track, probe.decoderConfig!, 0, n - 1, signal);
  } else {
    const sv = await openSeekVideo(file, track, (s) => log.push(s));
    sourceIsRotated = sv.browserRotates;
    dispose = sv.dispose;
    source = decodeWithSeeking(sv, track, 0, n - 1, signal);
  }
  log.push(`Pose detector: ${detector.label}. Inference canvas ${canvas.width}×${canvas.height}.`);
  let decoded = 0;
  let lastYield = performance.now();
  try {
    for await (const f of source) {
      try {
        drawFrame(ctx, f.source, track, scale, sourceIsRotated);
      } finally {
        f.close();
      }
      frames[f.index] = detector.detect(canvas, track.frames.times[f.index] * 1000);
      decoded++;
      if (performance.now() - lastYield > 40) {
        onProgress(decoded, n);
        await new Promise((r) => setTimeout(r, 0));
        lastYield = performance.now();
      }
    }
  } finally {
    dispose();
  }
  onProgress(decoded, n);
  if (decoded < n) log.push(`WARNING: only ${decoded} of ${n} frames were decoded; the missing frames are gaps.`);
  const times = probe.timing === 'container-timestamps' ? track.frames.times : frameCountTimes(n, probe.fps);
  const withPerson = frames.filter((f) => f !== null).length;
  log.push(`Pose found in ${withPerson} of ${n} frames.`);
  return {
    ...probe,
    log,
    series: { width: track.displayWidth, height: track.displayHeight, frames, times },
    framesDecoded: decoded,
    detectorLabel: detector.label,
    elapsedMs: performance.now() - t0,
  };
}
