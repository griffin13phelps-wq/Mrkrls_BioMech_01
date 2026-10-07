/**
 * Every tunable constant used by LiftLab's measurement logic lives here.
 *
 * Changing ANY value in this file changes measurements, so bump APP_VERSION in
 * src/version.ts at the same time (see the note there).
 *
 * Items marked [PROVISIONAL] are starting guesses that have NOT been tuned on
 * real iPhone video. They are listed in the README with their current values.
 *
 * Units used below:
 *   "leg" = the athlete's leg length in pixels for that video, measured as the
 *           median of |hip–knee| + |knee–ankle| on the near side. Expressing
 *           distances in leg lengths makes thresholds independent of how far
 *           the camera is from the athlete.
 */

// ---------------------------------------------------------------------------
// MediaPipe (loaded at runtime in the browser, never bundled)
// ---------------------------------------------------------------------------

/** Pinned @mediapipe/tasks-vision version. Changing it = bump APP_VERSION. */
export const MEDIAPIPE_VERSION = '1.1.0';
export const MEDIAPIPE_BUNDLE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/vision_bundle.mjs`;
export const MEDIAPIPE_WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;

/**
 * Pose Landmarker model. The package README shows the URL pattern for the
 * "lite" model; "full" follows the same pattern (see README: not verified from
 * this build environment). Changing the model = bump APP_VERSION.
 */
export const POSE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';

/** Try the GPU delegate first, then fall back to CPU if it fails to start. */
export const POSE_DELEGATE_ORDER: ReadonlyArray<'GPU' | 'CPU'> = ['GPU', 'CPU'];

/** Library defaults (0.5 each, per the tasks-vision type definitions) for the three detector confidences. */
export const POSE_MIN_DETECTION_CONFIDENCE = 0.5;
export const POSE_MIN_PRESENCE_CONFIDENCE = 0.5;
export const POSE_MIN_TRACKING_CONFIDENCE = 0.5;

/**
 * Frames are drawn to a canvas (in display orientation) before inference. The
 * long side is capped at this many pixels to keep drawing fast; landmarks are
 * normalized 0–1, so this does not change the pixel conversion, which always
 * uses the full display width and height of the video.
 */
export const POSE_INPUT_MAX_SIDE_PX = 1280;

// ---------------------------------------------------------------------------
// Data quality
// ---------------------------------------------------------------------------

/**
 * [PROVISIONAL] A landmark "passes" in a frame when its visibility score is
 * >= this value, AND its presence score is >= this value when the model
 * reports presence, AND its x and y lie inside the image (0–1).
 */
export const LANDMARK_CONFIDENCE_THRESHOLD = 0.5;

/**
 * [PROVISIONAL] Jumps: body_detected_pct covers the frames from this long
 * before takeoff (drop jump: before ground contact) through landing.
 */
export const JUMP_QUALITY_WINDOW_MS = 1000;

/**
 * [PROVISIONAL] Side detection: the near side is the side whose key landmarks
 * have the higher mean visibility. If the two means differ by less than this,
 * the side is reported as "could not be determined" and the user must pick.
 */
export const SIDE_MIN_VISIBILITY_MARGIN = 0.05;

/** If fewer than this % of frames contain any detected person, show an error. */
export const MIN_FRAMES_WITH_PERSON_PCT = 30;

// ---------------------------------------------------------------------------
// Smoothing (angles and slow position signals only — never timing events)
// ---------------------------------------------------------------------------

/**
 * [PROVISIONAL] Cut-off of the zero-lag low-pass filter (2nd-order Butterworth
 * run forward then backward, with Winter's two-pass correction) applied to
 * landmark pixel positions before angles and hip trajectories are computed.
 */
export const LOWPASS_CUTOFF_HZ = 6;

// ---------------------------------------------------------------------------
// Jump event detection (from UNSMOOTHED near-side heel and toe positions)
// ---------------------------------------------------------------------------

/** [PROVISIONAL] The foot is "at rest" if its lowest point moves less than this (leg) within the window below. */
export const REST_MAX_RANGE_LEG = 0.03;
/** Minimum duration of a rest window. */
export const REST_MIN_MS = 150;
/** Rest segments whose levels are within this distance (leg) are treated as the same surface. */
export const SURFACE_CLUSTER_LEG = 0.04;
/** The floor surface must be stood on (at rest) for at least this long in total. */
export const FLOOR_MIN_TOTAL_MS = 250;
/** A rest surface at least this far (leg) above the floor is treated as a box. */
export const BOX_MIN_HEIGHT_LEG = 0.1;

/**
 * [PROVISIONAL] Ground-contact band. A foot point counts as touching the floor
 * when it is within max(GROUND_BAND_MIN_LEG, GROUND_BAND_NOISE_K × SD of the
 * foot's height while standing on the floor) of the floor level.
 */
export const GROUND_BAND_MIN_LEG = 0.02;
export const GROUND_BAND_NOISE_K = 3;

/** [PROVISIONAL] A flight must lift the foot at least this high (leg) above the floor. */
export const FLIGHT_MIN_PEAK_LEG = 0.05;
/** [PROVISIONAL] During a real jump the hip rises at least this far (leg) above its standing level. */
export const JUMP_MIN_HIP_RISE_LEG = 0.04;
/** Plausible flight-time range for a jump. */
export const FLIGHT_MIN_MS = 100;
export const FLIGHT_MAX_MS = 1200;
/** Floor-contact blips shorter than this inside an airborne stretch are treated as noise. */
export const GROUND_BLIP_MAX_MS = 25;
/** Drop jump: the ground contact before the rebound must be shorter than this. */
export const DROP_CONTACT_MAX_MS = 1500;

// ---------------------------------------------------------------------------
// Squat jump hold and dip (from SMOOTHED near-side hip height)
// ---------------------------------------------------------------------------

/** [PROVISIONAL] Hips are "still" while their vertical speed is below this (leg per second). */
export const SJ_STILL_SPEED_LEG_PER_S = 0.1;
/** [PROVISIONAL] A still period shorter than this is not a hold (hold_time_ms = 0). */
export const SJ_MIN_HOLD_MS = 250;
/** [PROVISIONAL] A hold must be in a squat: median knee angle during it must be below this. */
export const SJ_HOLD_MAX_KNEE_DEG = 140;
/**
 * [PROVISIONAL] dip_before_takeoff = Y when the hips drop more than this (leg)
 * below their hold level after the hold and before takeoff. About 2.7 cm for a
 * 90 cm leg. Must be tuned on real video.
 */
export const SJ_DIP_THRESHOLD_LEG = 0.03;
/** How far back from takeoff to look for the hold. */
export const SJ_SEARCH_WINDOW_MS = 6000;
/** [PROVISIONAL] Still periods separated by breaks this short (with < dip-threshold level change) are joined into one hold. */
export const SJ_STILL_GAP_MERGE_MS = 100;

// ---------------------------------------------------------------------------
// Squat and hinge reps (from SMOOTHED signals)
// ---------------------------------------------------------------------------

/** [PROVISIONAL] Squat rep: hip must drop at least this far (leg) below its top level. */
export const SQUAT_REP_MIN_DROP_LEG = 0.15;
/** Squat: within this distance (leg) of the top level counts as "at the top". */
export const SQUAT_TOP_BAND_LEG = 0.05;
/** [PROVISIONAL] Hinge rep: hip angle must close at least this much (deg) from its top level. */
export const HINGE_REP_MIN_DEG = 30;
/** Hinge: within this many degrees of the top level counts as "at the top". */
export const HINGE_TOP_BAND_DEG = 10;
/**
 * [PROVISIONAL] Phase boundaries. A phase runs from the last frame inside the
 * band it starts in to the first frame inside the band it ends in. Each band is
 * this fraction of that phase's range of motion, measured from the rep's top or
 * bottom level.
 */
export const PHASE_BAND_FRAC = 0.05;
/** Reps shorter than this (start to end) are discarded as noise. */
export const REP_MIN_DURATION_MS = 400;
/** [PROVISIONAL] depth: |bottom_thigh_angle_deg| <= this band → "parallel". */
export const DEPTH_PARALLEL_BAND_DEG = 2;

// ---------------------------------------------------------------------------
// Video
// ---------------------------------------------------------------------------

/** Default warning limit for video length; editable in Settings (does not affect measurements). */
export const DEFAULT_MAX_VIDEO_SECONDS = 60;
/** Warn before processing a jump video below this frame rate. */
export const JUMP_MIN_FPS = 120;
/** Flag variable frame timing when more than 1% of frame intervals differ from the median by more than this fraction. */
export const VFR_TOLERANCE_FRAC = 0.25;

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

/** Frames decoded on each side of a frame the user is reviewing. */
export const REVIEW_FRAME_WINDOW = 24;
/** Review frame images are stored at this long-side size (JPEG). */
export const REVIEW_FRAME_MAX_SIDE_PX = 960;
