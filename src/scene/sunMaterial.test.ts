import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  applySunMap,
  createSunVisuals,
  updateSunTime,
} from './sunMaterial'

describe('sun visuals', () => {
  it('builds a photosphere and a flame corona, not a solid ring', () => {
    const sun = createSunVisuals(3.84)
    expect(sun.photosphere).toBeInstanceOf(THREE.Mesh)
    expect(sun.flames).toBeInstanceOf(THREE.Mesh)
    expect(sun.materials.length).toBeGreaterThanOrEqual(2)
  })

  it('photosphere shader includes limb darkening and a sun map uniform', () => {
    const sun = createSunVisuals(2)
    const mat = sun.photosphere.material as THREE.ShaderMaterial
    expect(mat.uniforms.sunMap).toBeDefined()
    expect(mat.uniforms.time).toBeDefined()
    expect(mat.fragmentShader).toMatch(/limb/)
    expect(mat.toneMapped).toBe(true)
    expect(mat.transparent).toBe(false)
  })

  it('flame layer is additive, does not write depth, and draws irregular tongues', () => {
    const sun = createSunVisuals(2)
    const mat = sun.flames.material as THREE.ShaderMaterial
    expect(mat.transparent).toBe(true)
    expect(mat.depthWrite).toBe(false)
    expect(mat.blending).toBe(THREE.AdditiveBlending)
    expect(mat.fragmentShader).toMatch(/prominence|spicule|flame/i)
  })

  it('updates time on every sun material', () => {
    const sun = createSunVisuals(2)
    updateSunTime(sun, 7.5)
    for (const mat of sun.materials) {
      expect(mat.uniforms.time.value).toBe(7.5)
    }
  })

  it('applies the photosphere texture to the sun map uniform', () => {
    const sun = createSunVisuals(2)
    const tex = new THREE.Texture()
    applySunMap(sun, tex)
    const mat = sun.photosphere.material as THREE.ShaderMaterial
    expect(mat.uniforms.sunMap.value).toBe(tex)
    expect(mat.uniforms.hasMap.value).toBe(1)
  })

  it('flame card is larger than the photosphere so tongues can leave the limb', () => {
    const r = 4
    const sun = createSunVisuals(r)
    const photoR = (sun.photosphere.geometry as THREE.SphereGeometry).parameters
      .radius
    expect(photoR).toBeCloseTo(r)
    expect(sun.flames.scale.x).toBeGreaterThan(r * 2)
  })
})
