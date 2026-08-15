/**
 * Neptune — deep methane blue, 2K real map, stormy wrap light.
 */
import * as THREE from 'three'
import {
  PLANET_VERTEX,
  createAtmosphereMaterial,
  globeMesh,
  setSunOnMaterials,
  setTimeOnMaterials,
} from './common'
import type { PlanetMaps, PlanetUpdateCtx, PlanetVisuals } from './types'

function createGlobeMaterial(): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      albedoMap: { value: null },
      hasMap: { value: 0 },
      sunPosition: { value: new THREE.Vector3() },
      time: { value: 0 },
    },
    vertexShader: PLANET_VERTEX,
    fragmentShader: /* glsl */ `
      uniform sampler2D albedoMap;
      uniform float hasMap;
      uniform vec3 sunPosition;
      uniform float time;
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vPosW;
      varying vec3 vLocalN;

      void main() {
        vec3 N = normalize(vNormalW);
        vec3 L = normalize(sunPosition - vPosW);
        vec3 V = normalize(cameraPosition - vPosW);
        float mu = max(dot(N, V), 0.0);
        float wrap = (dot(N, L) + 0.34) / 1.34;

        vec2 uv = vUv + vec2(time * 0.0025, 0.0);
        vec3 albedo = hasMap > 0.5
          ? texture2D(albedoMap, uv).rgb
          : vec3(0.15, 0.32, 0.72);

        // Methane eats red toward the limb.
        vec3 methane = mix(albedo, albedo * vec3(0.55, 0.75, 1.15), 1.0 - mu);
        float limb = max(0.22 + 0.95 * mu - 0.22 * (1.0 - mu) * (1.0 - mu), 0.08);
        float day = smoothstep(-0.22, 0.3, wrap);
        vec3 lit = methane * limb * (0.14 + 0.95 * max(wrap, 0.0));
        vec3 night = methane * vec3(0.02, 0.04, 0.08);
        vec3 color = mix(night, lit, day);
        color += vec3(0.25, 0.55, 1.0) * pow(1.0 - mu, 2.5) * 0.22;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  })
  mat.toneMapped = true
  return mat
}

export function createNeptuneVisuals(radius: number): PlanetVisuals {
  const globeMat = createGlobeMaterial()
  const atmoMat = createAtmosphereMaterial(0x4aa0ff, {
    power: 2.55,
    intensity: 1.05,
  })
  const globe = globeMesh(radius, globeMat, 'neptune-mesh')
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.048, 80, 56),
    atmoMat,
  )
  atmosphere.name = 'neptune-atmo'
  return { globe, atmosphere, materials: [globeMat, atmoMat] }
}

export function applyNeptuneMaps(visuals: PlanetVisuals, maps: PlanetMaps): void {
  const mat = visuals.globe.material as THREE.ShaderMaterial
  if (maps.albedo) {
    mat.uniforms.albedoMap.value = maps.albedo
    mat.uniforms.hasMap.value = 1
  }
}

export function updateNeptune(visuals: PlanetVisuals, ctx: PlanetUpdateCtx): void {
  setSunOnMaterials(visuals.materials, ctx.sunPosition)
  setTimeOnMaterials(visuals.materials, ctx.time)
}
