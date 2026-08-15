import { describe, expect, it } from 'vitest'
import {
  BODIES,
  BODY_ORDER,
  getAllBodies,
  getBody,
  type BodyId,
} from './bodies'
import {
  getBodyName,
  getEducationalContent,
  getHotspots,
  isValidBodyId,
} from './content'

/** Everything the catalog knows about. The Moon stays here while disabled. */
const CATALOGUED: BodyId[] = [
  'sun',
  'mercury',
  'venus',
  'earth',
  'moon',
  'mars',
  'jupiter',
  'saturn',
  'uranus',
  'neptune',
]

/**
 * What the app actually builds. MOON DISABLED — see BODY_ORDER in bodies.ts.
 * The split is deliberate: the Moon's content, elements, and materials are all
 * still present and still tested, it is only absent from the journey.
 */
const JOURNEY: BodyId[] = CATALOGUED.filter((id) => id !== 'moon')

const PLANET_ORDER_FROM_SUN: Record<Exclude<BodyId, 'moon'>, number> = {
  sun: 0,
  mercury: 1,
  venus: 2,
  earth: 3,
  mars: 4,
  jupiter: 5,
  saturn: 6,
  uranus: 7,
  neptune: 8,
}

describe('body catalog', () => {
  it('builds the sun and eight planets in journey order', () => {
    expect(BODY_ORDER).toEqual(JOURNEY)
  })

  it('keeps the disabled moon in the catalog, out of the journey', () => {
    expect(Object.keys(BODIES).sort()).toEqual([...CATALOGUED].sort())
    expect(BODY_ORDER).not.toContain('moon')
    expect(BODIES.moon).toBeDefined()
  })

  it('numbers planets from the sun and seats the moon with Earth', () => {
    for (const [id, order] of Object.entries(PLANET_ORDER_FROM_SUN)) {
      expect(BODIES[id as Exclude<BodyId, 'moon'>].orderFromSun).toBe(order)
    }
    expect(BODIES.moon.orderFromSun).toBe(BODIES.earth.orderFromSun)
  })

  it('provides non-empty educational fields for every body', () => {
    // Catalogued, not journey: the disabled Moon's content must stay valid so
    // re-enabling it is a one-line change and not a content rewrite.
    for (const id of CATALOGUED) {
      const body = getBody(id)
      expect(body.name.length).toBeGreaterThan(0)
      expect(body.tagline.length).toBeGreaterThan(0)
      expect(body.overview.length).toBeGreaterThan(40)
      expect(body.composition.length).toBeGreaterThan(20)
      expect(body.facts.length).toBeGreaterThanOrEqual(4)
      expect(body.hotspots.length).toBeGreaterThanOrEqual(3)
      expect(body.notableFeatures.length).toBeGreaterThanOrEqual(2)
      expect(body.textureKey.length).toBeGreaterThan(0)
      expect(body.displayRadius).toBeGreaterThan(0)
      expect(body.orbitDistance).toBeGreaterThanOrEqual(0)
      for (const fact of body.facts) {
        expect(fact.label.length).toBeGreaterThan(0)
        expect(fact.value.length).toBeGreaterThan(0)
      }
      for (const hs of body.hotspots) {
        expect(hs.id.length).toBeGreaterThan(0)
        expect(hs.label.length).toBeGreaterThan(0)
        expect(hs.description.length).toBeGreaterThan(10)
        expect(hs.lat).toBeGreaterThanOrEqual(-90)
        expect(hs.lat).toBeLessThanOrEqual(90)
        expect(hs.lon).toBeGreaterThanOrEqual(-180)
        expect(hs.lon).toBeLessThanOrEqual(180)
      }
    }
  })

  it('marks saturn with rings', () => {
    expect(BODIES.saturn.hasRings).toBe(true)
  })

  it('getAllBodies returns bodies in BODY_ORDER', () => {
    const all = getAllBodies()
    expect(all.map((b) => b.id)).toEqual(BODY_ORDER)
  })
})

describe('content lookup', () => {
  it('returns educational content for every body', () => {
    for (const id of CATALOGUED) {
      const content = getEducationalContent(id)
      expect(content.id).toBe(id)
      expect(getBodyName(id)).toBe(content.name)
      expect(getHotspots(id).length).toBeGreaterThanOrEqual(3)
    }
  })

  it('validates body ids', () => {
    expect(isValidBodyId('earth')).toBe(true)
    expect(isValidBodyId('pluto')).toBe(false)
    expect(isValidBodyId('')).toBe(false)
  })

  it('rejects the disabled moon as a navigable id', () => {
    // `isValidBodyId` is derived from BODY_ORDER, so it answers "can the user
    // travel here", not "does the catalog know about it". While the Moon is
    // disabled the honest answer is no. Flips back with BODY_ORDER.
    expect(isValidBodyId('moon')).toBe(false)
    expect(getEducationalContent('moon').name).toBe('Moon')
  })
})
