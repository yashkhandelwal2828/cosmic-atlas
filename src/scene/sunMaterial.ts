/**
 * Physically based Sun.
 * Photosphere: real SSS map + limb darkening.
 * Limb: irregular spicules, tongues, and prominence loops — not a ring.
 */
import * as THREE from 'three'

export interface SunVisuals {
  photosphere: THREE.Mesh
  flames: THREE.Mesh
  materials: THREE.ShaderMaterial[]
}

const PHOTO_W = 192
const PHOTO_H = 128

const NOISE_GLSL = /* glsl */ `
  float hash13(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.13));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float vnoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(
        mix(hash13(i), hash13(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), f.x),
        f.y
      ),
      mix(
        mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), f.x),
        f.y
      ),
      f.z
    );
  }

  float fbm(vec3 p) {
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      s += a * vnoise(p);
      p = p * 2.03 + vec3(0.17, 0.31, 0.13);
      a *= 0.5;
    }
    return s;
  }

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
      mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }

  float fbm2(vec2 p) {
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      s += a * noise2(p);
      p = p * 2.07 + vec2(0.13, 0.27);
      a *= 0.5;
    }
    return s;
  }

  float angDist(float a, float b) {
    float d = mod(a - b + 3.14159265, 6.2831853) - 3.14159265;
    return abs(d);
  }
`

const SUN_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec3 vLocalN;

  void main() {
    vUv = uv;
    vLocalN = normalize(position);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPosW = world.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

function createPhotosphereMaterial(): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      sunMap: { value: null },
      hasMap: { value: 0 },
      time: { value: 0 },
      // Ignition dimmer. 1 in normal operation; the intro ramps it up from 0 so
      // the star lights rather than pops into existence.
      intensity: { value: 1 },
    },
    vertexShader: SUN_VERTEX,
    fragmentShader: /* glsl */ `
      uniform sampler2D sunMap;
      uniform float hasMap;
      uniform float time;
      uniform float intensity;

      varying vec2 vUv;
      varying vec3 vNormalW;
      varying vec3 vPosW;
      varying vec3 vLocalN;

      ${NOISE_GLSL}

      void main() {
        vec3 N = normalize(vNormalW);
        vec3 V = normalize(cameraPosition - vPosW);
        float mu = max(dot(N, V), 0.0);

        // Neckel & Labs / Claret-style quadratic limb darkening (G2V, ~550 nm).
        // The floor is a *rendering* choice, not part of the fit: the real curve
        // keeps falling to near zero at the very edge, which crushed the last few
        // pixels of the disc to black and made the silhouette read as a hard cut
        // rather than as a glowing body.
        float x = 1.0 - mu;
        float limb = max(1.0 - 0.56 * x - 0.22 * x * x, 0.26);

        float lat = vLocalN.y;
        float spin = time * 0.045 * (1.0 - 0.38 * lat * lat);
        float cs = cos(spin);
        float sn = sin(spin);
        vec3 p = vec3(
          vLocalN.x * cs - vLocalN.z * sn,
          vLocalN.y,
          vLocalN.x * sn + vLocalN.z * cs
        );
        float gran = fbm(p * 7.5 + vec3(0.0, 0.0, time * 0.055));
        float granFine = fbm(p * 21.0 - vec3(time * 0.04, 0.0, 0.2));
        float granule = mix(0.86, 1.16, gran) * mix(0.94, 1.07, granFine);

        vec3 tex;
        if (hasMap > 0.5) {
          tex = texture2D(sunMap, vUv).rgb;
        } else {
          tex = mix(vec3(0.72, 0.28, 0.06), vec3(1.0, 0.78, 0.38), gran);
        }

        float lum = dot(tex, vec3(0.299, 0.587, 0.114));
        // Saturation is held high and the neutral mix below kept small on
        // purpose. Both of them pull toward grey/white, and a star that has been
        // pulled toward white stops looking like burning gas and starts looking
        // like a lit sphere of plastic — the hot centre is exactly where the eye
        // most expects colour, so that is the worst place to drain it.
        float sat = 0.94;
        tex = mix(vec3(lum), tex, sat) * vec3(1.10, 0.82, 0.50);
        tex = mix(tex, vec3(1.0, 0.93, 0.80) * lum, 0.07);

        float umbra = smoothstep(0.42, 0.14, lum);
        float facula = smoothstep(0.58, 0.9, lum);
        tex = mix(tex, tex * vec3(0.38, 0.14, 0.05), umbra * 0.7);
        // Faculae are hotter gas, not white paint — keep the boost inside the
        // fire ramp instead of letting bright patches desaturate to near-white.
        tex = mix(tex, tex * vec3(1.16, 0.99, 0.72), facula * 0.34);

        vec3 color = tex * granule;
        float height = lum * 0.55 + gran * 0.45;
        vec3 bump = normalize(vec3(-dFdx(height) * 7.0, -dFdy(height) * 7.0, 1.0));
        color *= 0.82 + 0.34 * bump.z;

        vec3 limbTint = mix(vec3(1.0), vec3(1.0, 0.58, 0.26), x * 0.66);
        color *= limb * limbTint;

        // Disc-centre HDR level.
        //
        // This was 3.35 — more than three times display white at the centre of a
        // large on-screen disc. Everything above ~1.8 is past where ACES can
        // still hold hue, so the core desaturated to pale yellow-white and the
        // bloom threshold caught the whole disc rather than just its hottest
        // patches. The result read as blown-out rather than bright: peak values
        // and mid values landed on the same output, erasing the granulation the
        // shader spends most of its cost computing.
        //
        // 1.85 still sits above white, so the centre glows and blooms — but the
        // texture, the granules, and the fire colour all survive the tonemap.
        float hdr = mix(0.98, 1.85, pow(mu, 1.15));
        color *= hdr * intensity;

        gl_FragColor = vec4(color, 1.0);
      }
    `,
  })
  mat.toneMapped = true
  return mat
}

function createFlameMaterial(diskR: number): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      diskR: { value: diskR },
      intensity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float time;
      uniform float diskR;
      uniform float intensity;
      varying vec2 vUv;

      ${NOISE_GLSL}

      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        if (r < diskR * 0.97 || r > 1.0) discard;

        float theta = atan(p.y, p.x);
        float height = (r - diskR) / max(1.0 - diskR, 0.001);

        // Clump the limb so fire gathers in bursts, not a even ring.
        float thetaW = theta + 0.18 * sin(theta * 5.0 + time * 0.21);

        // Spicules — dense short hair that breaks the circular silhouette.
        float spicN = fbm2(vec2(thetaW * 26.0, time * 0.55));
        float spicule = 0.07 + 0.16 * pow(spicN, 1.15);

        // Medium tongues.
        float tongN = fbm2(vec2(thetaW * 7.2 - time * 0.11, 1.4 + time * 0.13));
        float tongue = 0.55 * pow(max(tongN - 0.2, 0.0), 0.85);

        // A few large flare eruptions that breathe.
        float flare = 0.0;
        for (int i = 0; i < 6; i++) {
          float seed = float(i) * 1.07 + 0.35;
          float a = seed * 2.15 + 0.28 * sin(time * 0.09 + seed * 1.7);
          float da = angDist(theta, a);
          float env = smoothstep(0.42, 0.0, da);
          float breathe = 0.65 + 0.35 * sin(time * 0.45 + seed * 2.4);
          float reach = (0.28 + 0.32 * hash12(vec2(seed, 3.1))) * breathe;
          flare += env * reach;
        }

        // Radial streaks: plasma rising off the limb.
        float streak = fbm2(vec2(thetaW * 18.0, height * 11.0 - time * 0.95));
        float flicker = 0.7 + 0.3 * fbm2(vec2(thetaW * 9.0, time * 1.6));

        float maxH = max(spicule, max(tongue, flare));
        maxH *= 0.7 + 0.55 * streak;
        if (height > maxH) discard;

        float u = height / max(maxH, 0.02);
        // Teardrop: thick at the limb, tapering to torn tips.
        float profile = (1.0 - u) * (1.0 - u) * (1.0 + 2.4 * u);
        float torn = smoothstep(0.22, 0.75, streak);
        float flame = profile * mix(0.35, 1.0, torn) * flicker;
        if (flame < 0.02) discard;

        float heat = exp(-u * 2.1);
        vec3 hot = vec3(1.0, 0.95, 0.62);
        vec3 mid = vec3(1.0, 0.5, 0.08);
        vec3 cool = vec3(1.0, 0.18, 0.03);
        vec3 col = mix(cool, mid, clamp(heat * 1.15, 0.0, 1.0));
        col = mix(col, hot, clamp(heat * heat * 0.95, 0.0, 1.0));

        float a = clamp(flame * (0.7 + 0.65 * heat), 0.0, 1.0) * intensity;
        // Additive on top of a disc that is itself above white: at 1.55 the
        // corona stacked into a solid band at the limb instead of reading as
        // separate tongues. Dropped to sit just under the photosphere it rises
        // from, which is also the right order physically.
        gl_FragColor = vec4(col * a * 1.05, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })
  mat.toneMapped = true
  return mat
}

export function createSunVisuals(radius: number): SunVisuals {
  const photoMat = createPhotosphereMaterial()

  const flameScale = radius * 2.95
  const diskR = (radius * 2.0) / flameScale
  const flameMat = createFlameMaterial(diskR)

  const photosphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius, PHOTO_W, PHOTO_H),
    photoMat,
  )
  photosphere.name = 'sun-mesh'

  const flames = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), flameMat)
  flames.name = 'sun-flames'
  flames.scale.setScalar(flameScale)
  flames.renderOrder = 2
  flames.frustumCulled = false
  // Read back by updateSunFacing to fade the corona with camera distance.
  flames.userData.baseScale = flameScale
  flames.userData.radius = radius

  return {
    photosphere,
    flames,
    materials: [photoMat, flameMat],
  }
}

export function applySunMap(visuals: SunVisuals, map: THREE.Texture): void {
  const mat = visuals.photosphere.material as THREE.ShaderMaterial
  mat.uniforms.sunMap.value = map
  mat.uniforms.hasMap.value = 1
  mat.needsUpdate = true
}

export function updateSunTime(visuals: SunVisuals, time: number): void {
  for (const mat of visuals.materials) {
    if (mat.uniforms.time) mat.uniforms.time.value = time
  }
}

/** Ignition dimmer across every Sun layer. 1 is normal operation. */
export function setSunIntensity(visuals: SunVisuals, value: number): void {
  const v = Math.max(0, value)
  for (const mat of visuals.materials) {
    if (mat.uniforms.intensity) mat.uniforms.intensity.value = v
  }
}

/** Camera distance, in solar radii, at/below which the corona is drawn in full. */
const CORONA_FULL_RADII = 10
/** Distance, in solar radii, beyond which the corona shrinks to a tight disc. */
const CORONA_MIN_RADII = 30
/** Corona extent at maximum distance, as a multiple of the photosphere radius. */
const CORONA_MIN_SCALE = 1.4

const _sunWorld = new THREE.Vector3()

export function updateSunFacing(
  visuals: SunVisuals,
  camera: THREE.Camera,
): void {
  visuals.flames.lookAt(camera.position)

  // The corona is a billboard ~3x the photosphere. That reads beautifully in
  // close-up but from the whole-system view it spills across Mercury's and
  // Venus' orbits and hides them, so fade its extent out with distance.
  const base = visuals.flames.userData.baseScale as number | undefined
  const radius = visuals.flames.userData.radius as number | undefined
  if (!base || !radius) return

  const radii =
    visuals.flames.getWorldPosition(_sunWorld).distanceTo(camera.position) /
    radius
  const t = THREE.MathUtils.clamp(
    (radii - CORONA_FULL_RADII) / (CORONA_MIN_RADII - CORONA_FULL_RADII),
    0,
    1,
  )
  const eased = t * t * (3 - 2 * t)
  visuals.flames.scale.setScalar(
    THREE.MathUtils.lerp(base, radius * CORONA_MIN_SCALE, eased),
  )
}
