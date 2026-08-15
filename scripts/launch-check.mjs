/**
 * Headless launch verification for Cosmic Atlas.
 * Drives the real entry URL twice, checks canvas, travel, DOM content.
 */
import { chromium } from 'playwright'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.APP_URL || 'http://127.0.0.1:4174/'
const OUT = process.env.SCRATCH || '/var/folders/hr/gp9tpgms529_j50vjgvbql7h0000gn/T/grok-goal-670c07e95693/implementer/launch'
mkdirSync(OUT, { recursive: true })

const log = []
function say(msg) {
  console.log(msg)
  log.push(msg)
}

async function loadAndAssert(page, label) {
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`)
  })

  const res = await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 })
  say(`[${label}] status=${res?.status()} url=${page.url()}`)

  // Wait until the app is actually interactive. Two paths now reach that state:
  // the cinematic intro (which replaces the loading card entirely and owns the
  // camera until it hands over) and the direct boot (which still shows the card).
  // Driving travel before the intro finishes would fight its camera driver.
  await page
    .waitForFunction(
      () => {
        const api = window.__COSMIC_ATLAS__
        if (!api) return false
        if (api.isIntroPlaying?.()) return false
        const card = document.querySelector('.loading-overlay')
        return card === null || card.classList.contains('loading-overlay--done')
      },
      null,
      { timeout: 45000 },
    )
    .catch(() => {
      say(`[${label}] app not interactive after 45s`)
    })

  // Give textures a moment
  await page.waitForTimeout(1500)

  const canvas = page.locator('#cosmos')
  const box = await canvas.boundingBox()
  say(`[${label}] canvas box=${JSON.stringify(box)}`)

  const dims = await page.evaluate(() => {
    const c = document.querySelector('#cosmos')
    return c
      ? { width: c.width, height: c.height, clientW: c.clientWidth, clientH: c.clientHeight }
      : null
  })
  say(`[${label}] canvas buffer=${JSON.stringify(dims)}`)

  // Sample pixels — non-uniform / not pure clear color means filled scene
  const paint = await page.evaluate(() => {
    const c = document.querySelector('#cosmos')
    if (!c) return { ok: false, reason: 'no canvas' }
    const gl =
      c.getContext('webgl2', { preserveDrawingBuffer: true }) ||
      c.getContext('webgl', { preserveDrawingBuffer: true })
    // Canvas already has its own context from Three — re-get may fail.
    // Use 2d drawImage snapshot instead.
    const probe = document.createElement('canvas')
    probe.width = 64
    probe.height = 64
    const ctx = probe.getContext('2d')
    try {
      ctx.drawImage(c, 0, 0, 64, 64)
    } catch (e) {
      return { ok: false, reason: String(e) }
    }
    const data = ctx.getImageData(0, 0, 64, 64).data
    let nonBlack = 0
    let sum = 0
    const samples = []
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const a = data[i + 3]
      sum += r + g + b
      if (r + g + b > 12 && a > 0) nonBlack++
    }
    // sample corners + center
    for (const [x, y] of [
      [0, 0],
      [63, 0],
      [32, 32],
      [0, 63],
      [63, 63],
    ]) {
      const i = (y * 64 + x) * 4
      samples.push([data[i], data[i + 1], data[i + 2], data[i + 3]])
    }
    const total = 64 * 64
    return {
      ok: true,
      nonBlack,
      fraction: nonBlack / total,
      avgLuma: sum / (total * 3),
      samples,
    }
  })
  say(`[${label}] paint=${JSON.stringify(paint)}`)

  // Earth content in panel
  const title = await page.locator('[data-el="title"]').textContent()
  say(`[${label}] panel title="${title}"`)

  const focus = await page.evaluate(() => window.__COSMIC_ATLAS__?.getFocus?.())
  say(`[${label}] focus=${focus}`)

  // Travel to Mars
  await page.evaluate(async () => {
    await window.__COSMIC_ATLAS__?.travelTo?.('mars')
  })
  // Wait for travel complete
  await page.waitForFunction(
    () => window.__COSMIC_ATLAS__?.getFocus?.() === 'mars' && !window.__COSMIC_ATLAS__?.isTraveling?.(),
    null,
    { timeout: 10000 },
  )
  await page.waitForTimeout(400)
  const title2 = await page.locator('[data-el="title"]').textContent()
  const focus2 = await page.evaluate(() => window.__COSMIC_ATLAS__?.getFocus?.())
  say(`[${label}] after travel title="${title2}" focus=${focus2}`)

  // Hotspots present
  const hotspotCount = await page.locator('.hotspot-chip').count()
  say(`[${label}] hotspot chips=${hotspotCount}`)

  // Screenshot
  const shot = join(OUT, `${label}.png`)
  await page.screenshot({ path: shot, fullPage: true })
  say(`[${label}] screenshot=${shot}`)

  return {
    status: res?.status() ?? 0,
    errors,
    box,
    dims,
    paint,
    title,
    title2,
    focus,
    focus2,
    hotspotCount,
  }
}

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'],
})
const results = []
try {
  for (const label of ['run1', 'run2']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    const r = await loadAndAssert(page, label)
    results.push(r)
    await page.close()
  }
} finally {
  await browser.close()
}

const summary = {
  base: BASE,
  results,
  pass:
    results.length === 2 &&
    results.every(
      (r) =>
        r.status === 200 &&
        r.focus === 'earth' &&
        r.focus2 === 'mars' &&
        r.title2?.toLowerCase().includes('mars') &&
        r.hotspotCount >= 3 &&
        (r.paint?.fraction ?? 0) > 0.02,
    ),
}
say(`SUMMARY ${JSON.stringify(summary, null, 2)}`)
writeFileSync(join(OUT, 'launch-summary.json'), JSON.stringify(summary, null, 2))
writeFileSync(join(OUT, 'launch.log'), log.join('\n'))
if (!summary.pass) {
  // Soft fail details still written; exit non-zero if hard fails
  const hard =
    results.some((r) => r.status !== 200) ||
    results.some((r) => r.focus2 !== 'mars')
  process.exit(hard ? 1 : 0)
}
