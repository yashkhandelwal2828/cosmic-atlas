/**
 * Pure orbital mechanics — heliocentric ecliptic J2000 Keplerian propagation,
 * frame conversions, and rotation (prime-meridian) angles.
 * No DOM / WebGL / three: positions come back as plain `Vec3` objects so this
 * module stays unit-testable under vitest's node environment.
 */
import type {
  KeplerianElements,
  OrbitalElementSet,
  PlanetId,
} from '../data/orbitalElements'
import { MOON_ORBIT, ORBITS } from '../data/orbitalElements'

export interface Vec3 {
  x: number
  y: number
  z: number
}

/** Unix ms of the J2000.0 epoch (2000-01-01T12:00:00Z). */
export const J2000_EPOCH_MS = Date.UTC(2000, 0, 1, 12, 0, 0)

/** Mean solar days per Julian century. */
export const DAYS_PER_CENTURY = 36525

/** Obliquity of the ecliptic at J2000, degrees. */
const OBLIQUITY_J2000_DEG = 23.4392911

const DEG_TO_RAD = Math.PI / 180
const MS_PER_DAY = 86400000

/** Newton–Raphson iteration cap so the solver can never spin forever. */
const KEPLER_MAX_ITERATIONS = 60

/** Wrap an angle in degrees into −180…180. */
function wrapDeg180(deg: number): number {
  const wrapped = (((deg + 180) % 360) + 360) % 360
  return wrapped - 180
}

/** Julian centuries elapsed since J2000.0 for a Unix-ms timestamp. */
export function julianCenturies(unixMs: number): number {
  return daysSinceJ2000(unixMs) / DAYS_PER_CENTURY
}

/** Days elapsed since J2000.0 for a Unix-ms timestamp. */
export function daysSinceJ2000(unixMs: number): number {
  return (unixMs - J2000_EPOCH_MS) / MS_PER_DAY
}

/** Linear-propagate an element set to time T (Julian centuries past J2000). */
export function elementsAt(
  set: OrbitalElementSet,
  T: number,
): KeplerianElements {
  const { epoch, rates } = set
  return {
    a: epoch.a + rates.a * T,
    e: epoch.e + rates.e * T,
    i: epoch.i + rates.i * T,
    L: epoch.L + rates.L * T,
    lp: epoch.lp + rates.lp * T,
    node: epoch.node + rates.node * T,
  }
}

/**
 * Solve Kepler's equation M = E − e·sin(E) for the eccentric anomaly E.
 * Newton–Raphson. Inputs/outputs in RADIANS. Must converge for e up to 0.95.
 */
export function solveKepler(
  meanAnomalyRad: number,
  e: number,
  tolerance = 1e-12,
): number {
  let E = meanAnomalyRad + e * Math.sin(meanAnomalyRad)
  for (let iteration = 0; iteration < KEPLER_MAX_ITERATIONS; iteration++) {
    const residual = meanAnomalyRad - (E - e * Math.sin(E))
    const step = residual / (1 - e * Math.cos(E))
    E += step
    if (Math.abs(step) <= tolerance) break
  }
  return E
}

/**
 * Rotate a perifocal-plane point (x', y') into the ecliptic J2000 frame using
 * the argument of perihelion ω = ϖ − Ω, the inclination i and the node Ω.
 */
function perifocalToEcliptic(
  el: KeplerianElements,
  xPerifocal: number,
  yPerifocal: number,
): Vec3 {
  const argPeri = (el.lp - el.node) * DEG_TO_RAD
  const node = el.node * DEG_TO_RAD
  const inc = el.i * DEG_TO_RAD
  const cosW = Math.cos(argPeri)
  const sinW = Math.sin(argPeri)
  const cosN = Math.cos(node)
  const sinN = Math.sin(node)
  const cosI = Math.cos(inc)
  const sinI = Math.sin(inc)
  return {
    x:
      (cosW * cosN - sinW * sinN * cosI) * xPerifocal +
      (-sinW * cosN - cosW * sinN * cosI) * yPerifocal,
    y:
      (cosW * sinN + sinW * cosN * cosI) * xPerifocal +
      (-sinW * sinN + cosW * cosN * cosI) * yPerifocal,
    z: sinW * sinI * xPerifocal + cosW * sinI * yPerifocal,
  }
}

/**
 * Heliocentric position in the ecliptic J2000 frame, in AU.
 * Standard chain: M = L − ϖ (wrapped to −180…180) → solve Kepler → perifocal
 * (x', y') → rotate by argument of perihelion (ϖ − Ω), inclination i, then node Ω.
 */
export function heliocentricEcliptic(el: KeplerianElements): Vec3 {
  const meanAnomaly = wrapDeg180(el.L - el.lp) * DEG_TO_RAD
  const E = solveKepler(meanAnomaly, el.e)
  const xPerifocal = el.a * (Math.cos(E) - el.e)
  const yPerifocal = el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(E)
  return perifocalToEcliptic(el, xPerifocal, yPerifocal)
}

/** Convenience: elements → position for a planet at a given wall-clock time. */
export function planetPositionAU(id: PlanetId, unixMs: number): Vec3 {
  return heliocentricEcliptic(elementsAt(ORBITS[id], julianCenturies(unixMs)))
}

/**
 * Geocentric ecliptic J2000 position of the Moon, in AU.
 * Same Kepler chain as the planets; the elements themselves are Earth-centered.
 */
export function moonPositionAU(unixMs: number): Vec3 {
  return heliocentricEcliptic(elementsAt(MOON_ORBIT, julianCenturies(unixMs)))
}

/** Ecliptic-frame vector → three.js scene axes. Pure, allocation-returning. */
export function eclipticToScene(v: Vec3): Vec3 {
  return { x: v.x, y: v.z, z: -v.y }
}

/** Equatorial J2000 unit vector from RA/Dec in degrees. */
export function raDecToEquatorial(raDeg: number, decDeg: number): Vec3 {
  const ra = raDeg * DEG_TO_RAD
  const dec = decDeg * DEG_TO_RAD
  const cosDec = Math.cos(dec)
  return {
    x: cosDec * Math.cos(ra),
    y: cosDec * Math.sin(ra),
    z: Math.sin(dec),
  }
}

/** Equatorial J2000 → ecliptic J2000. */
export function equatorialToEcliptic(v: Vec3): Vec3 {
  const eps = OBLIQUITY_J2000_DEG * DEG_TO_RAD
  const cosE = Math.cos(eps)
  const sinE = Math.sin(eps)
  return {
    x: v.x,
    y: v.y * cosE + v.z * sinE,
    z: -v.y * sinE + v.z * cosE,
  }
}

/**
 * The body's north spin-axis direction expressed in SCENE axes (unit vector).
 * Chain: raDecToEquatorial → equatorialToEcliptic → eclipticToScene.
 */
export function spinAxisScene(poleRaDeg: number, poleDecDeg: number): Vec3 {
  return eclipticToScene(
    equatorialToEcliptic(raDecToEquatorial(poleRaDeg, poleDecDeg)),
  )
}

/**
 * Prime-meridian angle W in DEGREES at a given time.
 * W = w0 + 360 * daysSinceJ2000 / (siderealPeriodHours / 24)
 * Not normalised — callers may pass it straight to a rotation.
 */
export function spinAngleDeg(
  rotation: { siderealPeriodHours: number; w0: number },
  unixMs: number,
): number {
  const periodDays = rotation.siderealPeriodHours / 24
  return rotation.w0 + (360 * daysSinceJ2000(unixMs)) / periodDays
}

/** Kepler's third law: sidereal period in days for a semi-major axis in AU. */
export function orbitalPeriodDays(aAU: number): number {
  return 365.256898326 * Math.pow(aAU, 1.5)
}

/**
 * Closed ellipse sample for drawing the orbit path, in AU, ecliptic frame.
 * Elements are frozen at time T; the loop is swept over ECCENTRIC anomaly
 * 0…2π in `segments` steps so points bunch correctly near perihelion.
 * Returns `segments` points (caller closes the loop).
 */
export function sampleOrbitEcliptic(
  set: OrbitalElementSet,
  T: number,
  segments: number,
): Vec3[] {
  const el = elementsAt(set, T)
  const semiMinorFactor = Math.sqrt(1 - el.e * el.e)
  const points: Vec3[] = []
  for (let step = 0; step < segments; step++) {
    const E = (step / segments) * Math.PI * 2
    const xPerifocal = el.a * (Math.cos(E) - el.e)
    const yPerifocal = el.a * semiMinorFactor * Math.sin(E)
    points.push(perifocalToEcliptic(el, xPerifocal, yPerifocal))
  }
  return points
}
