/**
 * Jupiter — banded gas giant.
 * Wrap lighting + strong limb darkening so belts read as volume, not a sticker.
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
        float wrap = (dot(N, L) + 0.28) / 1.28;

        // Keep real belts; only a whisper of zonal creep.
        vec2 uv = vUv + vec2(time * 0.003 * (1.0 - abs(vLocalN.y)), 0.0);
        vec3 albedo = hasMap > 0.5
          ? texture2D(albedoMap, uv).rgb
          : vec3(0.78, 0.62, 0.42);

        float limb = max(0.28 + 0.85 * mu - 0.18 * (1.0 - mu) * (1.0 - mu), 0.12);
        float day = smoothstep(-0.18, 0.28, wrap);
        vec3 lit = albedo * limb * (0.12 + 0.95 * max(wrap, 0.0));
        vec3 night = albedo * vec3(0.04, 0.035, 0.04);
        vec3 color = mix(night, lit, day);

        // Warm forward scatter near the terminator.
        float term = 1.0 - abs(smoothstep(-0.15, 0.25, wrap) * 2.0 - 1.0);
        color += vec3(1.0, 0.72, 0.4) * term * 0.08;

        gl_FragColor = vec4(color, 1.0);
      }
    `,
  })
  mat.toneMapped = true
  return mat
}

export function createJupiterVisuals(radius: number): PlanetVisuals {
  const globeMat = createGlobeMaterial()
  const atmoMat = createAtmosphereMaterial(0xffd4a0, {
    power: 2.8,
    intensity: 0.55,
  })
  const globe = globeMesh(radius, globeMat, 'jupiter-mesh')
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.03, 80, 56),
    atmoMat,
  )
  atmosphere.name = 'jupiter-atmo'
  return { globe, atmosphere, materials: [globeMat, atmoMat] }
}

export function applyJupiterMaps(visuals: PlanetVisuals, maps: PlanetMaps): void {
  const mat = visuals.globe.material as THREE.ShaderMaterial
  if (maps.albedo) {
    mat.uniforms.albedoMap.value = maps.albedo
    mat.uniforms.hasMap.value = 1
  }
}

export function updateJupiter(visuals: PlanetVisuals, ctx: PlanetUpdateCtx): void {
  setSunOnMaterials(visuals.materials, ctx.sunPosition)
  setTimeOnMaterials(visuals.materials, ctx.time)
}
