import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { BACKGROUND_INTENSITY, STAR_COUNT, Starfield } from './Starfield'

describe('galactic backdrop', () => {
  it('raises the Milky Way band above the competing point cloud', () => {
    expect(BACKGROUND_INTENSITY).toBeGreaterThanOrEqual(0.55)
    expect(BACKGROUND_INTENSITY).toBeLessThanOrEqual(0.75)
    expect(STAR_COUNT).toBeLessThan(3000)
  })

  it('installs that intensity without changing the galactic-pole rotation', () => {
    const scene = new THREE.Scene()
    const milkyWay = new THREE.Texture()
    const stars = new Starfield({ milkyWay, radius: 100 })
    stars.applyTo(scene)
    expect(scene.backgroundIntensity).toBe(BACKGROUND_INTENSITY)
    // +Y → galactic north is a single turn about scene Z of ≈60.2°.
    expect(scene.backgroundRotation.z).toBeCloseTo(
      THREE.MathUtils.degToRad(60.2),
      2,
    )
    stars.dispose()
  })
})
