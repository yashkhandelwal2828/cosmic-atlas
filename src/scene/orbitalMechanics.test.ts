/**
 * Orbital mechanics contract tests — spec §11.
 * Pure node environment: no three, no DOM.
 */
import { describe, expect, it } from 'vitest'
import {
  MOON_ORBIT,
  ORBITS,
  PLANET_IDS,
  ROTATIONS,
} from '../data/orbitalElements'
import {
  DAYS_PER_CENTURY,
  J2000_EPOCH_MS,
  daysSinceJ2000,
  eclipticToScene,
  elementsAt,
  heliocentricEcliptic,
  julianCenturies,
  moonPositionAU,
  orbitalPeriodDays,
  planetPositionAU,
  sampleOrbitEcliptic,
  solveKepler,
  spinAngleDeg,
  spinAxisScene,
  type Vec3,
} from './orbitalMechanics'

const RAD_TO_DEG = 180 / Math.PI
const OBLIQUITY_RAD = (23.4392911 * Math.PI) / 180

/** Heliocentric ecliptic longitude in 0…360 degrees. */
function eclipticLongitudeDeg(v: Vec3): number {
  const deg = Math.atan2(v.y, v.x) * RAD_TO_DEG
  return ((deg % 360) + 360) % 360
}

/** Shortest angular gap between two longitudes, 0…180 degrees. */
function angularSeparationDeg(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360
  return diff > 180 ? 360 - diff : diff
}

function radius(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z)
}

/** 400 instants spanning 1900-01-01 → 2100-01-01. */
const SAMPLE_DATES: number[] = (() => {
  const start = Date.UTC(1900, 0, 1)
  const end = Date.UTC(2100, 0, 1)
  const dates: number[] = []
  for (let k = 0; k < 400; k++) {
    dates.push(start + ((end - start) * k) / 399)
  }
  return dates
})()

describe('solveKepler', () => {
  it('returns the mean anomaly unchanged for a circular orbit', () => {
    for (const M of [-3, -1.5, -0.25, 0, 0.25, 1.5, 3]) {
      expect(solveKepler(M, 0)).toBe(M)
    }
  })

  it('converges for e = 0.9 with a residual below 1e-10', () => {
    for (let k = 0; k < 720; k++) {
      const M = -Math.PI + (2 * Math.PI * k) / 719
      const E = solveKepler(M, 0.9)
      expect(Math.abs(E - 0.9 * Math.sin(E) - M)).toBeLessThan(1e-10)
    }
  })

  it('still converges at e = 0.95', () => {
    for (let k = 0; k < 360; k++) {
      const M = -Math.PI + (2 * Math.PI * k) / 359
      const E = solveKepler(M, 0.95)
      expect(Number.isFinite(E)).toBe(true)
      expect(Math.abs(E - 0.95 * Math.sin(E) - M)).toBeLessThan(1e-10)
    }
  })
})

describe('heliocentric distances', () => {
  it("keeps Earth's heliocentric distance in 0.980…1.020 AU over 1900–2100", () => {
    for (const unixMs of SAMPLE_DATES) {
      const r = radius(planetPositionAU('earth', unixMs))
      expect(r).toBeGreaterThanOrEqual(0.98)
      expect(r).toBeLessThanOrEqual(1.02)
    }
  })

  it('respects per-planet perihelion / aphelion bounds', () => {
    for (const id of PLANET_IDS) {
      for (const unixMs of SAMPLE_DATES) {
        const el = elementsAt(ORBITS[id], julianCenturies(unixMs))
        const r = radius(heliocentricEcliptic(el))
        expect(r).toBeGreaterThanOrEqual(el.a * (1 - el.e) - 0.01)
        expect(r).toBeLessThanOrEqual(el.a * (1 + el.e) + 0.01)
      }
    }
  })
})

describe('heliocentric longitudes', () => {
  it("places Earth within 2 degrees of longitude 100.0 at J2000", () => {
    const lon = eclipticLongitudeDeg(planetPositionAU('earth', J2000_EPOCH_MS))
    expect(angularSeparationDeg(lon, 100.0)).toBeLessThan(2)
  })

  it('returns each planet to its longitude after one orbital period', () => {
    const T = 0.26
    for (const id of PLANET_IDS) {
      const set = ORBITS[id]
      const el = elementsAt(set, T)
      // Frozen elements: only the mean longitude advances, by exactly the
      // mean-motion change over one Keplerian period. Isolates the solve.
      const periodCenturies = orbitalPeriodDays(el.a) / DAYS_PER_CENTURY
      const advanced = { ...el, L: el.L + set.rates.L * periodCenturies }
      const before = eclipticLongitudeDeg(heliocentricEcliptic(el))
      const after = eclipticLongitudeDeg(heliocentricEcliptic(advanced))
      expect(angularSeparationDeg(before, after)).toBeLessThan(2)
    }
  })

  it('matches Horizons EMB Earth on 2026-08-13 00:00', () => {
    const pos = planetPositionAU('earth', Date.UTC(2026, 7, 13, 0, 0, 0))
    expect(angularSeparationDeg(eclipticLongitudeDeg(pos), 319.9187)).toBeLessThan(
      0.05,
    )
    expect(Math.abs(radius(pos) - 1.013217)).toBeLessThan(2e-4)
  })

  it('matches Horizons Mercury on 2026-08-13 00:00', () => {
    const pos = planetPositionAU('mercury', Date.UTC(2026, 7, 13, 0, 0, 0))
    expect(angularSeparationDeg(eclipticLongitudeDeg(pos), 68.58)).toBeLessThan(0.1)
  })

  it('scatters the eight planets around the Sun on 2026-08-13', () => {
    const unixMs = Date.UTC(2026, 7, 13, 0, 0, 0)
    const lons = PLANET_IDS.map((id) =>
      eclipticLongitudeDeg(planetPositionAU(id, unixMs)),
    )

    let minSeparation = Infinity
    for (let a = 0; a < lons.length; a++) {
      for (let b = a + 1; b < lons.length; b++) {
        minSeparation = Math.min(
          minSeparation,
          angularSeparationDeg(lons[a], lons[b]),
        )
      }
    }
    expect(minSeparation).toBeGreaterThan(1)

    const ascending = lons.every((lon, k) => k === 0 || lons[k - 1] <= lon)
    const descending = lons.every((lon, k) => k === 0 || lons[k - 1] >= lon)
    expect(ascending).toBe(false)
    expect(descending).toBe(false)
  })
})

describe('frame conversions', () => {
  it('maps ecliptic axes to scene axes right-handedly', () => {
    expect(eclipticToScene({ x: 1, y: 0, z: 0 })).toEqual({ x: 1, y: 0, z: -0 })
    expect(eclipticToScene({ x: 0, y: 1, z: 0 })).toEqual({ x: 0, y: 0, z: -1 })
    expect(eclipticToScene({ x: 0, y: 0, z: 1 })).toEqual({ x: 0, y: 1, z: -0 })
  })

  it("tilts Earth's spin axis by the obliquity of the ecliptic", () => {
    const axis = spinAxisScene(0, 90)
    expect(axis.x).toBeCloseTo(0, 12)
    // Exact identity first; the spec's 0.9175 / −0.3977 are rounded displays.
    expect(axis.y).toBeCloseTo(Math.cos(OBLIQUITY_RAD), 12)
    expect(axis.z).toBeCloseTo(-Math.sin(OBLIQUITY_RAD), 12)
    expect(axis.y).toBeCloseTo(0.9175, 3)
    expect(axis.z).toBeCloseTo(-0.3977, 3)
  })
})

describe('spinAngleDeg', () => {
  const later = J2000_EPOCH_MS + 86400000 * 10

  it('advances prograde for Earth', () => {
    expect(spinAngleDeg(ROTATIONS.earth, later)).toBeGreaterThan(
      spinAngleDeg(ROTATIONS.earth, J2000_EPOCH_MS),
    )
  })

  it('runs backwards for Venus and Uranus', () => {
    for (const id of ['venus', 'uranus'] as const) {
      expect(spinAngleDeg(ROTATIONS[id], later)).toBeLessThan(
        spinAngleDeg(ROTATIONS[id], J2000_EPOCH_MS),
      )
    }
  })

  it('starts at w0 and matches the published daily rate', () => {
    expect(spinAngleDeg(ROTATIONS.earth, J2000_EPOCH_MS)).toBe(
      ROTATIONS.earth.w0,
    )
    expect(daysSinceJ2000(J2000_EPOCH_MS)).toBe(0)
    const oneDay = J2000_EPOCH_MS + 86400000
    expect(
      spinAngleDeg(ROTATIONS.earth, oneDay) - ROTATIONS.earth.w0,
    ).toBeCloseTo(360.9856, 3)
    expect(
      spinAngleDeg(ROTATIONS.uranus, oneDay) - ROTATIONS.uranus.w0,
    ).toBeCloseTo(-501.16, 2)
  })
})

describe('moon geocentric orbit', () => {
  it('stays between perigee and apogee over 1900–2100', () => {
    for (const unixMs of SAMPLE_DATES) {
      const el = elementsAt(MOON_ORBIT, julianCenturies(unixMs))
      const r = radius(moonPositionAU(unixMs))
      expect(r).toBeGreaterThanOrEqual(el.a * (1 - el.e) - 1e-9)
      expect(r).toBeLessThanOrEqual(el.a * (1 + el.e) + 1e-9)
    }
  })

  it('places the Moon near mean longitude 218° at J2000', () => {
    const lon = eclipticLongitudeDeg(moonPositionAU(J2000_EPOCH_MS))
    // True longitude is mean + equation of center (~4.5° at this M).
    expect(angularSeparationDeg(lon, 222.8)).toBeLessThan(1.5)
  })

  it('returns after one sidereal month on frozen elements', () => {
    const el = elementsAt(MOON_ORBIT, 0)
    const periodCenturies = 27.321661 / DAYS_PER_CENTURY
    const advanced = { ...el, L: el.L + MOON_ORBIT.rates.L * periodCenturies }
    const before = eclipticLongitudeDeg(heliocentricEcliptic(el))
    const after = eclipticLongitudeDeg(heliocentricEcliptic(advanced))
    expect(angularSeparationDeg(before, after)).toBeLessThan(2)
  })

  it('spins prograde at the IAU 13.176 °/day rate (tidal lock)', () => {
    const oneDay = J2000_EPOCH_MS + 86400000
    expect(spinAngleDeg(ROTATIONS.moon, J2000_EPOCH_MS)).toBe(ROTATIONS.moon.w0)
    expect(
      spinAngleDeg(ROTATIONS.moon, oneDay) - ROTATIONS.moon.w0,
    ).toBeCloseTo(13.17635815, 5)
    expect(ROTATIONS.moon.siderealPeriodHours).toBeCloseTo(27.321661 * 24, 4)
  })

  it('is not a heliocentric planet', () => {
    expect(PLANET_IDS.includes('moon' as (typeof PLANET_IDS)[number])).toBe(
      false,
    )
    expect(ORBITS).not.toHaveProperty('moon')
  })
})

describe('sampleOrbitEcliptic', () => {
  it('sweeps eccentric anomaly and stays on the ellipse', () => {
    const segments = 64
    const points = sampleOrbitEcliptic(ORBITS.mercury, 0, segments)
    expect(points).toHaveLength(segments)

    const el = elementsAt(ORBITS.mercury, 0)
    for (const p of points) {
      const r = radius(p)
      expect(r).toBeGreaterThanOrEqual(el.a * (1 - el.e) - 1e-9)
      expect(r).toBeLessThanOrEqual(el.a * (1 + el.e) + 1e-9)
    }
    // Eccentric-anomaly sweep starts at perihelion and reaches aphelion halfway.
    expect(radius(points[0])).toBeCloseTo(el.a * (1 - el.e), 10)
    expect(radius(points[segments / 2])).toBeCloseTo(el.a * (1 + el.e), 10)
  })
})
