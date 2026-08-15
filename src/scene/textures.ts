/**
 * Texture path map + cached loading.
 * Prefer FULL native SSS resolution (8K where published): JPG originals first, then WebP.
 */
import * as THREE from 'three'
import type { BodyId } from '../data/bodies'

/**
 * Candidate stems per logical key.
 * Loader tries FULL-res extensions in order: .jpg → .png → .webp
 * so uncompressed 8K SSS JPEGs win over any older downscaled WebP.
 */
const TEXTURE_CANDIDATES: Record<string, string[]> = {
  sun: ['sun', '2k_sun'],
  mercury: ['mercury', '2k_mercury'],
  venus: ['venus', '2k_venus_surface'],
  venus_atmosphere: ['venus_atmosphere'],
  earth: ['earth', 'earth_day', '2k_earth_daymap'],
  earth_night: ['earth_night', '2k_earth_nightmap'],
  earth_clouds: ['earth_clouds', '2k_earth_clouds'],
  earth_normal: ['earth_normal'],
  earth_specular: ['earth_specular'],
  mars: ['mars', '2k_mars'],
  mars_normal: ['mars_normal'],
  jupiter: ['jupiter', '2k_jupiter'],
  saturn: ['saturn', '2k_saturn'],
  saturn_ring: ['saturn_ring', '2k_saturn_ring_alpha'],
  uranus: ['uranus', '2k_uranus'],
  neptune: ['neptune', '2k_neptune'],
  moon: ['moon', '2k_moon'],
  stars: ['stars', 'stars_milky_way', '2k_stars_milky_way'],
}

export const CRITICAL_TEXTURE_KEYS = [
  'stars',
  'sun',
  'earth',
  'earth_night',
  'earth_clouds',
  'earth_normal',
  'earth_specular',
] as const

export function bodyTextureKey(id: BodyId): string {
  return id
}

function candidateUrls(key: string): string[] {
  const stems = TEXTURE_CANDIDATES[key]
  if (!stems) throw new Error(`Unknown texture key: ${key}`)
  const urls: string[] = []
  // Prefer full-res raster (JPG/PNG 8K) before WebP so we never accidentally keep a 4K webp
  for (const stem of stems) {
    urls.push(
      `/textures/${stem}.jpg`,
      `/textures/${stem}.png`,
      `/textures/${stem}.webp`,
    )
  }
  return urls
}

export class TextureCache {
  private loader = new THREE.TextureLoader()
  private cache = new Map<string, Promise<THREE.Texture>>()
  private resolved = new Map<string, THREE.Texture>()
  private maxAniso = 16

  setMaxAnisotropy(n: number): void {
    this.maxAniso = Math.max(1, n)
  }

  getSync(key: string): THREE.Texture | null {
    return this.resolved.get(key) ?? null
  }

  load(key: string, opts?: { colorSpace?: THREE.ColorSpace }): Promise<THREE.Texture> {
    const hit = this.cache.get(key)
    if (hit) return hit

    const promise = this.loadFirstAvailable(key).then((tex) => {
      tex.colorSpace = opts?.colorSpace ?? THREE.SRGBColorSpace
      tex.anisotropy = this.maxAniso
      tex.minFilter = THREE.LinearMipmapLinearFilter
      tex.magFilter = THREE.LinearFilter
      tex.generateMipmaps = true
      // Sharper when zoomed — Three will use full mip chain from 8K source
      if ('colorSpace' in tex) {
        /* already set */
      }
      this.resolved.set(key, tex)
      // Log actual GPU image size once (dev visibility)
      const img = tex.image as { width?: number; height?: number } | undefined
      if (img?.width && img?.height) {
        console.info(`[textures] ${key}: ${img.width}×${img.height}`)
      }
      return tex
    })
    this.cache.set(key, promise)
    return promise
  }

  loadData(key: string): Promise<THREE.Texture> {
    return this.load(key, { colorSpace: THREE.NoColorSpace })
  }

  private loadFirstAvailable(key: string): Promise<THREE.Texture> {
    const urls = candidateUrls(key)
    return new Promise((resolve, reject) => {
      const tryAt = (i: number): void => {
        if (i >= urls.length) {
          reject(new Error(`No texture found for key: ${key}`))
          return
        }
        this.loader.load(urls[i], resolve, undefined, () => tryAt(i + 1))
      }
      tryAt(0)
    })
  }

  async loadCritical(): Promise<void> {
    await Promise.all(
      CRITICAL_TEXTURE_KEYS.map((k) =>
        k === 'earth_normal' || k === 'earth_specular'
          ? this.loadData(k).catch(() => undefined)
          : this.load(k).catch(() => undefined),
      ),
    )
  }

  async loadBody(id: BodyId): Promise<THREE.Texture> {
    return this.load(bodyTextureKey(id))
  }

  async loadAllBodies(ids: BodyId[]): Promise<void> {
    await Promise.all(ids.map((id) => this.loadBody(id).catch(() => undefined)))
  }
}

/** Fresnel atmosphere shell — soft limb glow. */
export function createAtmosphereMaterial(
  color: THREE.ColorRepresentation,
  intensity = 1,
): THREE.ShaderMaterial {
  const c = new THREE.Color(color)
  return new THREE.ShaderMaterial({
    uniforms: {
      glowColor: { value: c },
      coeficient: { value: 0.55 },
      power: { value: 3.4 * intensity },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldPos = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 glowColor;
      uniform float coeficient;
      uniform float power;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      void main() {
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        float intensity = pow(coeficient - dot(vNormal, viewDir), power);
        intensity = clamp(intensity, 0.0, 1.0);
        gl_FragColor = vec4(glowColor, intensity * 0.9);
      }
    `,
    side: THREE.FrontSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  })
}
