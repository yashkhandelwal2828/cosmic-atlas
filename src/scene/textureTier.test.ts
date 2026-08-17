import { describe, expect, it } from 'vitest'
import {
  alwaysVisibleUpgradeJobs,
  companionCeiling,
  minTier,
  selectTextureCeiling,
  tierForKey,
  upgradeJobsFor,
  type TextureDeviceCaps,
} from './textureTier'

/** Workstation: discrete GPU, plenty of everything. */
const DESKTOP: TextureDeviceCaps = {
  isWebGL2: true,
  maxTextureSize: 16384,
  hardwareConcurrency: 16,
  deviceMemory: 8,
  coarsePointer: false,
  frugalNetwork: false,
}

/**
 * 13" MacBook Air on Safari, which does not implement `navigator.deviceMemory`
 * — so the policy has only the core count to go on. This is the machine the
 * whole tiering exists for.
 */
const MACBOOK_AIR: TextureDeviceCaps = {
  isWebGL2: true,
  maxTextureSize: 16384,
  hardwareConcurrency: 8,
  deviceMemory: 0,
  coarsePointer: false,
  frugalNetwork: false,
}

/**
 * The same class of machine on Chrome: an M4 Air with 16 GB, which reports
 * `deviceMemory: 8` because the spec caps the value there. Measured on exactly
 * this hardware, the 8K set costs 100-550 ms stalls a few seconds after the
 * intro hands over — so a report of 8 must not be read as "roomy".
 */
const MACBOOK_AIR_CHROME: TextureDeviceCaps = {
  isWebGL2: true,
  maxTextureSize: 16384,
  hardwareConcurrency: 10,
  deviceMemory: 8,
  coarsePointer: false,
  frugalNetwork: false,
}

/** Recent phone: WebGL2, a 4096 texture ceiling, touch input. */
const PHONE: TextureDeviceCaps = {
  isWebGL2: true,
  maxTextureSize: 4096,
  hardwareConcurrency: 6,
  deviceMemory: 4,
  coarsePointer: true,
  frugalNetwork: false,
}

describe('selectTextureCeiling', () => {
  it('gives a workstation the native maps', () => {
    expect(selectTextureCeiling(DESKTOP)).toBe('hi')
  })

  it('holds an integrated-GPU laptop at 4K', () => {
    expect(selectTextureCeiling(MACBOOK_AIR)).toBe('mid')
  })

  it('is not fooled by the deviceMemory cap of 8 on a 16 GB laptop', () => {
    expect(selectTextureCeiling(MACBOOK_AIR_CHROME)).toBe('mid')
  })

  it('never sends 8K maps to a phone', () => {
    expect(selectTextureCeiling(PHONE)).toBe('lo')
  })

  it('keeps a touch device at 2K even when it reports desktop-class specs', () => {
    // A tablet can report a 16384 ceiling and eight cores and still have a
    // fraction of the memory. Touch is the signal that outranks the rest.
    expect(
      selectTextureCeiling({ ...DESKTOP, coarsePointer: true }),
    ).toBe('lo')
  })

  it('falls to 2K when the GPU cannot hold an 8K map at all', () => {
    // Below 8192 the driver would make three rescale the image on the main
    // thread, which costs more than the upload it replaces.
    expect(selectTextureCeiling({ ...DESKTOP, maxTextureSize: 4096 })).toBe('lo')
  })

  it('falls to 2K without WebGL2', () => {
    expect(selectTextureCeiling({ ...DESKTOP, isWebGL2: false })).toBe('lo')
  })

  it('respects Data Saver and slow connections', () => {
    expect(selectTextureCeiling({ ...DESKTOP, frugalNetwork: true })).toBe('lo')
  })

  it('believes a small reported memory over a high core count', () => {
    expect(
      selectTextureCeiling({ ...DESKTOP, deviceMemory: 4 }),
    ).toBe('mid')
  })

  it('promotes on core count, reported memory or not', () => {
    expect(
      selectTextureCeiling({ ...MACBOOK_AIR, hardwareConcurrency: 16 }),
    ).toBe('hi')
    expect(
      selectTextureCeiling({ ...MACBOOK_AIR_CHROME, hardwareConcurrency: 12 }),
    ).toBe('hi')
  })

  it('stops at 4K when the GPU ceiling is exactly 8192', () => {
    expect(selectTextureCeiling({ ...DESKTOP, maxTextureSize: 8192 })).toBe('mid')
  })
})

describe('companionCeiling', () => {
  it('holds modifier maps a tier below a native-resolution device', () => {
    expect(companionCeiling('hi')).toBe('mid')
  })

  it('does not raise them above the ceiling', () => {
    expect(companionCeiling('mid')).toBe('mid')
    expect(companionCeiling('lo')).toBe('lo')
  })
})

describe('minTier', () => {
  it('picks the lower of two tiers either way round', () => {
    expect(minTier('hi', 'lo')).toBe('lo')
    expect(minTier('lo', 'hi')).toBe('lo')
    expect(minTier('mid', 'mid')).toBe('mid')
  })
})

describe('tierForKey', () => {
  it('gives surfaces the full ceiling', () => {
    expect(tierForKey('earth', 'hi')).toBe('hi')
    // City lights are a surface a viewer reads directly, not a modifier.
    expect(tierForKey('earth_night', 'hi')).toBe('hi')
  })

  it('holds cloud, normal and specular data one step back', () => {
    expect(tierForKey('earth_clouds', 'hi')).toBe('mid')
    expect(tierForKey('earth_normal', 'hi')).toBe('mid')
    expect(tierForKey('earth_specular', 'hi')).toBe('mid')
    expect(tierForKey('mars_normal', 'hi')).toBe('mid')
    expect(tierForKey('saturn_ring', 'hi')).toBe('mid')
    expect(tierForKey('venus_atmosphere', 'hi')).toBe('mid')
  })
})

describe('upgradeJobsFor', () => {
  it('covers every map a body samples', () => {
    const jobs = upgradeJobsFor('earth', 'hi')
    expect(jobs.map((j) => j.key)).toEqual([
      'earth',
      'earth_night',
      'earth_clouds',
      'earth_normal',
      'earth_specular',
    ])
    expect(jobs.map((j) => j.res)).toEqual(['hi', 'hi', 'mid', 'mid', 'mid'])
  })

  it('is empty at the 2K ceiling, where every map already sits', () => {
    expect(upgradeJobsFor('earth', 'lo')).toEqual([])
    expect(alwaysVisibleUpgradeJobs('lo')).toEqual([])
  })

  it('emits nothing for a body with no companion maps beyond its albedo', () => {
    expect(upgradeJobsFor('jupiter', 'mid')).toEqual([
      { key: 'jupiter', res: 'mid' },
    ])
  })

  it('queues the sky and the star, which are on screen from anywhere', () => {
    expect(alwaysVisibleUpgradeJobs('mid')).toEqual([
      { key: 'stars', res: 'mid' },
      { key: 'sun', res: 'mid' },
    ])
  })
})
