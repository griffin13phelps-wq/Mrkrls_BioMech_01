# LiftLab

LiftLab is a mobile web app for two coaches. It measures baseball players' jumps
(countermovement jump, squat jump, drop jump) and lifts (squat, hinge) from
iPhone video, using markerless pose estimation (MediaPipe Pose Landmarker) that
runs **entirely in the phone's browser**. Videos never leave the phone. Results
are exported as `mocap_<session_id>.csv` (spec_version 0.2) for import into the
player development tracker.

- Static site (Vite + TypeScript). No backend, no accounts, no server.
- Primary target: Safari on iPhone. Mobile-first layout, large tap targets.
- Roster, settings and the current session's rep data (not videos) are saved in
  `localStorage`, so a page reload does not lose work.

> **Honesty note shown on every results screen:** single-camera estimates. Knee
> angles and jump height are the most reliable; hip angles and trunk lean are
> moderate confidence. Not a substitute for lab testing.

---

## Contents

1. [How it works for the coach](#how-it-works-for-the-coach)
2. [Filming protocol](#filming-protocol)
3. [Run locally](#run-locally)
4. [Deploy to GitHub Pages](#deploy-to-github-pages)
5. [CSV format (spec_version 0.2)](#csv-format-spec_version-02)
6. [How measurements are made](#how-measurements-are-made)
7. [Configuration and PROVISIONAL settings](#configuration-and-provisional-settings)
8. [Tests](#tests)
9. [Known limitations and open risks](#known-limitations-and-open-risks)
10. [Code map](#code-map)

---

## How it works for the coach

**Once:** *Roster* → paste names, one per line, as `First Last` → *Save roster*.
Duplicates (case-insensitive) are warned about and kept once. Players are always
picked from this list.

**Each session:**

1. *Session* → **Start session**. This creates `session_id` =
   `MC-YYYYMMDD-HHMM-XXXX` from the local start time (XXXX = 4 random A–Z/0–9)
   and records the local date.
2. **Add a set**: pick player, lift, variant (squat/hinge), set number (the app
   suggests the next number for that player + lift + variant; you can change
   it), load in lb (squat/hinge: total weight incl. bar; goblet = the
   dumbbell/kettlebell; 0 = bodyweight) or box height in cm (drop jump; the
   last value is remembered).
3. Pick **one** video from the camera roll. One video = one set; every rep or
   jump inside it is found automatically.
4. The app reads the file and shows its frame rate (read from the file),
   length, displayed size, rotation, timing method and decoder. It warns before
   processing if the video is longer than the limit (Settings, default 60 s),
   if a jump video is below 120 fps, or if the frame timing varies.
5. **Process video**: progress bar and **Cancel**.
6. **Review** (see below). Delete any false rep/jump; the rest renumber 1, 2, 3…
7. **Save set** adds the reps to the session.
8. **Export CSV** checks every row first. If any row fails, export is blocked
   and the failing rows are listed with reasons (fix the set via *Edit or
   delete this set*, or delete the rep/set). Otherwise it downloads
   `mocap_<session_id>.csv`; a **Share CSV (iOS share sheet)** button is offered
   as the fallback. In a home-screen (standalone) install the share sheet is
   tried first.
9. **Clear session** (with confirmation) when the CSV is safely exported.

**Jump review (frame-by-frame, confirmation required).** For each jump the app
suggests takeoff, landing and (drop jump) ground-contact frames. Each event
shows the exact decoded frame with the skeleton overlay and the floor line,
`−10 / −1 / +1 / +10` buttons, *Zoom on feet*, *Reset to suggested*, and
**Confirm**. *Save set* stays disabled until every event of every remaining
jump is confirmed. Moving any suggested frame of a jump sets
`frames_adjusted = Y` for that jump. A trace of foot height above the floor
(with gaps where the pose was not detected) shows all events.

**Squat / hinge review (automatic).** Video playback with skeleton overlay, a
trace of the movement signal with each rep's bottom frame marked, the bottom
frame image for each rep, and a per-rep table. Reps can be deleted.

**Side facing the camera** is auto-detected and shown on the review screen; you
can override it (re-analysis is instant because the pose data is kept).

**Errors instead of numbers** (with filming tips) when: the video cannot be
read/decoded, no person is detected, the side cannot be determined (you can
then pick it), the floor (or box) cannot be found, or no reps/jumps are found.

**Settings:** edit the filming-protocol text, the video-length warning limit,
and **Prepare for offline use** (downloads and caches the pose library, its
WebAssembly runtime and the model; then test once in airplane mode).

---

## Filming protocol

Shown as an always-present card on every screen (editable in *Settings*):

- Side view only. Camera square to the athlete, at hip height, phone LEVEL (not
  tilted), on a tripod or held still. Whole body and feet in frame.
- Jumps: hands on hips, no arm swing. Land with legs straight, in the same
  position as takeoff.
- Squat jump: sink to a 90° knee angle, hold 3 seconds, jump with no dip.
- Drop jump: step off the box (don't jump off). Cue: "Jump as high as you can,
  as fast as you can."
- Frame rate: jumps in slo-mo (240 fps preferred, never below 120).
  Squats/hinges: normal video (30 or 60 fps) is fine.

Additional practical points for the app's detection: athlete standing still on
the floor for a moment before and after each jump (this is how the floor level
is found); for drop jumps, start filming with the athlete standing still on the
box and keep filming until they stand still after landing.

---

## Run locally

Requires Node.js 22 (the build was developed with Node 22.22).

```bash
npm ci
npm test          # unit tests (vitest)
npm run dev       # dev server at http://localhost:5173/
npm run build     # type-check + production build into dist/
npm run preview   # serve dist/ at http://localhost:4173/
```

WebCodecs and service workers need a **secure context**: `localhost` works on
the computer, but to try it on an iPhone you need HTTPS (e.g., the GitHub Pages
deployment). The service worker is only registered in production builds.

---

## Deploy to GitHub Pages

The workflow `.github/workflows/deploy.yml` runs on every push to `main` (and
manually): `npm ci` → `npm test` → `npm run build` with
`BASE_PATH=/<repository-name>/` → uploads `dist/` → deploys to Pages.

One-time setup in the GitHub repository: **Settings → Pages → Build and
deployment → Source: GitHub Actions**. The site is then served at
`https://<owner>.github.io/<repository-name>/`
(for this repository: `https://griffin13phelps-wq.github.io/Mrkrls_BioMech_01/`).

The base path is set in `vite.config.ts` from the `BASE_PATH` environment
variable (default `/`). To build locally for the repository subpath:

```bash
BASE_PATH=/Mrkrls_BioMech_01/ npm run build
```

The action versions pinned in the workflow (`actions/checkout@v4`,
`setup-node@v4`, `configure-pages@v5`, `upload-pages-artifact@v3`,
`deploy-pages@v4`) were not run from this build environment; check the first
workflow run.

---

## CSV format (spec_version 0.2)

UTF-8 (no byte-order mark), comma-delimited, header row first, lowercase headers
in exactly this order. Rows are separated by `\n` (LF) with no trailing newline.
A field containing a comma or a double quote (and, for safety, a line break) is
wrapped in double quotes, and any double quote inside it is written as two
double quotes. Blank = empty cell (never `N/A`, `null`, `-`, or `0`). Plain
numbers with `.` decimals; no units or symbols.

| # | column | type | notes |
|---|---|---|---|
| 1 | player_name | text | exactly as on the roster |
| 2 | player_id | text | always blank |
| 3 | date | date | `YYYY-MM-DD`, local; equals the date in session_id |
| 4 | session_id | text | `MC-YYYYMMDD-HHMM-XXXX` (local session start; XXXX = A–Z/0–9) |
| 5 | lift | code | `cmj`, `squat_jump`, `drop_jump`, `squat`, `hinge` |
| 6 | variant | code | squat: `back`, `front`, `goblet` · hinge: `trap_bar`, `rdl`, `conventional` · jumps: blank |
| 7 | set_number | integer | ≥ 1 |
| 8 | rep_number | integer | ≥ 1 within the set |
| 9 | camera_view | code | `side` |
| 10 | side_facing_camera | code | `left`, `right` |
| 11 | video_file_name | text | name the browser provides, with extension |
| 12 | app_version | text | `MAJOR.MINOR.PATCH` (currently `0.1.0`) |
| 13 | frame_rate_fps | decimal | > 0, up to 2 decimals (trailing zeros dropped, e.g. `240`, `29.97`) |
| 14 | body_detected_pct | decimal | 0–100, 1 decimal |
| 15 | frames_adjusted | Y/N | |
| 16 | flight_time_ms | integer | > 0 |
| 17 | jump_height_cm | decimal | 1 decimal |
| 18 | hold_time_ms | integer | ≥ 0 |
| 19 | start_knee_angle_deg | decimal | 0–180 |
| 20 | dip_before_takeoff | Y/N | |
| 21 | box_height_cm | decimal | > 0 |
| 22 | contact_time_ms | integer | > 0 |
| 23 | rsi | decimal | 2 decimals |
| 24 | depth | code | `above`, `parallel`, `below` |
| 25 | bottom_knee_angle_deg | decimal | 0–180 |
| 26 | bottom_hip_angle_deg | decimal | 0–180 |
| 27 | max_trunk_lean_deg | decimal | 0–180 |
| 28 | down_time_ms | integer | > 0 |
| 29 | up_time_ms | integer | > 0 |
| 30 | load_lb | decimal | ≥ 0, 1 decimal; 0 = bodyweight |
| 31 | bottom_thigh_angle_deg | decimal | −90 to 90, 1 decimal |
| 32 | spec_version | text | always `0.2` |

**Which columns apply** (R = required; E = expected, blank only if not
measurable; — = must be blank):

| column(s) | cmj | squat_jump | drop_jump | squat | hinge |
|---|---|---|---|---|---|
| player_name, date, session_id, lift, set_number, rep_number, camera_view, side_facing_camera, video_file_name, app_version, frame_rate_fps, spec_version | R | R | R | R | R |
| player_id | — | — | — | — | — |
| body_detected_pct | E | E | E | E | E |
| variant | — | — | — | R | R |
| frames_adjusted | R | R | R | — | — |
| flight_time_ms, jump_height_cm | E | E | E | — | — |
| hold_time_ms, start_knee_angle_deg, dip_before_takeoff | — | E | — | — | — |
| box_height_cm | — | — | R | — | — |
| contact_time_ms, rsi | — | — | E | — | — |
| depth, bottom_thigh_angle_deg | — | — | — | E | — |
| bottom_knee_angle_deg, bottom_hip_angle_deg, max_trunk_lean_deg, down_time_ms, up_time_ms | — | — | — | E | E |
| load_lb | — | — | — | R | R |

Further rules enforced before export (export is blocked and the failing rows
are listed): `rsi` blank if `jump_height_cm` or `contact_time_ms` is blank; a
row with every E column blank is invalid (body_detected_pct counts as an E
column, as in the spec); `session_id + player_name + lift + variant +
set_number + rep_number` unique in the file; `date` must equal the session_id
date; player must be on the roster; codes, ranges and decimal places as in the
table above.

**Rounding:** all calculations use unrounded values; values are rounded only
when the CSV is written, half away from zero (e.g., 55.55 → 55.6, 1099.5 →
1100). Angles, cm, lb: 1 decimal. ms: whole numbers. RSI: 2 decimals.
frame_rate_fps: up to 2 decimals. body_detected_pct: 1 decimal.

**app_version** lives only in `src/version.ts`. It must be bumped whenever any
measurement logic, threshold (`src/config.ts`), formula, pose model or MediaPipe
library version changes, so every row records which logic produced it. Each
saved set stores the app_version that processed it.

---

## How measurements are made

### What MediaPipe reports per landmark per frame

Verified by reading the pinned library itself (`@mediapipe/tasks-vision@1.1.0`:
`vision.d.ts` and the landmark-conversion code in `vision_bundle.mjs`). For
each detected person, each frame gives 33 landmarks, each with:

| field | meaning (as documented in the library's type definitions) |
|---|---|
| `x`, `y` | position normalized to image width / height (0–1; can fall outside 0–1) |
| `z` | depth value (LiftLab does not use it) |
| `visibility` | "the likelihood of the landmark being visible within the image" (0–1). The conversion code sets it to 0 if the model omits it. |
| `presence` | optional; present in 1.1.0 only when the model output contains it (it is not in 1.0.1's typings) |

There are also 3D `worldLandmarks`; LiftLab **does not** use them. When no
person is detected the frame's landmark list is empty, which LiftLab stores as
"no pose" (a gap).

Landmark indices used (BlazePose 33-point topology): shoulders 11/12, hips
23/24, knees 25/26, ankles 27/28, heels 29/30, foot index (toe) 31/32
(left/right = the athlete's left/right).

### body_detected_pct

A landmark *passes* in a frame when `visibility ≥ 0.5`, **and** `presence ≥ 0.5`
if presence is reported, **and** its x and y lie inside the image (0–1).

`body_detected_pct` = 100 × (frames in the rep window where **all key near-side
landmarks pass**) ÷ (frames in the window). Calculated **per rep**:

- key landmarks: jumps = hip, knee, ankle, heel, toe; squat/hinge = shoulder,
  hip, knee, ankle (near side only);
- window: squat/hinge = the rep's first to last frame (start of its first phase
  to end of its last phase); jumps = from 1000 ms before takeoff (drop jump:
  before ground contact) through the landing frame, inclusive. Recomputed with
  the confirmed (possibly adjusted) frames.

Frames that fail are **excluded** from every calculation and shown as gaps in
the traces and as hollow red rings on the skeleton; no values are ever
invented or interpolated.

### Frame rate, timestamps and orientation

All three are read from the video file's own metadata with `mp4box.js`, which
parses only the file's movie header (`moov` box) — the video data is never
loaded into memory at once.

- **Frame rate** = number of video samples ÷ total sample duration (from the
  track's timescale). Also shown: 1 ÷ median frame interval. If more than 1% of
  frame intervals differ from the median by more than 25%, the video is flagged
  as having variable frame timing. The frame rate is never taken from playback
  speed.
- **Timestamps**: each frame's presentation timestamp from the container
  (sorted into presentation order, so B-frames are handled). These are used
  for all time measurements when they are finite and strictly increasing,
  because they come straight from the file and do not depend on the browser's
  playback clock. Otherwise LiftLab falls back to frame index ÷ frame rate.
  The method used is shown before processing and in the processing log.
- **Orientation**: from the track header's display matrix
  `[a b u; c d v; x y w]`: clockwise rotation = atan2(b, a), snapped to 90°
  steps. The display size swaps width/height for 90°/270°. Frames decoded with
  WebCodecs come out in the stored (coded) orientation, so LiftLab rotates each
  frame onto a canvas before pose detection; landmarks are therefore in the
  orientation the video displays. In the `<video>`-seeking fallback, LiftLab
  compares the element's reported size with the container's display size to
  decide whether the browser already rotated the frame.
- **Decoding**: WebCodecs `VideoDecoder` (exact frames, every frame) when the
  browser supports the file's codec; otherwise a slower `<video>`-seeking
  fallback that seeks to the middle of each frame's display interval (frame
  accuracy then depends on the browser). The mode is shown on screen.

The processing log (expand *Processing log* on the review screen, or *How this
was determined* on the set screen) records the matrix, rotation, sizes, frame
rate, timing method and decoder for each video.

### Coordinates, angles, side

- Normalized landmarks are converted to pixels (x × video width, y × video
  height, display orientation) so both axes share one scale.
- Image y increases downward; every "up/below/vertical" is converted to real
  world directions (e.g., hip below knee ⇔ hip.y > knee.y in the image).
- **Knee angle** = angle at the knee between hip–knee–ankle (180° = straight).
  **Hip angle** = angle at the hip between shoulder–hip–knee. **Trunk lean** =
  hip→shoulder line from vertical (0° = upright). **Thigh angle** = hip→knee
  line from horizontal (0° = parallel; + = hip below knee; − = hip above knee).
- **Side**: mean visibility of shoulder, hip, knee, ankle, heel, toe on each
  side across all frames with a person; the higher side faces the camera. If
  the difference is < 0.05 the side is "not determined" and the coach picks.
  Only near-side joints are used for every measurement.
- **Leg length** (scale): median of |hip–knee| + |knee–ankle| in pixels. Distance
  thresholds are expressed in leg lengths so they do not depend on how far the
  camera is from the athlete.

### Smoothing

Landmark pixel positions used for angles and for slow hip trajectories are
smoothed with a zero-lag filter: a 2nd-order Butterworth low-pass (6 Hz) run
forward and then backward, with the two-pass cut-off correction described by
D. A. Winter (*Biomechanics and Motor Control of Human Movement*). Each
unbroken run of valid frames is filtered separately; gaps stay gaps.
**Jump events (takeoff, landing, ground contact) are always detected from the
unsmoothed positions**, so smoothing can never shift a suggested frame.

### Jumps

Foot signal (unsmoothed): per frame, the lowest image point of the near-side
heel and toe; null if either fails the confidence test.

1. **Rest periods**: windows ≥ 150 ms in which that point moves less than 0.03
   leg. Rest periods at similar levels (within 0.04 leg) are grouped into
   surfaces.
2. **Floor level** = the lowest surface (in the real world) stood on for ≥ 250
   ms in total — so a box top is never mistaken for the floor. A surface ≥ 0.10
   leg above the floor is the **box**.
3. **On the ground** = foot point within the contact band of the floor: max(0.02
   leg, 3 × SD of the foot signal while standing on the floor).
4. Frames are split into ground and airborne runs; floor-contact blips shorter
   than 25 ms inside an airborne stretch are treated as noise.
5. A **flight** is an airborne run between two ground runs, lasting 100–1200
   ms, lifting the foot ≥ 0.05 leg, with the hip rising ≥ 0.04 leg above its
   standing level (rejects steps).
   - **Takeoff** = first frame of the flight (first frame both feet are off the
     ground); **landing** = first frame of the next ground run (first frame a
     foot touches).
6. **Drop jump**: the airborne run that contains standing on the box (and the
   step down) is never a flight. **Ground contact** = first frame of the
   ground run right after it; the following flight's takeoff and landing are
   the rebound. Contact must be shorter than 1500 ms.

Then: `flight_time_ms = time(landing) − time(takeoff)`,
`contact_time_ms = time(takeoff) − time(ground contact)`,
`jump_height_cm = (9.81 × t² ÷ 8) × 100` (t = flight time in s),
`rsi = jump height (m) ÷ contact time (s)`.

Because the foot must clear the contact band, the suggested takeoff tends to be
slightly late and the suggested landing slightly early (in the synthetic tests,
within 3 frames at 240 fps). That is why every frame is confirmed by a person.

### Squat jump hold and dip

Uses the smoothed (zero-lag) near-side hip height in leg lengths:

- "Still" = hip vertical speed < 0.10 leg/s. Still periods separated by ≤ 100
  ms with < 0.03 leg level change are joined.
- Walking back from takeoff (up to 6 s), the most recent still period lasting
  ≥ 250 ms is examined: if its median knee angle is < 140° it is the **hold**;
  if the knees are straighter (the athlete was standing) there is no hold.
- `hold_time_ms` = time from the first to the last still frame of the hold;
  **0 if no hold**.
- `start_knee_angle_deg` = median knee angle during the hold.
- `dip_before_takeoff` = Y if the hips drop more than 0.03 leg (≈ 2.7 cm for a
  90 cm leg) below the hold's median level between the end of the hold and
  takeoff; else N.
- If there is no hold, `start_knee_angle_deg` and `dip_before_takeoff` are left
  blank because both are defined relative to the hold.

### Squat and hinge

- Movement signal (smoothed): squat = hip height (leg lengths); hinge = hip
  angle (degrees) — hinges are detected from the hip angle because the hips
  mostly move backward, not down.
- Phase order from the variant: squats and RDL lower first; conventional and
  trap-bar deadlifts (bar starts on the floor) lift first, then lower.
- **Reps**: rest level = 95th percentile of the signal (lower-first) or of its
  negative (lift-first). Frames within the top band (squat 0.05 leg; hinge 10°)
  are "at rest", frames at least the minimum excursion away (squat 0.15 leg;
  hinge 30°) are "out"; frames in between keep the previous label. Each "out"
  run is one rep. Movements cut off by the start or end of the video (e.g.,
  walking in and bending to the bar, standing up after releasing it) are not
  reps and are counted separately on the review screen. Reps shorter than 400
  ms are discarded.
- **Bottom frame**: squat = frame where the hip joint center is lowest; hinge =
  frame where the hip angle is smallest (within the rep).
- At the bottom frame: `bottom_knee_angle_deg`, `bottom_hip_angle_deg`, and for
  squats `bottom_thigh_angle_deg` and `depth` (|thigh| ≤ 2° → parallel;
  positive beyond → below; negative beyond → above).
- `max_trunk_lean_deg` = largest trunk lean anywhere in the rep.
- **Phase rule** (`down_time_ms`, `up_time_ms`): for each phase, ROM = distance
  between the rest level on that side and the turnaround value. A phase runs
  from the **last frame inside the band it leaves** to the **first frame inside
  the band it reaches**, where each band is 5% of that phase's ROM measured from
  the top or bottom level. Pauses at the top or bottom are therefore excluded
  from both phases. Times use the frame timestamps.

---

## Configuration and PROVISIONAL settings

Every constant is in `src/config.ts` (one place). Changing any value changes
measurements → bump `APP_VERSION` in `src/version.ts`.

**[PROVISIONAL] = starting guess, not tuned on real iPhone video.** "leg" =
the athlete's leg length in that video (see above).

| constant | value | PROVISIONAL | meaning |
|---|---|---|---|
| `LANDMARK_CONFIDENCE_THRESHOLD` | 0.5 | yes | landmark passes if visibility (and presence, when reported) ≥ this and it lies inside the image — used for body_detected_pct and to exclude frames |
| `JUMP_QUALITY_WINDOW_MS` | 1000 | yes | body_detected_pct window before takeoff (drop jump: before ground contact) |
| `SIDE_MIN_VISIBILITY_MARGIN` | 0.05 | yes | minimum left/right mean-visibility difference to auto-pick the side |
| `MIN_FRAMES_WITH_PERSON_PCT` | 30 | | below this % of frames with a person → "no person detected" |
| `LOWPASS_CUTOFF_HZ` | 6 | yes | zero-lag Butterworth cut-off for angle/hip smoothing |
| `REST_MAX_RANGE_LEG` | 0.03 | yes | foot "at rest" if it moves less than this (leg) within a rest window |
| `REST_MIN_MS` | 150 | | rest window length |
| `SURFACE_CLUSTER_LEG` | 0.04 | | rest levels this close are the same surface |
| `FLOOR_MIN_TOTAL_MS` | 250 | | minimum total time at rest on the floor |
| `BOX_MIN_HEIGHT_LEG` | 0.10 | | a surface this far above the floor is a box |
| `GROUND_BAND_MIN_LEG` | 0.02 | yes | minimum ground-contact band (leg) |
| `GROUND_BAND_NOISE_K` | 3 | yes | contact band = max(min band, K × SD of standing foot signal) |
| `FLIGHT_MIN_PEAK_LEG` | 0.05 | yes | foot must rise this high for a flight |
| `JUMP_MIN_HIP_RISE_LEG` | 0.04 | yes | hip must rise this far above standing during a flight |
| `FLIGHT_MIN_MS` / `FLIGHT_MAX_MS` | 100 / 1200 | | plausible flight-time range |
| `GROUND_BLIP_MAX_MS` | 25 | | ground blips shorter than this inside a flight are noise |
| `DROP_CONTACT_MAX_MS` | 1500 | | max ground contact before the rebound |
| `SJ_STILL_SPEED_LEG_PER_S` | 0.10 | yes | squat-jump hold "still" threshold (hip speed) |
| `SJ_MIN_HOLD_MS` | 250 | yes | shorter still periods are not a hold (→ hold_time_ms = 0) |
| `SJ_HOLD_MAX_KNEE_DEG` | 140 | yes | hold must be in a squat (median knee angle below this) |
| `SJ_DIP_THRESHOLD_LEG` | 0.03 | yes | dip_before_takeoff threshold (≈ 2.7 cm for a 90 cm leg); must be tuned on real video |
| `SJ_SEARCH_WINDOW_MS` | 6000 | | how far before takeoff to look for the hold |
| `SJ_STILL_GAP_MERGE_MS` | 100 | yes | still periods split by breaks this short are joined |
| `SQUAT_REP_MIN_DROP_LEG` | 0.15 | yes | hip drop needed for a squat rep |
| `SQUAT_TOP_BAND_LEG` | 0.05 | | "at the top" band for squats |
| `HINGE_REP_MIN_DEG` | 30 | yes | hip-angle closure needed for a hinge rep |
| `HINGE_TOP_BAND_DEG` | 10 | | "at the top" band for hinges |
| `PHASE_BAND_FRAC` | 0.05 | yes | phase start/end bands = 5% of the phase's range of motion |
| `REP_MIN_DURATION_MS` | 400 | | shorter reps are discarded |
| `DEPTH_PARALLEL_BAND_DEG` | 2 | yes | depth band: \|thigh angle\| ≤ this → parallel |
| `DEFAULT_MAX_VIDEO_SECONDS` | 60 | | default video-length warning (editable in Settings; not a measurement setting) |
| `JUMP_MIN_FPS` | 120 | | warn before processing a jump video below this |
| `VFR_TOLERANCE_FRAC` | 0.25 | | frame-interval deviation counted as irregular (flag if > 1% of intervals) |
| `POSE_INPUT_MAX_SIDE_PX` | 1280 | | long side of the canvas fed to the pose model |
| `POSE_MIN_DETECTION_CONFIDENCE` / `..._PRESENCE_...` / `..._TRACKING_...` | 0.5 each | | MediaPipe options (the library's defaults per its type definitions) |
| `POSE_DELEGATE_ORDER` | GPU, then CPU | | inference backend order |
| `MEDIAPIPE_VERSION` | 1.1.0 | | pinned `@mediapipe/tasks-vision` (loaded from jsDelivr) |
| `POSE_MODEL_URL` | `…/pose_landmarker_full/float16/1/pose_landmarker_full.task` | | pose model (Google storage) |
| `REVIEW_FRAME_WINDOW` | 24 | | frames decoded each side of a reviewed frame |
| `REVIEW_FRAME_MAX_SIDE_PX` | 960 | | review frame image size |

---

## Tests

```bash
npm test
```

71 unit tests (vitest) over pure functions and real container files:

- jump height: 520 ms → 33.2 cm, 480 → 28.3, 470 → 27.1; frame counting at 240
  fps (takeoff 100, landing 220 → 500 ms → 30.7 cm); RSI 470 ms + 210 ms → 1.29;
- drop jump with a box step-down (the ≈286 ms step-down is not counted; the 470
  ms rebound is); CMJ detection (also with 2 px landmark noise); floor/box
  errors;
- squat jump: no pause → hold_time_ms = 0; 3 s hold → ≈3000 ms at ≈90°; dip;
- synthetic squat (3 reps, bottom frames, phase times), RDL detected from hip
  angle and *not* from hip height, conventional deadlift (lift first, walk-in
  and stand-up ignored);
- angle math on 1080 × 1920 (a true 90° stays 90°; using normalized
  coordinates would give 121.3°), trunk lean, thigh angle signs, depth band;
- smoothing: no time shift, gaps preserved;
- CSV: 32 fields per row with commas/quotes in names, exact header, blanks per
  lift, quoting, rounding, export blocked on invalid rows, duplicates, date
  mismatch, out-of-range values;
- container parsing on ffmpeg-made files in `tests/fixtures/`: 240 fps H.264
  MOV with B-frames and a 90° rotation matrix; HEVC MP4.

**Optional browser smoke test** (`tests/e2e/smoke.mjs`, not part of `npm
test`): drives the production build in headless Chromium (Playwright) with AV1
test videos from `tests/e2e/make-videos.sh` and a stand-in pose detector,
because the real model cannot be downloaded in the build sandbox. It checks
frame rate (240 from the file), rotation (the coded top-left marker lands
top-right, matching Chromium's own rendering), container timestamps, every
frame processed, the confirm-before-save flow, frames_adjusted, CSV export and
its contents, persistence across reload, the offline app shell, clearing the
session, and the `<video>`-seeking fallback. The stand-in detector is only used
when a test sets `window.__LIFTLAB_TEST_POSE__` before the app starts.

```bash
tests/e2e/make-videos.sh /tmp/vids
BASE_PATH=/Mrkrls_BioMech_01/ npm run build
BASE_PATH=/Mrkrls_BioMech_01/ npx vite preview --port 4173 &
NODE_PATH=$(npm root -g) node tests/e2e/smoke.mjs /tmp/vids /tmp/e2e-out
```

---

## Known limitations and open risks

Not verified (could not be tested in the build environment):

- **Real iPhone video and the real pose model.** All detection logic was tested
  on synthetic landmark trajectories and a stand-in detector; no real athlete
  video and no real MediaPipe output have been run. Every [PROVISIONAL] value
  needs tuning on real video.
- **iPhone codecs in Safari.** iPhones record HEVC (often 10-bit HDR / Dolby
  Vision, sample entry `dvh1`) or H.264. Whether Safari's WebCodecs accepts these
  files (including the HEVC-base-layer codec string LiftLab tries for `dvh1`)
  is unverified; if not, the slower `<video>`-seeking fallback is used. The
  build sandbox's Chromium has no H.264/HEVC decoder, so only AV1 was tested in
  a browser.
- **240 fps slo-mo from the camera roll.** iOS may hand Safari a converted copy
  of a slo-mo video (compressed and/or with the slow-motion section rendered
  into the timeline). LiftLab reads the frame rate and timestamps from the file
  it receives and warns if it is below 120 fps or has variable frame timing,
  but cannot recover the capture rate if iOS changed it. Check the frame rate
  shown before processing.
- **Rotation handling on real iPhone files.** The matrix math was checked
  against a 90°-rotated test file and Chromium's own rendering; not against
  real iPhone portrait/landscape files in Safari.
- **Video file names.** Safari may provide a generic or changed name (e.g.,
  `IMG_0412.MOV`, or a temporary name for converted videos). LiftLab records
  whatever name the browser gives; it can be edited per set before export.
- **CSV download on iOS.** Direct download (`<a download>`) and the share-sheet
  fallback (`navigator.share` with a file) were not tested on an iPhone. In
  Chromium the download worked.
- **Offline caching.** The service worker's app-shell caching was verified in
  Chromium (app loads with the network off). Caching of the MediaPipe library,
  WASM and model (cross-origin, cache-first) could not be tested because
  neither the CDN nor the model can be reached from the build sandbox; use
  *Settings → Prepare for offline use*, then test in airplane mode. Safari's
  storage limits and eviction policy for cached files and `localStorage` were
  not verified here — export the CSV at the end of each session.
- **Model URL.** The `pose_landmarker_full` URL follows the URL pattern shown
  for the lite model in the library's README; it was not fetched from here.
- **Processing speed** on an iPhone (especially 240 fps videos: ~240 frames per
  second of video) is unknown.

Inherent to the method:

- Single side-view camera: out-of-plane motion is not measured; hip angle and
  trunk lean are moderate confidence; the far-side leg is not used.
- From the side only the near foot is clearly visible, so "both feet off" /
  "any foot touches" are judged from the near foot (the protocol keeps both feet
  together); the human confirmation step covers this.
- Pose models can swap left/right landmarks in side views; check the skeleton.
- Thresholds are relative to the athlete's leg length in pixels, which assumes
  the athlete stays at roughly the same distance from the camera.
- The flight-time jump-height formula assumes takeoff and landing in the same
  body position (hence the protocol cue to land with straight legs).
- `localStorage` is per browser: Safari and a home-screen install keep separate
  data; private browsing may not keep it.

---

## Code map

```
src/version.ts          APP_VERSION (one place) and SPEC_VERSION
src/config.ts           every constant
src/core/               pure, tested logic (no DOM)
  angles.ts             knee/hip/trunk/thigh angles, depth
  smoothing.ts          zero-lag Butterworth with gaps
  landmarks.ts          indices, confidence test, pixel conversion
  quality.ts            body_detected_pct
  side.ts               side detection
  timing.ts             frame times, frame rate, VFR check
  jumpEvents.ts         floor/box, takeoff, landing, ground contact
  squatJump.ts          hold, start knee angle, dip
  reps.ts               squat/hinge reps and phases
  jumpMetrics.ts        jump height, RSI
  analysis.ts           glue from pose data to measurements
  csv.ts                CSV columns, formatting, validation
  session.ts            session_id, set-number suggestion, roster parsing
  videoMeta.ts          rotation matrix, display size, frame table, codec strings
src/video/              mp4box demux, WebCodecs / seek decoding, review frame cache
src/pose/               MediaPipe loader, processing runner
src/ui/                 screens
src/state.ts            localStorage persistence
src/export.ts           download / share sheet
sw-template.js          service worker (vite.config.ts injects the file list)
tests/                  unit tests, fixtures, optional browser smoke test
```
