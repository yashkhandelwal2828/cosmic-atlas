/**
 * Headless verification for the black-hole intro.
 *
 * The load-bearing assertion is the last one: after the sequence hands over,
 * every body must sit at exactly the position a run with `?intro=0` puts it at
 * for the same simulated instant. That is what proves the placement override
 * released cleanly — a planet left mid-flight, or left scaled, shows up as a
 * mismatch rather than as something you have to notice by eye.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.APP_URL || 'http://127.0.0.1:4174/'
const OUT = process.env.SCRATCH || './intro-check'
mkdirSync(OUT, { recursive: true })

/** A fixed instant, so both runs are compared on identical ephemeris input. */
const FIXED_SIM_MS = Date.UTC(2026, 5, 15, 12, 0, 0)

/** MOON DISABLED — see BODY_ORDER in src/data/bodies.ts. */
const BODIES = [
  'sun',
  'mercury',
  'venus',
  'earth',
  // 'moon',
  'mars',
  'jupiter',
  'saturn',
  'uranus',
  'neptune',
]

const failures = []
function check(ok, message) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${message}`)
  if (!ok) failures.push(message)
}

function watchErrors(page, label) {
  const errors = []
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e}`))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`${label} console.error: ${msg.text()}`)
  })
  return errors
}

/**
 * Median frame interval over 90 frames.
 *
 * Headless Chromium rasterises with SwiftShader on the CPU, so the ABSOLUTE
 * numbers here say nothing about a real GPU — the untouched scene measures
 * slower than the intro does. Only the ratio between the two is meaningful, and
 * only as a regression tripwire. Real-device cost is handled at runtime by the
 * tier watchdog in quality.ts.
 */
async function medianFrameMs(page) {
  const samples = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const out = []
        let last = performance.now()
        const step = () => {
          const now = performance.now()
          out.push(now - last)
          last = now
          if (out.length < 90) requestAnimationFrame(step)
          else resolve(out)
        }
        requestAnimationFrame(step)
      }),
  )
  samples.sort((a, b) => a - b)
  return samples[Math.floor(samples.length / 2)]
}

async function glRenderer(page) {
  return page.evaluate(() => {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl2') || c.getContext('webgl')
    if (!gl) return 'none'
    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    return String(
      dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    )
  })
}

async function readPositions(page) {
  return page.evaluate(
    ({ ids, simMs }) => {
      const api = window.__COSMIC_ATLAS__
      api.setSimTime(simMs)
      const out = {}
      for (const id of ids) out[id] = api.getBodyPosition(id)
      return out
    },
    { ids: BODIES, simMs: FIXED_SIM_MS },
  )
}

async function run() {
  const browser = await chromium.launch()

  // ---- pass 1: intro plays -------------------------------------------------
  const introPage = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const introErrors = watchErrors(introPage, 'intro')
  await introPage.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 })

  // Chrome must be held back while the sequence runs. Wait on attachment, not
  // visibility: the page is pinned rendering a 200k-point cloud, and
  // Playwright's actionability polling loses that race.
  await introPage.waitForSelector('.shell--intro', {
    timeout: 45000,
    state: 'attached',
  })
  check(true, 'site chrome held back during intro')

  // The loading card must not exist at all, not merely be dismissed: its
  // `--done` class carries a 0.5s fade, so a dismissed card still flashes.
  check(
    await introPage.evaluate(
      () => document.querySelector('.loading-overlay') === null,
    ),
    'no loading card is ever built on the intro path',
  )

  const running = await introPage.evaluate(() =>
    window.__COSMIC_ATLAS__.isIntroPlaying(),
  )
  check(running, 'intro reports itself running shortly after load')

  await introPage.waitForSelector('.intro-skip--visible', {
    timeout: 45000,
    state: 'attached',
  })
  check(true, 'skip button appears')

  // Frames at named beats. Shot on the sequence's OWN clock, not wall time —
  // a screenshot of a WebGL page costs hundreds of ms, so wall-clock waits drift
  // a second or more off the phase they claim to be showing.
  const beats = [
    [0.5, 'void'],
    [1.35, 'singularity'],
    [1.63, 'flash'],
    [2.1, 'launch-early'],
    [3.2, 'launch-late'],
    [4.6, 'settle'],
    [5.7, 'orbits'],
    [6.6, 'approach'],
  ]
  await introPage.evaluate(() => window.__COSMIC_ATLAS__.setIntroPaused(true))
  for (const [at, name] of beats) {
    await introPage.evaluate((t) => {
      window.__COSMIC_ATLAS__.seekIntro(t)
    }, at)
    // Two frames: one to apply the seek, one to render it through the composer.
    await introPage.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    )
    // Draw calls are deterministic, unlike frame times under a software
    // rasteriser — this is the number that actually shows whether the
    // zero-scale bodies and the inert passes are being skipped.
    const stats = await introPage.evaluate(() =>
      window.__COSMIC_ATLAS__.getRenderStats(),
    )
    console.log(
      `      ${name.padEnd(13)} t=${at.toFixed(2)}  draws=${String(stats.calls).padStart(3)}  tris=${stats.triangles}`,
    )
    await introPage.screenshot({
      path: join(OUT, `intro-${at.toFixed(2)}-${name}.png`),
    })
  }
  // Trails are built from a history of past positions, so a paused frame has
  // nothing to draw — they only exist in motion. Rewind and let it actually run
  // for a beat before capturing the launch.
  await introPage.evaluate(() => {
    window.__COSMIC_ATLAS__.seekIntro(1.85)
    window.__COSMIC_ATLAS__.setIntroPaused(false)
  })
  await introPage.waitForTimeout(700)
  await introPage.screenshot({ path: join(OUT, 'intro-live-launch.png') })

  const introMedian = await medianFrameMs(introPage)

  await introPage.evaluate(() => {
    window.__COSMIC_ATLAS__.setIntroPaused(true)
    window.__COSMIC_ATLAS__.seekIntro(0)
    window.__COSMIC_ATLAS__.setIntroPaused(false)
  })

  // The sequence is 7.5s plus up to 1.75s of texture gate.
  await introPage
    .waitForFunction(() => window.__COSMIC_ATLAS__.isIntroPlaying() === false, {
      timeout: 25000,
    })
    .catch(() => {})

  const stillRunning = await introPage.evaluate(() =>
    window.__COSMIC_ATLAS__.isIntroPlaying(),
  )
  check(!stillRunning, 'intro finishes on its own')

  await introPage.waitForTimeout(600)
  await introPage.screenshot({ path: join(OUT, 'intro-handoff.png') })

  const chromeBack = await introPage.evaluate(
    () => document.querySelector('.shell--intro') === null,
  )
  check(chromeBack, 'site chrome restored after handoff')

  const focus = await introPage.evaluate(() => window.__COSMIC_ATLAS__.getFocus())
  check(focus === 'earth', `focus is earth after handoff (got ${focus})`)

  const labelCount = await introPage.evaluate(() =>
    window.__COSMIC_ATLAS__.getLabelCount(),
  )
  check(labelCount === BODIES.length, `all ${BODIES.length} labels present (got ${labelCount})`)

  const afterIntro = await readPositions(introPage)
  // Close before opening the next page. Chromium throttles requestAnimationFrame
  // in backgrounded tabs, and the intro clock only advances on rAF — leaving a
  // page open here stalls the sequence on every page that follows it.
  await introPage.close()

  // ---- pass 2: intro bypassed ---------------------------------------------
  const directPage = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const directErrors = watchErrors(directPage, 'direct')
  await directPage.goto(`${BASE}?intro=0`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  })
  await directPage.waitForSelector('.loading-overlay--done', { timeout: 45000 })
  await directPage.waitForTimeout(1500)

  const noOverlay = await directPage.evaluate(
    () => document.querySelector('[data-intro-overlay]') === null,
  )
  check(noOverlay, '?intro=0 skips the sequence entirely')

  const direct = await readPositions(directPage)
  await directPage.screenshot({ path: join(OUT, 'direct.png') })

  const renderer = await glRenderer(directPage)
  const baselineMedian = await medianFrameMs(directPage)
  const ratio = introMedian / baselineMedian
  console.log(`      GL renderer: ${renderer}`)
  console.log(
    `      frame time — intro launch ${introMedian.toFixed(1)}ms vs untouched scene ${baselineMedian.toFixed(1)}ms (${ratio.toFixed(2)}x)`,
  )
  check(
    ratio < 2.5,
    `intro frame cost within 2.5x of the untouched scene (${ratio.toFixed(2)}x)`,
  )

  // ---- the assertion that matters -----------------------------------------
  let worst = 0
  let worstId = ''
  for (const id of BODIES) {
    const a = afterIntro[id]
    const b = direct[id]
    const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
    if (d > worst) {
      worst = d
      worstId = id
    }
  }
  check(
    worst < 1e-6,
    `every body lands on its true ephemeris position (worst: ${worstId} off by ${worst.toExponential(2)})`,
  )

  await directPage.close()

  // ---- pass 3: skipped mid-flight ------------------------------------------
  // The riskiest path: `finish()` has to release the placement override from a
  // partial state, with bodies mid-launch and half-scaled.
  const skipPage = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const skipErrors = watchErrors(skipPage, 'skip')
  await skipPage.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await skipPage.waitForSelector('.intro-skip--visible', {
    timeout: 45000,
    state: 'attached',
  })
  // Skip during the launch phase, while bodies are actually in flight.
  await skipPage.waitForFunction(
    () => window.__COSMIC_ATLAS__.getIntroTime() >= 2.4,
    { timeout: 45000, polling: "raf" },
  )
  const midFlight = await skipPage.evaluate(() => {
    window.__COSMIC_ATLAS__.skipIntro()
    return true
  })
  await skipPage.waitForTimeout(800)

  check(midFlight, 'skip accepted mid-launch')
  check(
    await skipPage.evaluate(() => window.__COSMIC_ATLAS__.isIntroPlaying() === false),
    'skip ends the sequence',
  )
  check(
    await skipPage.evaluate(() => document.querySelector('.shell--intro') === null),
    'skip restores site chrome',
  )
  check(
    (await skipPage.evaluate(() => window.__COSMIC_ATLAS__.getFocus())) === 'earth',
    'skip leaves focus on earth',
  )

  const afterSkip = await readPositions(skipPage)
  await skipPage.screenshot({ path: join(OUT, 'skipped.png') })

  let skipWorst = 0
  let skipWorstId = ''
  for (const id of BODIES) {
    const a = afterSkip[id]
    const b = direct[id]
    const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
    if (d > skipWorst) {
      skipWorst = d
      skipWorstId = id
    }
  }
  check(
    skipWorst < 1e-6,
    `skipping mid-flight still lands every body exactly (worst: ${skipWorstId} off by ${skipWorst.toExponential(2)})`,
  )

  const errors = [...introErrors, ...directErrors, ...skipErrors]
  check(errors.length === 0, `no page errors (${errors.length})`)
  for (const e of errors) console.log(`      ${e}`)

  await browser.close()

  console.log(`\nScreenshots: ${OUT}`)
  if (failures.length > 0) {
    console.log(`\n${failures.length} FAILED`)
    process.exit(1)
  }
  console.log('\nAll checks passed.')
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
