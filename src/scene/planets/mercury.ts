/**
 * Mercury — airless cratered rock.
 * Harsh terminator, albedo-derived relief, no atmosphere.
 */
import * as THREE from 'three'
import {
  PLANET_VERTEX,
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
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vPosW;

      void main() {
        vec3 N = normalize(vNormalW);
        vec3 L = normalize(sunPosition - vPosW);
        vec3 V = normalize(cameraPosition - vPosW);
        float NdotL = dot(N, L);
        float mu = max(dot(N, V), 0.0);

        vec3 albedo = hasMap > 0.5
          ? texture2D(albedoMap, vUv).rgb
          : vec3(0.42, 0.40, 0.38);

        float lum = dot(albedo, vec3(0.299, 0.587, 0.114));
        vec3 bump = normalize(vec3(-dFdx(lum) * 4.5, -dFdy(lum) * 4.5, 1.0));
        float relief = 0.82 + 0.28 * bump.z;
        albedo *= relief;

        // Airless: hard-ish terminator, no wrap scatter.
        float day = smoothstep(-0.04, 0.16, NdotL);
        float shade = 0.035 + 0.965 * max(NdotL, 0.0);
        shade *= 0.55 + 0.45 * mu;

        // Dark lunar-like night. Tiny earthshine-level fill.
        vec3 lit = albedo * shade;
        vec3 night = albedo * vec3(0.03, 0.03, 0.035);
        vec3 color = mix(night, lit, day);

        gl_FragColor = vec4(color, 1.0);
      }
    `,
  })
  mat.toneMapped = true
  return mat
}

export function createMercuryVisuals(radius: number): PlanetVisuals {
  const globeMat = createGlobeMaterial()
  const globe = globeMesh(radius, globeMat, 'mercury-mesh')
  return { globe, materials: [globeMat] }
}

export function applyMercuryMaps(visuals: PlanetVisuals, maps: PlanetMaps): void {
  const mat = visuals.globe.material as THREE.ShaderMaterial
  if (maps.albedo) {
    mat.uniforms.albedoMap.value = maps.albedo
    mat.uniforms.hasMap.value = 1
    mat.needsUpdate = true
  }
}

export function updateMercury(visuals: PlanetVisuals, ctx: PlanetUpdateCtx): void {
  setSunOnMaterials(visuals.materials, ctx.sunPosition)
  setTimeOnMaterials(visuals.materials, ctx.time)
}
