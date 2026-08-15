/**
 * Ballistic launch paths — pure. No Three.js types so this is testable in jsdom.
 *
 * Every body flies from the singularity at the scene origin to its TRUE
 * ephemeris position. The target is re-read from the live ephemeris on every
 * frame rather than sampled once at launch, so a planet that drifts during the
 * 2.25s flight still lands exactly on its own orbit line. Two invariants make
 * that safe, and both are covered by tests:
 *
 *   t = 0  ->  exactly the origin
 *   t = 1  ->  exactly the target, with zero lateral offset
 *
 * The second one is why the arc term is `sin(pi * t)`: it vanishes at both ends,
 * so there is never a snap when the override is handed back to the ephemeris.
 */

export interface Vec3 {
  x: number
  y: number
  z: number
}

/** Seconds of stagger between the first body launched and the last. */
export const LAUNCH_STAGGER = 0.85

/**
 * Flight time for the innermost body. Chosen with LAUNCH_EXTRA_DURATION so that
 * `launchPhaseDuration()` lands exactly on the width of the timeline's `launch`
 * phase — the last body touches down as the phase ends. A test locks that.
 */
export const LAUNCH_BASE_DURATION = 1.0

/** Extra flight time added at the outermost radius. */
export const LAUNCH_EXTRA_DURATION = 0.4

/**
 * Stagger curve. Sub-linear so the inner four planets — which are bunched into
 * the first fifth of the radius range — still read as separate departures.
 */
const STAGGER_EXPONENT = 0.6

/** Lateral bow at mid-flight, as a fraction of the target distance. */
const ARC_AMOUNT = 0.26

/** Fraction of the flight over which a body swells from a point to full size. */
const SCALE_RAMP = 0.55

export interface LaunchTiming {
  /** Seconds after the launch phase opens before this body departs. */
  delay: number
  /** Seconds of flight. */
  duration: number
}

/**
 * @param normalizedRadius 0 for the innermost body, 1 for the outermost.
 */
export function launchTiming(normalizedRadius: number): LaunchTiming {
  const r = clamp01(normalizedRadius)
  return {
    delay: Math.pow(r, STAGGER_EXPONENT) * LAUNCH_STAGGER,
    duration: LAUNCH_BASE_DURATION + r * LAUNCH_EXTRA_DURATION,
  }
}

/** Total launch-phase time needed by the slowest body. */
export function launchPhaseDuration(): number {
  const last = launchTiming(1)
  return last.delay + last.duration
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function easeOutExpo(t: number): number {
  const x = clamp01(t)
  return x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)
}

function smootherstep(t: number): number {
  const x = clamp01(t)
  return x * x * x * (x * (x * 6 - 15) + 10)
}

const UP: Vec3 = { x: 0, y: 1, z: 0 }
const FALLBACK_AXIS: Vec3 = { x: 1, y: 0, z: 0 }

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z)
}

function normalize(v: Vec3, fallback: Vec3): Vec3 {
  const len = length(v)
  if (len < 1e-9) return fallback
  return { x: v.x / len, y: v.y / len, z: v.z / len }
}

/**
 * Position along the launch arc.
 *
 * @param target where the body must end up (live ephemeris position)
 * @param t      0..1 flight progress
 * @param seed   rotates the bow around the launch axis so nine bodies do not
 *               all curve through the same plane
 */
export function launchPositionAt(
  target: Vec3,
  t: number,
  seed: number,
  out: Vec3 = { x: 0, y: 0, z: 0 },
): Vec3 {
  const p = clamp01(t)
  const radial = easeOutExpo(p)

  out.x = target.x * radial
  out.y = target.y * radial
  out.z = target.z * radial

  const bow = Math.sin(Math.PI * p)
  if (bow <= 0) return out

  // Two axes perpendicular to the flight line, so the bow can point anywhere on
  // the plane normal to it rather than always toward scene up.
  const axis1 = normalize(cross(target, UP), FALLBACK_AXIS)
  const axis2 = normalize(cross(target, axis1), UP)
  const angle = seed * Math.PI * 2
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const reach = bow * ARC_AMOUNT * length(target)

  out.x += (axis1.x * c + axis2.x * s) * reach
  out.y += (axis1.y * c + axis2.y * s) * reach
  out.z += (axis1.z * c + axis2.z * s) * reach
  return out
}

/** Body scale during flight: a point of light that swells into a world. */
export function launchScaleAt(t: number): number {
  return smootherstep(clamp01(t) / SCALE_RAMP)
}

/**
 * Speed proxy in 0..1, used to drive radial motion blur and trail brightness.
 * Peaks at departure and decays with the same expo the position uses.
 */
export function launchSpeedAt(t: number): number {
  const p = clamp01(t)
  if (p >= 1) return 0
  return Math.pow(2, -10 * p)
}

/**
 * Deterministic 0..1 from a string. Bodies must bow the same way on every load —
 * a random seed would make the intro flicker between reloads.
 */
export function seedFromId(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 10000) / 10000
}
