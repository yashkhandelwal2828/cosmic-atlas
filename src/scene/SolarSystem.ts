/**
 * Three.js solar-system scene controller.
 * Real 8K-sourced maps, Earth day/night blend, planet name labels, Mars normals.
 *
 * Every body is a three-level node stack:
 *
 *   orbitGroup    position from the ephemeris — orientation stays IDENTITY
 *   └─ tiltGroup  fixed quaternion aligning +Y with the body's true spin axis
 *      ├─ spinGroup   rotation.y = prime-meridian angle; globe + hotspots ride here
 *      ├─ cloudSpin   Earth: spin*1.08; Venus: 4.05-day retrograde deck
 *      ├─ atmosphere
 *      └─ rings       equatorial plane — the visible tilt comes from tiltGroup
 *
 * The tilt must not inherit the spin (Ry·Rz sweeps the pole around world Y once
 * per rotation), and the orbit position must not inherit the tilt. Because
 * orbitGroup carries no rotation, the axis stays fixed in world space all the way
 * around the orbit — which is what produces seasons.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import {
  BODY_ORDER,
  BODIES,
  type BodyId,
  type Hotspot,
} from '../data/bodies'
import { ORBITS, ROTATIONS } from '../data/orbitalElements'
import { TextureCache } from './textures'
import {
  applySunMap,
  createSunVisuals,
  setSunIntensity,
  updateSunFacing,
  updateSunTime,
  type SunVisuals,
} from './sunMaterial'
import {
  applyPlanetMaps,
  createPlanetVisuals,
  updatePlanetVisuals,
  type PlanetVisuals,
} from './planets'
import { PlanetLabels } from './PlanetLabels'
import { OrbitPaths } from './OrbitPaths'
import { BACKGROUND_INTENSITY, Starfield } from './Starfield'
import {
  eclipticToScene,
  elementsAt,
  julianCenturies,
  moonPositionAU,
  planetPositionAU,
  spinAngleDeg,
  spinAxisScene,
} from './orbitalMechanics'
import { cloudAzimuthDeg, hasCloudDeck } from './cloudAzimuth'
import {
  INCLINATION_EXAGGERATION,
  moonOrbitScaleFactor,
  orbitScaleFactor,
  systemRadius,
  type DistanceMode,
} from './scale'
import {
  SYSTEM_VIEW_ELEVATION,
  systemViewDistance,
  systemViewMaxDistance,
} from './systemView'

const BASE_RADIUS = 1.2

/** Full-brightness intensity of the Sun's point light. `setSunIgnition` scales it. */
const SUN_LIGHT_INTENSITY = 4.5

/** Orbit geometry is frozen at one epoch; re-sample it after this much sim drift. */
const ORBIT_PATH_REFRESH_MS = 31557600000

/** Scene-space +Y, the axis `tiltGroup` rotates onto the real spin axis. */
const SCENE_UP = new THREE.Vector3(0, 1, 0)

/** Focus pose: degrees of yaw off the Sun–body line, and how far to ride above it. */
const VIEW_YAW = THREE.MathUtils.degToRad(38)
const VIEW_LIFT = 0.34

export interface FocusCameraPose {
  position: THREE.Vector3
  target: THREE.Vector3
}

/** Mutable slot a `BodyTransformOverride` writes its answer into. */
export interface BodyTransform {
  position: THREE.Vector3
  scale: number
}

/**
 * Hook for temporarily driving where bodies are and how big they are.
 *
 * Called once per body per frame, immediately after the ephemeris has produced
 * the body's true position — which arrives as `ephemeris` and must be treated as
 * read-only. `out` is pre-filled with the truthful answer, so an override that
 * writes nothing is the identity.
 *
 * Position is applied to `orbitGroup`; scale is applied to `tiltGroup`, so the
 * globe, clouds, atmosphere, and rings all scale together while the Moon — which
 * hangs off Earth's *orbitGroup* — is left alone.
 */
export type BodyTransformOverride = (
  id: BodyId,
  ephemeris: THREE.Vector3,
  out: BodyTransform,
) => void

/** The per-body node stack described in the file header. */
interface BodyNodes {
  orbitGroup: THREE.Group
  tiltGroup: THREE.Group
  spinGroup: THREE.Group
  cloudSpin?: THREE.Group
}

export class SolarSystem {
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly renderer: THREE.WebGLRenderer
  readonly controls: OrbitControls

  private root = new THREE.Group()
  private nodes = new Map<BodyId, BodyNodes>()
  private meshes = new Map<BodyId, THREE.Mesh>()
  private hotspotMeshes: THREE.Mesh[] = []
  private hotspotRings: THREE.Mesh[] = []
  private textures: TextureCache
  private labels: PlanetLabels | null = null
  private labelHost: HTMLElement | null = null
  private clock = new THREE.Clock()
  private animationId = 0
  private disposed = false

  private camFrom = new THREE.Vector3()
  private camTo = new THREE.Vector3()
  private lookFrom = new THREE.Vector3()
  private lookTo = new THREE.Vector3()
  private travelActive = false
  private travelT = 0
  private travelDuration = 1.6
  private focusedId: BodyId = 'earth'
  private onTravelComplete: ((id: BodyId) => void) | null = null
  private onHotspotClick: ((hotspot: Hotspot) => void) | null = null
  private onFrame: ((dtSeconds: number) => void) | null = null
  private raycaster = new THREE.Raycaster()
  private pointer = new THREE.Vector2()
  private sunVisuals: SunVisuals | null = null
  private planetVisuals = new Map<BodyId, PlanetVisuals>()
  private sunLight: THREE.PointLight

  private simMs = Date.now()
  private distanceMode: DistanceMode = 'compressed'
  private verticalExaggeration: number = INCLINATION_EXAGGERATION.off
  private orbitPaths: OrbitPaths
  private orbitPathsEpochMs: number
  private starfield: Starfield | null = null

  /** Camera-follow bookkeeping: bodies move, so the pose has to move with them. */
  private lastFocusPos = new THREE.Vector3()
  private followDelta = new THREE.Vector3()
  private followFocus = true

  /** Intro hooks. All null in steady state, which is the untouched code path. */
  private bodyOverride: BodyTransformOverride | null = null
  private renderOverride: ((dtSeconds: number) => void) | null = null
  private cameraDriver: ((dtSeconds: number) => void) | null = null
  private resizeHandler: ((width: number, height: number) => void) | null = null
  private skyIntensity = 1
  private labelOpacity = 1
  private readonly ephemerisScratch = new THREE.Vector3()
  private readonly transformScratch: BodyTransform = {
    position: new THREE.Vector3(),
    scale: 1,
  }

  constructor(canvas: HTMLCanvasElement, textures: TextureCache) {
    this.textures = textures
    this.scene = new THREE.Scene()
    // Placeholder until Starfield installs the equirect backdrop. No fog: it
    // washes the outer planets out once the orbits expand.
    this.scene.background = new THREE.Color(0x010208)

    const w = canvas.clientWidth || window.innerWidth
    const h = canvas.clientHeight || window.innerHeight
    this.camera = new THREE.PerspectiveCamera(48, w / h, 0.05, 4000)
    this.camera.position.set(0, 4, 18)

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(w, h, false)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.12
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy()
    // Use full GPU anisotropy so 8K maps stay sharp at grazing angles
    this.textures.setMaxAnisotropy(Math.min(16, maxAniso || 16))

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.055
    this.controls.minDistance = 1.8
    this.controls.maxDistance = systemViewMaxDistance(
      this.distanceMode,
      this.camera.fov,
      w,
      h,
    )
    this.controls.enablePan = false

    this.scene.add(this.root)

    this.scene.add(new THREE.HemisphereLight(0x9bb7ff, 0x0a0a12, 0.2))
    // Distance 0 = no cutoff: true-distance mode puts Neptune ~360 units out.
    this.sunLight = new THREE.PointLight(0xfff1d6, SUN_LIGHT_INTENSITY, 0, 0.55)
    this.scene.add(this.sunLight)
    const fill = new THREE.DirectionalLight(0x6b8cff, 0.16)
    fill.position.set(-12, 4, -18)
    this.scene.add(fill)

    this.orbitPathsEpochMs = this.simMs
    this.orbitPaths = new OrbitPaths(this.orbitPathOptions())
    this.scene.add(this.orbitPaths.root)

    this.buildBodies()
    this.updateEphemeris(this.simMs)
    this.lastFocusPos.copy(this.bodyPosition(this.focusedId))

    canvas.addEventListener('pointerdown', this.handlePointer)
    window.addEventListener('resize', this.handleResize)
  }

  /** Mount cute planet name tags into the shell container. */
  enableLabels(host: HTMLElement): void {
    this.labelHost = host
    this.labels = new PlanetLabels(host)
    this.scene.add(this.labels.root)
    this.labels.attachAll(
      (id) => this.bodyPosition(id),
      (id) => this.bodyRadius(id),
    )
    this.labels.setFocused(this.focusedId)
    // Guarantee every body id has a DOM tag (CSS2D only mounts on first render)
    if (this.labels.count !== BODY_ORDER.length) {
      console.warn(
        `PlanetLabels: ${this.labels.count}/${BODY_ORDER.length} — re-attaching`,
      )
      this.labels.attachAll(
        (id) => this.bodyPosition(id),
        (id) => this.bodyRadius(id),
      )
    }
  }

  /** Debug / tests: how many identity labels are attached. */
  getLabelCount(): number {
    return this.labels?.count ?? 0
  }

  private bodyRadius(id: BodyId): number {
    return BODIES[id].displayRadius * BASE_RADIUS
  }

  /** Live world position of a body — never a formula, always the current pose. */
  private bodyPosition(id: BodyId): THREE.Vector3 {
    const nodes = this.nodes.get(id)
    if (!nodes) return new THREE.Vector3()
    return nodes.orbitGroup.getWorldPosition(new THREE.Vector3())
  }

  private buildBodies(): void {
    for (const id of BODY_ORDER) {
      const radius = this.bodyRadius(id)

      const orbitGroup = new THREE.Group()
      orbitGroup.name = id
      orbitGroup.userData.radius = radius

      // Computed once: the spin axis is inertial, so re-deriving it per frame
      // would be both wasted work and an invitation to reintroduce precession.
      const rotation = ROTATIONS[id]
      const axis = spinAxisScene(rotation.poleRa, rotation.poleDec)
      const tiltGroup = new THREE.Group()
      tiltGroup.name = `${id}-tilt`
      tiltGroup.quaternion.setFromUnitVectors(
        SCENE_UP,
        new THREE.Vector3(axis.x, axis.y, axis.z).normalize(),
      )

      const spinGroup = new THREE.Group()
      spinGroup.name = `${id}-spin`

      tiltGroup.add(spinGroup)
      orbitGroup.add(tiltGroup)
      this.root.add(orbitGroup)

      const nodes: BodyNodes = { orbitGroup, tiltGroup, spinGroup }
      this.nodes.set(id, nodes)

      if (id === 'sun') {
        const visuals = createSunVisuals(radius)
        this.sunVisuals = visuals
        spinGroup.add(visuals.photosphere)
        // Flames are a camera-facing billboard — they must not inherit the spin.
        tiltGroup.add(visuals.flames)
        this.meshes.set(id, visuals.photosphere)
        continue
      }

      const visuals = createPlanetVisuals(id, radius)
      this.planetVisuals.set(id, visuals)
      spinGroup.add(visuals.globe)
      if (hasCloudDeck(id) && visuals.clouds) {
        const cloudSpin = new THREE.Group()
        cloudSpin.name = `${id}-cloud-spin`
        cloudSpin.add(visuals.clouds)
        tiltGroup.add(cloudSpin)
        nodes.cloudSpin = cloudSpin
      } else if (visuals.clouds) {
        tiltGroup.add(visuals.clouds)
      }
      if (visuals.atmosphere) tiltGroup.add(visuals.atmosphere)
      if (visuals.rings) tiltGroup.add(visuals.rings)
      this.meshes.set(id, visuals.globe)
    }

    // MOON DISABLED — see BODY_ORDER in data/bodies.ts.
    // Moon rides Earth's orbitGroup so the geocentric offset stays in the
    // ecliptic-aligned local frame and follows Earth automatically.
    // const earthNodes = this.nodes.get('earth')
    // const moonNodes = this.nodes.get('moon')
    // if (earthNodes && moonNodes) {
    //   this.root.remove(moonNodes.orbitGroup)
    //   earthNodes.orbitGroup.add(moonNodes.orbitGroup)
    //   earthNodes.orbitGroup.add(this.orbitPaths.moonRoot)
    // }
  }

  /**
   * Drive every body from the ephemeris at `simMs`.
   * Positions follow exactly the chain the drawn orbit paths use, so a planet
   * always sits on its own line: AU → eclipticToScene → orbit scale → Y exaggeration.
   */
  private updateEphemeris(simMs: number): void {
    const T = julianCenturies(simMs)
    for (const id of BODY_ORDER) {
      const nodes = this.nodes.get(id)
      if (!nodes) continue

      if (id === 'moon') {
        const scenePos = eclipticToScene(moonPositionAU(simMs))
        const factor = moonOrbitScaleFactor()
        this.ephemerisScratch.set(
          scenePos.x * factor,
          scenePos.y * factor * this.verticalExaggeration,
          scenePos.z * factor,
        )
      } else if (id !== 'sun') {
        const scenePos = eclipticToScene(planetPositionAU(id, simMs))
        const factor = orbitScaleFactor(
          elementsAt(ORBITS[id], T).a,
          this.distanceMode,
        )
        this.ephemerisScratch.set(
          scenePos.x * factor,
          scenePos.y * factor * this.verticalExaggeration,
          scenePos.z * factor,
        )
      } else {
        this.ephemerisScratch.set(0, 0, 0)
      }

      if (this.bodyOverride) {
        // Hand the override the truth, pre-loaded as the default answer, so an
        // override that declines to act leaves the body exactly where it belongs.
        this.transformScratch.position.copy(this.ephemerisScratch)
        this.transformScratch.scale = 1
        this.bodyOverride(id, this.ephemerisScratch, this.transformScratch)
        nodes.orbitGroup.position.copy(this.transformScratch.position)
        nodes.tiltGroup.scale.setScalar(this.transformScratch.scale)
        // A body scaled to zero still costs its full draw — globe, clouds,
        // atmosphere and rings, with 8K maps bound. Cull it outright instead.
        nodes.tiltGroup.visible = this.transformScratch.scale > 1e-4
      } else {
        nodes.orbitGroup.position.copy(this.ephemerisScratch)
      }

      const spin = THREE.MathUtils.degToRad(spinAngleDeg(ROTATIONS[id], simMs))
      nodes.spinGroup.rotation.y = spin
      if (nodes.cloudSpin && hasCloudDeck(id)) {
        nodes.cloudSpin.rotation.y = THREE.MathUtils.degToRad(
          cloudAzimuthDeg(id, simMs),
        )
      }
    }

    const sun = this.nodes.get('sun')
    if (sun) sun.orbitGroup.getWorldPosition(this.sunLight.position)
  }

  private orbitPathOptions(): {
    mode: DistanceMode
    T: number
    verticalExaggeration: number
  } {
    return {
      mode: this.distanceMode,
      T: julianCenturies(this.simMs),
      verticalExaggeration: this.verticalExaggeration,
    }
  }

  private rebuildOrbitPaths(): void {
    this.orbitPathsEpochMs = this.simMs
    this.orbitPaths.rebuild(this.orbitPathOptions())
  }

  /** Simulated wall-clock instant, pushed in by `main.ts` every frame. */
  setSimTime(unixMs: number): void {
    // A body override is animated in real time, not simulated time, so it needs
    // the ephemeris re-applied every frame even when the clock is paused.
    if (unixMs === this.simMs && !this.bodyOverride) return
    this.simMs = unixMs
    // Elements are frozen per rebuild; a year of linear drift is sub-pixel.
    if (Math.abs(unixMs - this.orbitPathsEpochMs) > ORBIT_PATH_REFRESH_MS) {
      this.rebuildOrbitPaths()
    }
    this.updateEphemeris(unixMs)
  }

  /** Compressed (sqrt-spaced) or true heliocentric distances. */
  setDistanceMode(mode: DistanceMode): void {
    if (mode === this.distanceMode) return
    this.distanceMode = mode
    this.applyOrbitDistanceLimit()
    this.rebuildOrbitPaths()
    this.updateEphemeris(this.simMs)
    // Bodies just teleported. While following, the next frame's delta carries the
    // camera along and preserves the user's zoom; the system view has to re-frame.
    if (!this.followFocus) this.focusSystem()
  }

  /** Multiplier on the out-of-ecliptic (scene Y) component. 1 = truthful. */
  setInclinationExaggeration(factor: number): void {
    if (factor === this.verticalExaggeration) return
    this.verticalExaggeration = factor
    this.rebuildOrbitPaths()
    this.updateEphemeris(this.simMs)
  }

  setOrbitLinesVisible(visible: boolean): void {
    this.orbitPaths.setVisible(visible)
  }

  getOrbitPaths(): OrbitPaths {
    return this.orbitPaths
  }

  /**
   * Take over body placement and scale. Pass `null` to hand control back — which
   * also restores every body's scale, so a half-finished intro cannot leave a
   * planet shrunk.
   */
  setBodyTransformOverride(fn: BodyTransformOverride | null): void {
    this.bodyOverride = fn
    if (!fn) {
      for (const nodes of this.nodes.values()) {
        nodes.tiltGroup.scale.setScalar(1)
        nodes.tiltGroup.visible = true
      }
    }
    this.updateEphemeris(this.simMs)
  }

  /**
   * Replace the per-frame draw call — used to route the scene through a
   * post-processing composer. The callback is responsible for actually drawing.
   */
  setRenderOverride(fn: ((dtSeconds: number) => void) | null): void {
    this.renderOverride = fn
  }

  /**
   * Take over the camera. While set, focus-following, travel interpolation, and
   * `OrbitControls.update()` are all suspended: the driver has the only say, and
   * damping cannot fight it.
   */
  setCameraDriver(fn: ((dtSeconds: number) => void) | null): void {
    this.cameraDriver = fn
    this.controls.enabled = fn === null
    if (!fn) {
      // Resync the controls' internal spherical with wherever the driver left
      // the camera, or the first user drag will snap back.
      this.controls.update()
      this.lastFocusPos.copy(this.bodyPosition(this.focusedId))
    }
  }

  /** Notified on canvas resize, for anything sized off the drawing buffer. */
  setResizeHandler(fn: ((width: number, height: number) => void) | null): void {
    this.resizeHandler = fn
  }

  /**
   * Global sky dimmer, 0..1, covering both halves of the backdrop: the equirect
   * Milky Way (a scene property) and the parallax point shell (a material
   * uniform). Persisted, so it survives `applyTextures` installing the starfield
   * partway through a fade.
   */
  setSkyIntensity(value: number): void {
    this.skyIntensity = Math.max(0, Math.min(1, value))
    this.applySkyIntensity()
  }

  private applySkyIntensity(): void {
    this.starfield?.setOpacity(this.skyIntensity)
    if (this.scene.background instanceof THREE.Texture) {
      this.scene.backgroundIntensity = BACKGROUND_INTENSITY * this.skyIntensity
    }
  }

  /** Ignition dimmer for the Sun: shader layers and the point light together. */
  setSunIgnition(value: number): void {
    const v = Math.max(0, Math.min(1, value))
    if (this.sunVisuals) setSunIntensity(this.sunVisuals, v)
    this.sunLight.intensity = SUN_LIGHT_INTENSITY * v
  }

  setLabelsOpacity(value: number): void {
    this.labelOpacity = Math.max(0, Math.min(1, value))
    this.labels?.setOpacity(this.labelOpacity)
  }

  /** Camera pose that frames a single body — the destination of `travelTo`. */
  focusPose(id: BodyId): FocusCameraPose {
    return this.cameraPoseFor(id)
  }

  /** Camera pose that frames the whole system, HUD chrome accounted for. */
  systemViewPose(): FocusCameraPose {
    const canvas = this.renderer.domElement
    const width = canvas.clientWidth || window.innerWidth
    const height = canvas.clientHeight || window.innerHeight
    const dist = systemViewDistance(
      systemRadius(this.distanceMode),
      this.camera.fov,
      width,
      height,
    )
    return {
      position: new THREE.Vector3(
        0,
        Math.sin(SYSTEM_VIEW_ELEVATION) * dist,
        Math.cos(SYSTEM_VIEW_ELEVATION) * dist,
      ),
      target: new THREE.Vector3(0, 0, 0),
    }
  }

  /** Live world position of a body, for labels / headless verification. */
  getBodyWorldPosition(id: BodyId): THREE.Vector3 {
    return this.bodyPosition(id)
  }

  /** Keep OrbitControls from spherical-clamping a HUD-safe Top-view pose. */
  private applyOrbitDistanceLimit(): void {
    const canvas = this.renderer.domElement
    const width = canvas.clientWidth || window.innerWidth
    const height = canvas.clientHeight || window.innerHeight
    this.controls.maxDistance = systemViewMaxDistance(
      this.distanceMode,
      this.camera.fov,
      width,
      height,
    )
  }

  /** Pull back far enough to frame the whole system, looking at the Sun. */
  focusSystem(): void {
    this.travelActive = false
    this.onTravelComplete = null
    this.followFocus = false
    this.controls.minDistance = 1.2
    // Fit the system's bounding sphere to the HUD-safe frustum. Raise
    // maxDistance first — OrbitControls.update() spherical-clamps the eye
    // and would otherwise pull a 1438-unit pose back to 3× systemRadius.
    this.applyOrbitDistanceLimit()
    const pose = this.systemViewPose()
    this.camera.position.copy(pose.position)
    this.controls.target.copy(pose.target)
    this.controls.update()
  }

  async applyTextures(): Promise<void> {
    const milkyWay = await this.textures.load('stars').catch(() => null)
    // Sized off the widest mode so the shell still encloses the system after a
    // switch to true distances — points are drawn at constant apparent size, so
    // the extra radius costs nothing visually.
    this.starfield = new Starfield({
      milkyWay,
      radius: systemRadius('true'),
    })
    this.starfield.applyTo(this.scene)
    // The intro may already be holding the sky down; `applyTo` has just reset
    // both halves of it, so re-assert whatever level was asked for.
    this.applySkyIntensity()

    await this.textures.loadCritical().catch(() => undefined)
    await this.setupSun()
    await this.setupPlanetMaps()
  }

  private async setupSun(): Promise<void> {
    if (!this.sunVisuals) return
    try {
      const map = await this.textures.load('sun')
      applySunMap(this.sunVisuals, map)
    } catch {
      // procedural photosphere still reads as a star
    }
  }

  private async setupPlanetMaps(): Promise<void> {
    const jobs = [...this.planetVisuals.entries()].map(async ([id, visuals]) => {
      const albedo = await this.textures.loadBody(id).catch(() => null)
      const night =
        id === 'earth'
          ? await this.textures.load('earth_night').catch(() => null)
          : null
      const clouds =
        id === 'earth'
          ? await this.textures.load('earth_clouds').catch(() => null)
          : null
      const normal =
        id === 'earth'
          ? await this.textures.loadData('earth_normal').catch(() => null)
          : id === 'mars'
            ? await this.textures.loadData('mars_normal').catch(() => null)
            : null
      const specular =
        id === 'earth'
          ? await this.textures.loadData('earth_specular').catch(() => null)
          : null
      const atmosphere =
        id === 'venus'
          ? await this.textures.load('venus_atmosphere').catch(() => null)
          : null
      const rings =
        id === 'saturn'
          ? await this.textures.load('saturn_ring').catch(() => null)
          : null
      applyPlanetMaps(id, visuals, {
        albedo,
        night,
        clouds,
        normal,
        specular,
        atmosphere,
        rings,
      })
    })
    await Promise.all(jobs)
  }

  focusImmediate(id: BodyId): void {
    this.focusedId = id
    this.followFocus = true
    this.travelActive = false
    this.applyFocusLimits(id)
    const pose = this.cameraPoseFor(id)
    this.camera.position.copy(pose.position)
    this.controls.target.copy(pose.target)
    this.controls.update()
    this.lastFocusPos.copy(this.bodyPosition(id))
    this.showHotspots(id)
    this.labels?.setFocused(id)
    this.orbitPaths.setFocused(id)
  }

  travelTo(
    id: BodyId,
    duration = 1.6,
    onComplete?: (id: BodyId) => void,
  ): void {
    if (this.travelActive) return
    this.travelActive = true
    this.travelT = 0
    this.travelDuration = duration
    this.onTravelComplete = onComplete ?? null
    this.camFrom.copy(this.camera.position)
    this.lookFrom.copy(this.controls.target)
    const pose = this.cameraPoseFor(id)
    this.camTo.copy(pose.position)
    this.lookTo.copy(pose.target)
    this.focusedId = id
    this.followFocus = true
    this.applyFocusLimits(id)
    this.labels?.setFocused(id)
    this.orbitPaths.setFocused(id)
  }

  private cameraPoseFor(id: BodyId): FocusCameraPose {
    const bodyPos = this.bodyPosition(id)
    const radius = this.bodyRadius(id)
    const dist =
      id === 'sun'
        ? radius * 4.55 + 2.6
        : id === 'moon'
          ? radius * 4.4 + 0.55
          : radius * 3.9 + 2.2

    if (id === 'sun') {
      return {
        position: bodyPos
          .clone()
          .add(new THREE.Vector3(dist * 0.36, dist * 0.2, dist)),
        target: bodyPos.clone(),
      }
    }

    // Approach from the sunward side. A fixed world-space offset only worked
    // while the old layout strung the bodies along one axis; at real heliocentric
    // longitudes it leaves half the planets as unlit silhouettes with the Sun
    // blazing directly behind them. Yaw and lift off the Sun–body line so the
    // terminator stays in frame instead of a flat full-phase disc.
    const toSun = this.bodyPosition('sun').sub(bodyPos)
    if (toSun.lengthSq() < 1e-9) toSun.set(0, 0, 1)
    toSun.normalize().applyAxisAngle(SCENE_UP, VIEW_YAW)
    toSun.y += VIEW_LIFT
    toSun.normalize()

    return {
      position: bodyPos.clone().addScaledVector(toSun, dist),
      target: bodyPos.clone(),
    }
  }

  private applyFocusLimits(id: BodyId): void {
    const r = this.bodyRadius(id)
    this.controls.minDistance = Math.max(id === 'moon' ? 0.55 : 1.2, r * 1.6)
  }

  showHotspots(id: BodyId): void {
    for (const mesh of [...this.hotspotMeshes, ...this.hotspotRings]) {
      mesh.parent?.remove(mesh)
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    }
    this.hotspotMeshes = []
    this.hotspotRings = []

    const body = BODIES[id]
    const nodes = this.nodes.get(id)
    if (!nodes || !body) return

    const radius = this.bodyRadius(id)

    for (const hs of body.hotspots) {
      const phi = THREE.MathUtils.degToRad(90 - hs.lat)
      const theta = THREE.MathUtils.degToRad(hs.lon + 180)
      const r = radius * 1.06
      // LOCAL surface coordinates. spinGroup's transform carries them into world
      // space, so markers ride the surface — no quaternion math needed here.
      const local = new THREE.Vector3(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta),
      )

      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 0.04, 16, 12),
        new THREE.MeshBasicMaterial({
          color: 0x7dd3fc,
          transparent: true,
          opacity: 0.95,
        }),
      )
      marker.position.copy(local)
      marker.userData.hotspot = hs

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(radius * 0.055, radius * 0.08, 28),
        new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.55,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      )
      ring.position.copy(local)

      nodes.spinGroup.add(marker)
      nodes.spinGroup.add(ring)
      // After parenting, so lookAt can cancel out the body's own rotation.
      ring.lookAt(this.camera.position)

      this.hotspotMeshes.push(marker)
      this.hotspotRings.push(ring)
    }

    // Markers were parented this instant; refresh world matrices so a click
    // landing before the next render still raycasts against the right place.
    this.root.updateMatrixWorld(true)
  }

  setHotspotClickHandler(fn: (hotspot: Hotspot) => void): void {
    this.onHotspotClick = fn
  }

  /**
   * Runs once per frame with the REAL elapsed seconds, before the scene updates.
   * `main.ts` owns the simulated clock, so this is where it advances it and
   * pushes the result back in through `setSimTime`.
   */
  setFrameHandler(fn: (dtSeconds: number) => void): void {
    this.onFrame = fn
  }

  private handlePointer = (event: PointerEvent): void => {
    if (!this.onHotspotClick || this.hotspotMeshes.length === 0) return
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hits = this.raycaster.intersectObjects(this.hotspotMeshes, false)
    if (hits.length > 0) {
      const hs = hits[0].object.userData.hotspot as Hotspot
      if (hs) this.onHotspotClick(hs)
    }
  }

  private handleResize = (): void => {
    const canvas = this.renderer.domElement
    const w = canvas.clientWidth || window.innerWidth
    const h = canvas.clientHeight || window.innerHeight
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h, false)
    this.labels?.setSize(w, h)
    this.resizeHandler?.(w, h)
  }

  start(): void {
    // `renderer.info` resets itself on every render() by default, so with a
    // post-processing composer it ends up describing only the final full-screen
    // blit. Reset once per frame instead and it counts the whole frame.
    this.renderer.info.autoReset = false

    const loop = (): void => {
      if (this.disposed) return
      this.animationId = requestAnimationFrame(loop)
      const dt = this.clock.getDelta()
      this.onFrame?.(dt)
      this.tick(dt)
      this.renderer.info.reset()
      if (this.renderOverride) {
        this.renderOverride(dt)
      } else {
        this.renderer.render(this.scene, this.camera)
      }
      // CSS2D writes a transform onto ten DOM nodes every frame. While the tags
      // are fully transparent — the whole first half of the intro — that is pure
      // layout cost for something nobody can see.
      if (this.labelOpacity > 0.001) this.labels?.render(this.scene, this.camera)
    }
    loop()
  }

  /**
   * Rotation and position come from the simulated clock, not from `dt` — the
   * only things `dt` still drives are the camera travel and the shader clocks.
   */
  private tick(dt: number): void {
    if (!this.cameraDriver) this.followFocusedBody()

    if (this.sunVisuals) {
      updateSunTime(this.sunVisuals, this.clock.elapsedTime)
      updateSunFacing(this.sunVisuals, this.camera)
    }
    const sunPos = this.sunLight.position
    const earthPos = this.bodyPosition('earth')
    const t = this.clock.elapsedTime
    for (const [id, visuals] of this.planetVisuals) {
      updatePlanetVisuals(id, visuals, {
        time: t,
        sunPosition: sunPos,
        earthPosition: earthPos,
      })
    }

    for (const ring of this.hotspotRings) {
      ring.lookAt(this.camera.position)
    }

    // An intro driver owns the camera outright: no travel lerp, no damping.
    if (this.cameraDriver) {
      this.cameraDriver(dt)
    } else if (this.travelActive) {
      this.travelT += dt / this.travelDuration
      const t = Math.min(1, this.travelT)
      const e = t * t * (3 - 2 * t)
      // The destination is moving, so re-derive it from the live pose each frame
      // instead of flying to where the planet used to be.
      const pose = this.cameraPoseFor(this.focusedId)
      this.camTo.copy(pose.position)
      this.lookTo.copy(pose.target)
      this.camera.position.lerpVectors(this.camFrom, this.camTo, e)
      this.controls.target.lerpVectors(this.lookFrom, this.lookTo, e)
      this.controls.update()
      if (t >= 1) {
        this.travelActive = false
        this.showHotspots(this.focusedId)
        this.labels?.setFocused(this.focusedId)
        this.onTravelComplete?.(this.focusedId)
        this.onTravelComplete = null
      }
    } else {
      this.controls.update()
    }
  }

  /**
   * Carry the camera along with the focused body. Applying the frame's delta to
   * both the eye and the target keeps whatever orbit/zoom the user has dialled in
   * — re-deriving the pose outright would fight them every frame.
   */
  private followFocusedBody(): void {
    const pos = this.bodyPosition(this.focusedId)
    if (this.followFocus && !this.travelActive) {
      this.followDelta.subVectors(pos, this.lastFocusPos)
      this.camera.position.add(this.followDelta)
      this.controls.target.add(this.followDelta)
    }
    this.lastFocusPos.copy(pos)
  }

  getFocusedId(): BodyId {
    return this.focusedId
  }

  isTraveling(): boolean {
    return this.travelActive
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.animationId)
    window.removeEventListener('resize', this.handleResize)
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointer)
    if (this.labelHost && this.labels) this.labels.dispose(this.labelHost)
    this.orbitPaths.dispose()
    this.starfield?.dispose()
    this.controls.dispose()
    this.renderer.dispose()
  }
}
