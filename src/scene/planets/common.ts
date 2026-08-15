/**
 * Shared planet-shader building blocks.
 * Body files stay distinctive; this only holds vertex + atmosphere + sun-vector helpers.
 */
import * as THREE from 'three'

export const SPHERE_W = 192
export const SPHERE_H = 128

export const PLANET_VERTEX = /* glsl */ `
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

/**
 * Ring particle structure, shared by every ringed body.
 *
 * A ring is not a painted sheet — it is several hundred million orbiting bodies.
 * The radial texture alone gets the far view right (the bands ARE the real
 * signal at that scale) but holds up to nothing on approach, because it has no
 * azimuthal variation whatsoever: every point at a given radius is identical.
 *
 * `ringParticles` adds the missing structure and resolves it by apparent size,
 * so the far silhouette is untouched and the rubble only appears once there are
 * enough pixels to draw it in.
 */
export const RING_PARTICLES_GLSL = /* glsl */ `
  float ringHash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float ringNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(ringHash12(i), ringHash12(i + vec2(1.0, 0.0)), f.x),
      mix(ringHash12(i + vec2(0.0, 1.0)), ringHash12(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }

  /**
   * Mean fraction of a cell covered by its grain, for the radius distribution
   * in ringGrainLayer below:
   *
   *   r = 0.07 + 0.33 * u^2.2,  u uniform on [0,1],  E[u^k] = 1/(k+1)
   *   E[r^2] = 0.0049 + 0.0462*E[u^2.2] + 0.1089*E[u^4.4] = 0.03951
   *   coverage = pi * E[r^2] = 0.1241
   *
   * Grains are kept wholly inside their own cell, so no area is lost to
   * clipping and this figure is exact. It is what lets a layer fade to its own
   * average instead of to nothing once it goes sub-pixel.
   *
   * The 0.40 ceiling on r is deliberate: the jitter range is [r, 1-r], so a
   * grain any larger than this would have nowhere left to sit and would centre
   * itself in its cell, printing the sampling lattice as a visible grid.
   */
  const float RING_GRAIN_MEAN = 0.1241;

  /**
   * Per-layer grain scale, coarse to fine.
   *
   * Not equal, and that is the whole point. Real ring particles follow a steep
   * power law — overwhelmingly small bodies with rare large ones — so giving
   * every layer the same coverage made the coarse blobs as common as the dust
   * and the field read as leopard spots. Shrinking the coarse layer turns its
   * grains into the occasional boulder they should be, while the fine layer
   * carries the bulk of the coverage.
   */
  const float RING_SCALE_0 = 0.55;
  const float RING_SCALE_1 = 0.85;
  const float RING_SCALE_2 = 1.00;

  /**
   * One layer of discrete grains: a lattice of cells, each holding a single
   * hard-edged disc at a jittered position with a randomised radius.
   *
   * Value noise cannot produce this look no matter how it is contrasted — it is
   * continuous, so it yields mottling rather than separate objects with empty
   * space between them. A disc per cell yields actual particles, and the
   * heavy-tailed radius (u^2.2) is what gives a field of mostly-small grains
   * punctuated by the occasional boulder rather than one uniform gravel size.
   *
   * The disc is constrained to its own cell, so no neighbour lookups are
   * needed: nine hashes per fragment instead of eighty-one. At the sparse
   * coverage a ring wants, particles crossing cell borders would not be
   * visible as structure anyway.
   *
   * @param cellsPerPixel screen footprint in cell units — drives both the edge
   *                      softening and the fade to mean.
   */
  float ringGrainLayer(
    vec2 p, float seed, float sizeScale, float cellsPerPixel
  ) {
    vec2 cell = floor(p);
    vec2 f = fract(p);

    float h1 = ringHash12(cell + vec2(seed, seed * 1.7));
    float h2 = ringHash12(cell + vec2(seed + 37.7, seed * 2.3 + 11.1));
    float h3 = ringHash12(cell + vec2(seed + 91.3, seed * 0.7 + 53.9));

    float r = sizeScale * (0.07 + 0.33 * pow(h3, 2.2));
    vec2 c = vec2(r) + (1.0 - 2.0 * r) * vec2(h1, h2);

    float aa = max(cellsPerPixel, 1e-4);
    float cov = 1.0 - smoothstep(r - aa, r + aa, length(f - c));

    // Once a cell is smaller than roughly two pixels the discs cannot be drawn
    // without aliasing into a crawling moire, so hand back the average this
    // layer contributes instead. That is what makes the far view identical to
    // the smooth band it always was, with no pop as the camera closes in.
    // Coverage goes as r^2, so the mean scales with the square of the size.
    float mean = RING_GRAIN_MEAN * sizeScale * sizeScale;
    return mix(mean, cov, smoothstep(0.55, 0.14, aa));
  }

  /**
   * @param local     fragment position within the ring plane (object space xy)
   * @param innerR    inner ring radius — normalises the Keplerian shear
   * @param cellSize  object-space size of one clump at full resolution
   * @param time
   * @return x = density multiplier, y = brightness multiplier. Both average to
   *         ~1, so this redistributes light rather than dimming the ring.
   */
  vec2 ringParticles(vec2 local, float innerR, float cellSize, float time) {
    float rho = length(local);

    // Level of detail from apparent size, not camera distance.
    //
    // A feature is worth drawing only once it covers more than a pixel or two.
    // Fading in by camera distance instead would put sub-pixel noise on screen
    // at some ranges, and sub-pixel noise on a surface this large crawls into a
    // shimmering moire the moment anything moves. Measuring the object-space
    // footprint of a pixel answers "how big is this feature right now"
    // directly, so it self-tunes across resolution, field of view and ring
    // size — and stays correct when the intro scales a body down mid-flight.
    vec2 dx = dFdx(local);
    vec2 dy = dFdy(local);

    // Round features are limited by the LARGER of the two screen axes.
    float isoPerPixel = max(max(length(dx), length(dy)), 1e-7);
    // Concentric ringlets vary only radially, so they are limited by how fast
    // the radius changes across a pixel instead — a far smaller number at the
    // grazing angles this view spends most of its time at. Judging them by the
    // isotropic footprint drew hundreds of sub-pixel ringlets and aliased them
    // into a scratched-metal streak pattern.
    float radialPerPixel = max(fwidth(rho), 1e-7);

    float bandLod = smoothstep(1.5, 6.0, cellSize * 1.1 / radialPerPixel);

    // Rings do rotate differentially — inner orbits sweep faster than outer
    // ones. But that winding accumulates without bound, and time here is
    // wall-clock seconds: a few minutes in, a truly Keplerian shear has wound
    // the field into sub-pixel strands that alias no matter what the LOD does.
    // A rigid spin (which never winds) plus a bounded differential wobble reads
    // as the same motion and stays stable for a session of any length.
    //
    // The rotation is applied to the sample coordinate rather than by building
    // a (radius, angle) pair: there is no atan, so there is no seam at +-pi,
    // and clumps stay round instead of fanning into wedges near the inner edge.
    float shear =
      time * 0.035 + 0.4 * sin(time * 0.06) * pow(innerR / max(rho, 1e-4), 1.5);
    float cs = cos(shear);
    float sn = sin(shear);
    vec2 q = vec2(local.x * cs - local.y * sn, local.x * sn + local.y * cs);

    float f = 1.0 / max(cellSize, 1e-6);
    float cellsPerPixel = isoPerPixel * f;

    // Past this the coarsest layer is already fully faded to its mean, and the
    // two finer ones more so, so the grain field would evaluate to exactly 1.0
    // at the cost of nine hashes. Skip it — this is the branch the system view
    // and the whole intro take.
    float density = 1.0;
    float facet = 1.0;
    if (cellsPerPixel < 0.55) {
      // Three scales of grain, roughly 50x apart end to end: boulders, gravel
      // and dust. Combined with the spread inside each layer, that is the range
      // the eye reads as "made of rocks of every size" rather than as one grain
      // size repeated. Frequencies are deliberately non-harmonic so the three
      // lattices never line up into a visible grid.
      float g0 = ringGrainLayer(q * f, 0.0, RING_SCALE_0, cellsPerPixel);
      float g1 =
        ringGrainLayer(q * f * 3.3, 13.0, RING_SCALE_1, cellsPerPixel * 3.3);
      float g2 =
        ringGrainLayer(q * f * 11.0, 29.0, RING_SCALE_2, cellsPerPixel * 11.0);

      // Union, not max: for binary coverage the two agree, but once a layer has
      // faded to its average the product form keeps combining correctly, while
      // max would return the largest constant and lose the others.
      float cover = 1.0 - (1.0 - g0) * (1.0 - g1) * (1.0 - g2);

      // The same union over the layer means. Derived here rather than written
      // in as a constant so it cannot silently drift out of step with the size
      // scales above — it is what makes the fully-faded far case land on
      // exactly 1.0 and leave the original ring untouched.
      float coverMean =
        1.0 -
        (1.0 - RING_GRAIN_MEAN * RING_SCALE_0 * RING_SCALE_0) *
        (1.0 - RING_GRAIN_MEAN * RING_SCALE_1 * RING_SCALE_1) *
        (1.0 - RING_GRAIN_MEAN * RING_SCALE_2 * RING_SCALE_2);

      density = cover / coverMean;

      // Individual bodies catch the sun at their own angle. Keyed to the middle
      // layer's lattice so brightness varies per grain rather than drifting
      // across them, which is what stops the field reading as holes punched in
      // a sheet.
      float facetLod = smoothstep(0.55, 0.14, cellsPerPixel * 3.3);
      facet =
        mix(1.0, 0.70 + 0.62 * ringHash12(floor(q * f * 3.3) + 5.3), facetLod);
    }

    // Ringlets: the fine concentric banding that survives all the way down to
    // Cassini-era close-ups. Kept low-contrast so it modulates the grains
    // rather than competing with them. Radial-only, so it outlives the grain
    // field at grazing angles and is computed outside that branch.
    float bands = ringNoise(vec2(rho * f * 0.9, 11.3));
    density *= mix(1.0, 0.74 + 0.52 * bands, bandLod);

    return vec2(density, facet);
  }
`

export function createAtmosphereMaterial(
  color: THREE.ColorRepresentation,
  opts?: { power?: number; intensity?: number },
): THREE.ShaderMaterial {
  const c = new THREE.Color(color)
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      glowColor: { value: c },
      power: { value: opts?.power ?? 3.2 },
      intensity: { value: opts?.intensity ?? 1.0 },
      sunPosition: { value: new THREE.Vector3(0, 0, 0) },
    },
    vertexShader: PLANET_VERTEX,
    fragmentShader: /* glsl */ `
      uniform vec3 glowColor;
      uniform float power;
      uniform float intensity;
      uniform vec3 sunPosition;
      varying vec3 vNormalW;
      varying vec3 vPosW;

      void main() {
        vec3 N = normalize(vNormalW);
        vec3 V = normalize(cameraPosition - vPosW);
        vec3 L = normalize(sunPosition - vPosW);
        float mu = max(dot(N, V), 0.0);
        float rim = pow(1.0 - mu, power);
        float sunFacing = 0.35 + 0.65 * smoothstep(-0.25, 0.55, dot(N, L));
        float a = rim * intensity * sunFacing;
        gl_FragColor = vec4(glowColor * a, a);
      }
    `,
    side: THREE.FrontSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  })
  mat.toneMapped = true
  return mat
}

export function setSunOnMaterials(
  materials: THREE.ShaderMaterial[],
  sunPosition: THREE.Vector3,
): void {
  for (const mat of materials) {
    if (mat.uniforms?.sunPosition) mat.uniforms.sunPosition.value.copy(sunPosition)
  }
}

export function setTimeOnMaterials(
  materials: THREE.ShaderMaterial[],
  time: number,
): void {
  for (const mat of materials) {
    if (mat.uniforms?.time) mat.uniforms.time.value = time
  }
}

export function globeMesh(
  radius: number,
  material: THREE.Material,
  name: string,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, SPHERE_W, SPHERE_H),
    material,
  )
  mesh.name = name
  return mesh
}

export function isCustomPlanetMaterial(mat: THREE.Material): boolean {
  return (
    mat instanceof THREE.ShaderMaterial &&
    !!mat.uniforms &&
    ('albedoMap' in mat.uniforms || 'dayMap' in mat.uniforms || 'cloudMap' in mat.uniforms)
  )
}
