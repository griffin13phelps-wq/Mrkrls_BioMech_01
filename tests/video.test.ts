import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { demuxVideo, readSamples } from '../src/video/demux';
import { applyTransform, buildFrameTable, displaySize, hevcCodecString, rotationFromMatrix, rotationTransform } from '../src/core/videoMeta';

const fx = (name: string) => new Blob([readFileSync(new URL(`./fixtures/${name}`, import.meta.url))]);
const F = 65536;

describe('orientation from the track matrix', () => {
  it('identity, 90, 180, 270 (iPhone portrait = 90° clockwise)', () => {
    expect(rotationFromMatrix([F, 0, 0, 0, F, 0, 0, 0, 1 << 30]).rotation).toBe(0);
    expect(rotationFromMatrix([0, F, 0, -F, 0, 0, 1080 * F, 0, 1 << 30]).rotation).toBe(90);
    expect(rotationFromMatrix([-F, 0, 0, 0, -F, 0, 0, 0, 1 << 30]).rotation).toBe(180);
    expect(rotationFromMatrix([0, -F, 0, F, 0, 0, 0, 0, 1 << 30]).rotation).toBe(270);
  });

  it('display size swaps for 90/270', () => {
    expect(displaySize(1920, 1080, 90)).toEqual({ width: 1080, height: 1920 });
    expect(displaySize(1920, 1080, 180)).toEqual({ width: 1920, height: 1080 });
  });

  it('canvas transform maps coded corners to the rotated display corners', () => {
    // 90° cw: coded top-left → display top-right; coded top-right → display bottom-right.
    const t = rotationTransform(90, 1920, 1080, 0.5);
    expect(applyTransform(t, 0, 0)).toEqual({ x: 540, y: 0 });
    expect(applyTransform(t, 1920, 0)).toEqual({ x: 540, y: 960 });
    expect(applyTransform(t, 0, 1080)).toEqual({ x: 0, y: 0 });
    const t270 = rotationTransform(270, 1920, 1080, 1);
    expect(applyTransform(t270, 0, 0)).toEqual({ x: 0, y: 1920 }); // top-left → bottom-left
    const t180 = rotationTransform(180, 100, 50, 1);
    expect(applyTransform(t180, 0, 0)).toEqual({ x: 100, y: 50 });
  });
});

describe('frame table', () => {
  it('orders B-frames by presentation time', () => {
    // decode order I P B B with cts 0, 3, 1, 2 (×100)
    const s = [0, 300, 100, 200].map((cts, i) => ({ cts, dts: i * 100, duration: 100, is_sync: i === 0 }));
    const t = buildFrameTable(s, 1000, 0.25);
    expect(t.presToDecode).toEqual([0, 2, 3, 1]);
    expect(t.times).toEqual([0, 0.1, 0.2, 0.3]);
    expect(t.rate.meanFps).toBe(10);
    expect(t.timesUsable).toBe(true);
  });
});

describe('HEVC codec string', () => {
  it('Main profile, level 3.1', () => {
    expect(
      hevcCodecString({
        general_profile_space: 0,
        general_tier_flag: 0,
        general_profile_idc: 1,
        general_profile_compatibility: 0x60000000,
        general_constraint_indicator: [0xb0, 0, 0, 0, 0, 0],
        general_level_idc: 93,
      }),
    ).toBe('hvc1.1.6.L93.B0');
  });
});

describe('demux real files (generated with ffmpeg)', () => {
  it('H.264 MOV, 240 fps, B-frames, display matrix rotated 90° clockwise (ffprobe: "rotation of -90.00 degrees")', async () => {
    const v = await demuxVideo(fx('h264_240fps_rot90.mov'));
    expect(v.codecCandidates[0]).toMatch(/^avc1\./);
    expect(v.description?.length).toBeGreaterThan(5);
    expect(v.codedWidth).toBe(96);
    expect(v.codedHeight).toBe(54);
    expect(v.rotation).toBe(90);
    expect(v.displayWidth).toBe(54);
    expect(v.displayHeight).toBe(96);
    expect(v.samples).toHaveLength(120);
    expect(v.frames.rate.meanFps).toBeCloseTo(240, 6);
    expect(v.frames.rate.variable).toBe(false);
    expect(v.frames.timesUsable).toBe(true);
    expect(v.frames.times[100] - v.frames.times[0]).toBeCloseTo(100 / 240, 9);
    // B-frames: decode order differs from presentation order
    expect(v.frames.presToDecode.some((d, p) => d !== p)).toBe(true);
    expect(v.samples[0].is_sync).toBe(true);
    const bytes = await readSamples(fx('h264_240fps_rot90.mov'), v, 0, 3);
    expect(bytes.map((b) => b.length)).toEqual(v.samples.slice(0, 4).map((s) => s.size));
    // avcC-style samples start with a 4-byte NAL length that fits inside the sample
    const nalLen = new DataView(bytes[0].buffer, bytes[0].byteOffset).getUint32(0);
    expect(nalLen).toBeGreaterThan(0);
    expect(nalLen + 4).toBeLessThanOrEqual(bytes[0].length);
  });

  it('HEVC MP4, 30 fps, no rotation', async () => {
    const v = await demuxVideo(fx('hevc_30fps.mp4'));
    expect(v.codecCandidates[0]).toMatch(/^hvc1\./);
    expect(v.rotation).toBe(0);
    expect(v.displayWidth).toBe(64);
    expect(v.frames.rate.meanFps).toBeCloseTo(30, 6);
    expect(v.samples).toHaveLength(30);
  });

  it('rejects a non-video file with a clear error', async () => {
    await expect(demuxVideo(new Blob([new Uint8Array(64)]))).rejects.toThrow();
  });
});
