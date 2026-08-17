/**
 * Camera travel arc — pure. No Three.js types so this is testable in node.
 *
 * A straight lerp from Earth to Jupiter flattens the system into a subway
 * ride. A `sin(πt)` bow that vanishes at both ends keeps the live destination
 * exact (planets move during the hop) while lifting the eye up and outward so
 * the hop reads as crossing a lot of empty space.
 *
 *   t = 0  ->  exactly `from`
 *   t = 1  ->  exactly `to`, with zero lateral offset
 */

export interface Vec3 {
  x: number
  y: number
  z: number
}

/** Peak offset from the chord, as a fraction of travel distance. */
export const CAMERA_ARC_PEAK = 0.34

/**
 * Milder bow for the look-at point — the eye should lift more than the target
 * so the hop looks down at the system instead of staring into the Sun.
 */
export const LOOK_ARC_PEAK = 0.12

/**
 * Look-at points that would pass inside this radius are pushed out, enveloped
 * by the bow, so a hop across the system never aims through the photosphere.
 */
export const LOOK_MIN_RADIUS = 8

/** Chord closest-approach inside this is "through the Sun" and gets extra lift. */
const SUN_HAZARD = 6

/** Mid-flight eye distance we want when the chord threads the Sun. */
const EYE_CLEAR = 14

const UP: Vec3 = { x: 0, y: 1, z: 0 }
const FALLBACK_AXIS: Vec3 = { x: 1, y: 0, z: 0 }

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z)
}

function normalize(v: Vec3, fallback: Vec3): Vec3 {
  const len = length(v)
  if (len < 1e-9) return fallback
  return { x: v.x / len, y: v.y / len, z: v.z / len }
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

/**
 * Direction the camera bows: up out of the ecliptic, and away from the Sun.
 * The chord-parallel component is stripped so the bow cannot arrive early.
 */
function bowDirection(from: Vec3, to: Vec3): Vec3 {
  const chord = normalize(sub(to, from), UP)
  const midX = (from.x + to.x) * 0.5
  const midZ = (from.z + to.z) * 0.5
  const radial = normalize({ x: midX, y: 0, z: midZ }, FALLBACK_AXIS)

  // Mostly lift, some radial push — "swoop slightly out".
  let dir = normalize(
    { x: radial.x * 0.55, y: 1, z: radial.z * 0.55 },
    UP,
  )

  const along = dot(dir, chord)
  dir = normalize(
    {
      x: dir.x - chord.x * along,
      y: dir.y - chord.y * along,
      z: dir.z - chord.z * along,
    },
    UP,
  )

  // Keep the hop above the ecliptic. A downward bow would hide the planets.
  if (dir.y < 0) {
    dir = { x: -dir.x, y: -dir.y, z: -dir.z }
  }
  return dir
}

/** Distance from the origin to the closest point on the from→to segment. */
function originToSegment(from: Vec3, to: Vec3): number {
  const ab = sub(to, from)
  const abLenSq = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z
  if (abLenSq < 1e-12) return length(from)
  const t = clamp01(-(from.x * ab.x + from.y * ab.y + from.z * ab.z) / abLenSq)
  return Math.hypot(
    from.x + ab.x * t,
    from.y + ab.y * t,
    from.z + ab.z * t,
  )
}

/**
 * Position along the camera travel arc.
 *
 * @param from  eye at the start of the hop (frozen)
 * @param to    live destination pose — re-read each frame
 * @param t     0..1 travel progress (already eased by the caller)
 * @param peak  bow height as a fraction of travel distance
 */
export function sampleCameraArc(
  from: Vec3,
  to: Vec3,
  t: number,
  out: Vec3 = { x: 0, y: 0, z: 0 },
  peak: number = CAMERA_ARC_PEAK,
): Vec3 {
  const p = clamp01(t)
  const inv = 1 - p
  out.x = from.x * inv + to.x * p
  out.y = from.y * inv + to.y * p
  out.z = from.z * inv + to.z * p

  const bow = Math.sin(Math.PI * p)
  if (bow <= 0) return out

  const dist = length(sub(to, from))
  if (dist < 1e-9) return out

  const closest = originToSegment(from, to)
  const extra =
    closest < SUN_HAZARD
      ? ((EYE_CLEAR - closest) * peak) / CAMERA_ARC_PEAK
      : 0

  const dir = bowDirection(from, to)
  const reach = bow * (peak * dist + extra)
  out.x += dir.x * reach
  out.y += dir.y * reach
  out.z += dir.z * reach
  return out
}

/**
 * Look-at path for the same hop: a shallower bow that also refuses to pass
 * through the Sun, so mid-flight frames the void instead of the photosphere.
 */
export function sampleLookTarget(
  from: Vec3,
  to: Vec3,
  t: number,
  out: Vec3 = { x: 0, y: 0, z: 0 },
): Vec3 {
  sampleCameraArc(from, to, t, out, LOOK_ARC_PEAK)
  const bow = Math.sin(Math.PI * clamp01(t))
  if (bow <= 0) return out
  const r = length(out)
  if (r < 1e-9 || r >= LOOK_MIN_RADIUS) return out
  const s = 1 + (LOOK_MIN_RADIUS / r - 1) * bow
  out.x *= s
  out.y *= s
  out.z *= s
  return out
}
