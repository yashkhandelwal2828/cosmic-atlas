/**
 * Real day/night Earth material.
 * Blends Solar System Scope day + night city-lights maps by N·L toward the Sun.
 */
import * as THREE from 'three'

export interface EarthMaterialMaps {
  dayMap: THREE.Texture
  nightMap: THREE.Texture
  normalMap?: THREE.Texture | null
  specularMap?: THREE.Texture | null
}

export function createEarthDayNightMaterial(
  maps: EarthMaterialMaps,
  sunPosition: THREE.Vector3,
): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      dayMap: { value: maps.dayMap },
      nightMap: { value: maps.nightMap },
      normalMap: { value: maps.normalMap ?? null },
      specularMap: { value: maps.specularMap ?? null },
      hasNormal: { value: maps.normalMap ? 1 : 0 },
      hasSpecular: { value: maps.specularMap ? 1 : 0 },
      sunPosition: { value: sunPosition.clone() },
      ambient: { value: 0.06 },
      nightBoost: { value: 1.35 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vPosW;
      varying vec3 vTangentW;
      varying vec3 vBitangentW;

      attribute vec4 tangent;

      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vPosW = world.xyz;
        mat3 nMat = mat3(modelMatrix);
        vNormalW = normalize(nMat * normal);
        // Approximate tangent frame for normal mapping
        vec3 t = normalize(nMat * vec3(1.0, 0.0, 0.0));
        t = normalize(t - vNormalW * dot(vNormalW, t));
        vTangentW = t;
        vBitangentW = cross(vNormalW, vTangentW);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D dayMap;
      uniform sampler2D nightMap;
      uniform sampler2D normalMap;
      uniform sampler2D specularMap;
      uniform float hasNormal;
      uniform float hasSpecular;
      uniform vec3 sunPosition;
      uniform float ambient;
      uniform float nightBoost;

      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vPosW;
      varying vec3 vTangentW;
      varying vec3 vBitangentW;

      void main() {
        vec3 N = normalize(vNormalW);
        if (hasNormal > 0.5) {
          vec3 nTex = texture2D(normalMap, vUv).xyz * 2.0 - 1.0;
          nTex.xy *= 0.9;
          mat3 TBN = mat3(normalize(vTangentW), normalize(vBitangentW), N);
          N = normalize(TBN * nTex);
        }

        vec3 L = normalize(sunPosition - vPosW);
        float NdotL = dot(N, L);
        // Soft terminator (real limb lighting, not hard cut)
        float dayFactor = smoothstep(-0.12, 0.22, NdotL);
        float nightFactor = 1.0 - smoothstep(-0.05, 0.35, NdotL);

        vec3 day = texture2D(dayMap, vUv).rgb;
        vec3 night = texture2D(nightMap, vUv).rgb;

        // Specular ocean glint on day side
        float spec = 0.0;
        if (hasSpecular > 0.5) {
          float ocean = texture2D(specularMap, vUv).r;
          vec3 V = normalize(cameraPosition - vPosW);
          vec3 H = normalize(L + V);
          spec = ocean * pow(max(dot(N, H), 0.0), 48.0) * dayFactor;
        }

        vec3 litDay = day * (ambient + (1.0 - ambient) * max(NdotL, 0.0));
        litDay += vec3(0.85, 0.92, 1.0) * spec * 0.55;

        // City lights only where night; slight warm boost
        vec3 city = night * nightBoost * nightFactor;

        vec3 color = mix(city, litDay, dayFactor);
        // Keep a little city bleed near terminator for realism
        color += city * 0.15 * (1.0 - dayFactor);

        gl_FragColor = vec4(color, 1.0);
      }
    `,
  })
  mat.toneMapped = true
  return mat
}

export function updateEarthSunUniform(
  mat: THREE.ShaderMaterial,
  sunPosition: THREE.Vector3,
): void {
  if (mat.uniforms?.sunPosition) {
    mat.uniforms.sunPosition.value.copy(sunPosition)
  }
}
