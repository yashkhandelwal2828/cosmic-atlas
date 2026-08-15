import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  PLANET_IDS,
  applyPlanetMaps,
  createPlanetVisuals,
  updatePlanetVisuals,
} from './index'
import { isCustomPlanetMaterial } from './common'
import type { BodyId } from '../../data/bodies'

function globeMat(id: BodyId): THREE.Material {
  return createPlanetVisuals(id, 1.2).globe.material as THREE.Material
}

describe('planet visuals — Sun-class constructors', () => {
  it('builds a custom shaded globe for every planet', () => {
    for (const id of PLANET_IDS) {
      const visuals = createPlanetVisuals(id, 1.5)
      expect(visuals.globe).toBeInstanceOf(THREE.Mesh)
      expect(visuals.materials.length).toBeGreaterThan(0)
      expect(
        isCustomPlanetMaterial(visuals.globe.material as THREE.Material),
        `${id} must not be MeshBasic / unmapped MeshStandard`,
      ).toBe(true)
    }
  })

  it('refuses map-less MeshBasic or default MeshStandard as the globe', () => {
    for (const id of PLANET_IDS) {
      const mat = globeMat(id)
      expect(mat).not.toBeInstanceOf(THREE.MeshBasicMaterial)
      if (mat instanceof THREE.MeshStandardMaterial) {
        throw new Error(`${id} still uses MeshStandardMaterial`)
      }
      expect(mat).toBeInstanceOf(THREE.ShaderMaterial)
    }
  })

  it('globe shaders consume a real albedo/day map uniform', () => {
    for (const id of PLANET_IDS) {
      const mat = globeMat(id) as THREE.ShaderMaterial
      const hasAlbedo = !!mat.uniforms.albedoMap || !!mat.uniforms.dayMap
      expect(hasAlbedo, `${id} missing albedo/day map uniform`).toBe(true)
      expect(mat.fragmentShader).toMatch(/sunPosition/)
    }
  })

  it('applies a texture onto the shipped globe uniform (not a reimplementation)', () => {
    const tex = new THREE.Texture()
    for (const id of PLANET_IDS) {
      const visuals = createPlanetVisuals(id, 1)
      applyPlanetMaps(id, visuals, { albedo: tex })
      const mat = visuals.globe.material as THREE.ShaderMaterial
      const uni = mat.uniforms.albedoMap ?? mat.uniforms.dayMap
      expect(uni?.value, `${id} did not receive albedo`).toBe(tex)
      if (mat.uniforms.hasMap) expect(mat.uniforms.hasMap.value).toBe(1)
    }
  })

  it('keeps distinctive layers: Venus clouds, Earth night+clouds, Mars, Saturn rings, ice-giant atmo', () => {
    const venus = createPlanetVisuals('venus', 1)
    expect(venus.clouds).toBeInstanceOf(THREE.Mesh)
    expect(venus.atmosphere).toBeInstanceOf(THREE.Mesh)
    const vCloud = venus.clouds!.material as THREE.ShaderMaterial
    expect(vCloud.uniforms.cloudMap).toBeDefined()

    const earth = createPlanetVisuals('earth', 1)
    const eMat = earth.globe.material as THREE.ShaderMaterial
    expect(eMat.uniforms.nightMap).toBeDefined()
    expect(eMat.uniforms.specularMap).toBeDefined()
    expect(earth.clouds).toBeInstanceOf(THREE.Mesh)
    expect(earth.atmosphere).toBeInstanceOf(THREE.Mesh)

    const mars = createPlanetVisuals('mars', 1)
    const mMat = mars.globe.material as THREE.ShaderMaterial
    expect(mMat.uniforms.normalMap).toBeDefined()
    expect(mars.atmosphere).toBeInstanceOf(THREE.Mesh)

    const saturn = createPlanetVisuals('saturn', 2)
    expect(saturn.rings).toBeInstanceOf(THREE.Mesh)
    const rMat = saturn.rings!.material as THREE.ShaderMaterial
    expect(rMat.uniforms.ringMap).toBeDefined()
    expect(rMat.fragmentShader).toMatch(/shadow|planetRadius/)

    const uranus = createPlanetVisuals('uranus', 1)
    expect(uranus.rings).toBeInstanceOf(THREE.Mesh)
    expect(uranus.atmosphere).toBeInstanceOf(THREE.Mesh)

    const neptune = createPlanetVisuals('neptune', 1)
    expect(neptune.atmosphere).toBeInstanceOf(THREE.Mesh)
    expect((neptune.globe.material as THREE.ShaderMaterial).fragmentShader).toMatch(
      /methane/,
    )

    const moon = createPlanetVisuals('moon', 0.27)
    expect(moon.atmosphere).toBeUndefined()
    expect(moon.clouds).toBeUndefined()
    const moonMat = moon.globe.material as THREE.ShaderMaterial
    expect(moonMat.uniforms.earthPosition).toBeDefined()
    expect(moonMat.fragmentShader).toMatch(/earthshine|earthFacing/)
    expect(moonMat.fragmentShader).toMatch(/dFdx/)
  })

  it('does not yaw Earth or Venus clouds from wall-clock time', () => {
    const sunPosition = new THREE.Vector3()
    const earth = createPlanetVisuals('earth', 1)
    const venus = createPlanetVisuals('venus', 1)
    updatePlanetVisuals('earth', earth, { time: 100, sunPosition })
    updatePlanetVisuals('venus', venus, { time: 100, sunPosition })
    expect(earth.clouds!.rotation.y).toBe(0)
    expect(venus.clouds!.rotation.y).toBe(0)

    const vCloud = venus.clouds!.material as THREE.ShaderMaterial
    expect(vCloud.fragmentShader).not.toMatch(/vUv\s*\+\s*vec2\(\s*time/)
  })
})
