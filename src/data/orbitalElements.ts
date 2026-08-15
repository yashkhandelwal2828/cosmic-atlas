/**
 * Pure orbital + rotation data tables — no DOM / WebGL / three.
 * Keplerian elements are the JPL "Approximate Positions of the Major Planets"
 * set (Standish), valid 1800–2050. Rotation models are the IAU/WGCCRE values.
 * Data only: every consumer does its own math.
 */
import type { BodyId } from './bodies'

/** The 8 planets — the Sun sits at the origin; the Moon is geocentric. */
export type PlanetId = Exclude<BodyId, 'sun' | 'moon'>

export const PLANET_IDS: readonly PlanetId[] = [
  'mercury',
  'venus',
  'earth',
  'mars',
  'jupiter',
  'saturn',
  'uranus',
  'neptune',
]

/** Classical Keplerian element set (JPL / Standish convention). */
export interface KeplerianElements {
  /** Semi-major axis, AU */
  a: number
  /** Eccentricity, dimensionless */
  e: number
  /** Inclination to the ecliptic, degrees */
  i: number
  /** Mean longitude L, degrees */
  L: number
  /** Longitude of perihelion ϖ, degrees */
  lp: number
  /** Longitude of ascending node Ω, degrees */
  node: number
}

export interface OrbitalElementSet {
  /** Values at epoch J2000.0 */
  epoch: KeplerianElements
  /** Change per Julian century */
  rates: KeplerianElements
}

/**
 * Elements at J2000.0 and their per-century linear rates.
 * The `earth` row is the Earth–Moon barycentre — intentional and correct here.
 */
export const ORBITS: Record<PlanetId, OrbitalElementSet> = {
  mercury: {
    epoch: {
      a: 0.38709927,
      e: 0.20563593,
      i: 7.00497902,
      L: 252.2503235,
      lp: 77.45779628,
      node: 48.33076593,
    },
    rates: {
      a: 0.00000037,
      e: 0.00001906,
      i: -0.00594749,
      L: 149472.67411175,
      lp: 0.16047689,
      node: -0.12534081,
    },
  },

  venus: {
    epoch: {
      a: 0.72333566,
      e: 0.00677672,
      i: 3.39467605,
      L: 181.9790995,
      lp: 131.60246718,
      node: 76.67984255,
    },
    rates: {
      a: 0.0000039,
      e: -0.00004107,
      i: -0.0007889,
      L: 58517.81538729,
      lp: 0.00268329,
      node: -0.27769418,
    },
  },

  earth: {
    epoch: {
      a: 1.00000261,
      e: 0.01671123,
      i: -0.00001531,
      L: 100.46457166,
      lp: 102.93768193,
      node: 0.0,
    },
    rates: {
      a: 0.00000562,
      e: -0.00004392,
      i: -0.01294668,
      L: 35999.37244981,
      lp: 0.32327364,
      node: 0.0,
    },
  },

  mars: {
    epoch: {
      a: 1.52371034,
      e: 0.0933941,
      i: 1.84969142,
      L: -4.55343205,
      lp: -23.94362959,
      node: 49.55953891,
    },
    rates: {
      a: 0.00001847,
      e: 0.00007882,
      i: -0.00813131,
      L: 19140.30268499,
      lp: 0.44441088,
      node: -0.29257343,
    },
  },

  jupiter: {
    epoch: {
      a: 5.202887,
      e: 0.04838624,
      i: 1.30439695,
      L: 34.39644051,
      lp: 14.72847983,
      node: 100.47390909,
    },
    rates: {
      a: -0.00011607,
      e: -0.00013253,
      i: -0.00183714,
      L: 3034.74612775,
      lp: 0.21252668,
      node: 0.20469106,
    },
  },

  saturn: {
    epoch: {
      a: 9.53667594,
      e: 0.05386179,
      i: 2.48599187,
      L: 49.95424423,
      lp: 92.59887831,
      node: 113.66242448,
    },
    rates: {
      a: -0.0012506,
      e: -0.00050991,
      i: 0.00193609,
      L: 1222.49362201,
      lp: -0.41897216,
      node: -0.28867794,
    },
  },

  uranus: {
    epoch: {
      a: 19.18916464,
      e: 0.04725744,
      i: 0.77263783,
      L: 313.23810451,
      lp: 170.9542763,
      node: 74.01692503,
    },
    rates: {
      a: -0.00196176,
      e: -0.00004397,
      i: -0.00242939,
      L: 428.48202785,
      lp: 0.40805281,
      node: 0.04240589,
    },
  },

  neptune: {
    epoch: {
      a: 30.06992276,
      e: 0.00859048,
      i: 1.77004347,
      L: -55.12002969,
      lp: 44.96476227,
      node: 131.78422574,
    },
    rates: {
      a: 0.00026291,
      e: 0.00005105,
      i: 0.00035372,
      L: 218.45945325,
      lp: -0.32241464,
      node: -0.00508664,
    },
  },
}

/**
 * Mean Keplerian elements of the Moon, referred to the mean ecliptic and
 * equinox of J2000 (Meeus / ELP-derived means). The frame is GEOCENTRIC —
 * add Earth's heliocentric vector to get a solar-system position.
 *
 * L0 = 218.3164477°, M'0 = 134.9633964° → ϖ0 = L − M'.
 * Node regresses in 18.6 yr; perigee advances in 8.85 yr.
 */
export const MOON_ORBIT: OrbitalElementSet = {
  epoch: {
    // 384,399 km / 149,597,870.7 km
    a: 0.00256955529,
    e: 0.0549,
    i: 5.145396,
    L: 218.3164477,
    lp: 83.3530513,
    node: 125.0445479,
  },
  rates: {
    a: 0,
    e: 0,
    i: 0,
    L: 481267.88123421,
    lp: 4069.01372871,
    node: -1934.1362891,
  },
}

export interface RotationModel {
  /**
   * Sidereal rotation period in hours.
   * NEGATIVE means retrograde (Venus, Uranus) — the sign is load-bearing,
   * spin angle is computed as W0 + 360 * days / (periodHours / 24).
   */
  siderealPeriodHours: number
  /** IAU north-pole right ascension at J2000, degrees (equatorial frame) */
  poleRa: number
  /** IAU north-pole declination at J2000, degrees (equatorial frame) */
  poleDec: number
  /** Prime-meridian angle W at J2000, degrees */
  w0: number
  /** Obliquity to its own orbit, degrees — display/education only */
  obliquityToOrbit: number
}

/**
 * Sign check: Earth 360 / (23.9344696 / 24) = +360.9856 °/day,
 * Venus 360 / (-5832.6 / 24) = −1.48136 °/day, Uranus = −501.16 °/day.
 */
export const ROTATIONS: Record<BodyId, RotationModel> = {
  sun: {
    siderealPeriodHours: 609.12,
    poleRa: 286.13,
    poleDec: 63.87,
    w0: 84.176,
    obliquityToOrbit: 7.25,
  },
  mercury: {
    siderealPeriodHours: 1407.6,
    poleRa: 281.0103,
    poleDec: 61.4155,
    w0: 329.5988,
    obliquityToOrbit: 0.034,
  },
  venus: {
    siderealPeriodHours: -5832.6,
    poleRa: 272.76,
    poleDec: 67.16,
    w0: 160.2,
    obliquityToOrbit: 177.36,
  },
  earth: {
    siderealPeriodHours: 23.9344696,
    poleRa: 0.0,
    poleDec: 90.0,
    w0: 190.147,
    obliquityToOrbit: 23.44,
  },
  moon: {
    // IAU/WGCCRE: W = 38.3213 + 13.17635815 d. Period matches the sidereal
    // month, so the near side stays Earth-facing (tidal lock). Eccentricity
    // then produces the real optical libration — do not force a fixed face.
    siderealPeriodHours: 655.719864,
    poleRa: 269.9949,
    poleDec: 66.5392,
    w0: 38.3213,
    obliquityToOrbit: 6.68,
  },
  mars: {
    siderealPeriodHours: 24.6229,
    // IAU/WGCCRE J2000 pole. Verified: the angle between this axis and Mars'
    // own orbit normal is 25.20deg, matching the published 25.19deg obliquity.
    poleRa: 317.68143,
    poleDec: 52.8865,
    w0: 176.63,
    obliquityToOrbit: 25.19,
  },
  jupiter: {
    siderealPeriodHours: 9.925,
    poleRa: 268.057,
    poleDec: 64.495,
    w0: 284.95,
    obliquityToOrbit: 3.13,
  },
  saturn: {
    siderealPeriodHours: 10.656,
    poleRa: 40.589,
    poleDec: 83.537,
    w0: 38.9,
    obliquityToOrbit: 26.73,
  },
  uranus: {
    siderealPeriodHours: -17.24,
    poleRa: 257.311,
    poleDec: -15.175,
    w0: 203.81,
    obliquityToOrbit: 97.77,
  },
  neptune: {
    siderealPeriodHours: 16.11,
    // Neptune's IAU pole carries a periodic term: a0 = 299.36 + 0.70 sin N,
    // d0 = 43.46 - 0.51 cos N, with N = 357.85 + 52.316 T. These are the values
    // evaluated at T = 0, which land the obliquity at 28.34deg vs the published
    // 28.32deg. Using the bare constants instead leaves it 0.5deg short.
    poleRa: 299.3337,
    poleDec: 42.9504,
    w0: 253.198,
    obliquityToOrbit: 28.32,
  },
}
