/**
 * Mars — rust desert with real 8K albedo + derived normal, thin CO2 halo.
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
      normalMap: { value: null },
      hasNormal: { value: 0 },
      sunPosition: { value: new THREE.Vector3() },
      time: { value: 0 },
    },
    vertexShader: PLANET_VERTEX,
    fragmentShader: /* glsl */ `
      uniform sampler2D albedoMap;
      uniform float hasMap;
      uniform sampler2D normalMap;
      uniform float hasNormal;
      uniform vec3 sunPosition;
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vPosW;
      varying vec3 vLocalN;

      void main() {
        vec3 N = normalize(vNormalW);
        if (hasNormal > 0.5) {
          vec3 nTex = texture2D(normalMap, vUv).xyz * 2.0 - 1.0;
          vec3 t = normalize(cross(N, vec3(0.0, 1.0, 0.0)));
          if (length(t) < 0.1) t = normalize(cross(N, vec3(1.0, 0.0, 0.0)));
          vec3 b = normalize(cross(N, t));
          N = normalize(mat3(t, b, N) * nTex);
        }

        vec3 L = normalize(sunPosition - vPosW);
        vec3 V = normalize(cameraPosition - vPosW);
        float NdotL = dot(N, L);
        float mu = max(dot(N, V), 0.0);

        vec3 albedo = hasMap > 0.5
          ? texture2D(albedoMap, vUv).rgb
          : vec3(0.62, 0.32, 0.18);

        // Polar ice reads brighter / cooler.
        float ice = smoothstep(0.55, 0.82, albedo.b / max(albedo.r, 0.05));
        albedo = mix(albedo, albedo * vec3(0.95, 0.97, 1.08), ice * 0.55);

        float day = smoothstep(-0.06, 0.2, NdotL);
        float shade = 0.05 + 0.95 * max(NdotL, 0.0);
        vec3 lit = albedo * shade;
        // Dusty night — faint warm fill, not earth city lights.
        vec3 night = albedo * vec3(0.04, 0.03, 0.035);
        vec3 color = mix(night, lit, day);

        float limb = pow(1.0 - mu, 3.2);
        color += vec3(1.0, 0.45, 0.22) * limb * 0.18 * day;

        gl_FragColor = vec4(color, 1.0);
      }
    `,
  })
  mat.toneMapped = true
  return mat
}

export function createMarsVisuals(radius: number): PlanetVisuals {
  const globeMat = createGlobeMaterial()
  const atmoMat = createAtmosphereMaterial(0xff8a5c, {
    power: 3.6,
    intensity: 0.7,
  })
  const globe = globeMesh(radius, globeMat, 'mars-mesh')
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.038, 80, 56),
    atmoMat,
  )
  atmosphere.name = 'mars-atmo'
  return { globe, atmosphere, materials: [globeMat, atmoMat] }
}

export function applyMarsMaps(visuals: PlanetVisuals, maps: PlanetMaps): void {
  const mat = visuals.globe.material as THREE.ShaderMaterial
  if (maps.albedo) {
    mat.uniforms.albedoMap.value = maps.albedo
    mat.uniforms.hasMap.value = 1
  }
  if (maps.normal) {
    mat.uniforms.normalMap.value = maps.normal
    mat.uniforms.hasNormal.value = 1
  }
}

export function updateMars(visuals: PlanetVisuals, ctx: PlanetUpdateCtx): void {
  setSunOnMaterials(visuals.materials, ctx.sunPosition)
  setTimeOnMaterials(visuals.materials, ctx.time)
}
