/**
 * The detonation.
 *
 *   flare   camera-facing radial blowout — the first two frames of the flash
 *   shell   a thin expanding bubble, brightest where it grazes the view
 *   motes   the ejecta cloud: one THREE.Points, one draw call, zero CPU work
 *
 * The point cloud's motion lives entirely in its vertex shader. At 200k points a
 * per-frame JS position loop would cost more than everything else in the frame
 * put together; here the CPU writes exactly one uniform per frame.
 */
import * as THREE from 'three'

/** Seconds for the fastest ejecta to reach 63% of its final radius. */
const DRAG_RATE = 1.35

/** Clamped smoothstep — `x` mapped from [edge0, edge1] onto [0, 1]. */
function smoothstep01(x: number, edge0: number, edge1: number): number {
  if (edge1 <= edge0) return x >= edge1 ? 1 : 0
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/**
 * Particles per filament.
 *
 * Independently random directions do not look like an explosion — at this count
 * they average out into uniform grey static. Real ejecta is clumpy: matter
 * leaves along a limited number of channels and each channel stretches into a
 * streak because its members carry a spread of speeds. Sharing a direction
 * across a run of particles and varying only their speed is what produces that.
 */
const FILAMENT_SIZE = 160

function createEjecta(count: number, pixelRatio: number): THREE.Points {
  const geometry = new THREE.BufferGeometry()
  const positions = new Float32Array(count * 3)
  const dir = new Float32Array(count * 3)
  const speed = new Float32Array(count)
  const seed = new Float32Array(count)
  const size = new Float32Array(count)
  const bright = new Float32Array(count)

  const filaments = Math.max(1, Math.ceil(count / FILAMENT_SIZE))
  const filamentDir = new Float32Array(filaments * 3)
  const filamentSpeed = new Float32Array(filaments)
  const filamentBright = new Float32Array(filaments)

  for (let f = 0; f < filaments; f++) {
    // Uniform on the sphere, then flattened toward the ecliptic so the blast
    // reads as a system being born rather than a featureless ball.
    const u = Math.random() * 2 - 1
    const theta = Math.random() * Math.PI * 2
    const s = Math.sqrt(Math.max(0, 1 - u * u))
    const flatten = 0.34
    const y = u * flatten
    const norm = Math.hypot(s * Math.cos(theta), y, s * Math.sin(theta)) || 1

    filamentDir[f * 3] = (s * Math.cos(theta)) / norm
    filamentDir[f * 3 + 1] = y / norm
    filamentDir[f * 3 + 2] = (s * Math.sin(theta)) / norm
    filamentSpeed[f] = 0.3 + Math.pow(Math.random(), 0.7) * 0.8
    // Most filaments are faint; a few are the ones you actually see.
    filamentBright[f] = 0.25 + Math.pow(Math.random(), 3.2) * 1.75
  }

  for (let i = 0; i < count; i++) {
    const f = Math.min(filaments - 1, Math.floor(i / FILAMENT_SIZE))

    const jx = filamentDir[f * 3] + (Math.random() - 0.5) * 0.055
    const jy = filamentDir[f * 3 + 1] + (Math.random() - 0.5) * 0.055
    const jz = filamentDir[f * 3 + 2] + (Math.random() - 0.5) * 0.055
    const norm = Math.hypot(jx, jy, jz) || 1
    dir[i * 3] = jx / norm
    dir[i * 3 + 1] = jy / norm
    dir[i * 3 + 2] = jz / norm

    // The speed spread within a filament is what stretches it into a streak.
    speed[i] = filamentSpeed[f] * (0.55 + Math.random() * 0.85)
    seed[i] = Math.random()
    size[i] = 0.9 + Math.pow(Math.random(), 2.2) * 4.2
    bright[i] = filamentBright[f]
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aDir', new THREE.BufferAttribute(dir, 3))
  geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1))
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
  geometry.setAttribute('aBright', new THREE.BufferAttribute(bright, 1))

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uT: { value: 0 },
      uReach: { value: 100 },
      uFade: { value: 0 },
      uPixelRatio: { value: pixelRatio },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aDir;
      attribute float aSpeed;
      attribute float aSeed;
      attribute float aSize;
      attribute float aBright;

      uniform float uT;
      uniform float uReach;
      uniform float uPixelRatio;

      varying float vSeed;
      varying float vAge;
      varying float vBright;

      void main() {
        // Saturating displacement: fast launch, asymptotic coast. One exp is
        // cheaper and reads better than integrating drag on the CPU.
        float drag = 1.0 - exp(-uT * ${DRAG_RATE.toFixed(2)});
        float dist = uReach * aSpeed * drag;

        vec3 p = aDir * dist;
        vSeed = aSeed;
        vBright = aBright;
        vAge = clamp(uT * 0.42, 0.0, 1.0);

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        // Shrink as they cool, and attenuate with distance like real geometry.
        // The clamp is load-bearing at this count: 200k unbounded 1/z sprites
        // stack into a solid white ball the moment the camera is inside the
        // cloud, which is exactly where the choreography puts it.
        float shrink = mix(1.0, 0.35, vAge);
        gl_PointSize = clamp(
          aSize * shrink * uPixelRatio * (85.0 / max(-mv.z, 1.0)),
          1.0,
          22.0
        );
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uFade;
      varying float vSeed;
      varying float vAge;
      varying float vBright;

      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r2 = dot(d, d);
        if (r2 > 0.25) discard;
        float falloff = 1.0 - smoothstep(0.0, 0.25, r2);

        // Cooling ramp: white-hot, through gold, into the deep blue of the
        // interstellar medium. Seed staggers each particle's own clock.
        float heat = clamp(1.0 - vAge * (0.7 + vSeed * 0.6), 0.0, 1.0);
        vec3 hot = vec3(1.0, 0.98, 0.94);
        vec3 mid = vec3(1.0, 0.68, 0.28);
        vec3 cold = vec3(0.24, 0.38, 0.95);
        vec3 col = mix(cold, mid, clamp(heat * 1.8, 0.0, 1.0));
        col = mix(col, hot, clamp(heat * heat * 1.5, 0.0, 1.0));

        // Per-particle brightness is set for the SUM, not for one sprite: at the
        // core of the burst dozens of these overlap, and additive blending adds
        // every one of them.
        float a = falloff * (1.0 - vAge) * uFade * vBright * 0.55;
        if (a < 0.003) discard;
        gl_FragColor = vec4(col * a * 0.85, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })

  const points = new THREE.Points(geometry, material)
  points.name = 'shockwave-ejecta'
  points.frustumCulled = false
  points.renderOrder = 4
  return points
}

function createShell(segments: number): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uIntensity: { value: 0 },
      uColor: { value: new THREE.Color(0.75, 0.86, 1.0) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormalW;
      varying vec3 vPosW;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vPosW = world.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uIntensity;
      uniform vec3 uColor;
      varying vec3 vNormalW;
      varying vec3 vPosW;

      void main() {
        vec3 V = normalize(cameraPosition - vPosW);
        // Grazing angles traverse more of the shell, so they glow: a thin bubble
        // rather than a filled sphere, with no geometry cost.
        float graze = 1.0 - abs(dot(normalize(vNormalW), V));
        float edge = pow(clamp(graze, 0.0, 1.0), 3.2);
        float a = clamp(edge * uIntensity, 0.0, 1.0);
        if (a < 0.003) discard;
        gl_FragColor = vec4(uColor * a * 1.3, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
  })

  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, segments, Math.max(8, segments >> 1)),
    material,
  )
  mesh.name = 'shockwave-shell'
  mesh.frustumCulled = false
  mesh.renderOrder = 3
  return mesh
}

function createFlare(): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uIntensity: { value: 0 },
      uColor: { value: new THREE.Color(1.0, 0.97, 0.9) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uIntensity;
      uniform vec3 uColor;
      varying vec2 vUv;

      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        if (r > 1.0) discard;

        float core = exp(-pow(r / 0.16, 2.0));
        float bloom = exp(-pow(r / 0.62, 2.0)) * 0.45;
        // Two crossed spikes — the anamorphic streak that sells a real flare.
        float spike = exp(-abs(p.y) * 42.0) * exp(-abs(p.x) * 1.4) * 0.6
                    + exp(-abs(p.x) * 42.0) * exp(-abs(p.y) * 1.4) * 0.35;

        float v = (core + bloom + spike) * uIntensity;
        float a = clamp(v, 0.0, 1.0);
        if (a < 0.003) discard;
        // 1.6 put the core near 4.0 in linear space on a quad that covers the
        // frame. Everything above ~1.5 is past the point where ACES can still
        // separate it from its neighbour, so it bought no visible brightness —
        // only a white rectangle and a bloom pass with nothing left to isolate.
        gl_FragColor = vec4(uColor * v * 1.15, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  })

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material)
  mesh.name = 'shockwave-flare'
  mesh.frustumCulled = false
  mesh.renderOrder = 6
  return mesh
}

export interface ShockwaveOptions {
  particles: number
  shellSegments: number
  /** Scene units the fastest ejecta eventually covers — set from systemRadius. */
  reach: number
  pixelRatio: number
}

export class Shockwave {
  readonly group = new THREE.Group()

  private ejecta: THREE.Points
  private shell: THREE.Mesh
  private flare: THREE.Mesh
  private reach: number

  constructor(options: ShockwaveOptions) {
    this.group.name = 'shockwave'
    this.reach = options.reach

    this.ejecta = createEjecta(options.particles, options.pixelRatio)
    ;(this.ejecta.material as THREE.ShaderMaterial).uniforms.uReach.value =
      options.reach

    this.shell = createShell(options.shellSegments)
    this.flare = createFlare()

    this.group.add(this.ejecta)
    this.group.add(this.shell)
    this.group.add(this.flare)
    this.group.visible = false
  }

  /**
   * @param since  seconds since detonation; negative before it happens
   * @param flare  0..1 blowout intensity, driven by the flash phase
   */
  update(since: number, flare: number, camera: THREE.Camera): void {
    const live = since >= 0
    this.group.visible = live || flare > 0.001
    if (!this.group.visible) return

    const t = Math.max(0, since)

    const camDist = camera.position.distanceTo(this.group.position)

    const ejectaMat = this.ejecta.material as THREE.ShaderMaterial
    ejectaMat.uniforms.uT.value = t
    // Ejecta ride in behind the flash and burn out over ~1.9s.
    ejectaMat.uniforms.uFade.value = live
      ? Math.min(1, t * 6) * Math.max(0, 1 - t / 1.9)
      : 0
    this.ejecta.visible = ejectaMat.uniforms.uFade.value > 0.002

    const drag = 1 - Math.exp(-t * DRAG_RATE)
    const shellRadius = Math.max(0.001, this.reach * 1.05 * drag)
    this.shell.scale.setScalar(shellRadius)
    const shellMat = this.shell.material as THREE.ShaderMaterial
    // The blast front is a wall of light only while it is still ahead of you.
    // Once it sweeps past the camera the back side fills the entire frame, so
    // fade it out across the crossing rather than letting it wash the screen.
    const passed = smoothstep01(shellRadius, camDist * 0.55, camDist * 1.05)
    shellMat.uniforms.uIntensity.value = live
      ? Math.min(1, t * 9) * Math.max(0, 1 - t / 1.5) * (1 - passed)
      : 0
    this.shell.visible = shellMat.uniforms.uIntensity.value > 0.002

    this.flare.lookAt(camera.position)
    const flareMat = this.flare.material as THREE.ShaderMaterial
    flareMat.uniforms.uIntensity.value = flare * 0.85
    this.flare.visible = flare > 0.002
    // Scaled in camera-distance units so the blowout keeps its apparent size no
    // matter how far back the camera has already retreated.
    //
    // The growth term used to be 2.6, which at peak blew the quad out to ~3.5x
    // the frame — and the frame then sat entirely inside the `core` gaussian, so
    // every pixel got the same near-maximum value. That is why the flash read as
    // a flat white rectangle rather than as a flare: the falloff, the halo, and
    // the anamorphic spikes were all off-screen. Keeping it close to the frame
    // size puts that structure back where it can be seen.
    this.flare.scale.setScalar(camDist * (0.75 + 0.85 * flare))
  }

  dispose(): void {
    this.group.parent?.remove(this.group)
    for (const obj of [this.ejecta, this.shell, this.flare]) {
      obj.geometry.dispose()
      ;(obj.material as THREE.Material).dispose()
    }
  }
}
