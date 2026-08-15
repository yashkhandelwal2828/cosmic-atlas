/**
 * The black hole that opens the sequence.
 *
 * Four layers, because a convincing hole is mostly *absence* framed by light:
 *
 *   horizon   an opaque black sphere. Nothing renders it — it occludes.
 *   photon    camera-facing annulus: light grazing the horizon piled into a ring
 *   disk      accretion disk, differentially rotating, Doppler-beamed
 *   motes     infalling debris spiralling in on the disk plane
 *
 * All of it is additive except the horizon, which must write depth so the far
 * side of the disk is genuinely hidden behind it.
 */
import * as THREE from 'three'

/** Scene-unit radius of the event horizon. */
export const HORIZON_RADIUS = 1.6

const DISK_INNER = HORIZON_RADIUS * 1.42
const DISK_OUTER = HORIZON_RADIUS * 3.4

const NOISE_GLSL = /* glsl */ `
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
    for (int i = 0; i < 4; i++) {
      s += a * noise2(p);
      p = p * 2.11 + vec2(0.19, 0.37);
      a *= 0.5;
    }
    return s;
  }
`

function createPhotonRing(): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uIntensity: { value: 0 },
      uRingRadius: { value: 0.44 },
      uRingWidth: { value: 0.055 },
      uColor: { value: new THREE.Color(0.85, 0.92, 1.0) },
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
      uniform float uRingRadius;
      uniform float uRingWidth;
      uniform vec3 uColor;
      varying vec2 vUv;

      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        if (r > 1.0) discard;

        float w = max(uRingWidth, 1e-4);
        float ring = exp(-pow((r - uRingRadius) / w, 2.0));
        // A wide, faint halo so the ring sits in something rather than on black.
        float halo = exp(-pow(r / 0.8, 2.0)) * 0.05;

        float a = clamp((ring * 1.15 + halo) * uIntensity, 0.0, 1.0);
        if (a < 0.002) discard;
        gl_FragColor = vec4(uColor * (ring * 1.1 + halo) * uIntensity, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material)
  mesh.name = 'singularity-photon-ring'
  mesh.scale.setScalar(HORIZON_RADIUS * 4.6)
  mesh.renderOrder = 3
  mesh.frustumCulled = false
  return mesh
}

function createAccretionDisk(): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 0 },
      uInner: { value: DISK_INNER },
      uOuter: { value: DISK_OUTER },
      /** Screen-space direction of the approaching limb, for Doppler beaming. */
      uDoppler: { value: 0.6 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vLocal;
      void main() {
        vLocal = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uIntensity;
      uniform float uInner;
      uniform float uOuter;
      uniform float uDoppler;
      varying vec2 vLocal;

      ${NOISE_GLSL}

      void main() {
        float r = length(vLocal);
        float t01 = (r - uInner) / max(uOuter - uInner, 1e-4);
        if (t01 < 0.0 || t01 > 1.0) discard;

        float a = atan(vLocal.y, vLocal.x);

        // Keplerian shear: inner annuli wrap far faster than outer ones, which is
        // what smears the gas into spiral filaments instead of rigid spokes.
        float wind = uTime * 2.6 / pow(max(r, 0.35), 1.5);
        float aw = a + wind;

        float bands = fbm2(vec2(aw * 2.3, r * 1.7 - uTime * 0.12));
        float filament = fbm2(vec2(aw * 9.5, r * 1.1 + uTime * 0.05));
        float d = mix(bands, filament, 0.45);

        float heat = pow(1.0 - t01, 1.6);
        vec3 cool = vec3(0.42, 0.20, 0.86);
        vec3 mid = vec3(1.0, 0.55, 0.18);
        vec3 hot = vec3(1.0, 0.96, 0.88);
        vec3 col = mix(cool, mid, clamp(heat * 1.7, 0.0, 1.0));
        col = mix(col, hot, clamp(heat * heat * 1.4, 0.0, 1.0));

        // Relativistic beaming — the limb rotating toward us is far brighter.
        float doppler = 0.25 + 0.75 * pow(0.5 + 0.5 * cos(a - uDoppler), 2.0);

        // A high, narrow density threshold is what keeps this a filigree of hot
        // filaments on black. Open it up and the disk becomes a solid lit sheet
        // covering most of the frame, which bloom then smears into white.
        float density = smoothstep(0.38, 0.90, d)
          * smoothstep(0.0, 0.10, t01)
          * (1.0 - smoothstep(0.55, 1.0, t01));

        float alpha = clamp(density * doppler * uIntensity, 0.0, 1.0);
        if (alpha < 0.002) discard;
        gl_FragColor = vec4(col * alpha * 0.85, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  })

  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(DISK_INNER, DISK_OUTER, 192, 8),
    material,
  )
  mesh.name = 'singularity-disk'
  mesh.renderOrder = 2
  return mesh
}

function createMotes(count: number): THREE.Points {
  const geometry = new THREE.BufferGeometry()
  const positions = new Float32Array(count * 3)
  const angle = new Float32Array(count)
  const phase = new Float32Array(count)
  const speed = new Float32Array(count)
  const height = new Float32Array(count)
  const size = new Float32Array(count)

  for (let i = 0; i < count; i++) {
    angle[i] = Math.random() * Math.PI * 2
    phase[i] = Math.random()
    speed[i] = 0.18 + Math.random() * 0.5
    height[i] = (Math.random() - 0.5) * 2
    size[i] = 0.8 + Math.pow(Math.random(), 3) * 3.2
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aAngle', new THREE.BufferAttribute(angle, 1))
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1))
  geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1))
  geometry.setAttribute('aHeight', new THREE.BufferAttribute(height, 1))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
  // Positions are computed entirely in the vertex shader, so the CPU-side
  // bounding sphere is meaningless — never let the frustum test see it.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), DISK_OUTER * 2)

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 0 },
      uInner: { value: DISK_INNER * 0.92 },
      uOuter: { value: DISK_OUTER * 1.05 },
      uPixelRatio: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float aAngle;
      attribute float aPhase;
      attribute float aSpeed;
      attribute float aHeight;
      attribute float aSize;

      uniform float uTime;
      uniform float uInner;
      uniform float uOuter;
      uniform float uPixelRatio;

      varying float vLife;

      void main() {
        // life 0 = just captured at the outer edge, 1 = crossing the horizon
        float life = fract(aPhase + uTime * aSpeed * 0.22);
        vLife = life;

        float r = mix(uOuter, uInner, life);
        // Winds up as it falls: the same Keplerian shear the disk shader uses.
        float ang = aAngle + pow(life, 1.7) * 9.0;

        vec3 p = vec3(cos(ang) * r, sin(ang) * r, aHeight * r * 0.07);

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        // Clamped: 1/z attenuation is unbounded, and a mote that drifts near the
        // near plane would otherwise be drawn as a 40px blob of additive white.
        gl_PointSize = clamp(
          aSize * uPixelRatio * (32.0 / max(-mv.z, 1.0)),
          1.0,
          9.0
        );
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uIntensity;
      varying float vLife;

      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r2 = dot(d, d);
        if (r2 > 0.25) discard;

        float falloff = 1.0 - smoothstep(0.0, 0.25, r2);
        // Fade in on capture, blaze on the way down, vanish at the horizon.
        float env = smoothstep(0.0, 0.12, vLife) * (1.0 - smoothstep(0.86, 1.0, vLife));
        vec3 col = mix(vec3(0.55, 0.35, 1.0), vec3(1.0, 0.85, 0.6), vLife);

        float a = falloff * env * uIntensity * 0.5;
        if (a < 0.003) discard;
        gl_FragColor = vec4(col * a * 0.45, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })

  const points = new THREE.Points(geometry, material)
  points.name = 'singularity-motes'
  points.frustumCulled = false
  points.renderOrder = 2
  return points
}

export class Singularity {
  readonly group = new THREE.Group()

  private horizon: THREE.Mesh
  private photonRing: THREE.Mesh
  private disk: THREE.Mesh
  private motes: THREE.Points
  /** Disk + motes share a tilt so the ring reads as a disk, not a circle. */
  private diskGroup = new THREE.Group()

  constructor(moteCount: number, pixelRatio: number) {
    this.group.name = 'singularity'

    this.horizon = new THREE.Mesh(
      new THREE.SphereGeometry(HORIZON_RADIUS, 48, 32),
      new THREE.MeshBasicMaterial({ color: 0x000000 }),
    )
    this.horizon.name = 'singularity-horizon'
    this.horizon.renderOrder = 1

    this.photonRing = createPhotonRing()
    this.disk = createAccretionDisk()
    this.motes = createMotes(moteCount)
    ;(this.motes.material as THREE.ShaderMaterial).uniforms.uPixelRatio.value =
      pixelRatio

    // RingGeometry lies in XY; tip it toward the ecliptic and leave a few
    // degrees of lean so the far edge arcs over the horizon.
    this.diskGroup.rotation.set(-Math.PI / 2 + 0.28, 0, 0)
    this.diskGroup.add(this.disk)
    this.diskGroup.add(this.motes)

    this.group.add(this.horizon)
    this.group.add(this.diskGroup)
    this.group.add(this.photonRing)
    this.group.visible = false
    this.group.scale.setScalar(0.001)
  }

  /**
   * @param emergence 0 = nothing, 1 = fully formed
   * @param time      seconds, drives the disk's differential rotation
   */
  update(emergence: number, time: number, camera: THREE.Camera): void {
    const e = Math.max(0, Math.min(1, emergence))
    this.group.visible = e > 0.001
    if (!this.group.visible) return

    // It does not fade in — it *grows* in, which reads as something arriving
    // rather than something being turned up.
    this.group.scale.setScalar(0.12 + 0.88 * e)

    this.photonRing.lookAt(camera.position)
    const ringMat = this.photonRing.material as THREE.ShaderMaterial
    ringMat.uniforms.uIntensity.value = e * e

    const diskMat = this.disk.material as THREE.ShaderMaterial
    diskMat.uniforms.uTime.value = time
    diskMat.uniforms.uIntensity.value = e

    const moteMat = this.motes.material as THREE.ShaderMaterial
    moteMat.uniforms.uTime.value = time
    moteMat.uniforms.uIntensity.value = e
  }

  dispose(): void {
    this.group.parent?.remove(this.group)
    for (const obj of [this.horizon, this.photonRing, this.disk, this.motes]) {
      obj.geometry.dispose()
      ;(obj.material as THREE.Material).dispose()
    }
  }
}
