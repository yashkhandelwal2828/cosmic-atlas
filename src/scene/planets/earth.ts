/**
 * Earth — day/night city lights, ocean glint, cloud deck, Rayleigh limb.
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

function createGlobeMaterial(): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      dayMap: { value: null },
      nightMap: { value: null },
      normalMap: { value: null },
      specularMap: { value: null },
      hasMap: { value: 0 },
      hasNight: { value: 0 },
      hasNormal: { value: 0 },
      hasSpecular: { value: 0 },
      sunPosition: { value: new THREE.Vector3() },
      time: { value: 0 },
    },
    vertexShader: PLANET_VERTEX,
    fragmentShader: /* glsl */ `
      uniform sampler2D dayMap;
      uniform sampler2D nightMap;
      uniform sampler2D normalMap;
      uniform sampler2D specularMap;
      uniform float hasMap;
      uniform float hasNight;
      uniform float hasNormal;
      uniform float hasSpecular;
      uniform vec3 sunPosition;
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vPosW;

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
        float day = smoothstep(-0.12, 0.22, NdotL);
        float night = 1.0 - smoothstep(-0.05, 0.35, NdotL);

        vec3 dayCol = hasMap > 0.5
          ? texture2D(dayMap, vUv).rgb
          : vec3(0.12, 0.22, 0.45);
        vec3 nightCol = hasNight > 0.5
          ? texture2D(nightMap, vUv).rgb
          : vec3(0.0);

        float spec = 0.0;
        if (hasSpecular > 0.5) {
          float ocean = texture2D(specularMap, vUv).r;
          vec3 H = normalize(L + V);
          spec = ocean * pow(max(dot(N, H), 0.0), 52.0) * day;
        }

        vec3 litDay = dayCol * (0.07 + 0.93 * max(NdotL, 0.0));
        litDay += vec3(0.85, 0.92, 1.0) * spec * 0.6;

        vec3 city = nightCol * 1.4 * night;
        vec3 color = mix(city, litDay, day);
        color += city * 0.18 * (1.0 - day);

        gl_FragColor = vec4(color, 1.0);
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
        float NdotL = dot(N, L);
        float cover = hasMap > 0.5 ? texture2D(cloudMap, vUv).r : 0.0;
        float day = smoothstep(-0.08, 0.25, NdotL);
        vec3 lit = vec3(0.95, 0.96, 0.98) * (0.25 + 0.75 * max(NdotL, 0.0));
        vec3 dusk = vec3(1.0, 0.72, 0.48) * 0.35;
        vec3 color = mix(dusk, lit, day);
        float alpha = cover * mix(0.22, 0.78, day);
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
  })
  mat.toneMapped = true
  return mat
}

export function createEarthVisuals(radius: number): PlanetVisuals {
  const globeMat = createGlobeMaterial()
  const cloudMat = createCloudMaterial()
  const atmoMat = createAtmosphereMaterial(0x6eb6ff, {
    power: 3.0,
    intensity: 1.25,
  })

  const globe = globeMesh(radius, globeMat, 'earth-mesh')
  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.018, SPHERE_W, SPHERE_H),
    cloudMat,
  )
  clouds.name = 'earth-clouds'
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.05, 80, 56),
    atmoMat,
  )
  atmosphere.name = 'earth-atmo'

  return {
    globe,
    clouds,
    atmosphere,
    materials: [globeMat, cloudMat, atmoMat],
  }
}

export function applyEarthMaps(visuals: PlanetVisuals, maps: PlanetMaps): void {
  const mat = visuals.globe.material as THREE.ShaderMaterial
  if (maps.albedo) {
    mat.uniforms.dayMap.value = maps.albedo
    mat.uniforms.hasMap.value = 1
  }
  if (maps.night) {
    mat.uniforms.nightMap.value = maps.night
    mat.uniforms.hasNight.value = 1
  }
  if (maps.normal) {
    mat.uniforms.normalMap.value = maps.normal
    mat.uniforms.hasNormal.value = 1
  }
  if (maps.specular) {
    mat.uniforms.specularMap.value = maps.specular
    mat.uniforms.hasSpecular.value = 1
  }
  const clouds = visuals.clouds?.material as THREE.ShaderMaterial | undefined
  if (clouds && maps.clouds) {
    clouds.uniforms.cloudMap.value = maps.clouds
    clouds.uniforms.hasMap.value = 1
  }
}

export function updateEarth(visuals: PlanetVisuals, ctx: PlanetUpdateCtx): void {
  setSunOnMaterials(visuals.materials, ctx.sunPosition)
  setTimeOnMaterials(visuals.materials, ctx.time)
}
