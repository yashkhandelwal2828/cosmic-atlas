/**
 * Light streaks behind each body in flight.
 *
 * One additive THREE.Line per body over a fixed-length ring buffer of past world
 * positions. Alpha falls off toward the tail, so with bloom on top it reads as a
 * plasma trail rather than a polyline. Nine lines of 32 vertices is nothing —
 * the cost here is entirely in the bloom pass, which is already paid for.
 */
import * as THREE from 'three'
import type { BodyId } from '../data/bodies'
import { BODIES } from '../data/bodies'

const TRAIL_POINTS = 32

const TRAIL_VERTEX = /* glsl */ `
  attribute float aT;
  varying float vT;
  void main() {
    vT = aT;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const TRAIL_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  varying float vT;

  void main() {
    // Squared falloff keeps the head bright and the tail a whisper.
    float a = (1.0 - vT) * (1.0 - vT) * uIntensity;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor * a * 2.2, a);
  }
`

interface Trail {
  line: THREE.Line
  positions: Float32Array
  material: THREE.ShaderMaterial
  /** Ring buffer of world positions, newest first after `sample`. */
  history: Float32Array
  filled: boolean
}

export class Trails {
  readonly group = new THREE.Group()

  private trails = new Map<BodyId, Trail>()

  constructor(ids: readonly BodyId[]) {
    this.group.name = 'intro-trails'
    this.group.renderOrder = 5

    for (const id of ids) {
      const positions = new Float32Array(TRAIL_POINTS * 3)
      const t = new Float32Array(TRAIL_POINTS)
      for (let i = 0; i < TRAIL_POINTS; i++) t[i] = i / (TRAIL_POINTS - 1)

      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      geometry.setAttribute('aT', new THREE.BufferAttribute(t, 1))
      geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6)

      const material = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(BODIES[id].color) },
          uIntensity: { value: 0 },
        },
        vertexShader: TRAIL_VERTEX,
        fragmentShader: TRAIL_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })

      const line = new THREE.Line(geometry, material)
      line.name = `trail-${id}`
      line.frustumCulled = false
      line.raycast = () => {}
      this.group.add(line)

      this.trails.set(id, {
        line,
        positions,
        material,
        history: new Float32Array(TRAIL_POINTS * 3),
        filled: false,
      })
    }
  }

  /**
   * Record one frame of a body's flight.
   *
   * @param intensity 0 hides the trail; drive it from launch speed so the streak
   *                  is brightest at departure and gone by touchdown.
   */
  sample(id: BodyId, position: THREE.Vector3, intensity: number): void {
    const trail = this.trails.get(id)
    if (!trail) return

    trail.material.uniforms.uIntensity.value = intensity
    trail.line.visible = intensity > 0.004
    if (!trail.line.visible) return

    const h = trail.history
    if (!trail.filled) {
      // First sample: collapse the whole tail onto the head so the trail grows
      // out of the body instead of whipping in from wherever it last ran.
      for (let i = 0; i < TRAIL_POINTS; i++) {
        h[i * 3] = position.x
        h[i * 3 + 1] = position.y
        h[i * 3 + 2] = position.z
      }
      trail.filled = true
    } else {
      h.copyWithin(3, 0, (TRAIL_POINTS - 1) * 3)
      h[0] = position.x
      h[1] = position.y
      h[2] = position.z
    }

    trail.positions.set(h)
    trail.line.geometry.attributes.position.needsUpdate = true
  }

  /** Forget a body's history so its next flight starts clean. */
  reset(id: BodyId): void {
    const trail = this.trails.get(id)
    if (!trail) return
    trail.filled = false
    trail.material.uniforms.uIntensity.value = 0
    trail.line.visible = false
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible
  }

  dispose(): void {
    this.group.parent?.remove(this.group)
    for (const trail of this.trails.values()) {
      trail.line.geometry.dispose()
      trail.material.dispose()
    }
    this.trails.clear()
  }
}
