/**
 * Post-processing pipeline.
 *
 * Two lives in one object:
 *
 *   intro    RenderPass -> Lens -> RadialBlur -> Bloom -> Film -> Output
 *   explore  RenderPass ------------------------> Bloom -------> Output
 *
 * `demoteToExplore()` performs the transition: the three intro-only passes are
 * removed and disposed, and bloom is retuned from "detonation" to "there is a
 * star in frame". Everything after that point is the permanent look of the site.
 *
 * Nothing here reads the timeline — the conductor pushes uniform values in. That
 * keeps the pipeline reusable and keeps phase logic in exactly one file.
 */
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { FilmShader, LensShader, RadialBlurShader } from './shaders'
import { settingsFor, type QualityTier } from '../quality'

/**
 * Bloom while the singularity and the blast are on screen.
 *
 * The threshold is high because the scene is genuinely HDR — the Sun's
 * photosphere alone peaks near 3.3 in linear space, and the additive intro
 * layers stack on top of it. A "cinematic" low threshold here does not look
 * cinematic, it looks like a white screen.
 */
const BLOOM_INTRO = { strength: 0.85, radius: 0.62, threshold: 0.62 }

/** Bloom for the rest of the site's life: sun corona and hotspots only. */
const BLOOM_EXPLORE = { strength: 0.45, radius: 0.55, threshold: 0.85 }

export interface LensParams {
  /** Singularity position in UV space (0..1, origin bottom-left). */
  center: THREE.Vector2
  /** Signed: positive pulls light in, negative pushes it out. */
  strength: number
  ringRadius: number
  ringWidth: number
  chroma: number
}

export interface FilmParams {
  grain: number
  vignette: number
  flash: number
}

export class IntroPipeline {
  readonly composer: EffectComposer

  private renderer: THREE.WebGLRenderer
  private renderPass: RenderPass
  private bloom: UnrealBloomPass
  private lens: ShaderPass | null = null
  private blur: ShaderPass | null = null
  private film: ShaderPass | null = null
  private output: OutputPass

  private tier: QualityTier
  private savedPixelRatio: number
  private width = 1
  private height = 1
  private demoted = false
  private disposed = false

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    tier: QualityTier,
  ) {
    this.renderer = renderer
    this.tier = tier
    this.savedPixelRatio = renderer.getPixelRatio()

    const size = renderer.getSize(new THREE.Vector2())
    this.width = Math.max(1, size.x)
    this.height = Math.max(1, size.y)

    this.composer = new EffectComposer(renderer)
    this.renderPass = new RenderPass(scene, camera)
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(this.width, this.height),
      BLOOM_INTRO.strength,
      BLOOM_INTRO.radius,
      BLOOM_INTRO.threshold,
    )
    // OutputPass owns tone mapping + sRGB conversion. Three disables in-material
    // tone mapping whenever the destination is a render target, so the scene
    // reaches bloom in linear HDR and is tonemapped exactly once, here.
    this.output = new OutputPass()

    this.applyTier(tier)
  }

  /** (Re)build the pass chain for a tier. Safe to call mid-flight on downgrade. */
  applyTier(tier: QualityTier): void {
    if (this.disposed) return
    this.tier = tier
    const settings = settingsFor(tier)

    this.disposeIntroPasses()

    if (!this.demoted && settings.lens) {
      this.lens = new ShaderPass(LensShader)
    }
    if (!this.demoted && settings.radialBlur) {
      this.blur = new ShaderPass(RadialBlurShader)
    }
    if (!this.demoted && settings.film) {
      this.film = new ShaderPass(FilmShader)
    }

    this.rebuildChain()

    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, settings.maxPixelRatio),
    )
    this.setSize(this.width, this.height)
  }

  private rebuildChain(): void {
    const passes = [
      this.renderPass,
      this.lens,
      this.blur,
      this.bloom,
      this.film,
      this.output,
    ].filter((p): p is NonNullable<typeof p> => p !== null)

    this.composer.passes.length = 0
    for (const pass of passes) this.composer.addPass(pass)
  }

  private disposeIntroPasses(): void {
    for (const pass of [this.lens, this.blur, this.film]) {
      pass?.dispose?.()
    }
    this.lens = null
    this.blur = null
    this.film = null
  }

  setSize(width: number, height: number): void {
    if (this.disposed) return
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    this.composer.setSize(this.width, this.height)

    const scale = settingsFor(this.tier).bloomResolutionScale
    this.bloom.setSize(
      Math.max(1, Math.round(this.width * scale)),
      Math.max(1, Math.round(this.height * scale)),
    )

    const aspect = this.width / this.height
    if (this.lens) this.lens.uniforms.uAspect.value = aspect
  }

  /**
   * Each setter also switches its pass off once its parameters reach identity.
   * EffectComposer skips disabled passes and reroutes `renderToScreen` around
   * them, so an inert pass costs nothing at all rather than costing a
   * full-screen read and write to reproduce its input. Over the sequence this
   * removes the lens for ~5s and the radial blur for ~6s of the 7.5s runtime.
   */
  setLens(params: LensParams): void {
    if (!this.lens) return
    this.lens.enabled = Math.abs(params.strength) > 0.002
    if (!this.lens.enabled) return
    const u = this.lens.uniforms
    u.uCenter.value.copy(params.center)
    u.uStrength.value = params.strength
    u.uRingRadius.value = params.ringRadius
    u.uRingWidth.value = params.ringWidth
    u.uChroma.value = params.chroma
  }

  setRadialBlur(center: THREE.Vector2, strength: number): void {
    if (!this.blur) return
    this.blur.enabled = strength > 0.004
    if (!this.blur.enabled) return
    this.blur.uniforms.uCenter.value.copy(center)
    this.blur.uniforms.uStrength.value = strength
  }

  setFilm(time: number, params: FilmParams): void {
    if (!this.film) return
    this.film.enabled =
      params.grain > 0.002 || params.vignette > 0.002 || params.flash > 0.002
    if (!this.film.enabled) return
    const u = this.film.uniforms
    u.uTime.value = time
    u.uGrain.value = params.grain
    u.uVignette.value = params.vignette
    u.uFlash.value = params.flash
  }

  /**
   * Link every pass's program up front by rendering one frame with all of them
   * enabled at identity uniforms. Without this the lens links the first time its
   * strength crosses zero — mid-shot, as a visible hitch — because a disabled
   * pass is skipped entirely and never reaches the compiler.
   */
  warmUp(): void {
    if (this.disposed) return
    const passes = [this.lens, this.blur, this.film]
    const wasEnabled = passes.map((p) => p?.enabled ?? false)
    for (const pass of passes) if (pass) pass.enabled = true
    this.composer.render(0)
    passes.forEach((pass, i) => {
      if (pass) pass.enabled = wasEnabled[i]
    })
  }

  setBloom(strength: number, radius: number, threshold: number): void {
    this.bloom.strength = strength
    this.bloom.radius = radius
    this.bloom.threshold = threshold
  }

  /** True once the intro-only passes are gone. */
  get isDemoted(): boolean {
    return this.demoted
  }

  /**
   * Drop the intro-only passes and settle bloom into its permanent tuning.
   * Idempotent — the skip path and the natural end can both call it.
   */
  demoteToExplore(): void {
    if (this.disposed || this.demoted) return
    this.demoted = true
    this.disposeIntroPasses()
    this.rebuildChain()
    this.setBloom(
      BLOOM_EXPLORE.strength,
      BLOOM_EXPLORE.radius,
      BLOOM_EXPLORE.threshold,
    )
    // Give the interactive scene its full resolution back regardless of the
    // tier the intro ran at — the steady-state load is far lighter.
    this.renderer.setPixelRatio(this.savedPixelRatio)
    this.setSize(this.width, this.height)
  }

  render(deltaSeconds: number): void {
    if (this.disposed) return
    this.composer.render(deltaSeconds)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.disposeIntroPasses()
    this.bloom.dispose()
    this.output.dispose?.()
    this.composer.dispose()
    this.renderer.setPixelRatio(this.savedPixelRatio)
  }
}

export { BLOOM_EXPLORE, BLOOM_INTRO }
