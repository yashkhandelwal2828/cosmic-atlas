/**
 * Venus — opaque sulfuric cloud deck over a hot surface.
 * Atmosphere map is what you see from space; surface only leaks in dark seams.
 */
import * as THREE from 'three'
import {
  PLANET_VERTEX,
  SPHERE_W,
  SPHERE_H,
  createAtmosphereMaterial,
  globeMesh,
  setSunOnMaterials,
  setTimeOnMaterials,
} from './common'
import type { PlanetMaps, PlanetUpdateCtx, PlanetVisuals } from './types'

function createSurfaceMaterial(): THREE.ShaderMaterial {
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
        float NdotL = dot(N, L);
        vec3 albedo = hasMap > 0.5
          ? texture2D(albedoMap, vUv).rgb
          : vec3(0.55, 0.38, 0.18);
        float wrap = (NdotL + 0.35) / 1.35;
        float day = smoothstep(-0.2, 0.25, wrap);
        vec3 lit = albedo * (0.12 + 0.88 * max(wrap, 0.0));
        gl_FragColor = vec4(mix(albedo * 0.08, lit, day), 1.0);
      }
    `,
  })
  mat.toneMapped = true
  return mat
}

function createCloudMaterial(): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      cloudMap: { value: null },
      hasMap: { value: 0 },
      sunPosition: { value: new THREE.Vector3() },
      time: { value: 0 },
    },
    vertexShader: PLANET_VERTEX,
    fragmentShader: /* glsl */ `
      uniform sampler2D cloudMap;
      uniform float hasMap;
      uniform vec3 sunPosition;
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vPosW;

      void main() {
        vec3 N = normalize(vNormalW);
        vec3 L = normalize(sunPosition - vPosW);
        vec3 V = normalize(cameraPosition - vPosW);
        float mu = max(dot(N, V), 0.0);
        float wrap = (dot(N, L) + 0.4) / 1.4;

        vec3 clouds = hasMap > 0.5
          ? texture2D(cloudMap, vUv).rgb
          : vec3(0.85, 0.72, 0.42);

        // Thick deck — nearly opaque, warmer on the dayside.
        float day = smoothstep(-0.15, 0.3, wrap);
        vec3 dayCol = clouds * vec3(1.06, 0.96, 0.72) * (0.35 + 0.75 * max(wrap, 0.0));
        vec3 nightCol = clouds * vec3(0.12, 0.08, 0.05);
        vec3 color = mix(nightCol, dayCol, day);

        // Sulfuric limb — yellow-white, not a hard rim.
        float limb = pow(1.0 - mu, 2.4);
        color += vec3(1.0, 0.78, 0.4) * limb * 0.55;

        float alpha = 0.88 + 0.1 * limb;
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
  })
  mat.toneMapped = true
  return mat
}

export function createVenusVisuals(radius: number): PlanetVisuals {
  const surfaceMat = createSurfaceMaterial()
  const cloudMat = createCloudMaterial()
  const atmoMat = createAtmosphereMaterial(0xffd28a, {
    power: 2.6,
    intensity: 1.15,
  })

  const globe = globeMesh(radius, surfaceMat, 'venus-mesh')
  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.012, SPHERE_W, SPHERE_H),
    cloudMat,
  )
  clouds.name = 'venus-clouds'
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.055, 80, 56),
    atmoMat,
  )
  atmosphere.name = 'venus-atmo'

  return {
    globe,
    clouds,
    atmosphere,
    materials: [surfaceMat, cloudMat, atmoMat],
  }
}

export function applyVenusMaps(visuals: PlanetVisuals, maps: PlanetMaps): void {
  const surface = visuals.globe.material as THREE.ShaderMaterial
  if (maps.albedo) {
    surface.uniforms.albedoMap.value = maps.albedo
    surface.uniforms.hasMap.value = 1
  }
  const clouds = visuals.clouds?.material as THREE.ShaderMaterial | undefined
  if (clouds && maps.atmosphere) {
    clouds.uniforms.cloudMap.value = maps.atmosphere
    clouds.uniforms.hasMap.value = 1
  }
}

export function updateVenus(visuals: PlanetVisuals, ctx: PlanetUpdateCtx): void {
  setSunOnMaterials(visuals.materials, ctx.sunPosition)
  setTimeOnMaterials(visuals.materials, ctx.time)
}
