import { describe, expect, it } from 'vitest'
import {
  CAMERA_ARC_PEAK,
  LOOK_MIN_RADIUS,
  sampleCameraArc,
  sampleLookTarget,
  type Vec3,
} from './cameraArc'

const EARTH: Vec3 = { x: 9.6, y: 0.1, z: 0.4 }
const JUPITER: Vec3 = { x: -18.2, y: 0.8, z: 12.4 }
const NEPTUNE: Vec3 = { x: 4.2, y: 1.1, z: -48.0 }

function len(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z)
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

function scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s }
}

function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return add(scale(a, 1 - t), scale(b, t))
}

function chordDistance(from: Vec3, to: Vec3): number {
  return len(sub(to, from))
}

/** Perpendicular distance from `p` to the infinite line through `a` → `b`. */
function distanceToLine(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = sub(b, a)
  const ap = sub(p, a)
  const abLen = len(ab)
  if (abLen < 1e-9) return len(ap)
  const along = (ap.x * ab.x + ap.y * ab.y + ap.z * ab.z) / abLen
  const closest = add(a, scale(ab, along / abLen))
  return len(sub(p, closest))
}

describe('sampleCameraArc', () => {
  it('starts exactly at the from pose', () => {
    const p = sampleCameraArc(EARTH, JUPITER, 0)
    expect(p.x).toBeCloseTo(EARTH.x, 12)
    expect(p.y).toBeCloseTo(EARTH.y, 12)
    expect(p.z).toBeCloseTo(EARTH.z, 12)
  })

  it('lands exactly on the to pose — no lateral residue to snap away', () => {
    const p = sampleCameraArc(EARTH, JUPITER, 1)
    expect(p.x).toBeCloseTo(JUPITER.x, 12)
    expect(p.y).toBeCloseTo(JUPITER.y, 12)
    expect(p.z).toBeCloseTo(JUPITER.z, 12)
  })

  it('lands on a live destination that moved after the hop started', () => {
    const p = sampleCameraArc(EARTH, NEPTUNE, 1)
    expect(len(sub(p, NEPTUNE))).toBeLessThan(1e-9)
  })

  it('bows off the straight line at mid-flight', () => {
    const mid = sampleCameraArc(EARTH, JUPITER, 0.5)
    const dist = chordDistance(EARTH, JUPITER)
    expect(distanceToLine(mid, EARTH, JUPITER)).toBeGreaterThan(dist * 0.12)
  })

  it('lifts above the ecliptic at mid-flight so the hop reads as scale, not a subway', () => {
    const mid = sampleCameraArc(EARTH, JUPITER, 0.5)
    const chordMidY = (EARTH.y + JUPITER.y) * 0.5
    expect(mid.y).toBeGreaterThan(chordMidY + 1)
  })

  it('swoops outward from the origin at mid-flight', () => {
    const mid = sampleCameraArc(EARTH, JUPITER, 0.5)
    const chordMid = lerp(EARTH, JUPITER, 0.5)
    expect(len(mid)).toBeGreaterThan(len(chordMid))
  })

  it('vanishes the bow at both ends so t=0 and t=1 stay exact', () => {
    expect(distanceToLine(sampleCameraArc(EARTH, JUPITER, 0), EARTH, JUPITER)).toBeLessThan(1e-9)
    expect(distanceToLine(sampleCameraArc(EARTH, JUPITER, 1), EARTH, JUPITER)).toBeLessThan(1e-9)
  })

  it('still swoops out when traveling inward toward the Sun', () => {
    const mid = sampleCameraArc(JUPITER, EARTH, 0.5)
    const chordMid = lerp(JUPITER, EARTH, 0.5)
    expect(len(mid)).toBeGreaterThan(len(chordMid))
    expect(mid.y).toBeGreaterThan(chordMid.y)
  })

  it('goes over the Sun instead of through it on a chord that crosses the origin', () => {
    const from: Vec3 = { x: 12, y: 0.2, z: 0 }
    const to: Vec3 = { x: -20, y: 0.3, z: 0 }
    const mid = sampleCameraArc(from, to, 0.5)
    expect(Math.abs(mid.x)).toBeLessThan(8)
    expect(mid.y).toBeGreaterThan(2)
    expect(distanceToLine(mid, from, to)).toBeGreaterThan(2)
  })

  it('scales the bow with travel distance', () => {
    const shortTo: Vec3 = { x: EARTH.x + 3, y: EARTH.y, z: EARTH.z + 0.4 }
    const shortMid = sampleCameraArc(EARTH, shortTo, 0.5)
    const longMid = sampleCameraArc(EARTH, NEPTUNE, 0.5)
    expect(distanceToLine(longMid, EARTH, NEPTUNE)).toBeGreaterThan(
      distanceToLine(shortMid, EARTH, shortTo) * 2,
    )
  })

  it('peaks the bow at mid-flight and eases back in', () => {
    const early = distanceToLine(sampleCameraArc(EARTH, JUPITER, 0.2), EARTH, JUPITER)
    const mid = distanceToLine(sampleCameraArc(EARTH, JUPITER, 0.5), EARTH, JUPITER)
    const late = distanceToLine(sampleCameraArc(EARTH, JUPITER, 0.8), EARTH, JUPITER)
    expect(mid).toBeGreaterThan(early)
    expect(mid).toBeGreaterThan(late)
    expect(early).toBeGreaterThan(0)
    expect(late).toBeGreaterThan(0)
  })

  it('survives identical from/to without producing NaN', () => {
    const p = sampleCameraArc(EARTH, EARTH, 0.5)
    expect(Number.isFinite(p.x)).toBe(true)
    expect(Number.isFinite(p.y)).toBe(true)
    expect(Number.isFinite(p.z)).toBe(true)
    expect(len(sub(p, EARTH))).toBeLessThan(1e-9)
  })

  it('survives a near-vertical hop', () => {
    const from: Vec3 = { x: 8, y: 1, z: 2 }
    const to: Vec3 = { x: 8.1, y: 14, z: 2.1 }
    const mid = sampleCameraArc(from, to, 0.5)
    expect(Number.isFinite(mid.x)).toBe(true)
    expect(distanceToLine(mid, from, to)).toBeGreaterThan(0.4)
  })

  it('writes into a supplied out object instead of allocating', () => {
    const out: Vec3 = { x: 9, y: 9, z: 9 }
    const returned = sampleCameraArc(EARTH, JUPITER, 1, out)
    expect(returned).toBe(out)
    expect(out.x).toBeCloseTo(JUPITER.x, 12)
    expect(out.y).toBeCloseTo(JUPITER.y, 12)
    expect(out.z).toBeCloseTo(JUPITER.z, 12)
  })

  it('exposes a peak fraction in a cinematic range', () => {
    expect(CAMERA_ARC_PEAK).toBeGreaterThan(0.2)
    expect(CAMERA_ARC_PEAK).toBeLessThan(0.55)
  })

  it('accepts a smaller peak so the look-at can bow less than the eye', () => {
    const full = sampleCameraArc(EARTH, JUPITER, 0.5)
    const mild = sampleCameraArc(EARTH, JUPITER, 0.5, undefined, CAMERA_ARC_PEAK * 0.35)
    expect(distanceToLine(full, EARTH, JUPITER)).toBeGreaterThan(
      distanceToLine(mild, EARTH, JUPITER),
    )
  })

  it('pulls the eye clear of the Sun on opposite-side hops', () => {
    // Real-ish Earth → Jupiter camera poses from a compressed-mode session:
    // the chord threads the origin, so a lift-only bow still sits on the Sun.
    const from: Vec3 = { x: 1.4, y: 2.2, z: 5.9 }
    const to: Vec3 = { x: -1.23, y: 4.44, z: -14.47 }
    const mid = sampleCameraArc(from, to, 0.5)
    expect(len(mid)).toBeGreaterThan(14)
    expect(mid.y).toBeGreaterThan(8)
  })
})

describe('sampleLookTarget', () => {
  it('starts at from and lands on to', () => {
    const a = sampleLookTarget(EARTH, JUPITER, 0)
    const b = sampleLookTarget(EARTH, JUPITER, 1)
    expect(len(sub(a, EARTH))).toBeLessThan(1e-9)
    expect(len(sub(b, JUPITER))).toBeLessThan(1e-9)
  })

  it('does not look through the Sun on an opposite-side hop', () => {
    const from: Vec3 = { x: 9.6, y: 0.1, z: 0.4 }
    const to: Vec3 = { x: -18.2, y: 0.8, z: 12.4 }
    const mid = sampleLookTarget(from, to, 0.5)
    expect(len(mid)).toBeGreaterThanOrEqual(LOOK_MIN_RADIUS - 1e-6)
    expect(len(lerp(from, to, 0.5))).toBeLessThan(LOOK_MIN_RADIUS)
  })

  it('lifts the look point so the camera looks down at the system', () => {
    const mid = sampleLookTarget(EARTH, JUPITER, 0.5)
    const chordMidY = (EARTH.y + JUPITER.y) * 0.5
    expect(mid.y).toBeGreaterThan(chordMidY)
  })
})
