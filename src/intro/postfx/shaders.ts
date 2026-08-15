/**
 * GLSL for the intro-only screen passes.
 *
 * All three are written so that their neutral uniform value is a true identity:
 * `uStrength = 0` on the lens and blur, `uGrain = uVignette = uFlash = 0` on the
 * film pass, each reduce to a single unmodified texture fetch. That is what lets
 * the conductor cross-fade a pass out over a few frames and then dispose it
 * without a visible step.
 */
import * as THREE from 'three'

const SCREEN_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

/**
 * Gravitational lensing.
 *
 * Deflection falls off as 1/r from the projected singularity, softened by an
 * epsilon so the centre stays finite on screen. `uStrength` is signed: positive
 * pulls light inward (the black hole), negative pushes it outward (the blast).
 * The three channels are sampled at slightly different offsets, which is what
 * produces the coloured fringe on the Einstein ring rather than a flat halo.
 */
export const LensShader = {
  name: 'LensShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uStrength: { value: 0 },
    uAspect: { value: 1 },
    uRingRadius: { value: 0.08 },
    uRingWidth: { value: 0.02 },
    uRingColor: { value: new THREE.Color(0.62, 0.78, 1.0) },
    uChroma: { value: 0.08 },
  },
  vertexShader: SCREEN_VERTEX,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uCenter;
    uniform float uStrength;
    uniform float uAspect;
    uniform float uRingRadius;
    uniform float uRingWidth;
    uniform vec3 uRingColor;
    uniform float uChroma;
    varying vec2 vUv;

    void main() {
      vec2 d = vUv - uCenter;
      d.x *= uAspect;
      float r = length(d);
      vec2 dir = r > 1e-5 ? d / r : vec2(0.0);

      // The epsilon and the clamp are both doing real work. 1/r² without them
      // sends the near-centre displacement past a third of the screen, and at
      // that magnitude the per-channel offset stops being a fringe on the
      // Einstein ring and becomes a full-frame rainbow starburst.
      float bend = uStrength * 0.02 / (r * r + 0.05);
      bend = clamp(bend, -0.10, 0.10);

      vec2 off = dir * bend;
      off.x /= uAspect;

      vec3 col;
      col.r = texture2D(tDiffuse, vUv - off * (1.0 + uChroma)).r;
      col.g = texture2D(tDiffuse, vUv - off).g;
      col.b = texture2D(tDiffuse, vUv - off * (1.0 - uChroma)).b;

      // Photon ring: light grazing the horizon piles up at a fixed radius.
      float w = max(uRingWidth, 1e-4);
      float ring = exp(-pow((r - uRingRadius) / w, 2.0));
      col += uRingColor * ring * max(uStrength, 0.0) * 0.35;

      gl_FragColor = vec4(col, 1.0);
    }
  `,
}

/**
 * Radial motion blur, 8 taps along the line to the burst centre.
 * At `uStrength = 0` every tap lands on the same texel, so it is an identity.
 */
export const RadialBlurShader = {
  name: 'RadialBlurShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uStrength: { value: 0 },
  },
  vertexShader: SCREEN_VERTEX,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uCenter;
    uniform float uStrength;
    varying vec2 vUv;

    const int TAPS = 8;

    void main() {
      vec2 d = vUv - uCenter;
      vec3 sum = vec3(0.0);
      float total = 0.0;
      for (int i = 0; i < TAPS; i++) {
        float f = float(i) / float(TAPS - 1);
        float scale = 1.0 - uStrength * 0.10 * f;
        vec3 s = texture2D(tDiffuse, uCenter + d * scale).rgb;
        // Front-weighted so the sharp frame still dominates the streak.
        float w = 1.0 - f * 0.55;
        sum += s * w;
        total += w;
      }
      gl_FragColor = vec4(sum / total, 1.0);
    }
  `,
}

/** Film grain, vignette, and the white blowout at detonation. */
export const FilmShader = {
  name: 'FilmShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uGrain: { value: 0 },
    uVignette: { value: 0 },
    uFlash: { value: 0 },
  },
  vertexShader: SCREEN_VERTEX,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uFlash;
    varying vec2 vUv;

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec3 col = texture2D(tDiffuse, vUv).rgb;

      vec2 c = vUv - 0.5;
      col *= clamp(1.0 - uVignette * dot(c, c) * 1.9, 0.0, 1.0);

      float g = hash12(vUv * vec2(1237.0, 811.0) + uTime * 61.0) - 0.5;
      col += g * uGrain;

      col = mix(col, vec3(1.0), clamp(uFlash, 0.0, 1.0));

      gl_FragColor = vec4(col, 1.0);
    }
  `,
}
