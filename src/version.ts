/**
 * The ONE place the app version lives. It is written into every CSV row as
 * app_version so each row records which measurement logic produced it.
 *
 * Bump it whenever any measurement logic, threshold (src/config.ts), formula,
 * pose model, or MediaPipe library version changes:
 *   PATCH – threshold / constant tweaks, bug fixes in a measurement
 *   MINOR – new or redefined measurement, new detection method
 *   MAJOR – incompatible change to how the app measures
 */
export const APP_VERSION = '0.1.0';

/** CSV spec version this app writes. Fixed by the CSV contract (section 7). */
export const SPEC_VERSION = '0.2';
