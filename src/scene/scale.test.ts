import { describe, expect, it } from 'vitest'
import {
  COMPRESSED_UNIT,
  INCLINATION_EXAGGERATION,
  MOON_A_AU,
  MOON_DISPLAY_A,
  TRUE_UNITS_PER_AU,
  moonOrbitScaleFactor,
  orbitScaleFactor,
  systemRadius,
} from './scale'

/** Semi-major axes in AU (JPL, matching the orbital element table). */
const SEMI_MAJOR_AU: Record<string, number> = {
  mercury: 0.38709927,
  venus: 0.72333566,
  earth: 1.00000261,
  mars: 1.52371034,
  jupiter: 5.202887,
  saturn: 9.53667594,
  uranus: 19.18916464,
  neptune: 30.06992276,
}

/** The hand-tuned spacing the compressed mode has to reproduce (spec §4). */
const COMPRESSED_TABLE: Record<string, number> = {
  mercury: 6.0,
  venus: 8.2,
  earth: 9.6,
  mars: 11.8,
  jupiter: 21.9,
  saturn: 29.6,
  uranus: 42.0,
  neptune: 52.6,
}

describe('distance scale', () => {
  it('compressed factors reproduce the spec table within 0.1 scene units', () => {
    for (const [id, aAU] of Object.entries(SEMI_MAJOR_AU)) {
      const sceneRadius = orbitScaleFactor(aAU, 'compressed') * aAU
      expect(Math.abs(sceneRadius - COMPRESSED_TABLE[id])).toBeLessThan(0.1)
    }
  })

  it('compressed mode places Earth at exactly COMPRESSED_UNIT', () => {
    expect(orbitScaleFactor(1, 'compressed') * 1).toBeCloseTo(COMPRESSED_UNIT, 10)
  })

  it('compresses spacing without reordering the orbits', () => {
    const radii = Object.values(SEMI_MAJOR_AU).map(
      (aAU) => orbitScaleFactor(aAU, 'compressed') * aAU,
    )
    for (let i = 1; i < radii.length; i += 1) {
      expect(radii[i]).toBeGreaterThan(radii[i - 1])
    }
    // Neptune is 78x Mercury in reality, but only ~9x on screen.
    const trueRatio = SEMI_MAJOR_AU.neptune / SEMI_MAJOR_AU.mercury
    const sceneRatio = radii[radii.length - 1] / radii[0]
    expect(sceneRatio).toBeLessThan(trueRatio)
  })

  it('true mode returns TRUE_UNITS_PER_AU for every body', () => {
    for (const aAU of Object.values(SEMI_MAJOR_AU)) {
      expect(orbitScaleFactor(aAU, 'true')).toBe(TRUE_UNITS_PER_AU)
    }
  })

  it('systemRadius is larger in true mode than compressed', () => {
    expect(systemRadius('true')).toBeGreaterThan(systemRadius('compressed'))
  })

  it('systemRadius encloses the outermost orbit in both modes', () => {
    for (const mode of ['compressed', 'true'] as const) {
      const neptune = orbitScaleFactor(SEMI_MAJOR_AU.neptune, mode) * SEMI_MAJOR_AU.neptune
      expect(systemRadius(mode)).toBeGreaterThan(neptune)
    }
  })

  it('exposes an off/on inclination exaggeration pair', () => {
    expect(INCLINATION_EXAGGERATION.off).toBe(1)
    expect(INCLINATION_EXAGGERATION.on).toBeGreaterThan(1)
  })

  it('maps the lunar mean distance onto a readable Earth-centered orbit', () => {
    expect(moonOrbitScaleFactor() * MOON_A_AU).toBeCloseTo(MOON_DISPLAY_A, 10)
    const perigee = MOON_DISPLAY_A * (1 - 0.0549)
    // Earth's display radius is 1.2 scene units; the Moon must sit outside it.
    expect(perigee).toBeGreaterThan(1.6)
    expect(MOON_DISPLAY_A).toBeLessThan(COMPRESSED_UNIT)
  })
})
