/**
 * Moon — airless, cratered, tidally locked.
 * Hard terminator, albedo-derived relief, maria/highland split, Earthshine.
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
      earthPosition: { value: new THREE.Vector3() },
      time: { value: 0 },
    },
    vertexShader: PLANET_VERTEX,
    fragmentShader: /* glsl */ `
      uniform sampler2D albedoMap;
      uniform float hasMap;
      uniform vec3 sunPosition;
      uniform vec3 earthPosition;
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vPosW;

      void main() {
        vec3 N = normalize(vNormalW);
        vec3 L = normalize(sunPosition - vPosW);
        vec3 V = normalize(cameraPosition - vPosW);
        vec3 E = normalize(earthPosition - vPosW);
        float NdotL = dot(N, L);
        float mu = max(dot(N, V), 0.0);

        vec3 albedo = hasMap > 0.5
          ? pow(texture2D(albedoMap, vUv).rgb, vec3(0.88)) * 1.22
          : vec3(0.55, 0.53, 0.50);

        float lum = dot(albedo, vec3(0.299, 0.587, 0.114));
        vec3 bump = normalize(vec3(-dFdx(lum) * 5.2, -dFdy(lum) * 5.2, 1.0));
        float relief = 0.78 + 0.32 * bump.z;
        albedo *= relief;

        // Dark maria run cooler/bluer; bright highlands stay warm anorthosite.
        float mare = 1.0 - smoothstep(0.18, 0.42, lum);
        albedo = mix(albedo, albedo * vec3(0.86, 0.90, 1.04), mare * 0.45);

        // Airless: hard terminator, almost no wrap.
        float day = smoothstep(-0.03, 0.14, NdotL);
        float shade = 0.03 + 0.97 * max(NdotL, 0.0);
        shade *= 0.58 + 0.42 * mu;

        vec3 lit = albedo * shade;

        // Earthshine: faint blue-gray fill on the night hemisphere facing Earth.
        float earthFacing = max(dot(N, E), 0.0);
        float night = 1.0 - day;
        vec3 earthshine = vec3(0.22, 0.36, 0.58) * earthFacing * night * 0.16;
        vec3 nightFill = albedo * vec3(0.028, 0.028, 0.034);
        vec3 color = mix(nightFill, lit, day) + earthshine;

        // Hairline silhouette so the disc reads against the starfield.
        color += albedo * pow(1.0 - mu, 5.5) * 0.07;

        gl_FragColor = vec4(color, 1.0);
      }
    `,
  })
  mat.toneMapped = true
  return mat
}

export function createMoonVisuals(radius: number): PlanetVisuals {
  const globeMat = createGlobeMaterial()
  const globe = globeMesh(radius, globeMat, 'moon-mesh')
  return { globe, materials: [globeMat] }
}

export function applyMoonMaps(visuals: PlanetVisuals, maps: PlanetMaps): void {
  const mat = visuals.globe.material as THREE.ShaderMaterial
  if (maps.albedo) {
    mat.uniforms.albedoMap.value = maps.albedo
    mat.uniforms.hasMap.value = 1
    mat.needsUpdate = true
  }
}

export function updateMoon(visuals: PlanetVisuals, ctx: PlanetUpdateCtx): void {
  setSunOnMaterials(visuals.materials, ctx.sunPosition)
  setTimeOnMaterials(visuals.materials, ctx.time)
  if (!ctx.earthPosition) return
  for (const mat of visuals.materials) {
    if (mat.uniforms?.earthPosition) {
      mat.uniforms.earthPosition.value.copy(ctx.earthPosition)
    }
  }
}
