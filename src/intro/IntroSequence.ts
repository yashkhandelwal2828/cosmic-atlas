/**
 * The conductor.
 *
 * Everything the intro does is a function of one number — `this.t`, seconds
 * since the sequence began — read through `timeline.ts`. No module below this
 * one knows what a phase is; they take intensities and positions and draw.
 *
 * Two structural decisions worth knowing before editing:
 *
 * 1. Bodies are placed by an override installed on `SolarSystem`, which is
 *    handed each body's TRUE ephemeris position every frame. Flight is computed
 *    against that live target, so a planet that drifts during its 1.4s flight
 *    still lands exactly on its own drawn orbit. `launchPositionAt` returns the
 *    target verbatim at t=1, so releasing the override is a no-op, not a snap.
 *
 * 2. The clock can be *held*. At the moment of detonation it stops until the
 *    planetary textures resolve (or a ceiling elapses). The intro is therefore
 *    also the loading screen, and no planet is ever born wearing a fallback
 *    material unless the network genuinely failed.
 */
import * as THREE from 'three'
import type { BodyId } from '../data/bodies'
import { BODIES, BODY_ORDER } from '../data/bodies'
import type { SolarSystem, BodyTransform } from '../scene/SolarSystem'
import { systemRadius, type DistanceMode } from '../scene/scale'
import { SYSTEM_VIEW_ELEVATION } from '../scene/systemView'
import { HORIZON_RADIUS, Singularity } from './Singularity'
import { Shockwave } from './Shockwave'
import { Trails } from './Trails'
import { IntroPipeline } from './postfx/Pipeline'
import {
  FrameWatchdog,
  downgrade,
  selectTier,
  settingsFor,
  type DeviceCaps,
  type QualityTier,
} from './quality'
import {
  launchPositionAt,
  launchScaleAt,
  launchSpeedAt,
  launchTiming,
  seedFromId,
  type Vec3,
} from './launchPath'
import {
  INTRO_DURATION,
  LAUNCH_GATE_AT,
  LAUNCH_GATE_MAX_WAIT,
  clamp01,
  easeInQuint,
  easeOutCubic,
  lerp,
  progressBetween,
  progressIn,
  smootherstep,
  smoothstep,
  spanOf,
} from './timeline'

/** Camera distance at the very first frame, in scene units. */
const CAM_DIST_OPEN = 24

/**
 * Camera distance while the singularity holds the frame. The disk is ~5.4 scene
 * units across, so this frames it at roughly half the frame height — close
 * enough to read the filaments, far enough that it is an object in space rather
 * than a wall of light.
 */
const CAM_DIST_HOLE = 14

/** Elevation (radians) the camera opens at, before it rises to the system view. */
const CAM_ELEVATION_OPEN = 0.1

/** How fast the camera drifts around the system, radians/second. */
const CAM_AZIMUTH_RATE = 0.055

/** Starting azimuth — chosen so the Milky Way band crosses frame during settle. */
const CAM_AZIMUTH_OPEN = 0.6

/** Seconds after the skip button becomes available. */
const SKIP_REVEAL_AT = 1.0

/**
 * Ceiling on the film pass's white mix.
 *
 * The film shader does `mix(col, vec3(1.0), uFlash)`, so feeding it 1.0 does not
 * mean "very bright" — it means *every pixel is literally white*, with the frame
 * behind it discarded. That is indistinguishable from a broken renderer. Capped
 * here, the detonation lifts the field enough to read as a blinding wash while
 * the flare and the bloom supply the actual punch, which is where the HDR range
 * lives. Kept well under 1 for contrast as much as for comfort: an even white
 * mix across the frame raises the burst and the background by the same amount,
 * so pushing it up makes the explosion *less* legible, not more.
 */
const FILM_FLASH_PEAK = 0.32

interface LaunchSpec {
  /** Absolute timeline second this body departs. */
  startAt: number
  /** Absolute timeline second it arrives. */
  endAt: number
  seed: number
}

export interface IntroSequenceOptions {
  solar: SolarSystem
  distanceMode: DistanceMode
  /** Called once, when control returns to the interactive scene. */
  onFinish: () => void
  /** Called when the skip affordance should appear. */
  onRevealSkip: () => void
  /** Overridden in tests; normally probed from the renderer. */
  tier?: QualityTier
}

export class IntroSequence {
  private solar: SolarSystem
  private onFinish: () => void
  private onRevealSkip: () => void

  private t = 0
  private gateHeld = 0
  private texturesReady = false
  private started = false
  private finished = false
  private paused = false
  private skipRevealed = false

  private tier: QualityTier
  private watchdog = new FrameWatchdog()
  private pipeline: IntroPipeline

  private singularity: Singularity
  private shockwave: Shockwave
  private trails: Trails

  private specs = new Map<BodyId, LaunchSpec>()
  private launchIds: BodyId[]
  private sunScale = 0

  /**
   * Cached because `systemViewPose()` reads `canvas.clientWidth/clientHeight`.
   * Calling it from the camera driver forced a synchronous layout on every
   * frame of the sequence — a measurable stutter that has nothing to do with
   * the GPU. It only changes on resize, so it is recomputed there.
   */
  private systemDistance = 1

  private lensCenter = new THREE.Vector2(0.5, 0.5)
  private projectScratch = new THREE.Vector3()
  private rightScratch = new THREE.Vector3()
  private posScratch: Vec3 = { x: 0, y: 0, z: 0 }
  private worldScratch = new THREE.Vector3()
  private earthWorld = new THREE.Vector3()
  private camPos = new THREE.Vector3()
  private camTarget = new THREE.Vector3()

  constructor(options: IntroSequenceOptions) {
    this.solar = options.solar
    this.onFinish = options.onFinish
    this.onRevealSkip = options.onRevealSkip

    this.tier = options.tier ?? selectTier(probeCaps(this.solar.renderer))
    const settings = settingsFor(this.tier)
    const pixelRatio = Math.min(
      window.devicePixelRatio || 1,
      settings.maxPixelRatio,
    )

    this.pipeline = new IntroPipeline(
      this.solar.renderer,
      this.solar.scene,
      this.solar.camera,
      this.tier,
    )

    this.singularity = new Singularity(settings.accretionParticles, pixelRatio)
    this.shockwave = new Shockwave({
      particles: settings.particles,
      shellSegments: settings.shellSegments,
      reach: systemRadius(options.distanceMode) * 1.15,
      pixelRatio,
    })

    this.launchIds = BODY_ORDER.filter((id) => id !== 'sun')
    this.trails = new Trails(this.launchIds)

    const launch = spanOf('launch')
    for (const id of this.launchIds) {
      // Stagger by distance from the Sun rather than by measured scene radius,
      // so the running order is identical in compressed and true-distance modes.
      // The Moon shares Earth's slot: it is parented to Earth and rides along.
      const order = BODIES[id].orderFromSun
      const normalized = clamp01((order - 1) / 7)
      const timing = launchTiming(normalized)
      const startAt = launch.start + timing.delay
      this.specs.set(id, {
        startAt,
        endAt: startAt + timing.duration,
        seed: seedFromId(id),
      })
    }
  }

  /** Install the hooks and blank the scene. Call before the render loop starts. */
  begin(): void {
    if (this.started) return
    this.started = true

    this.solar.scene.add(this.singularity.group)
    this.solar.scene.add(this.shockwave.group)
    this.solar.scene.add(this.trails.group)

    this.solar.setSkyIntensity(0)
    this.solar.setSunIgnition(0)
    this.solar.setLabelsOpacity(0)
    this.solar.getOrbitPaths().setDrawProgressAll(0)
    this.solar.setBodyTransformOverride(this.transformBody)
    this.solar.setCameraDriver(this.driveCamera)
    this.solar.setRenderOverride(this.render)
    this.solar.setResizeHandler(this.handleResize)

    this.systemDistance = this.solar.systemViewPose().position.length()
    this.warmUpShaders()
    this.applyFrame()
  }

  /**
   * Force every program the sequence will ever need to link now, during boot.
   *
   * The shockwave's three materials are hidden until the detonation, so WebGL
   * compiled and linked them on the frame at t=1.6 — tens of milliseconds of
   * synchronous stall on an integrated GPU, landing on the single frame with the
   * least headroom in the whole sequence. It read as the animation breaking at
   * exactly the moment it was supposed to be at its most impressive.
   *
   * Everything is drawn at zero intensity, so the warm-up frame is black.
   */
  private warmUpShaders(): void {
    const singularityWasVisible = this.singularity.group.visible
    const shockwaveWasVisible = this.shockwave.group.visible
    this.singularity.group.visible = true
    this.shockwave.group.visible = true

    try {
      this.solar.renderer.compile(this.solar.scene, this.solar.camera)
      // Scene materials are linked above; the composer's own passes are not,
      // and the lens is disabled at t=0 so it would otherwise link mid-shot.
      this.pipeline.warmUp()
    } catch (err) {
      // A warm-up is an optimisation. Losing it costs a hitch, not the intro.
      console.warn('Intro shader warm-up failed', err)
    } finally {
      // `warmUp` draws a real frame, and at this point the placement override is
      // installed but has not run — the bodies are still at their constructed
      // positions. Wiping it here keeps that frame from ever being presented:
      // `begin()` is synchronous, so the browser composites only what survives
      // to the end of this task, which is the cleared buffer.
      this.solar.renderer.setRenderTarget(null)
      this.solar.renderer.clear()
    }

    this.singularity.group.visible = singularityWasVisible
    this.shockwave.group.visible = shockwaveWasVisible
  }

  /** The texture gate. Resolving this releases the clock at the detonation. */
  gateOn(ready: Promise<unknown>): void {
    void ready.then(
      () => {
        this.texturesReady = true
      },
      () => {
        this.texturesReady = true
      },
    )
  }

  /**
   * Advance the sequence. Called from the scene's frame handler BEFORE the
   * simulated clock is pushed in, so the override runs against the `t` set here.
   */
  tick(deltaSeconds: number): void {
    if (this.finished || this.paused) return

    const dt = Math.min(deltaSeconds, 0.1) // a tab-switch must not skip the show

    if (this.isGated()) {
      this.gateHeld += dt
    } else {
      this.t += dt
    }

    if (!this.skipRevealed && this.t >= SKIP_REVEAL_AT) {
      this.skipRevealed = true
      this.onRevealSkip()
    }

    if (this.watchdog.sample(deltaSeconds * 1000) && this.tier !== 'low') {
      this.tier = downgrade(this.tier)
      this.pipeline.applyTier(this.tier)
    }

    this.applyFrame()

    if (this.t >= INTRO_DURATION) this.finish()
  }

  /** True while the clock is deliberately stopped waiting on planetary maps. */
  private isGated(): boolean {
    return (
      !this.texturesReady &&
      this.t >= LAUNCH_GATE_AT &&
      this.gateHeld < LAUNCH_GATE_MAX_WAIT
    )
  }

  /** Push everything that is not per-body: scene dimmers, effects, uniforms. */
  private applyFrame(): void {
    const t = this.t
    const camera = this.solar.camera
    const flash = spanOf('flash')
    const settle = spanOf('settle')
    const orbits = spanOf('orbits')
    const approach = spanOf('approach')

    // --- singularity ----------------------------------------------------
    // Grows in through its own phase, then is annihilated by the flash in 80ms.
    const emergence =
      easeOutCubic(progressIn('singularity', t)) *
      (1 - progressBetween(t, flash.start, flash.start + 0.08))
    this.singularity.update(emergence, t, camera)

    // --- detonation -----------------------------------------------------
    this.shockwave.update(t - flash.start, this.blowoutAt(t), camera)

    // --- the star -------------------------------------------------------
    this.sunScale = smoothstep(progressBetween(t, flash.start, flash.start + 0.55))
    this.solar.setSunIgnition(
      smoothstep(progressBetween(t, flash.start, settle.start + 0.4)),
    )

    // --- the sky --------------------------------------------------------
    // Held at zero until the ejecta cools, or the burst has nothing to be
    // brighter than and the whole detonation reads flat.
    this.solar.setSkyIntensity(smoothstep(progressBetween(t, 3.4, 5.2)))

    // --- orbit paths ----------------------------------------------------
    this.drawOrbits(t, orbits.start, orbits.end)

    this.solar.setLabelsOpacity(
      smoothstep(progressBetween(t, orbits.start + 0.35, approach.start + 0.4)),
    )

    this.updateScreenEffects(t)
  }

  /** Ellipses draw in from the inside out, each over a slice of the phase. */
  private drawOrbits(t: number, start: number, end: number): void {
    const paths = this.solar.getOrbitPaths()
    const ids = paths.drawOrder
    const span = end - start
    const width = span * 0.55
    const stagger = ids.length > 1 ? (span - width) / (ids.length - 1) : 0

    for (let i = 0; i < ids.length; i++) {
      const from = start + i * stagger
      const p = easeOutCubic(progressBetween(t, from, from + width))
      paths.setDrawProgress(ids[i], p)
      // MOON DISABLED — see BODY_ORDER in data/bodies.ts.
      // The lunar path belongs to Earth's slot, so it draws with Earth's line.
      // if (ids[i] === 'earth') paths.setDrawProgress('moon', p)
    }
  }

  private updateScreenEffects(t: number): void {
    const camera = this.solar.camera
    const flash = spanOf('flash')
    const launch = spanOf('launch')

    // Project the singularity to screen space — the lens and the radial blur
    // both need it, and it moves every frame as the camera retreats.
    this.projectScratch.set(0, 0, 0).project(camera)
    this.lensCenter.set(
      this.projectScratch.x * 0.5 + 0.5,
      this.projectScratch.y * 0.5 + 0.5,
    )

    // Apparent radius of the photon ring, measured rather than approximated:
    // project a point one ring-radius to the camera's right and take the gap.
    this.rightScratch.setFromMatrixColumn(camera.matrixWorld, 0)
    this.projectScratch
      .copy(this.rightScratch)
      .multiplyScalar(HORIZON_RADIUS * 2.1)
      .project(camera)
    const ringRadius = Math.max(
      0.01,
      Math.abs(this.projectScratch.x * 0.5 + 0.5 - this.lensCenter.x),
    )

    // Signed: the hole pulls light inward, the blast throws it outward.
    let lensStrength = easeInQuint(progressIn('singularity', t))
    if (t >= flash.start) {
      const decay = 1 - progressBetween(t, flash.start, flash.start + 0.9)
      lensStrength = -1.3 * decay * decay
    }

    this.pipeline.setLens({
      center: this.lensCenter,
      strength: lensStrength,
      ringRadius,
      ringWidth: Math.max(0.008, ringRadius * 0.16),
      // The fringe is a feature on the smooth Einstein ring and an artefact on
      // the burst, whose ejecta is high-frequency point detail: sampling three
      // channels at different offsets there just prints rainbow confetti.
      chroma: lensStrength >= 0 ? 0.08 : 0.022,
    })

    // Blur tracks the fastest thing on screen: the blast front, then the bodies.
    const blastBlur = 1 - progressBetween(t, flash.start, launch.start + 0.5)
    const bodyBlur = this.peakLaunchSpeed(t)
    this.pipeline.setRadialBlur(
      this.lensCenter,
      Math.min(0.8, blastBlur * 0.8 + bodyBlur * 0.4),
    )

    this.pipeline.setFilm(t, {
      // Grain thins out as the scene resolves, so the interactive view it hands
      // off to never looks noisy.
      grain: lerp(0.032, 0.006, smoothstep(progressBetween(t, 4.0, 7.2))),
      vignette: lerp(0.45, 0.16, smoothstep(progressBetween(t, 3.0, 6.4))),
      flash: this.blowoutAt(t) * FILM_FLASH_PEAK,
    })
  }

  /**
   * The detonation envelope, 0..1 — read by the flare and by the film pass, so
   * it lives in one place rather than being written out twice and drifting.
   *
   * The decay is squared, not linear. A linear ramp down from a near-white frame
   * spends its first half still near-white, which is what made the flash read as
   * a stuck frame rather than a blink; squaring it is down to a quarter by the
   * midpoint, so the scene reappears while the burst is still going.
   */
  private blowoutAt(t: number): number {
    const flash = spanOf('flash')
    const attack = progressBetween(t, flash.start, flash.start + 0.05)
    const fall = 1 - progressBetween(t, flash.start + 0.05, flash.start + 0.4)
    return attack * fall * fall
  }

  /** Fastest body currently in flight, 0..1 — drives motion blur. */
  private peakLaunchSpeed(t: number): number {
    let peak = 0
    for (const spec of this.specs.values()) {
      if (t < spec.startAt || t >= spec.endAt) continue
      const local = progressBetween(t, spec.startAt, spec.endAt)
      const speed = launchSpeedAt(local)
      if (speed > peak) peak = speed
    }
    return peak
  }

  /**
   * Per-body placement. `ephemeris` is the truthful position for this frame and
   * `out` arrives pre-loaded with it, so every early return below is exact.
   */
  private transformBody = (
    id: BodyId,
    ephemeris: THREE.Vector3,
    out: BodyTransform,
  ): void => {
    if (id === 'sun') {
      out.scale = this.sunScale
      return
    }

    const spec = this.specs.get(id)
    if (!spec) return

    if (this.t < spec.startAt) {
      out.position.set(0, 0, 0)
      out.scale = 0
      this.trails.reset(id)
      if (id === 'earth') this.earthWorld.set(0, 0, 0)
      return
    }

    const local = progressBetween(this.t, spec.startAt, spec.endAt)
    if (local < 1) {
      launchPositionAt(ephemeris, local, spec.seed, this.posScratch)
      out.position.set(this.posScratch.x, this.posScratch.y, this.posScratch.z)
      out.scale = launchScaleAt(local)
    }

    // MOON DISABLED — see BODY_ORDER in data/bodies.ts. The Moon's transform is
    // expressed in Earth's frame, so it had to be lifted to world space before
    // going into the trail; BODY_ORDER puts Earth first, so `earthWorld` was
    // already this frame's value by the time the Moon arrived.
    // if (id === 'moon') {
    //   this.worldScratch.copy(this.earthWorld).add(out.position)
    // } else {
    this.worldScratch.copy(out.position)
    if (id === 'earth') this.earthWorld.copy(out.position)
    // }

    // Trails use their own ramp rather than `launchSpeedAt`. Real speed decays
    // as 2^-10t, which is all but zero a third of the way through the flight —
    // correct for motion blur, but it would leave the streaks invisible for most
    // of the journey they exist to describe.
    this.trails.sample(id, this.worldScratch, Math.pow(1 - local, 0.8) * 0.85)
  }

  /**
   * Camera choreography. Spherical while the system is being framed, then a
   * straight interpolation into the Earth pose — which is re-read every frame,
   * because Earth is moving.
   */
  private driveCamera = (): void => {
    const camera = this.solar.camera
    const approach = spanOf('approach')

    if (this.t < approach.start) {
      this.sphericalPose(this.t, this.camPos, this.camTarget)
    } else {
      this.sphericalPose(approach.start, this.camPos, this.camTarget)
      const to = this.solar.focusPose('earth')
      const e = smootherstep(
        progressBetween(this.t, approach.start, approach.end),
      )
      this.camPos.lerp(to.position, e)
      this.camTarget.lerp(to.target, e)
    }

    camera.position.copy(this.camPos)
    camera.lookAt(this.camTarget)
    this.solar.controls.target.copy(this.camTarget)
  }

  /** The pre-approach camera path, as a pure function of time. */
  private sphericalPose(
    t: number,
    outPosition: THREE.Vector3,
    outTarget: THREE.Vector3,
  ): void {
    const flash = spanOf('flash')
    const settle = spanOf('settle')

    let distance: number
    if (t < flash.start) {
      // Slow push toward the hole — the frame tightens before it detonates.
      distance = lerp(
        CAM_DIST_OPEN,
        CAM_DIST_HOLE,
        smootherstep(progressBetween(t, 0, flash.start)),
      )
    } else if (t < flash.end) {
      // Recoil: the blast physically shoves the camera back a little.
      distance =
        CAM_DIST_HOLE +
        3.2 * smoothstep(progressBetween(t, flash.start, flash.end))
    } else {
      // Smootherstep, not easeOut: an ease-out front-loads the retreat and the
      // camera is already halfway to the system view before the inner planets
      // have finished launching, which throws away the shot.
      distance = lerp(
        CAM_DIST_HOLE + 3.2,
        this.systemDistance,
        smootherstep(progressBetween(t, flash.end, settle.end)),
      )
    }

    const elevation = lerp(
      CAM_ELEVATION_OPEN,
      SYSTEM_VIEW_ELEVATION,
      smootherstep(progressBetween(t, flash.end, settle.end)),
    )
    const azimuth = CAM_AZIMUTH_OPEN + t * CAM_AZIMUTH_RATE

    const horizontal = Math.cos(elevation) * distance
    outPosition.set(
      Math.sin(azimuth) * horizontal,
      Math.sin(elevation) * distance,
      Math.cos(azimuth) * horizontal,
    )
    outTarget.set(0, 0, 0)
  }

  private render = (dt: number): void => {
    this.pipeline.render(dt)
  }

  private handleResize = (width: number, height: number): void => {
    this.pipeline.setSize(width, height)
    this.systemDistance = this.solar.systemViewPose().position.length()
  }

  /** True between `begin()` and the moment control returns to the scene. */
  get isRunning(): boolean {
    return this.started && !this.finished
  }

  /** Seconds into the sequence. Exposed so verification can shoot exact beats. */
  get time(): number {
    return this.t
  }

  /**
   * Stop advancing without tearing anything down. The render loop keeps running
   * and keeps drawing whatever instant is currently set, which is what makes a
   * screenshot of an exact beat possible — capturing a WebGL page costs hundreds
   * of milliseconds, far more than a phase is wide.
   */
  setPaused(paused: boolean): void {
    this.paused = paused
  }

  /** Jump to an exact instant and render it. Pairs with `setPaused(true)`. */
  seek(seconds: number): void {
    if (this.finished) return
    // A seek is an explicit instruction; the texture gate must not fight it.
    this.texturesReady = true
    this.t = Math.max(0, Math.min(INTRO_DURATION - 1e-3, seconds))
    this.applyFrame()
  }

  /** Jump straight to the finished state. Safe at any point in the sequence. */
  skip(): void {
    if (this.finished) return
    this.t = INTRO_DURATION
    this.finish()
  }

  /**
   * Hand the scene back. Idempotent, and reachable from three directions — the
   * clock running out, the skip button, and a failure during boot — so every
   * hook it releases must tolerate already being released.
   */
  private finish(): void {
    if (this.finished) return
    this.finished = true

    this.solar.setBodyTransformOverride(null)
    this.solar.setCameraDriver(null)
    this.solar.setResizeHandler(null)
    this.solar.setSkyIntensity(1)
    this.solar.setSunIgnition(1)
    this.solar.setLabelsOpacity(1)
    this.solar.getOrbitPaths().setDrawProgressAll(1)

    // Bloom lives on; the lens, blur, and film passes do not.
    this.pipeline.demoteToExplore()

    this.singularity.dispose()
    this.shockwave.dispose()
    this.trails.dispose()

    this.solar.focusImmediate('earth')
    this.onFinish()
  }

  /** Tear down everything including the composer. Only for a hard unmount. */
  dispose(): void {
    this.finish()
    this.solar.setRenderOverride(null)
    this.pipeline.dispose()
  }
}

function probeCaps(renderer: THREE.WebGLRenderer): DeviceCaps {
  const gl = renderer.getContext()
  const size = renderer.getSize(new THREE.Vector2())
  return {
    isWebGL2: renderer.capabilities.isWebGL2 ?? true,
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    hardwareConcurrency:
      typeof navigator === 'undefined' ? 0 : (navigator.hardwareConcurrency ?? 0),
    devicePixelRatio: typeof window === 'undefined' ? 1 : window.devicePixelRatio,
    // CSS pixels — `renderPixels` applies the tier's own ratio cap on top.
    viewportWidth: size.x,
    viewportHeight: size.y,
  }
}
