/**
 * Drawn orbit paths — one closed path per planet.
 * Points come from the shared Kepler sampler, then go through EXACTLY the same
 * ecliptic-AU -> scene chain that `SolarSystem` uses to place the planets
 * (eclipticToScene -> orbitScaleFactor -> vertical exaggeration on Y), so a body
 * always sits on the line that is drawn for it.
 *
 * The primitive is `THREE.Line` with the first sample repeated at the end rather
 * than `LineLoop`, which draws identically when complete but also supports a
 * partial `drawRange`. LineLoop cannot: truncating it draws a chord straight back
 * to the first vertex, so the intro's draw-in would cut across the ellipse.
 */
import * as THREE from 'three'
import type { BodyId } from '../data/bodies'
import { BODIES } from '../data/bodies'
import type { PlanetId } from '../data/orbitalElements'
// MOON DISABLED — `MOON_ORBIT` returns with `buildMoon` below.
import { /* MOON_ORBIT, */ ORBITS, PLANET_IDS } from '../data/orbitalElements'
import {
  eclipticToScene,
  elementsAt,
  sampleOrbitEcliptic,
} from './orbitalMechanics'
import type { DistanceMode } from './scale'
// MOON DISABLED — `moonOrbitScaleFactor` returns with `buildMoon` below.
import { /* moonOrbitScaleFactor, */ orbitScaleFactor } from './scale'

export interface OrbitPathOptions {
  mode: DistanceMode
  /** Julian centuries past J2000, for element propagation. */
  T: number
  verticalExaggeration: number
  segments?: number
}

const DEFAULT_SEGMENTS = 512
const BASE_OPACITY = 0.22
const FOCUSED_OPACITY = 0.85

type OrbitLine = THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>

/**
 * Build the vertex buffer for one closed path: every sample, then the first
 * sample again so the ellipse meets itself.
 */
function closedPositions(
  samples: { x: number; y: number; z: number }[],
  factor: number,
  verticalExaggeration: number,
): Float32Array {
  const count = samples.length + 1
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const p = eclipticToScene(samples[i % samples.length])
    positions[i * 3] = p.x * factor
    positions[i * 3 + 1] = p.y * factor * verticalExaggeration
    positions[i * 3 + 2] = p.z * factor
  }
  return positions
}

export class OrbitPaths {
  readonly root = new THREE.Group()
  /** Geocentric lunar path — parented under Earth's orbitGroup by the scene. */
  readonly moonRoot = new THREE.Group()
  private lines = new Map<PlanetId, OrbitLine>()
  private moonLine: OrbitLine | null = null
  private focused: BodyId | null = null

  constructor(options: OrbitPathOptions) {
    this.root.name = 'orbit-paths'
    this.moonRoot.name = 'moon-orbit-path'
    this.build(options)
  }

  /** Rebuild geometry (call when mode / exaggeration changes, or every ~year of sim time). */
  rebuild(options: OrbitPathOptions): void {
    this.clear()
    this.build(options)
  }

  /** Brighten the focused planet's path, dim the rest. `null` dims everything. */
  setFocused(id: BodyId | null): void {
    this.focused = id
    for (const [planetId, line] of this.lines) {
      line.material.opacity = planetId === id ? FOCUSED_OPACITY : BASE_OPACITY
    }
    if (this.moonLine) {
      this.moonLine.material.opacity =
        id === 'moon' ? FOCUSED_OPACITY : id === 'earth' ? 0.45 : BASE_OPACITY
    }
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible
    this.moonRoot.visible = visible
  }

  /** Planet paths in the order they are drawn in, innermost first. */
  get drawOrder(): readonly PlanetId[] {
    return PLANET_IDS
  }

  /**
   * Reveal a fraction of one path, measured from its first sample.
   * `1` restores the full ellipse; this is the only state left behind once the
   * intro finishes, so the steady-state scene never carries a partial range.
   */
  setDrawProgress(id: PlanetId | 'moon', progress: number): void {
    const line = id === 'moon' ? this.moonLine : this.lines.get(id)
    if (!line) return
    const total = line.geometry.attributes.position.count
    const shown = Math.round(Math.max(0, Math.min(1, progress)) * total)
    line.geometry.setDrawRange(0, shown)
    line.visible = shown > 1
  }

  /** Apply the same fraction to every path — used to hide them all at once. */
  setDrawProgressAll(progress: number): void {
    for (const id of PLANET_IDS) this.setDrawProgress(id, progress)
    this.setDrawProgress('moon', progress)
  }

  dispose(): void {
    this.clear()
    this.moonRoot.parent?.remove(this.moonRoot)
    this.root.parent?.remove(this.root)
  }

  private build(options: OrbitPathOptions): void {
    const segments = options.segments ?? DEFAULT_SEGMENTS
    for (const id of PLANET_IDS) {
      const set = ORBITS[id]
      const factor = orbitScaleFactor(elementsAt(set, options.T).a, options.mode)
      const samples = sampleOrbitEcliptic(set, options.T, segments)

      const positions = closedPositions(
        samples,
        factor,
        options.verticalExaggeration,
      )

      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      const material = new THREE.LineBasicMaterial({
        color: new THREE.Color(BODIES[id].color),
        transparent: true,
        opacity: id === this.focused ? FOCUSED_OPACITY : BASE_OPACITY,
        depthWrite: false,
      })

      const line: OrbitLine = new THREE.Line(geometry, material)
      line.name = `orbit-${id}`
      // Paths are decorative: never let them steal a hotspot/body raycast hit.
      line.raycast = () => {}
      this.root.add(line)
      this.lines.set(id, line)
    }
    // MOON DISABLED — see BODY_ORDER in data/bodies.ts. `buildMoon` and every
    // moon branch below stay intact; nothing calls them while this is commented,
    // and `moonLine` stays null so the guards in setFocused / setDrawProgress
    // simply no-op.
    // this.buildMoon(options, segments)
  }

  // MOON DISABLED — see BODY_ORDER in data/bodies.ts. Commented out rather than
  // deleted, together with its `MOON_ORBIT` / `moonOrbitScaleFactor` imports,
  // because TypeScript's noUnusedLocals rejects an uncalled private method.
  //
  // private buildMoon(options: OrbitPathOptions, segments: number): void {
  //   const factor = moonOrbitScaleFactor()
  //   const samples = sampleOrbitEcliptic(MOON_ORBIT, options.T, segments)
  //   const positions = closedPositions(
  //     samples,
  //     factor,
  //     options.verticalExaggeration,
  //   )
  //
  //   const geometry = new THREE.BufferGeometry()
  //   geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  //   const material = new THREE.LineBasicMaterial({
  //     color: new THREE.Color(BODIES.moon.color),
  //     transparent: true,
  //     opacity:
  //       this.focused === 'moon'
  //         ? FOCUSED_OPACITY
  //         : this.focused === 'earth'
  //           ? 0.45
  //           : BASE_OPACITY,
  //     depthWrite: false,
  //   })
  //
  //   const line: OrbitLine = new THREE.Line(geometry, material)
  //   line.name = 'orbit-moon'
  //   line.raycast = () => {}
  //   this.moonRoot.add(line)
  //   this.moonLine = line
  // }

  /** Free every GPU resource we own — toggling distance mode must not leak. */
  private clear(): void {
    for (const line of this.lines.values()) {
      this.root.remove(line)
      line.geometry.dispose()
      line.material.dispose()
    }
    this.lines.clear()
    if (this.moonLine) {
      this.moonRoot.remove(this.moonLine)
      this.moonLine.geometry.dispose()
      this.moonLine.material.dispose()
      this.moonLine = null
    }
  }
}
