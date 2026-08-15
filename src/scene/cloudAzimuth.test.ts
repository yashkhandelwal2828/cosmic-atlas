import { describe, expect, it } from 'vitest'
import { ROTATIONS } from '../data/orbitalElements'
import { J2000_EPOCH_MS, spinAngleDeg } from './orbitalMechanics'
import {
  EARTH_CLOUD_SPIN_RATIO,
  VENUS_CLOUD_PERIOD_DAYS,
  cloudAzimuthDeg,
} from './cloudAzimuth'
import {
  advanceSimTime,
  createSimTime,
  setPlaying,
} from '../state/simTime'

const SAMPLE_MS = Date.UTC(2026, 7, 13, 0, 0, 0)

describe('cloud azimuth', () => {
  it('Earth clouds lead the surface by 8 percent', () => {
    expect(EARTH_CLOUD_SPIN_RATIO).toBe(1.08)
    expect(cloudAzimuthDeg('earth', SAMPLE_MS)).toBeCloseTo(
      spinAngleDeg(ROTATIONS.earth, SAMPLE_MS) * 1.08,
      10,
    )
  })

  it('Venus clouds use the observed ~4.05-day retrograde super-rotation', () => {
    expect(VENUS_CLOUD_PERIOD_DAYS).toBeCloseTo(-4.05, 10)
    const t0 = J2000_EPOCH_MS
    const t1 = t0 + 86_400_000
    const cloudDelta = cloudAzimuthDeg('venus', t1) - cloudAzimuthDeg('venus', t0)
    const surfaceDelta =
      spinAngleDeg(ROTATIONS.venus, t1) - spinAngleDeg(ROTATIONS.venus, t0)
    expect(cloudDelta).toBeLessThan(0)
    expect(Math.abs(cloudDelta)).toBeGreaterThan(Math.abs(surfaceDelta))
    expect(cloudDelta).toBeCloseTo(360 / VENUS_CLOUD_PERIOD_DAYS, 5)
    expect(cloudAzimuthDeg('venus', SAMPLE_MS)).not.toBeCloseTo(
      spinAngleDeg(ROTATIONS.venus, SAMPLE_MS) * 1.08,
      1,
    )
  })

  it('advancing simulated time changes the cloud azimuth', () => {
    const later = SAMPLE_MS + 86_400_000
    expect(cloudAzimuthDeg('earth', later)).not.toBe(
      cloudAzimuthDeg('earth', SAMPLE_MS),
    )
    expect(cloudAzimuthDeg('venus', later)).not.toBe(
      cloudAzimuthDeg('venus', SAMPLE_MS),
    )
  })

  it('a paused / frozen epoch does not change the cloud azimuth', () => {
    const paused = createSimTime(SAMPLE_MS)
    expect(paused.playing).toBe(false)
    const next = advanceSimTime(paused, 10)
    expect(next.epochMs).toBe(SAMPLE_MS)
    expect(cloudAzimuthDeg('earth', next.epochMs)).toBe(
      cloudAzimuthDeg('earth', SAMPLE_MS),
    )
    expect(cloudAzimuthDeg('venus', next.epochMs)).toBe(
      cloudAzimuthDeg('venus', SAMPLE_MS),
    )

    const stillPaused = setPlaying(paused, false)
    expect(advanceSimTime(stillPaused, 60).epochMs).toBe(SAMPLE_MS)
  })
})
