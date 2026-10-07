/**
 * Frame images for the review screens. Frames are decoded on demand (from the
 * nearest keyframe) in windows around the requested frame and kept as small
 * JPEG blobs, so stepping −1 / +1 frame is instant and memory stays low.
 * Each image is the exact decoded frame i, drawn in display orientation.
 */
import { REVIEW_FRAME_MAX_SIDE_PX, REVIEW_FRAME_WINDOW } from '../config';
import type { VideoProbe } from '../pose/runner';
import { decodeWithSeeking, decodeWithWebCodecs, drawFrame, openSeekVideo, type SeekVideo } from './decoder';

const MAX_CACHED = 600;

export class ReviewFrames {
  private cache = new Map<number, Blob>();
  private pending: Promise<void> = Promise.resolve();
  private seek: SeekVideo | null = null;
  readonly width: number;
  readonly height: number;
  private scale: number;

  constructor(
    private file: Blob,
    private probe: VideoProbe,
  ) {
    const t = probe.track;
    this.scale = Math.min(1, REVIEW_FRAME_MAX_SIDE_PX / Math.max(t.displayWidth, t.displayHeight));
    this.width = Math.round(t.displayWidth * this.scale);
    this.height = Math.round(t.displayHeight * this.scale);
  }

  get frameCount(): number {
    return this.probe.track.frames.times.length;
  }

  has(i: number): boolean {
    return this.cache.has(i);
  }

  /** Image for frame i (decodes a window around it if needed). */
  async get(i: number): Promise<ImageBitmap> {
    if (!this.cache.has(i)) {
      await this.load(Math.max(0, i - REVIEW_FRAME_WINDOW), Math.min(this.frameCount - 1, i + REVIEW_FRAME_WINDOW));
    }
    const blob = this.cache.get(i);
    if (!blob) throw new Error(`Frame ${i} could not be decoded.`);
    // Mark as recently used.
    this.cache.delete(i);
    this.cache.set(i, blob);
    return await createImageBitmap(blob);
  }

  /** Decode frames [a, b] that are not cached yet. Calls are serialized. */
  load(a: number, b: number): Promise<void> {
    const job = this.pending.then(() => this.doLoad(a, b));
    this.pending = job.catch(() => {});
    return job;
  }

  private async doLoad(a: number, b: number): Promise<void> {
    while (a <= b && this.cache.has(a)) a++;
    while (b >= a && this.cache.has(b)) b--;
    if (a > b) return;
    const t = this.probe.track;
    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;
    const ctx = canvas.getContext('2d')!;
    let rotated = false;
    let gen;
    if (this.probe.mode === 'webcodecs') {
      gen = decodeWithWebCodecs(this.file, t, this.probe.decoderConfig!, a, b);
    } else {
      this.seek ??= await openSeekVideo(this.file, t, () => {});
      rotated = this.seek.browserRotates;
      gen = decodeWithSeeking(this.seek, t, a, b);
    }
    for await (const f of gen) {
      try {
        drawFrame(ctx, f.source, t, this.scale, rotated);
      } finally {
        f.close();
      }
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
      if (blob) this.cache.set(f.index, blob);
    }
    while (this.cache.size > MAX_CACHED) this.cache.delete(this.cache.keys().next().value!);
  }

  dispose(): void {
    this.cache.clear();
    this.seek?.dispose();
    this.seek = null;
  }
}
