/**
 * Independent verification of the orbital-mechanics rework.
 *
 * Deliberately does NOT import the app's own math — it drives the running page
 * through window.__COSMIC_ATLAS__ and checks observable behaviour against
 * externally-known astronomy. If the app's ephemeris is wrong, this fails.
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.APP_URL || 'http://127.0.0.1:4174/'
const OUT = process.env.OUT_DIR || '/tmp/orbit-check'
mkdirSync(OUT, { recursive: true })

const log = []
const say = (m) => {
  console.log(m)
  log.push(m)
}

const checks = []
function check(name, pass, detail) {
  checks.push({ name, pass, detail })
  say(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const PLANETS = [
  'mercury',
  'venus',
  'earth',
  'mars',
  'jupiter',
  'saturn',
  'uranus',
  'neptune',
]

/**
 * Sidereal orbital periods in days, from NASA planetary fact sheets.
 * Independent of whatever the app computed.
 */
const PERIOD_DAYS = {
  mercury: 87.969,
  venus: 224.701,
  earth: 365.256,
  mars: 686.98,
  jupiter: 4332.589,
  saturn: 10759.22,
  uranus: 30685.4,
  neptune: 60189,
}

/** Scene position -> heliocentric longitude in the ecliptic plane, degrees 0..360. */
function sceneLongitude(p) {
  // scene mapping is (x_ecl, z_ecl, -y_ecl) so y_ecl = -sceneZ, x_ecl = sceneX
  const deg = (Math.atan2(-p.z, p.x) * 180) / Math.PI
  return (deg + 360) % 360
}

function angularDiff(a, b) {
  let d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'],
})

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push(`console.error: ${m.text()}`)
  })

  const res = await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 })
  check('page loads 200', res?.status() === 200, `status=${res?.status()}`)

  await page
    .waitForSelector('.loading-overlay--done', { timeout: 40000 })
    .catch(() => say('loading overlay never dismissed'))
  await page.waitForTimeout(2000)

  const api = await page.evaluate(() => Object.keys(window.__COSMIC_ATLAS__ || {}))
  check(
    'test API exposes sim-time hooks',
    ['getSimTime', 'setSimTime', 'getBodyPosition'].every((k) => api.includes(k)),
    `keys=${api.join(',')}`,
  )

  // ---- 1. Planets are not strung out on a line -------------------------
  const J2000_ISO = Date.UTC(2026, 7, 13, 0, 0, 0)
  await page.evaluate((ms) => window.__COSMIC_ATLAS__.setSimTime(ms), J2000_ISO)
  await page.waitForTimeout(300)

  const positions = await page.evaluate(
    (ids) =>
      Object.fromEntries(
        ids.map((id) => [id, window.__COSMIC_ATLAS__.getBodyPosition(id)]),
      ),
    PLANETS,
  )
  const lons = Object.fromEntries(
    PLANETS.map((id) => [id, sceneLongitude(positions[id])]),
  )
  say(`longitudes: ${PLANETS.map((p) => `${p}=${lons[p].toFixed(1)}`).join(' ')}`)

  let minSep = 360
  for (let i = 0; i < PLANETS.length; i++) {
    for (let j = i + 1; j < PLANETS.length; j++) {
      minSep = Math.min(minSep, angularDiff(lons[PLANETS[i]], lons[PLANETS[j]]))
    }
  }
  check(
    'planets occupy distinct heliocentric longitudes (not collinear)',
    minSep > 1,
    `min pairwise separation = ${minSep.toFixed(2)}deg`,
  )

  const sorted = [...PLANETS].sort((a, b) => lons[a] - lons[b])
  check(
    'longitude order is NOT the orbital order (proves real ephemeris, not a fake spiral)',
    sorted.join(',') !== PLANETS.join(','),
    `by longitude: ${sorted.join(',')}`,
  )

  // ---- 1b. External anchor: Earth's position on a known calendar date --
  // The Sun's apparent (geocentric) ecliptic longitude on 13 Aug is ~140.3deg —
  // it reaches 150deg (Virgo ingress) around 23 Aug and moves ~0.98deg/day.
  // Earth's heliocentric longitude is exactly 180deg opposite that, so ~320.3deg.
  // This anchor comes from the calendar, not from the app's own tables, so it
  // catches a transcription typo in the Earth element row.
  const earthLon = lons.earth
  check(
    'Earth sits where the calendar says it should on 13 Aug (~320.3deg helio)',
    angularDiff(earthLon, 320.3) < 2.5,
    `computed ${earthLon.toFixed(2)}deg, expected ~320.3deg`,
  )

  // ---- 2. Orbits are inclined — bodies leave the ecliptic plane --------
  const outOfPlane = PLANETS.map((id) => Math.abs(positions[id].y))
  check(
    'orbits are inclined (some bodies sit off the ecliptic plane)',
    outOfPlane.some((y) => y > 0.05),
    `max |y| = ${Math.max(...outOfPlane).toFixed(3)} scene units`,
  )

  // ---- 3. Orbital periods match NASA fact-sheet values -----------------
  for (const id of PLANETS) {
    const before = await page.evaluate(
      (b) => window.__COSMIC_ATLAS__.getBodyPosition(b),
      id,
    )
    const oneOrbit = J2000_ISO + PERIOD_DAYS[id] * 86400000
    await page.evaluate((ms) => window.__COSMIC_ATLAS__.setSimTime(ms), oneOrbit)
    await page.waitForTimeout(60)
    const after = await page.evaluate(
      (b) => window.__COSMIC_ATLAS__.getBodyPosition(b),
      id,
    )
    const drift = angularDiff(sceneLongitude(before), sceneLongitude(after))
    check(
      `${id} returns to its start longitude after one sidereal period`,
      drift < 3,
      `drift = ${drift.toFixed(2)}deg after ${PERIOD_DAYS[id]}d`,
    )
    await page.evaluate((ms) => window.__COSMIC_ATLAS__.setSimTime(ms), J2000_ISO)
  }

  // ---- 4. Heliocentric distance stays within perihelion/aphelion -------
  const A_AU = {
    mercury: [0.3075, 0.4667],
    venus: [0.7184, 0.7282],
    earth: [0.9833, 1.0167],
    mars: [1.3814, 1.666],
    jupiter: [4.9501, 5.4588],
    saturn: [9.0412, 10.1238],
    uranus: [18.2861, 20.0965],
    neptune: [29.81, 30.33],
  }
  for (const id of PLANETS) {
    const samples = []
    for (let k = 0; k < 24; k++) {
      const ms = J2000_ISO + (PERIOD_DAYS[id] * 86400000 * k) / 24
      await page.evaluate((t) => window.__COSMIC_ATLAS__.setSimTime(t), ms)
      const p = await page.evaluate(
        (b) => window.__COSMIC_ATLAS__.getBodyPosition(b),
        id,
      )
      samples.push(Math.hypot(p.x, p.y, p.z))
    }
    const rMin = Math.min(...samples)
    const rMax = Math.max(...samples)
    // scene units are compressed; check the RATIO rather than absolute AU
    const trueRatio = A_AU[id][1] / A_AU[id][0]
    const sceneRatio = rMax / rMin
    check(
      `${id} eccentricity is preserved in scene space`,
      Math.abs(sceneRatio - trueRatio) < 0.05,
      `scene aphelion/perihelion = ${sceneRatio.toFixed(4)} vs true ${trueRatio.toFixed(4)}`,
    )
  }
  await page.evaluate((ms) => window.__COSMIC_ATLAS__.setSimTime(ms), J2000_ISO)

  // ---- 5. Screenshots --------------------------------------------------
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(OUT, '1-default-view.png') })

  const topBtn = page.locator('[data-time] button', { hasText: /top/i }).first()
  if (await topBtn.count()) {
    await topBtn.click()
    await page.waitForTimeout(1200)
    await page.screenshot({ path: join(OUT, '2-system-top-view.png') })
  }

  for (const id of ['saturn', 'uranus', 'earth']) {
    await page.evaluate((b) => window.__COSMIC_ATLAS__.travelTo(b), id)
    await page
      .waitForFunction(
        (b) =>
          window.__COSMIC_ATLAS__.getFocus() === b &&
          !window.__COSMIC_ATLAS__.isTraveling(),
        id,
        { timeout: 15000 },
      )
      .catch(() => say(`travel to ${id} timed out`))
    await page.waitForTimeout(900)
    await page.screenshot({ path: join(OUT, `3-${id}.png`) })
  }

  check('no runtime page errors', pageErrors.length === 0, pageErrors.slice(0, 5).join(' | '))

  await page.close()
} finally {
  await browser.close()
}

const failed = checks.filter((c) => !c.pass)
say(`\n${checks.length - failed.length}/${checks.length} checks passed`)
writeFileSync(
  join(OUT, 'orbit-check.json'),
  JSON.stringify({ checks, log }, null, 2),
)
writeFileSync(join(OUT, 'orbit-check.log'), log.join('\n'))
process.exit(failed.length ? 1 : 0)
