/**
 * Pure distance scaling — astronomical units to scene units.
 *
 * Body SIZES are never to scale (a true-scale Earth next to a true-scale orbit
 * would be a sub-pixel dot); only DISTANCES get a mode toggle. `bodies.ts`
 * keeps owning `displayRadius`, this module only ever touches orbits.
 */

export type DistanceMode = 'compressed' | 'true'

/** Scene units for Earth's orbit in compressed mode. */
export const COMPRESSED_UNIT = 9.6
/** Scene units per AU in true-distance mode. */
export const TRUE_UNITS_PER_AU = 12

/** Neptune's semi-major axis in AU — the outermost orbit we draw. */
const OUTERMOST_AU = 30.06992276
/** Headroom past the outermost orbit (aphelion + framing slack). */
const SYSTEM_MARGIN = 1.08

/**
 * Scene units per AU for a body whose semi-major axis is `aAU`.
 *
 * compressed:  sceneRadius(a) = COMPRESSED_UNIT * sqrt(a)
 *              → factor = COMPRESSED_UNIT / sqrt(a)
 *              Each orbit is scaled UNIFORMLY by its own factor, so the ellipse
 *              keeps its true shape, eccentricity, and inclination; only the
 *              spacing between orbits is compressed.
 * true:        factor = TRUE_UNITS_PER_AU for every body.
 */
export function orbitScaleFactor(aAU: number, mode: DistanceMode): number {
  if (mode === 'true') {
    return TRUE_UNITS_PER_AU
  }
  return COMPRESSED_UNIT / Math.sqrt(aAU)
}

/** Outer extent of the system in scene units, for camera framing / far plane. */
export function systemRadius(mode: DistanceMode): number {
  return orbitScaleFactor(OUTERMOST_AU, mode) * OUTERMOST_AU * SYSTEM_MARGIN
}

/** Multiplier applied to the scene Y (out-of-ecliptic) component. 1 = truthful. */
export const INCLINATION_EXAGGERATION = { off: 1, on: 4 } as const

/** Mean lunar distance in AU (384,399 km). */
export const MOON_A_AU = 0.00256955529

/**
 * Educational scene units for the Moon's mean Earth distance.
 * Planet sizes are not to scale, so a true-AU Moon would sit inside Earth's
 * display sphere. This factor keeps the ellipse shape, eccentricity, and
 * inclination truthful — only the Earth–Moon spacing is readable.
 */
export const MOON_DISPLAY_A = 2.4

/** Scene units per AU for the geocentric lunar orbit. Independent of heliocentric mode. */
export function moonOrbitScaleFactor(): number {
  return MOON_DISPLAY_A / MOON_A_AU
}
