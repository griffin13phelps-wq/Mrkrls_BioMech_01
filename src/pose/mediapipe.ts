/**
 * Loads MediaPipe Pose Landmarker at runtime from the official CDN / model
 * URLs (src/config.ts). The service worker caches these responses so the app
 * works offline after the first successful load.
 */
import * as C from '../config';
import type { Landmark } from '../core/types';
import type { PoseDetector } from './detector';

/* Minimal local typings for the parts of @mediapipe/tasks-vision we use. */
interface WasmFileset {
  wasmLoaderPath: string;
  wasmBinaryPath: string;
}
interface MPLandmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
  presence?: number;
}
interface MPResult {
  landmarks: MPLandmark[][];
  close?: () => void;
}
interface MPPoseLandmarker {
  detectForVideo(image: TexImageSource, timestampMs: number): MPResult;
  close(): void;
}
interface VisionModule {
  FilesetResolver: { forVisionTasks(basePath: string): Promise<WasmFileset> };
  PoseLandmarker: {
    createFromOptions(fileset: WasmFileset, options: Record<string, unknown>): Promise<MPPoseLandmarker>;
  };
}

let visionPromise: Promise<VisionModule> | null = null;
let detectorPromise: Promise<PoseDetector> | null = null;

export function loadVision(): Promise<VisionModule> {
  visionPromise ??= import(/* @vite-ignore */ C.MEDIAPIPE_BUNDLE_URL) as Promise<VisionModule>;
  visionPromise.catch(() => (visionPromise = null));
  return visionPromise;
}

/** Copy MediaPipe's landmarks into plain objects (the result's memory may be reused). */
export function copyLandmarks(lms: MPLandmark[] | undefined): Landmark[] | null {
  if (!lms || lms.length === 0) return null;
  return lms.map((l) => {
    const o: Landmark = { x: l.x, y: l.y, z: l.z, visibility: l.visibility };
    if (typeof l.presence === 'number') o.presence = l.presence;
    return o;
  });
}

export function loadMediaPipeDetector(log: (s: string) => void): Promise<PoseDetector> {
  detectorPromise ??= (async () => {
    log(`Loading MediaPipe tasks-vision ${C.MEDIAPIPE_VERSION} from ${C.MEDIAPIPE_BUNDLE_URL}`);
    const vision = await loadVision();
    const fileset = await vision.FilesetResolver.forVisionTasks(C.MEDIAPIPE_WASM_BASE);
    log(`WASM: ${fileset.wasmBinaryPath}`);
    let lastError: unknown = null;
    for (const delegate of C.POSE_DELEGATE_ORDER) {
      try {
        const lm = await vision.PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: C.POSE_MODEL_URL, delegate },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: C.POSE_MIN_DETECTION_CONFIDENCE,
          minPosePresenceConfidence: C.POSE_MIN_PRESENCE_CONFIDENCE,
          minTrackingConfidence: C.POSE_MIN_TRACKING_CONFIDENCE,
          outputSegmentationMasks: false,
        });
        log(`Pose model ready (${delegate} delegate): ${C.POSE_MODEL_URL}`);
        let lastTs = -Infinity;
        return {
          label: `MediaPipe Pose Landmarker (full), tasks-vision ${C.MEDIAPIPE_VERSION}, ${delegate}`,
          detect(image: TexImageSource, timestampMs: number) {
            // VIDEO mode requires strictly increasing timestamps across calls.
            const ts = timestampMs > lastTs ? timestampMs : lastTs + 1;
            lastTs = ts;
            const r = lm.detectForVideo(image, ts);
            const out = copyLandmarks(r.landmarks[0]);
            r.close?.();
            return out;
          },
        } satisfies PoseDetector;
      } catch (e) {
        lastError = e;
        log(`Could not start the ${delegate} delegate: ${String(e)}`);
      }
    }
    throw lastError ?? new Error('Pose model failed to load.');
  })();
  detectorPromise.catch(() => (detectorPromise = null));
  return detectorPromise;
}

/**
 * Download (and let the service worker cache) every file needed offline:
 * the library bundle, the WASM loader + binary this device will use, and the model.
 */
export async function prefetchForOffline(log: (s: string) => void): Promise<{ url: string; ok: boolean; bytes: number }[]> {
  const vision = await loadVision();
  const fileset = await vision.FilesetResolver.forVisionTasks(C.MEDIAPIPE_WASM_BASE);
  const urls = [C.MEDIAPIPE_BUNDLE_URL, fileset.wasmLoaderPath, fileset.wasmBinaryPath, C.POSE_MODEL_URL];
  const out: { url: string; ok: boolean; bytes: number }[] = [];
  for (const url of urls) {
    try {
      const r = await fetch(url, { mode: 'cors' });
      const b = await r.arrayBuffer();
      out.push({ url, ok: r.ok, bytes: b.byteLength });
      log(`${r.ok ? 'Cached' : 'FAILED'} ${url} (${(b.byteLength / 1e6).toFixed(1)} MB)`);
    } catch (e) {
      out.push({ url, ok: false, bytes: 0 });
      log(`FAILED ${url}: ${String(e)}`);
    }
  }
  return out;
}
