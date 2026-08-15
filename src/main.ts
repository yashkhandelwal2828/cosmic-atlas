/**
 * Cosmic Atlas — interactive 3D solar-system education explorer.
 * Starts on Earth; travel to each body and learn via hotspots.
 * Owns the simulated clock: the scene is a pure function of the instant we push in.
 */
import './style.css'
import type { BodyId } from './data/bodies'
import { getEducationalContent } from './data/content'
import {
  canTravelTo,
  completeTravel,
  createInitialTravelState,
  startTravel,
  type TravelState,
} from './state/travel'
import {
  advanceSimTime,
  createSimTime,
  setEpoch,
  setPlaying,
  setTimeScale,
  type SimTimeState,
} from './state/simTime'
import { SolarSystem } from './scene/SolarSystem'
import { TextureCache } from './scene/textures'
import { IntroSequence } from './intro/IntroSequence'
import { IntroOverlay, shouldPlayIntro } from './intro/IntroOverlay'
import { INCLINATION_EXAGGERATION, type DistanceMode } from './scene/scale'
import { BodySelector } from './ui/BodySelector'
import { LearningPanel } from './ui/LearningPanel'
import { TimeControls } from './ui/TimeControls'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) {
  throw new Error('#app root missing')
}

/**
 * Decided BEFORE the shell is built, because the loading card must not merely be
 * dismissed when the intro plays — it must never exist. Adding
 * `loading-overlay--done` on the first line of boot still paints one frame at
 * full opacity and then runs the class's own 0.5s fade, which reads as a flash
 * of loading screen in front of the sequence.
 */
const playIntro = shouldPlayIntro()

const loadingMarkup = playIntro
  ? ''
  : `
    <div class="loading-overlay" data-loading>
      <div class="loading-card">
        <div class="loading-spinner" aria-hidden="true"></div>
        <p>Preparing the solar system…</p>
        <p class="loading-sub">Real 8K planetary maps · Earth day/night · labels</p>
      </div>
    </div>
  `

app.innerHTML = `
  <div class="shell${playIntro ? ' shell--intro' : ''}">
    <header class="topbar">
      <div class="brand">
        <span class="brand__mark" aria-hidden="true"></span>
        <div>
          <p class="brand__kicker">Interactive education</p>
          <h1 class="brand__title">Cosmic Atlas</h1>
        </div>
      </div>
      <p class="topbar__hint">Start at Earth · travel the solar system · inspect hotspots to learn</p>
      <div class="status" data-status>
        <span class="status__dot"></span>
        <span data-status-text>Loading mission assets…</span>
      </div>
    </header>

    <canvas id="cosmos" class="cosmos-canvas" aria-label="3D solar system view"></canvas>
    <div class="label-host" data-label-host></div>

    ${loadingMarkup}

    <div class="time-dock" data-time></div>
    <aside class="panel-dock" data-panel></aside>
    <nav class="journey-dock" data-journey></nav>

    <footer class="credits">
      Textures © Solar System Scope (CC BY 4.0) · Built with Three.js
    </footer>
  </div>
`

const canvas = document.querySelector<HTMLCanvasElement>('#cosmos')!
const panelEl = document.querySelector<HTMLElement>('[data-panel]')!
const journeyEl = document.querySelector<HTMLElement>('[data-journey]')!
const timeEl = document.querySelector<HTMLElement>('[data-time]')!
/** Null on the intro path — the sequence itself is the loading screen. */
const loadingEl = document.querySelector<HTMLElement>('[data-loading]')
const statusText = document.querySelector<HTMLElement>('[data-status-text]')!
const labelHost = document.querySelector<HTMLElement>('[data-label-host]')!
const shell = document.querySelector<HTMLElement>('.shell')!

let travelState: TravelState = createInitialTravelState()
let simTime: SimTimeState = createSimTime(Date.now())
let distanceMode: DistanceMode = 'compressed'

const textures = new TextureCache()
const solar = new SolarSystem(canvas, textures)
solar.setSimTime(simTime.epochMs)
solar.enableLabels(labelHost || shell)
const panel = new LearningPanel(panelEl)
const selector = new BodySelector(journeyEl, (id) => void requestTravel(id))
const timeControls = new TimeControls(timeEl, {
  onPlayToggle: (playing) => {
    simTime = setPlaying(simTime, playing)
  },
  onScaleChange: (secondsPerSecond) => {
    simTime = setTimeScale(simTime, secondsPerSecond)
  },
  onJumpToDate: (unixMs) => {
    simTime = setEpoch(simTime, unixMs)
    solar.setSimTime(simTime.epochMs)
  },
  onJumpToNow: () => {
    simTime = setEpoch(simTime, Date.now())
    solar.setSimTime(simTime.epochMs)
  },
  onDistanceModeChange: (mode) => {
    distanceMode = mode
    solar.setDistanceMode(mode)
  },
  onOrbitLinesToggle: (visible) => solar.setOrbitLinesVisible(visible),
  onInclinationExaggerationToggle: (on) =>
    solar.setInclinationExaggeration(
      on ? INCLINATION_EXAGGERATION.on : INCLINATION_EXAGGERATION.off,
    ),
  onTopView: () => solar.focusSystem(),
})

panel.update('earth')
selector.setFocused('earth')
timeControls.update(simTime)

solar.setHotspotClickHandler((hs) => {
  panel.highlightHotspot(hs)
})

let intro: IntroSequence | null = null
let introOverlay: IntroOverlay | null = null

// The scene owns the render loop; the clock rides one step ahead of it so every
// frame renders the instant it was just told about. The intro advances first:
// it sets the phase time that the body-placement override reads a step later,
// inside `setSimTime`.
solar.setFrameHandler((dtSeconds) => {
  intro?.tick(dtSeconds)
  simTime = advanceSimTime(simTime, dtSeconds)
  solar.setSimTime(simTime.epochMs)
  timeControls.update(simTime)
})

function setStatus(text: string, ready = false): void {
  if (statusText) statusText.textContent = text
  document.querySelector('.status')?.classList.toggle('status--ready', ready)
}

async function requestTravel(targetId: BodyId): Promise<void> {
  if (!canTravelTo(travelState, targetId)) return
  if (solar.isTraveling()) return

  travelState = startTravel(travelState, targetId)
  selector.setTraveling(true)
  selector.setFocused(targetId)
  setStatus(`Traveling to ${getEducationalContent(targetId).name}…`)

  // Prefetch target texture while animating
  void textures.loadBody(targetId).catch(() => undefined)

  solar.travelTo(targetId, 1.65, (id) => {
    travelState = completeTravel(travelState, id)
    panel.update(id)
    selector.setFocused(id)
    selector.setTraveling(false)
    setStatus(`Exploring ${getEducationalContent(id).name}`, true)
  })
}

/**
 * Bodies whose maps must be in hand before the detonation launches them.
 * MOON DISABLED — see BODY_ORDER in data/bodies.ts.
 */
const FIRST_WAVE: BodyId[] = ['mercury', 'venus', 'earth', /* 'moon', */ 'mars']

const REST: BodyId[] = [
  // 'moon',
  'mercury',
  'venus',
  'mars',
  'jupiter',
  'saturn',
  'uranus',
  'neptune',
]

function announceAllMapsReady(): void {
  void textures.loadAllBodies(REST).then(() => {
    setStatus('All planetary maps ready · Exploring Earth', true)
  })
}

/**
 * Cinematic path: the render loop starts on the first frame and the intro plays
 * over the top of texture loading, so the sequence IS the loading screen. The
 * DOM loading card is dismissed immediately — two loaders would fight.
 */
async function bootWithIntro(): Promise<void> {
  setStatus('Collapsing…')

  introOverlay = new IntroOverlay({
    shell,
    onSkip: () => intro?.skip(),
  })

  intro = new IntroSequence({
    solar,
    distanceMode,
    onRevealSkip: () => introOverlay?.revealSkip(),
    onFinish: () => {
      introOverlay?.finish()
      panel.update('earth')
      selector.setFocused('earth')
      setStatus('Exploring Earth', true)
      announceAllMapsReady()
    },
  })

  intro.begin()
  solar.start()

  const scenery = solar.applyTextures().catch((err) => {
    console.error(err)
    setStatus('Loaded with fallback materials')
  })

  // Hold the detonation for the maps the first bodies out will be wearing.
  // The outer planets depart up to 0.85s later and stream in behind this.
  intro.gateOn(
    Promise.all([textures.loadCritical(), textures.loadAllBodies(FIRST_WAVE)]),
  )

  await scenery
}

/** Reduced-motion / `?intro=0` path — the original boot, unchanged. */
async function bootDirect(): Promise<void> {
  try {
    setStatus('Loading Earth & starfield…')
    await solar.applyTextures()
    solar.focusImmediate('earth')
    solar.start()
    loadingEl?.classList.add('loading-overlay--done')
    setStatus('Exploring Earth', true)
    announceAllMapsReady()
  } catch (err) {
    console.error(err)
    setStatus('Loaded with fallback materials')
    solar.focusImmediate('earth')
    solar.start()
    loadingEl?.classList.add('loading-overlay--done')
  }
}

async function boot(): Promise<void> {
  if (playIntro) {
    await bootWithIntro()
  } else {
    await bootDirect()
  }
}

void boot()

// Expose for headless / manual verification
declare global {
  interface Window {
    __COSMIC_ATLAS__?: {
      getFocus: () => BodyId
      travelTo: (id: BodyId) => Promise<void>
      getTravelState: () => TravelState
      isTraveling: () => boolean
      getLabelCount: () => number
      getLabelIds: () => (string | null)[]
      getSimTime: () => number
      setSimTime: (ms: number) => void
      getBodyPosition: (id: BodyId) => { x: number; y: number; z: number }
      getDistanceMode: () => DistanceMode
      isIntroPlaying: () => boolean
      getIntroTime: () => number
      getRenderStats: () => {
        calls: number
        triangles: number
        points: number
      }
      setIntroPaused: (paused: boolean) => void
      seekIntro: (seconds: number) => void
      skipIntro: () => void
    }
  }
}

window.__COSMIC_ATLAS__ = {
  getFocus: () => travelState.focusedBodyId,
  travelTo: requestTravel,
  getTravelState: () => travelState,
  isTraveling: () => travelState.isTraveling || solar.isTraveling(),
  getLabelCount: () => solar.getLabelCount(),
  getLabelIds: () =>
    [...document.querySelectorAll('[data-planet-label]')].map((el) =>
      el.getAttribute('data-planet-label'),
    ),
  getSimTime: () => simTime.epochMs,
  setSimTime: (ms) => {
    simTime = setEpoch(simTime, ms)
    solar.setSimTime(simTime.epochMs)
  },
  getBodyPosition: (id) => {
    const p = solar.getBodyWorldPosition(id)
    return { x: p.x, y: p.y, z: p.z }
  },
  getDistanceMode: () => distanceMode,
  isIntroPlaying: () => intro?.isRunning ?? false,
  getIntroTime: () => intro?.time ?? -1,
  getRenderStats: () => ({
    calls: solar.renderer.info.render.calls,
    triangles: solar.renderer.info.render.triangles,
    points: solar.renderer.info.render.points,
  }),
  setIntroPaused: (paused) => intro?.setPaused(paused),
  seekIntro: (seconds) => intro?.seek(seconds),
  skipIntro: () => intro?.skip(),
}
