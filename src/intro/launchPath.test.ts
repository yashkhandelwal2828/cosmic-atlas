import { describe, expect, it } from 'vitest'
import {
  LAUNCH_STAGGER,
  launchPhaseDuration,
  launchPositionAt,
  launchScaleAt,
  launchSpeedAt,
  launchTiming,
  seedFromId,
  type Vec3,
} from './launchPath'
import { spanOf } from './timeline'

const TARGET: Vec3 = { x: 12.4, y: 0.8, z: -31.7 }

function len(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z)
}

describe('launchPositionAt', () => {
  it('starts exactly at the origin', () => {
    const p = launchPositionAt(TARGET, 0, 0.3)
    // Signed zero is fine here (target.z is negative, so z scales to -0).
    expect(len(p)).toBe(0)
  })

  it('lands exactly on the target — no lateral residue to snap away', () => {
    const p = launchPositionAt(TARGET, 1, 0.77)
    expect(p.x).toBeCloseTo(TARGET.x, 12)
    expect(p.y).toBeCloseTo(TARGET.y, 12)
    expect(p.z).toBeCloseTo(TARGET.z, 12)
  })

  it('lands on target for every seed', () => {
    for (let seed = 0; seed <= 1; seed += 0.1) {
      const p = launchPositionAt(TARGET, 1, seed)
      expect(len({ x: p.x - TARGET.x, y: p.y - TARGET.y, z: p.z - TARGET.z })).toBeLessThan(1e-9)
    }
  })

  it('bows off the straight line at mid-flight', () => {
    const mid = launchPositionAt(TARGET, 0.5, 0.25)
    // Distance from the point to the origin->target line must be non-zero.
    const tLen = len(TARGET)
    const unit = { x: TARGET.x / tLen, y: TARGET.y / tLen, z: TARGET.z / tLen }
    const along = mid.x * unit.x + mid.y * unit.y + mid.z * unit.z
    const perp = {
      x: mid.x - unit.x * along,
      y: mid.y - unit.y * along,
      z: mid.z - unit.z * along,
    }
    expect(len(perp)).toBeGreaterThan(tLen * 0.05)
  })

  it('moves monotonically outward in radius', () => {
    let previous = -1
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const along = launchPositionAt(TARGET, t, 0.5)
      const tLen = len(TARGET)
      const radial =
        (along.x * TARGET.x + along.y * TARGET.y + along.z * TARGET.z) / tLen
      expect(radial).toBeGreaterThanOrEqual(previous - 1e-9)
      previous = radial
    }
  })

  it('survives a degenerate target at the origin', () => {
    const p = launchPositionAt({ x: 0, y: 0, z: 0 }, 0.5, 0.5)
    expect(Number.isFinite(p.x)).toBe(true)
    expect(Number.isFinite(p.y)).toBe(true)
    expect(Number.isFinite(p.z)).toBe(true)
  })

  it('writes into a supplied out object instead of allocating', () => {
    const out: Vec3 = { x: 9, y: 9, z: 9 }
    const returned = launchPositionAt(TARGET, 1, 0.1, out)
    expect(returned).toBe(out)
    expect(out.x).toBeCloseTo(TARGET.x, 12)
  })
})

describe('launchTiming', () => {
  it('sends the innermost body first with no delay', () => {
    expect(launchTiming(0).delay).toBe(0)
  })

  it('staggers outward bodies later', () => {
    expect(launchTiming(1).delay).toBeGreaterThan(launchTiming(0.5).delay)
    expect(launchTiming(0.5).delay).toBeGreaterThan(launchTiming(0).delay)
    expect(launchTiming(1).delay).toBeCloseTo(LAUNCH_STAGGER, 10)
  })

  it('gives outer bodies a longer flight', () => {
    expect(launchTiming(1).duration).toBeGreaterThan(launchTiming(0).duration)
  })

  it('clamps out-of-range radii', () => {
    expect(launchTiming(-1).delay).toBe(0)
    expect(launchTiming(3).delay).toBeCloseTo(launchTiming(1).delay, 10)
  })

  it('reports a phase duration that covers the last arrival', () => {
    const last = launchTiming(1)
    expect(launchPhaseDuration()).toBeCloseTo(last.delay + last.duration, 10)
  })

  it('fits the timeline launch phase exactly — the last body lands on the beat', () => {
    const launch = spanOf('launch')
    expect(launchPhaseDuration()).toBeCloseTo(launch.end - launch.start, 10)
  })
})

describe('launchScaleAt', () => {
  it('starts at zero and is full size before touchdown', () => {
    expect(launchScaleAt(0)).toBe(0)
    expect(launchScaleAt(1)).toBe(1)
    expect(launchScaleAt(0.6)).toBe(1)
  })

  it('is monotonic', () => {
    let previous = -1
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const s = launchScaleAt(t)
      expect(s).toBeGreaterThanOrEqual(previous)
      previous = s
    }
  })
})

describe('launchSpeedAt', () => {
  it('peaks at departure and is zero on arrival', () => {
    expect(launchSpeedAt(0)).toBe(1)
    expect(launchSpeedAt(1)).toBe(0)
  })

  it('decays', () => {
    expect(launchSpeedAt(0.5)).toBeLessThan(launchSpeedAt(0.2))
  })
})

describe('seedFromId', () => {
  it('is stable across calls — the intro must not flicker between reloads', () => {
    expect(seedFromId('jupiter')).toBe(seedFromId('jupiter'))
  })

  it('stays in 0..1', () => {
    for (const id of ['sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']) {
      const s = seedFromId(id)
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThan(1)
    }
  })

  it('separates different ids', () => {
    const seeds = new Set(
      ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'].map(seedFromId),
    )
    expect(seeds.size).toBeGreaterThan(6)
  })
})
