/**
 * Deep-sky backdrop.
 * The Milky Way is installed as an equirectangular `scene.background`, so it sits at
 * infinity — no giant SphereGeometry to clip through, no dependence on `camera.far`,
 * and nothing to rescale when the orbits expand into true-distance mode.
 * A sparse THREE.Points shell rides in front of it purely for parallax depth.
 */
import * as THREE from 'three'
import { eclipticToScene } from './orbitalMechanics'

export interface StarfieldOptions {
  /** Equirectangular Milky Way map, or null to go fully procedural. */
  milkyWay: THREE.Texture | null
  /** Radius of the procedural point cloud. */
  radius: number
}

/** Points in the procedural shell — sparkle only; the band is the sky. */
export const STAR_COUNT = 1600

/** Outer edge of the shell, as a multiple of `options.radius`. */
const SHELL_DEPTH = 2.3

/** Equirect intensity: high enough to read the band from the system view. */
export const BACKGROUND_INTENSITY = 0.65

/** Sky colour used when no equirect map was available. */
const EMPTY_SKY = 0x010208

/**
 * Galactic north pole in ecliptic J2000 coordinates, degrees.
 * APPROXIMATE — rounded to 0.1°, which leaves the band a couple of degrees off the
 * true IAU galactic frame. That is well inside what reads correctly on screen, and
 * §7 of the spec explicitly allows it.
 */
const GALACTIC_POLE_ECLIPTIC_LON_DEG = 180.0
const GALACTIC_POLE_ECLIPTIC_LAT_DEG = 29.8

/**
 * Working, so the 60.2° result is checkable rather than magic:
 *
 *   λ = 180.0°, β = +29.8°  (galactic north pole, ecliptic frame)
 *
 *   x_ecl = cos β · cos λ = 0.8678 · (−1) = −0.8678
 *   y_ecl = cos β · sin λ = 0.8678 ·   0  =  0
 *   z_ecl = sin β         =                  +0.4970
 *
 * Through the one shared ecliptic → scene mapping (x, z, −y):
 *
 *   n_gal = (−0.8678, +0.4970, 0)
 *
 * An equirect background is sampled in world space with its own pole at +Y
 * (texture v = 1), so the backdrop rotation is just the minimal rotation carrying
 * +Y onto n_gal. n_gal has no scene-Z component, so that rotation is a single turn
 * about scene Z:
 *
 *   Rz(θ) · (0, 1, 0) = (−sin θ, cos θ, 0)
 *   −sin θ = −0.8678, cos θ = 0.4970  →  θ = 60.2°
 *
 * which is exactly the ≈60.2° inclination of the galactic plane to the ecliptic —
 * the whole point being that the band crosses the ecliptic steeply instead of lying
 * along it. `setFromUnitVectors` is used below rather than a hard-coded 60.2° so the
 * two published pole numbers stay load-bearing.
 */
function galacticBackgroundRotation(): THREE.Euler {
  const lon = THREE.MathUtils.degToRad(GALACTIC_POLE_ECLIPTIC_LON_DEG)
  const lat = THREE.MathUtils.degToRad(GALACTIC_POLE_ECLIPTIC_LAT_DEG)
  const pole = eclipticToScene({
    x: Math.cos(lat) * Math.cos(lon),
    y: Math.cos(lat) * Math.sin(lon),
    z: Math.sin(lat),
  })
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(pole.x, pole.y, pole.z).normalize(),
  )
  return new THREE.Euler().setFromQuaternion(quaternion)
}

const STAR_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  uniform float uPixelRatio;
  varying vec3 vColor;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // Stars are effectively at infinity: constant apparent size, no attenuation.
    gl_PointSize = aSize * uPixelRatio;
  }
`

const STAR_FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  void main() {
    vec2 d = gl_PointCoord - vec2(0.5);
    float r2 = dot(d, d);
    if (r2 > 0.25) discard;
    float falloff = 1.0 - smoothstep(0.015, 0.25, r2);
    gl_FragColor = vec4(vColor, falloff * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/** Warm (K/M), neutral (G) and cool (A/B) star tints. */
const WARM = [1.0, 0.83, 0.67]
const NEUTRAL = [1.0, 0.97, 0.93]
const COOL = [0.72, 0.81, 1.0]

function mix(a: number[], b: number[], t: number, channel: number): number {
  return a[channel] + (b[channel] - a[channel]) * t
}

function buildStarGeometry(radius: number): THREE.BufferGeometry {
  const positions = new Float32Array(STAR_COUNT * 3)
  const colors = new Float32Array(STAR_COUNT * 3)
  const sizes = new Float32Array(STAR_COUNT)

  const inner = Math.max(radius, 1)
  const outer = inner * SHELL_DEPTH

  for (let i = 0; i < STAR_COUNT; i++) {
    // cbrt keeps the shell roughly uniform in volume rather than crowding the inner face
    const r = inner + (outer - inner) * Math.cbrt(Math.random())
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
    positions[i * 3 + 2] = r * Math.cos(phi)

    // Colour temperature: mostly near-neutral, with warm and cool tails
    const t = Math.random()
    const brightness = 0.22 + Math.random() * 0.28
    for (let c = 0; c < 3; c++) {
      const tint =
        t < 0.5 ? mix(WARM, NEUTRAL, t * 2, c) : mix(NEUTRAL, COOL, (t - 0.5) * 2, c)
      colors[i * 3 + c] = tint * brightness
    }

    // Cubed so the field is mostly faint pinpricks with a scattering of bright ones
    sizes[i] = 0.5 + Math.pow(Math.random(), 3) * 1.4
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  return geometry
}

function devicePixelRatio(): number {
  if (typeof window === 'undefined') return 1
  return Math.min(window.devicePixelRatio || 1, 2)
}

export class Starfield {
  readonly points: THREE.Points

  private milkyWay: THREE.Texture | null
  private geometry: THREE.BufferGeometry
  private material: THREE.ShaderMaterial

  constructor(options: StarfieldOptions) {
    this.milkyWay = options.milkyWay
    this.geometry = buildStarGeometry(options.radius)
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uPixelRatio: { value: devicePixelRatio() },
        uOpacity: { value: 1 },
      },
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.points = new THREE.Points(this.geometry, this.material)
    this.points.name = 'starfield'
    // The shell always encloses the camera, so culling it is only ever a false negative
    this.points.frustumCulled = false
    this.points.renderOrder = -1
  }

  /** Installs the equirect background + galactic-plane rotation onto the scene. */
  applyTo(scene: THREE.Scene): void {
    scene.add(this.points)

    if (this.milkyWay) {
      this.milkyWay.mapping = THREE.EquirectangularReflectionMapping
      this.milkyWay.colorSpace = THREE.SRGBColorSpace
      scene.background = this.milkyWay
      scene.backgroundIntensity = BACKGROUND_INTENSITY
      scene.backgroundRotation.copy(galacticBackgroundRotation())
    } else {
      scene.background = new THREE.Color(EMPTY_SKY)
    }

    // Exponential fog washes out the outer planets once the orbits expand — never re-add it.
    scene.fog = null
  }

  /**
   * Fade the point shell. The equirect band is a scene-level property, so the
   * caller pairs this with `scene.backgroundIntensity` — see
   * `SolarSystem.setSkyIntensity`, which owns both halves.
   */
  setOpacity(value: number): void {
    this.material.uniforms.uOpacity.value = Math.max(0, Math.min(1, value))
  }

  dispose(): void {
    this.points.parent?.remove(this.points)
    this.geometry.dispose()
    this.material.dispose()
    // The Milky Way texture is owned by TextureCache, so it is not disposed here.
  }
}
