/**
 * Derive the `lo` and `mid` texture tiers from the shipped native-resolution maps.
 *
 * Why this exists
 * ---------------
 * The intro IS the loading screen: the sequence plays while the planetary maps
 * stream in. The maps that ship are up to 8192x4096, and an 8K texture is not
 * merely a big download — it is 134 MB of decoded RGBA, a synchronous
 * `texImage2D` upload, and a `glGenerateMipmap` on the main thread. Nine of them
 * land across the detonation, which is the single frame in the sequence with the
 * least headroom. On integrated graphics that reads as the animation breaking.
 *
 * Nothing on screen during the intro can resolve 8K — Earth is a few hundred
 * pixels tall at its largest, Mercury is a dot — so the fix is to play the whole
 * sequence off a 2K set and raise the resolution afterwards, when a hitch lands
 * on a static camera instead of on the shot.
 *
 * Output layout, keyed by the loader's LOGICAL key rather than by source stem,
 * so `src/scene/textures.ts` can address a tier with one template:
 *
 *   public/textures/lo/<key>.webp    <= 2048 px wide
 *   public/textures/mid/<key>.webp   <= 4096 px wide
 *   public/textures/<stem>.{jpg,png,webp}   the untouched native set ("hi")
 *
 * Sources are never upscaled: a key published at 2048 is copied into every tier
 * at its own size, so `lo` is always "at most 2048", not "exactly 2048".
 *
 * Usage: node scripts/build-texture-tiers.mjs [--force]
 * Requires ImageMagick (`brew install imagemagick`).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TEX = join(ROOT, 'public', 'textures')

/** Longest edge each tier is allowed, in pixels. */
const TIERS = { lo: 2048, mid: 4096 }

/**
 * Logical key -> candidate source stems, mirroring TEXTURE_CANDIDATES in
 * src/scene/textures.ts. The first stem that exists on disk wins, matching the
 * loader's own preference order so a tier is always derived from the exact image
 * the site would otherwise have served.
 */
const KEYS = {
  sun: ['sun'],
  mercury: ['mercury'],
  venus: ['venus'],
  venus_atmosphere: ['venus_atmosphere'],
  earth: ['earth'],
  earth_night: ['earth_night'],
  earth_clouds: ['earth_clouds'],
  earth_normal: ['earth_normal'],
  earth_specular: ['earth_specular'],
  mars: ['mars'],
  mars_normal: ['mars_normal'],
  jupiter: ['jupiter'],
  saturn: ['saturn'],
  saturn_ring: ['saturn_ring'],
  uranus: ['uranus'],
  neptune: ['neptune'],
  stars: ['stars'],
}

/**
 * Keys whose pixels are numbers rather than colour. Lossy chroma handling turns
 * a normal map's smooth gradients into visible terracing under specular light,
 * so these get a much higher quality floor and no chroma subsampling.
 */
const DATA_KEYS = new Set(['earth_normal', 'mars_normal', 'earth_specular'])

/** Keys that carry a meaningful alpha channel. */
const ALPHA_KEYS = new Set(['saturn_ring'])

const EXTENSIONS = ['.jpg', '.png', '.webp']

function resolveSource(key) {
  for (const stem of KEYS[key]) {
    for (const ext of EXTENSIONS) {
      const path = join(TEX, stem + ext)
      if (existsSync(path)) return path
    }
  }
  // Companion maps (clouds, normals, rings) ship only as lo/mid WebP.
  // If the native root file is gone, rebuild lo from the mid encode.
  const mid = join(TEX, 'mid', `${key}.webp`)
  if (existsSync(mid)) return mid
  return null
}

function dimensions(path) {
  const out = execFileSync('magick', ['identify', '-format', '%w %h', path], {
    encoding: 'utf8',
  })
  const [w, h] = out.trim().split(/\s+/).map(Number)
  return { width: w, height: h }
}

function encode(source, target, maxWidth, key) {
  const { width } = dimensions(source)
  // `>` in a geometry means "only shrink". Belt and braces alongside the check
  // below, so a source narrower than the tier is re-encoded rather than blown up.
  const geometry = `${maxWidth}x>`

  const args = [source, '-colorspace', 'sRGB', '-filter', 'Lanczos']
  if (width > maxWidth) args.push('-resize', geometry)

  if (DATA_KEYS.has(key)) {
    args.push('-quality', '95', '-define', 'webp:use-sharp-yuv=true')
  } else {
    args.push('-quality', '86', '-define', 'webp:use-sharp-yuv=true')
  }
  if (ALPHA_KEYS.has(key)) {
    args.push('-define', 'webp:alpha-quality=100')
  } else {
    // Equirectangular maps have no meaningful alpha; carrying one costs a
    // quarter of the decoded size for nothing.
    args.push('-alpha', 'off')
  }
  args.push(target)

  execFileSync('magick', args, { stdio: ['ignore', 'ignore', 'inherit'] })
}

const force = process.argv.includes('--force')
let built = 0
let skipped = 0
const missing = []

for (const [tier, maxWidth] of Object.entries(TIERS)) {
  const dir = join(TEX, tier)
  mkdirSync(dir, { recursive: true })

  for (const key of Object.keys(KEYS)) {
    const source = resolveSource(key)
    if (!source) {
      if (tier === 'lo') missing.push(key)
      continue
    }

    const target = join(dir, `${key}.webp`)
    if (!force && existsSync(target) && statSync(target).mtimeMs >= statSync(source).mtimeMs) {
      skipped++
      continue
    }

    encode(source, target, maxWidth, key)
    const { width, height } = dimensions(target)
    const kb = (statSync(target).size / 1024).toFixed(0)
    console.log(`${tier}/${key}.webp  ${width}x${height}  ${kb} KB`)
    built++
  }
}

if (missing.length) {
  console.warn(`No source found for: ${missing.join(', ')}`)
}
console.log(`\n${built} built, ${skipped} up to date.`)
