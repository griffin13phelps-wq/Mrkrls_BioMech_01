/** g used in the flight-time formula (m/s²). */
export const G = 9.81;

/** jump_height_cm = (9.81 × t² ÷ 8) × 100, t = flight time in seconds. */
export function jumpHeightCm(flightTimeMs: number): number {
  const t = flightTimeMs / 1000;
  return ((G * t * t) / 8) * 100;
}

/** rsi = jump height (m) ÷ contact time (s). */
export function reactiveStrengthIndex(jumpHeightCmValue: number, contactTimeMs: number): number {
  return jumpHeightCmValue / 100 / (contactTimeMs / 1000);
}
