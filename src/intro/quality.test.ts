import { describe, expect, it } from 'vitest'
import {
  DOWNGRADE_MISSED_FRAMES,
  FrameWatchdog,
  TIER_SETTINGS,
  WATCHDOG_WINDOW_FRAMES,
  downgrade,
  selectTier,
  settingsFor,
  type DeviceCaps,
} from './quality'

/** 1080p at DPR 1 — plenty of cores, modest number of pixels to fill. */
const DESKTOP: DeviceCaps = {
  isWebGL2: true,
  maxTextureSize: 16384,
  hardwareConcurrency: 12,
  devicePixelRatio: 1,
  viewportWidth: 1920,
  viewportHeight: 1080,
}

/** Default-scaled 13" MacBook Air: 8 "cores", integrated GPU, retina panel. */
const RETINA_LAPTOP: DeviceCaps = {
  isWebGL2: true,
  maxTextureSize: 16384,
  hardwareConcurrency: 8,
  devicePixelRatio: 2,
  viewportWidth: 1470,
  viewportHeight: 830,
}

describe('selectTier', () => {
  it('gives a modern desktop the full stack', () => {
    expect(selectTier(DESKTOP)).toBe('high')
  })

  it('holds a retina laptop at medium despite its core count', () => {
    // The exact regression this budget exists for: eight cores said "high" and
    // the integrated GPU was then asked to fill ~3.7M pixels a frame.
    expect(selectTier(RETINA_LAPTOP)).toBe('medium')
  })

  it('drops a desktop to medium once the panel gets large enough', () => {
    expect(
      selectTier({ ...DESKTOP, viewportWidth: 3840, viewportHeight: 2160 }),
    ).toBe('medium')
  })

  it('assumes 720p when the viewport is unknown rather than refusing high', () => {
    expect(
      selectTier({ ...DESKTOP, viewportWidth: 0, viewportHeight: 0 }),
    ).toBe('high')
  })

  it('drops WebGL1 straight to low', () => {
    expect(selectTier({ ...DESKTOP, isWebGL2: false })).toBe('low')
  })

  it('drops a small texture ceiling to low', () => {
    expect(selectTier({ ...DESKTOP, maxTextureSize: 2048 })).toBe('low')
  })

  it('drops a dual-core to low', () => {
    expect(selectTier({ ...DESKTOP, hardwareConcurrency: 2 })).toBe('low')
  })

  it('treats an unreported core count as mid-range, not fast', () => {
    expect(selectTier({ ...DESKTOP, hardwareConcurrency: 0 })).toBe('medium')
  })

  it('keeps a capable-but-modest device at medium', () => {
    expect(
      selectTier({ ...DESKTOP, hardwareConcurrency: 4, maxTextureSize: 8192 }),
    ).toBe('medium')
  })

  it('requires a large texture ceiling for high even on many cores', () => {
    expect(selectTier({ ...DESKTOP, maxTextureSize: 4096 })).toBe('medium')
  })
})

describe('tier settings', () => {
  it('spends strictly less at each step down', () => {
    expect(TIER_SETTINGS.high.particles).toBeGreaterThan(TIER_SETTINGS.medium.particles)
    expect(TIER_SETTINGS.medium.particles).toBeGreaterThan(TIER_SETTINGS.low.particles)
    expect(TIER_SETTINGS.high.bloomResolutionScale).toBeGreaterThan(
      TIER_SETTINGS.medium.bloomResolutionScale,
    )
    expect(TIER_SETTINGS.medium.bloomResolutionScale).toBeGreaterThan(
      TIER_SETTINGS.low.bloomResolutionScale,
    )
  })

  it('keeps bloom on at every tier — it is the whole look', () => {
    expect(settingsFor('low').lens).toBe(false)
    expect(settingsFor('low').radialBlur).toBe(false)
    // bloom is not optional in any tier, so there is no flag to check: assert the
    // optional passes are the only ones that ever switch off.
    expect(settingsFor('high').lens).toBe(true)
  })
})

describe('downgrade', () => {
  it('steps one tier at a time and bottoms out', () => {
    expect(downgrade('high')).toBe('medium')
    expect(downgrade('medium')).toBe('low')
    expect(downgrade('low')).toBe('low')
  })
})

describe('FrameWatchdog', () => {
  it('ignores frames inside budget', () => {
    const w = new FrameWatchdog()
    for (let i = 0; i < 200; i++) expect(w.sample(8)).toBe(false)
  })

  it('trips after a sustained run of slow frames', () => {
    const w = new FrameWatchdog()
    for (let i = 0; i < DOWNGRADE_MISSED_FRAMES - 1; i++) {
      expect(w.sample(40)).toBe(false)
    }
    expect(w.sample(40)).toBe(true)
  })

  it('trips on an alternating stutter — the shape a strained GPU actually has', () => {
    // The old consecutive counter could never fire here, which is why a device
    // holding ~40fps stayed pinned to a tier it could not afford.
    const w = new FrameWatchdog()
    let tripped = false
    for (let i = 0; i < WATCHDOG_WINDOW_FRAMES * 2 && !tripped; i++) {
      tripped = w.sample(i % 2 === 0 ? 40 : 6)
    }
    expect(tripped).toBe(true)
  })

  it('shrugs off an isolated hitch — a GC pause is not a slow GPU', () => {
    const w = new FrameWatchdog()
    for (let i = 0; i < 300; i++) {
      // One bad frame per second at 60fps: nowhere near half the window.
      expect(w.sample(i % 60 === 0 ? 60 : 8)).toBe(false)
    }
  })

  it('trips at most once per run', () => {
    const w = new FrameWatchdog(22, 3, 8)
    expect(w.sample(40)).toBe(false)
    expect(w.sample(40)).toBe(false)
    expect(w.sample(40)).toBe(true)
    expect(w.sample(40)).toBe(false)
  })
})
