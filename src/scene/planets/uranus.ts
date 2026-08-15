/**
 * Uranus — methane ice giant, 2K real map, faint rings, cyan limb.
 */
import * as THREE from 'three'
import {
  PLANET_VERTEX,
  RING_PARTICLES_GLSL,
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
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vPosW;

      void main() {
        vec3 N = normalize(vNormalW);
        vec3 L = normalize(sunPosition - vPosW);
        vec3 V = normalize(cameraPosition - vPosW);
        float mu = max(dot(N, V), 0.0);
        float wrap = (dot(N, L) + 0.32) / 1.32;

        vec3 albedo = hasMap > 0.5
          ? texture2D(albedoMap, vUv).rgb
          : vec3(0.55, 0.82, 0.86);

        float limb = max(0.26 + 0.9 * mu - 0.2 * (1.0 - mu) * (1.0 - mu), 0.1);
        float day = smoothstep(-0.2, 0.28, wrap);
        vec3 lit = albedo * limb * (0.16 + 0.9 * max(wrap, 0.0));
        vec3 night = albedo * vec3(0.03, 0.045, 0.055);
        vec3 color = mix(night, lit, day);
        color += vec3(0.45, 0.9, 1.0) * pow(1.0 - mu, 2.8) * 0.16;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  })
  mat.toneMapped = true
  return mat
}

function createRingMaterial(radius: number): THREE.ShaderMaterial {
  const inner = radius * 1.4
  const outer = radius * 1.95
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      sunPosition: { value: new THREE.Vector3() },
      innerR: { value: inner },
      outerR: { value: outer },
      // Uranus rings are narrow, dark and genuinely chunky — boulder-dominated
      // with almost none of Saturn fine ice — so grains run coarser here
      // relative to ring width: ~55 cells across it rather than Saturn ~215.
      cellSize: { value: radius * 0.018 },
      time: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vPosW;
      varying vec3 vLocal;
      void main() {
        vLocal = position;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vPosW = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 sunPosition;
      uniform float innerR;
      uniform float outerR;
      uniform float cellSize;
      uniform float time;
      varying vec3 vPosW;
      varying vec3 vLocal;

      ${RING_PARTICLES_GLSL}

      void main() {
        float rho = length(vLocal.xy);
        float u = (rho - innerR) / max(outerR - innerR, 0.001);
        float band = smoothstep(0.0, 0.08, u) * smoothstep(1.0, 0.92, u);
        float gaps = 0.45 + 0.55 * step(0.35, fract(u * 7.0));

        vec2 rubble = ringParticles(vLocal.xy, innerR, cellSize, time);

        vec3 L = normalize(sunPosition - vPosW);
        float lit = 0.4 + 0.6 * max(L.y * 0.3 + 0.7, 0.0);
        vec3 col = vec3(0.62, 0.72, 0.78) * lit * rubble.y;
        float alpha = clamp(0.22 * band * gaps * rubble.x, 0.0, 1.0);
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
  })
  mat.toneMapped = true
  return mat
}

export function createUranusVisuals(radius: number): PlanetVisuals {
  const globeMat = createGlobeMaterial()
  const ringMat = createRingMaterial(radius)
  const atmoMat = createAtmosphereMaterial(0x7ec8ff, {
    power: 2.7,
    intensity: 0.95,
  })
  const globe = globeMesh(radius, globeMat, 'uranus-mesh')
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.045, 80, 56),
    atmoMat,
  )
  atmosphere.name = 'uranus-atmo'

  const inner = radius * 1.4
  const outer = radius * 1.95
  const rings = new THREE.Mesh(
    new THREE.RingGeometry(inner, outer, 160, 4),
    ringMat,
  )
  // Equatorial plane, exactly. Uranus' 97.77deg tilt comes from the scene's
  // tiltGroup, which leaves these rings standing almost perpendicular to the
  // ecliptic — that is the real geometry, not a bug.
  rings.rotation.x = -Math.PI / 2
  rings.name = 'uranus-rings'

  return {
    globe,
    atmosphere,
    rings,
    materials: [globeMat, ringMat, atmoMat],
  }
}

export function applyUranusMaps(visuals: PlanetVisuals, maps: PlanetMaps): void {
  const mat = visuals.globe.material as THREE.ShaderMaterial
  if (maps.albedo) {
    mat.uniforms.albedoMap.value = maps.albedo
    mat.uniforms.hasMap.value = 1
  }
}

export function updateUranus(visuals: PlanetVisuals, ctx: PlanetUpdateCtx): void {
  setSunOnMaterials(visuals.materials, ctx.sunPosition)
  setTimeOnMaterials(visuals.materials, ctx.time)
}
