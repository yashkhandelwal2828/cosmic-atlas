/**
 * Quality tiering — pure. Takes a plain caps snapshot so it can be unit tested
 * without a WebGL context, and so the live downgrade path shares one table with
 * the initial pick.
 *
 * Two independent inputs decide the tier:
 *   1. static capability probe (below) — runs once, before the first frame
 *   2. a live frame-time watchdog — the conductor calls `downgrade` when the
 *      renderer misses budget for a sustained run of frames
 */

export type QualityTier = 'high' | 'medium' | 'low'

export interface DeviceCaps {
  isWebGL2: boolean
  maxTextureSize: number
  /** navigator.hardwareConcurrency, or 0 when unreported. */
  hardwareConcurrency: number
  devicePixelRatio: number
  /** CSS-pixel size of the drawing surface. 0 means "unknown, assume 720p". */
  viewportWidth: number
  viewportHeight: number
}

export interface TierSettings {
  /** Shockwave point count. Single draw call either way — this is fill cost. */
  particles: number
  /** Infalling motes around the singularity. */
  accretionParticles: number
  lens: boolean
  radialBlur: boolean
  film: boolean
  /** Multiplier on the render size used for the bloom mip chain. */
  bloomResolutionScale: number
  /** Ceiling applied to window.devicePixelRatio while the intro runs. */
  maxPixelRatio: number
  /** Sphere tessellation for the blast shell. */
  shellSegments: number
}

export const TIER_SETTINGS: Record<QualityTier, TierSettings> = {
  high: {
    particles: 120_000,
    accretionParticles: 8_000,
    lens: true,
    radialBlur: true,
    film: true,
    // Bloom is a five-level mip blur chain — thirteen-odd fullscreen draws. Run
    // at full resolution it was the single most expensive thing in the frame,
    // and it is a *blur*: halving its resolution is invisible in the output and
    // quarters its cost. There is no reason for this to ever be 1.
    bloomResolutionScale: 0.5,
    // 2.0 on a retina panel is four times the fill of 1.0 for an effect that is
    // mostly soft additive sprites. 1.75 keeps edges crisp at ~77% of the cost.
    maxPixelRatio: 1.75,
    shellSegments: 96,
  },
  medium: {
    particles: 45_000,
    accretionParticles: 4_000,
    lens: true,
    radialBlur: false,
    film: true,
    bloomResolutionScale: 0.4,
    maxPixelRatio: 1.25,
    shellSegments: 64,
  },
  low: {
    particles: 15_000,
    accretionParticles: 1_200,
    lens: false,
    radialBlur: false,
    film: false,
    bloomResolutionScale: 0.25,
    maxPixelRatio: 1,
    shellSegments: 32,
  },
}

/** Frame time (ms) above which the watchdog counts a frame as missed. */
export const FRAME_BUDGET_MS = 22

/** How many recent frames the watchdog judges a tier on. */
export const WATCHDOG_WINDOW_FRAMES = 24

/** Missed frames *within that window* before dropping a tier. */
export const DOWNGRADE_MISSED_FRAMES = 12

/**
 * Pixels per frame the top tier is willing to fill.
 *
 * The intro is fill-bound, not vertex- or CPU-bound: soft additive sprites,
 * three fullscreen passes, and a bloom mip chain. Core count says nothing about
 * that. A retina laptop reports eight cores and then asks an integrated GPU to
 * fill five megapixels — the exact machine this budget exists to catch, and the
 * reason `hardwareConcurrency >= 8` alone was the wrong test.
 *
 * 3.5M clears 1080p and 1440p at DPR 1 and pushes retina panels to `medium`,
 * where the only visible loss is the radial blur.
 */
export const HIGH_TIER_PIXEL_BUDGET = 3_500_000

/** Pixels a tier would actually rasterise on this device, per frame. */
export function renderPixels(caps: DeviceCaps, tier: QualityTier): number {
  const ratio = Math.min(
    caps.devicePixelRatio > 0 ? caps.devicePixelRatio : 1,
    TIER_SETTINGS[tier].maxPixelRatio,
  )
  const width = caps.viewportWidth > 0 ? caps.viewportWidth : 1280
  const height = caps.viewportHeight > 0 ? caps.viewportHeight : 720
  return width * height * ratio * ratio
}

export function selectTier(caps: DeviceCaps): QualityTier {
  // WebGL1 or a small texture ceiling means an old integrated part or a
  // software rasteriser — neither survives a large additive point cloud.
  if (!caps.isWebGL2 || caps.maxTextureSize < 4096) return 'low'
  if (caps.hardwareConcurrency > 0 && caps.hardwareConcurrency <= 2) return 'low'

  const cores = caps.hardwareConcurrency
  // Unreported core count (0) is treated as mid-range rather than assumed fast.
  if (
    cores >= 8 &&
    caps.maxTextureSize >= 8192 &&
    renderPixels(caps, 'high') <= HIGH_TIER_PIXEL_BUDGET
  ) {
    return 'high'
  }
  return 'medium'
}

export function downgrade(tier: QualityTier): QualityTier {
  return tier === 'high' ? 'medium' : 'low'
}

export function settingsFor(tier: QualityTier): TierSettings {
  return TIER_SETTINGS[tier]
}

/**
 * Watchdog state machine. Kept pure so the "does a burst of slow frames
 * actually trip it" question is answerable in a test rather than on a laptop.
 *
 * It counts missed frames across a sliding window rather than requiring them to
 * be consecutive. That distinction is the whole point: a GPU that cannot hold
 * the budget does not miss thirty frames in a row, it alternates — one heavy
 * frame, one cheap one, forever. A consecutive counter resets on every cheap
 * frame and therefore never fires on precisely the device it exists to rescue.
 */
export class FrameWatchdog {
  private ring: Uint8Array
  private head = 0
  private missed = 0
  private budgetMs: number
  private threshold: number

  constructor(
    budgetMs = FRAME_BUDGET_MS,
    threshold = DOWNGRADE_MISSED_FRAMES,
    windowFrames = WATCHDOG_WINDOW_FRAMES,
  ) {
    this.budgetMs = budgetMs
    this.ring = new Uint8Array(Math.max(1, windowFrames))
    this.threshold = Math.max(1, Math.min(threshold, this.ring.length))
  }

  /** Returns true exactly once per trip, when a downgrade should happen. */
  sample(frameMs: number): boolean {
    const slow = frameMs > this.budgetMs ? 1 : 0
    // Evict the sample falling out of the window, admit the new one.
    this.missed -= this.ring[this.head]
    this.ring[this.head] = slow
    this.missed += slow
    this.head = (this.head + 1) % this.ring.length

    if (this.missed >= this.threshold) {
      // Clear rather than decay: the tier just changed, so every sample in the
      // window was measured against a pipeline that no longer exists.
      this.ring.fill(0)
      this.missed = 0
      this.head = 0
      return true
    }
    return false
  }
}
