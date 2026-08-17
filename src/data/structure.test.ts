/**
 * Structural / source-path checks against shipped modules and entry wiring.
 * Ensures the education + travel surface is real, not TODO stubs.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BODY_ORDER, BODIES } from './bodies'
import { getEducationalContent } from './content'
import {
  createInitialTravelState,
  startTravel,
  completeTravel,
} from '../state/travel'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

describe('shipped entry surface', () => {
  it('entry HTML loads the main module', () => {
    const html = read('index.html')
    expect(html).toMatch(/src\/main\.ts/)
    expect(html.toLowerCase()).toMatch(/cosmic atlas|solar/)
  })

  it('main boots Three.js solar system and Earth-first content', () => {
    const main = read('src/main.ts')
    expect(main).toMatch(/SolarSystem/)
    expect(main).toMatch(/createInitialTravelState/)
    expect(main).toMatch(/panel\.update\('earth'\)/)
    expect(main).toMatch(/focusImmediate\('earth'\)/)
    expect(main).not.toMatch(/\bTODO\b/)
  })

  it('scene module constructs textured bodies and travel', () => {
    const scene = read('src/scene/SolarSystem.ts')
    expect(scene).toMatch(/WebGLRenderer/)
    expect(scene).toMatch(/travelTo/)
    expect(scene).toMatch(/sampleCameraArc/)
    expect(scene).toMatch(/gsap/)
    expect(scene).toMatch(/showHotspots/)
    expect(scene).toMatch(/saturn|rings/i)
    expect(scene).toMatch(/createSunVisuals/)
    expect(scene).toMatch(/createPlanetVisuals/)
  })
})

describe('end-to-end pure path: Earth → every body', () => {
  it('transitions focus and yields non-empty content for each body', () => {
    for (const id of BODY_ORDER) {
      let state = createInitialTravelState()
      expect(state.focusedBodyId).toBe('earth')

      if (id !== 'earth') {
        state = startTravel(state, id)
        state = completeTravel(state, id)
      }

      expect(state.focusedBodyId).toBe(id)
      const content = getEducationalContent(state.focusedBodyId)
      expect(content.name.length).toBeGreaterThan(0)
      expect(content.facts.length).toBeGreaterThanOrEqual(4)
      expect(content.hotspots.length).toBeGreaterThanOrEqual(3)
      expect(content.overview).not.toMatch(/lorem|TODO|placeholder/i)
      expect(BODIES[id].textureKey.length).toBeGreaterThan(0)
    }
  })
})
