/**
 * Reads an MP4/MOV file's movie header (moov) with mp4box.js WITHOUT loading
 * the whole video into memory, and returns everything needed to decode and
 * time each frame. Works in the browser and in Node (tests).
 */
import { createFile, DataStream, Endianness, MP4BoxBuffer, type Movie, type Sample } from 'mp4box';
import { VFR_TOLERANCE_FRAC } from '../config';
import { buildFrameTable, displaySize, hevcCodecString, rotationFromMatrix, type FrameTable, type Rotation } from '../core/videoMeta';

export interface VideoTrackInfo {
  /** Codec strings to try with VideoDecoder, best first. */
  codecCandidates: string[];
  /** Codec configuration record (avcC/hvcC/vpcC/av1C payload) for VideoDecoder.description. */
  description?: Uint8Array;
  sampleEntryType: string;
  codedWidth: number;
  codedHeight: number;
  rotation: Rotation;
  mirrored: boolean;
  rotationExact: boolean;
  matrix: number[];
  displayWidth: number;
  displayHeight: number;
  timescale: number;
  /** Samples in decode order with file offsets. */
  samples: Pick<Sample, 'offset' | 'size' | 'cts' | 'dts' | 'duration' | 'is_sync'>[];
  frames: FrameTable;
  /**
   * Seconds to add to a frame's time (frames.times) to get the media time an
   * HTML <video> element reports for it (edit list offset).
   */
  videoElementOffset: number;
  durationSec: number;
  brands: string[];
}

export class DemuxError extends Error {}

interface BoxHeader {
  type: string;
  start: number;
  size: number;
}

async function readBytes(file: Blob, start: number, end: number): Promise<ArrayBuffer> {
  return await file.slice(start, end).arrayBuffer();
}

/** Walk the top-level boxes using only their headers. */
async function topLevelBoxes(file: Blob): Promise<BoxHeader[]> {
  const boxes: BoxHeader[] = [];
  let pos = 0;
  while (pos + 8 <= file.size) {
    const hdr = new DataView(await readBytes(file, pos, Math.min(pos + 16, file.size)));
    let size = hdr.getUint32(0);
    const type = String.fromCharCode(hdr.getUint8(4), hdr.getUint8(5), hdr.getUint8(6), hdr.getUint8(7));
    if (size === 1) {
      if (hdr.byteLength < 16) break;
      size = Number(hdr.getBigUint64(8));
    } else if (size === 0) {
      size = file.size - pos;
    }
    if (size < 8) throw new DemuxError(`Malformed box "${type}" at byte ${pos}.`);
    boxes.push({ type, start: pos, size });
    pos += size;
  }
  return boxes;
}

function configBytes(box: { write: (s: DataStream) => void } | undefined): Uint8Array | undefined {
  if (!box) return undefined;
  const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
  box.write(stream);
  return new Uint8Array(stream.buffer as ArrayBuffer, 8); // drop the 8-byte box header
}

export async function demuxVideo(file: Blob): Promise<VideoTrackInfo> {
  const boxes = await topLevelBoxes(file);
  const moov = boxes.find((b) => b.type === 'moov');
  if (!moov) throw new DemuxError('This file has no movie header (moov box); it may not be an MP4/MOV video.');
  const mp4 = createFile();
  let info: Movie | undefined;
  let error: string | undefined;
  mp4.onReady = (i) => (info = i);
  mp4.onError = (_m, msg) => (error = msg);
  // Feed ONLY the ftyp and moov boxes, back to back, as one buffer. The sample
  // table's chunk offsets are absolute file positions, so they stay valid for
  // reading frames from the original file later; the (possibly huge) media
  // data is never loaded here.
  const parts = boxes.filter((x) => x.type === 'ftyp' || x.type === 'moov');
  const total = parts.reduce((a, b) => a + b.size, 0);
  const joined = new Uint8Array(total);
  let at = 0;
  for (const b of parts) {
    joined.set(new Uint8Array(await readBytes(file, b.start, b.start + b.size)), at);
    at += b.size;
  }
  mp4.appendBuffer(MP4BoxBuffer.fromArrayBuffer(joined.buffer, 0));
  mp4.flush();
  if (!info) throw new DemuxError(`Could not read the movie header${error ? `: ${error}` : ''}.`);
  const track = info.videoTracks[0];
  if (!track) throw new DemuxError('No video track found in this file.');
  const trak = mp4.getTrackById(track.id);
  const entry = trak.mdia.minf.stbl.stsd.entries[0] as unknown as {
    type: string;
    width: number;
    height: number;
    avcC?: { write: (s: DataStream) => void };
    hvcC?: { write: (s: DataStream) => void } & Parameters<typeof hevcCodecString>[0];
    vpcC?: { write: (s: DataStream) => void };
    av1C?: { write: (s: DataStream) => void };
    getCodec?: () => string;
  };
  const samples = mp4.getTrackSamplesInfo(track.id).map((s) => ({
    offset: s.offset,
    size: s.size,
    cts: s.cts,
    dts: s.dts,
    duration: s.duration,
    is_sync: s.is_sync,
  }));
  if (samples.length === 0) throw new DemuxError('The video track has no frames.');
  const codecCandidates = [track.codec];
  if (entry.hvcC && !track.codec.startsWith('hvc1') && !track.codec.startsWith('hev1')) {
    // e.g. Dolby Vision "dvh1"/"dvhe": try the HEVC base layer.
    codecCandidates.push(hevcCodecString(entry.hvcC, 'hvc1'), hevcCodecString(entry.hvcC, 'hev1'));
  }
  const matrix = Array.from(trak.tkhd.matrix as ArrayLike<number>);
  const rot = rotationFromMatrix(matrix);
  const codedWidth = entry.width || track.video?.width || 0;
  const codedHeight = entry.height || track.video?.height || 0;
  const disp = displaySize(codedWidth, codedHeight, rot.rotation);
  const frames = buildFrameTable(samples, track.timescale, VFR_TOLERANCE_FRAC);
  // Edit list: the first non-empty edit's media_time is where the <video> timeline starts.
  let videoElementOffset = 0;
  const edits = trak.edts?.elst?.entries ?? [];
  const firstMedia = edits.find((e) => e.media_time >= 0);
  if (firstMedia) videoElementOffset = (frames.cts[0] - firstMedia.media_time) / track.timescale;
  else videoElementOffset = frames.cts[0] / track.timescale;
  return {
    codecCandidates,
    description: configBytes(entry.avcC ?? entry.hvcC ?? entry.vpcC ?? entry.av1C),
    sampleEntryType: entry.type,
    codedWidth,
    codedHeight,
    rotation: rot.rotation,
    mirrored: rot.mirrored,
    rotationExact: rot.exact,
    matrix,
    displayWidth: disp.width,
    displayHeight: disp.height,
    timescale: track.timescale,
    samples,
    frames,
    videoElementOffset,
    durationSec: frames.durations.reduce((a, b) => a + b, 0) / track.timescale,
    brands: info.brands,
  };
}

/** Read the bytes of decode-order samples [from, to] with as few reads as possible. */
export async function readSamples(file: Blob, track: VideoTrackInfo, from: number, to: number): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  let i = from;
  while (i <= to) {
    // Group samples that are contiguous in the file (up to ~8 MB per read).
    let j = i;
    let end = track.samples[i].offset + track.samples[i].size;
    while (j + 1 <= to && track.samples[j + 1].offset === end && end - track.samples[i].offset < 8 * 1024 * 1024) {
      j++;
      end += track.samples[j].size;
    }
    const start = track.samples[i].offset;
    const buf = new Uint8Array(await readBytes(file, start, end));
    for (let k = i; k <= j; k++) {
      const s = track.samples[k];
      out.push(buf.subarray(s.offset - start, s.offset - start + s.size));
    }
    i = j + 1;
  }
  return out;
}
