/**
 * The "Bounce" word animation: a word does not sweep, it snaps on and pops.
 *
 * `popCurve(age)` is a damped spring impulse over the seconds since the
 * word started: 0 before it, a quick rise to ~1 at ~0.1 s, a small
 * undershoot (the squash) and then rest. Frequency and decay are chosen so
 * the first peak lands almost at once; the 1.85 gain normalises that peak to
 * about 1 (exp(-6.5 * 0.096) * sin(pi / 2) is ~0.54).
 */
const FREQ_HZ = 2.6;
const DECAY = 6.5;
const GAIN = 1.85;
/** Past this the spring is below visibility; treated as at rest. */
export const POP_REST_S = 0.9;

export function popCurve(age: number): number {
  if (age <= 0 || age >= POP_REST_S) return 0;
  return GAIN * Math.exp(-DECAY * age) * Math.sin(2 * Math.PI * FREQ_HZ * age);
}

/**
 * How hard a word of the given length pops. Very short words (a syllable in
 * a fast run) would otherwise jitter, so they get a gentler pop; long ones
 * are capped at full strength.
 */
export function popStrength(durationSec: number): number {
  return Math.min(1, Math.max(0.45, durationSec / 0.3));
}

/** CSS transform for a word `age` seconds into its pop, or "" at rest. */
export function popTransform(age: number, strength: number): string {
  const p = popCurve(age) * strength;
  if (p === 0) return "";
  // Squash and stretch: taller and narrower on the way up, shorter and
  // wider on the undershoot.
  const sx = 1 - 0.08 * p;
  const sy = 1 + 0.18 * p;
  const lift = -0.2 * p;
  return `translate3d(0, ${lift.toFixed(3)}em, 0) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`;
}
