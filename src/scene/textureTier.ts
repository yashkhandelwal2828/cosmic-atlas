/**
 * How much texture resolution this device should ever be asked to hold — pure,
 * so the policy is testable without a WebGL context.
 *
 * This is a memory and upload-cost decision, not a bandwidth one. A 8192x4096
 * map is 134 MB of RGBA on the GPU, 179 MB once mipped. Earth alone samples five
 * maps. Handing every device the native set is what put a MacBook Air into a
 * stutter during the intro and what would put a phone into a tab crash.
 *
 * What the display can actually resolve bounds this from the other side. A
 * planet framed by `focusPose` covers roughly two thirds of the viewport, and its
 * visible disc is 180 degrees of longitude — half the equirect. So a 1470 CSS-px
 * viewport at DPR 2 asks for about 2 x 1000 = 2000 px of map across the disc,
 * and a 4096-wide map already oversamples it. 8K only starts to pay at the
 * closest orbit distance, on a machine with the memory to spare, which is
 * exactly the case `hi` is reserved for.
 */
import type { BodyId } from '../data/bodies'
import type { TextureRes, UpgradeJob } from './textures'
import { TIER_ORDER, bodyTextureKeys, isPrimaryKey } from './textures'

export interface TextureDeviceCaps {
  isWebGL2: boolean
  maxTextureSize: number
  /** navigator.hardwareConcurrency, or 0 when unreported. */
  hardwareConcurrency: number
  /** navigator.deviceMemory in GB, or 0 when unreported (Safari, Firefox). */
  deviceMemory: number
  /** True for touch-primary devices — phones and tablets. */
  coarsePointer: boolean
  /** Data Saver, or a connection the browser calls 2g/3g. */
  frugalNetwork: boolean
}

/** The lower of two tiers. */
export function minTier(a: TextureRes, b: TextureRes): TextureRes {
  return TIER_ORDER.indexOf(a) <= TIER_ORDER.indexOf(b) ? a : b
}

/**
 * Ceiling for a body's ALBEDO and night maps — the two a viewer actually looks
 * at. Companion maps are held one step lower by `companionCeiling`.
 */
export function selectTextureCeiling(caps: TextureDeviceCaps): TextureRes {
  // A 4096 ceiling means the driver would have to rescale an 8K image to fit,
  // which three does on the main thread via a canvas draw — slower than the
  // upload it is avoiding, and it happens on the frame the map first renders.
  if (!caps.isWebGL2 || caps.maxTextureSize < 8192) return 'lo'
  // Touch devices are memory-constrained in a way no core count reveals, and a
  // phone is the one place where a texture budget overrun ends the session
  // rather than slowing it.
  if (caps.coarsePointer) return 'lo'
  if (caps.frugalNetwork) return 'lo'

  if (caps.maxTextureSize < 16384) return 'mid'

  // `hi` has to be earned, because 4096 already oversamples the disc at default
  // framing (see the file header) — so the step up buys resolution only for a
  // viewer who zooms all the way in, at roughly four times the memory and an
  // upload measured in hundreds of milliseconds. The bar is therefore positive
  // evidence of headroom, not the absence of evidence against it.
  //
  // `navigator.deviceMemory` is deliberately quantised and CAPPED AT 8 by the
  // spec, so a 16 GB laptop and a 128 GB workstation both report exactly 8. It
  // can only ever tell us a machine is small — never that one is big — so it
  // demotes and never promotes. Reading `>= 8` as "roomy" sent every mainstream
  // laptop to the 8K set, which is measurably the wrong answer: on an M4 Air
  // that lands as half-second stalls a few seconds after the intro hands over.
  if (caps.deviceMemory > 0 && caps.deviceMemory < 8) return 'mid'

  // Core count is the one signal that still discriminates at the top end. Eight
  // to ten cores is the modern thin-and-light with an integrated GPU — the exact
  // class this tiering exists for. Twelve is where a discrete part and a real
  // memory budget become a safe assumption.
  if (caps.hardwareConcurrency >= 12) return 'hi'

  return 'mid'
}

/**
 * Ceiling for clouds, normal, specular, ring and atmosphere maps.
 *
 * These are either low-frequency by nature (a normal map's gradients, a
 * specular land/sea mask) or drawn semi-transparent over something else, so the
 * step from 4K to 8K is invisible while the memory cost is identical to the
 * albedo's. Capping them is what keeps Earth's five maps under half a gigabyte.
 */
export function companionCeiling(ceiling: TextureRes): TextureRes {
  return minTier(ceiling, 'mid')
}

/** Tier for a single key under a ceiling, applying the primary/secondary split. */
export function tierForKey(key: string, ceiling: TextureRes): TextureRes {
  return isPrimaryKey(key) ? ceiling : companionCeiling(ceiling)
}

/**
 * Everything one body's materials sample, at the right tier each.
 * Empty when the ceiling is `lo`, since that is where every map already sits.
 */
export function upgradeJobsFor(id: BodyId, ceiling: TextureRes): UpgradeJob[] {
  if (ceiling === 'lo') return []
  return bodyTextureKeys(id)
    .map((key) => ({ key, res: tierForKey(key, ceiling) }))
    .filter((job) => job.res !== 'lo')
}

/**
 * Maps that are on screen no matter where the viewer is standing, so they are
 * worth raising the moment the intro lets go. The sky is the widest thing in
 * frame and the one an equirect stretches thinnest, which is why it leads.
 */
export function alwaysVisibleUpgradeJobs(ceiling: TextureRes): UpgradeJob[] {
  if (ceiling === 'lo') return []
  return [
    { key: 'stars', res: ceiling },
    { key: 'sun', res: ceiling },
  ]
}

/** Probe the live environment. Kept apart from the policy so the policy is pure. */
export function probeTextureCaps(gl: WebGLRenderingContext | WebGL2RenderingContext, isWebGL2: boolean): TextureDeviceCaps {
  const nav = typeof navigator === 'undefined' ? undefined : navigator
  const connection = (
    nav as (Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }) | undefined
  )?.connection

  return {
    isWebGL2,
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    hardwareConcurrency: nav?.hardwareConcurrency ?? 0,
    deviceMemory:
      (nav as (Navigator & { deviceMemory?: number }) | undefined)?.deviceMemory ?? 0,
    coarsePointer:
      typeof matchMedia === 'function'
        ? matchMedia('(pointer: coarse)').matches
        : false,
    frugalNetwork:
      connection?.saveData === true ||
      connection?.effectiveType === 'slow-2g' ||
      connection?.effectiveType === '2g' ||
      connection?.effectiveType === '3g',
  }
}
