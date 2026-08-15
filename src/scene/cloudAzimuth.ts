/**
 * Cloud-deck azimuth as a function of simulated time.
 * Prime-meridian / cloud yaw must never be driven from the wall clock.
 */
import type { BodyId } from '../data/bodies'
import { ROTATIONS } from '../data/orbitalElements'
import { spinAngleDeg } from './orbitalMechanics'

/** Earth's cloud deck leads the surface by ~8%. Spec: Earth only. */
export const EARTH_CLOUD_SPIN_RATIO = 1.08

/**
 * Observed Venus cloud-deck sidereal period, days.
 * Negative = retrograde, same sense as the 243-day surface.
 */
export const VENUS_CLOUD_PERIOD_DAYS = -4.05

export type CloudDeckId = 'earth' | 'venus'

export function hasCloudDeck(id: BodyId): id is CloudDeckId {
  return id === 'earth' || id === 'venus'
}

/** Cloud-deck prime-meridian angle W in degrees at `unixMs`. */
export function cloudAzimuthDeg(id: CloudDeckId, unixMs: number): number {
  if (id === 'earth') {
    return spinAngleDeg(ROTATIONS.earth, unixMs) * EARTH_CLOUD_SPIN_RATIO
  }
  return spinAngleDeg(
    {
      siderealPeriodHours: VENUS_CLOUD_PERIOD_DAYS * 24,
      w0: ROTATIONS.venus.w0,
    },
    unixMs,
  )
}
