/**
 * Saturn — pale gold gas globe + real ring alpha.
 * Rings receive planet shadow; the globe receives ring shadow.
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

function createGlobeMaterial(radius: number): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      albedoMap: { value: null },
      hasMap: { value: 0 },
      sunPosition: { value: new THREE.Vector3() },
      time: { value: 0 },
      planetRadius: { value: radius },
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
        float wrap = (dot(N, L) + 0.3) / 1.3;

        vec3 albedo = hasMap > 0.5
          ? texture2D(albedoMap, vUv).rgb
          : vec3(0.86, 0.74, 0.48);

        float limb = max(0.3 + 0.82 * mu - 0.16 * (1.0 - mu) * (1.0 - mu), 0.14);
        float day = smoothstep(-0.16, 0.26, wrap);
        vec3 lit = albedo * limb * (0.14 + 0.92 * max(wrap, 0.0));
        vec3 night = albedo * vec3(0.045, 0.04, 0.035);
        vec3 color = mix(night, lit, day);

        // Ring-plane shadow: darken southern/northern band when sun is across the rings.
        float ringPlane = abs(vLocalN.y);
        float sunLat = normalize(sunPosition - vPosW).y;
        float across = step(0.0, -vLocalN.y * sunLat);
        float shadow = across * (1.0 - smoothstep(0.02, 0.18, ringPlane)) * day;
        color *= 1.0 - shadow * 0.45;

        gl_FragColor = vec4(color, 1.0);
      }
    `,
  })
  mat.toneMapped = true
  return mat
}

function createRingMaterial(radius: number): THREE.ShaderMaterial {
  const inner = radius * 1.32
  const outer = radius * 2.4
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ringMap: { value: null },
      hasMap: { value: 0 },
      sunPosition: { value: new THREE.Vector3() },
      planetCenter: { value: new THREE.Vector3() },
      planetRadius: { value: radius },
      innerR: { value: inner },
      outerR: { value: outer },
      // Coarsest grain cell. The ring spans ~1.08 planet radii, so this puts
      // ~215 cells across its width, with the finer layers reaching ~2400 —
      // dense enough to read as gravel rather than as leopard spots.
      cellSize: { value: radius * 0.011 },
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
      uniform sampler2D ringMap;
      uniform float hasMap;
      uniform vec3 sunPosition;
      uniform vec3 planetCenter;
      uniform float planetRadius;
      uniform float innerR;
      uniform float outerR;
      uniform float cellSize;
      uniform float time;
      varying vec3 vPosW;
      varying vec3 vLocal;

      ${RING_PARTICLES_GLSL}

      void main() {
        float rho = length(vLocal.xy);
        float u = clamp((rho - innerR) / max(outerR - innerR, 0.001), 0.0, 1.0);
        vec4 tex = hasMap > 0.5 ? texture2D(ringMap, vec2(u, 0.5)) : vec4(0.85, 0.78, 0.62, 0.35);
        float alpha = max(tex.a, tex.r * 0.35);

        // The radial map carries the bands; this carries the bodies making them.
        vec2 rubble = ringParticles(vLocal.xy, innerR, cellSize, time);
        alpha = clamp(alpha * rubble.x, 0.0, 1.0);
        if (alpha < 0.02) discard;

        vec3 L = normalize(sunPosition - vPosW);
        // Planet umbra on the rings.
        vec3 oc = planetCenter - vPosW;
        float tca = dot(oc, L);
        float d2 = dot(oc, oc) - tca * tca;
        float shadowed = 0.0;
        if (tca > 0.0 && d2 < planetRadius * planetRadius) shadowed = 1.0;

        vec3 col = tex.rgb * rubble.y * mix(1.0, 0.18, shadowed);
        float sun = 0.55 + 0.45 * max(L.y * 0.35 + 0.65, 0.0);
        gl_FragColor = vec4(col * sun, alpha);
      }
    `,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
  })
  mat.toneMapped = true
  return mat
}

function makeRingGeometry(radius: number): THREE.RingGeometry {
  const inner = radius * 1.32
  const outer = radius * 2.4
  const geo = new THREE.RingGeometry(inner, outer, 192, 8)
  const pos = geo.attributes.position
  const uv = geo.attributes.uv
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const len = Math.sqrt(x * x + y * y)
    const u = (len - inner) / (outer - inner)
    uv.setXY(i, u, 0.5)
  }
  uv.needsUpdate = true
  return geo
}

export function createSaturnVisuals(radius: number): PlanetVisuals {
  const globeMat = createGlobeMaterial(radius)
  const ringMat = createRingMaterial(radius)
  const atmoMat = createAtmosphereMaterial(0xffe0b0, {
    power: 2.9,
    intensity: 0.5,
  })

  const globe = globeMesh(radius, globeMat, 'saturn-mesh')
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.032, 80, 56),
    atmoMat,
  )
  atmosphere.name = 'saturn-atmo'
  const rings = new THREE.Mesh(makeRingGeometry(radius), ringMat)
  // Exactly flat in the body's equatorial plane — the 26.73deg tilt you see comes
  // from the scene's tiltGroup, not from a fudged ring rotation.
  rings.rotation.x = -Math.PI / 2
  rings.name = 'saturn-rings'

  return {
    globe,
    atmosphere,
    rings,
    materials: [globeMat, ringMat, atmoMat],
  }
}

export function applySaturnMaps(visuals: PlanetVisuals, maps: PlanetMaps): void {
  const globe = visuals.globe.material as THREE.ShaderMaterial
  if (maps.albedo) {
    globe.uniforms.albedoMap.value = maps.albedo
    globe.uniforms.hasMap.value = 1
  }
  const rings = visuals.rings?.material as THREE.ShaderMaterial | undefined
  if (rings && maps.rings) {
    maps.rings.colorSpace = THREE.SRGBColorSpace
    rings.uniforms.ringMap.value = maps.rings
    rings.uniforms.hasMap.value = 1
  }
}

export function updateSaturn(visuals: PlanetVisuals, ctx: PlanetUpdateCtx): void {
  setSunOnMaterials(visuals.materials, ctx.sunPosition)
  setTimeOnMaterials(visuals.materials, ctx.time)
  const rings = visuals.rings?.material as THREE.ShaderMaterial | undefined
  if (rings?.uniforms.planetCenter) {
    visuals.globe.getWorldPosition(rings.uniforms.planetCenter.value)
  }
}
