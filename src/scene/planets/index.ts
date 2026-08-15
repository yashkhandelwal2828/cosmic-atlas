import type { BodyId } from '../../data/bodies'
import type { PlanetUpdateCtx, PlanetVisuals } from './types'
import { createMercuryVisuals, applyMercuryMaps, updateMercury } from './mercury'
import { createVenusVisuals, applyVenusMaps, updateVenus } from './venus'
import { createEarthVisuals, applyEarthMaps, updateEarth } from './earth'
import { createMoonVisuals, applyMoonMaps, updateMoon } from './moon'
import { createMarsVisuals, applyMarsMaps, updateMars } from './mars'
import { createJupiterVisuals, applyJupiterMaps, updateJupiter } from './jupiter'
import { createSaturnVisuals, applySaturnMaps, updateSaturn } from './saturn'
import { createUranusVisuals, applyUranusMaps, updateUranus } from './uranus'
import { createNeptuneVisuals, applyNeptuneMaps, updateNeptune } from './neptune'

export type { PlanetMaps, PlanetUpdateCtx, PlanetVisuals } from './types'

export const PLANET_IDS = [
  'mercury',
  'venus',
  'earth',
  'moon',
  'mars',
  'jupiter',
  'saturn',
  'uranus',
  'neptune',
] as const satisfies readonly BodyId[]

export function createPlanetVisuals(id: BodyId, radius: number): PlanetVisuals {
  switch (id) {
    case 'mercury':
      return createMercuryVisuals(radius)
    case 'venus':
      return createVenusVisuals(radius)
    case 'earth':
      return createEarthVisuals(radius)
    case 'moon':
      return createMoonVisuals(radius)
    case 'mars':
      return createMarsVisuals(radius)
    case 'jupiter':
      return createJupiterVisuals(radius)
    case 'saturn':
      return createSaturnVisuals(radius)
    case 'uranus':
      return createUranusVisuals(radius)
    case 'neptune':
      return createNeptuneVisuals(radius)
    default:
      throw new Error(`Not a planet: ${id}`)
  }
}

export function applyPlanetMaps(
  id: BodyId,
  visuals: PlanetVisuals,
  maps: import('./types').PlanetMaps,
): void {
  switch (id) {
    case 'mercury':
      return applyMercuryMaps(visuals, maps)
    case 'venus':
      return applyVenusMaps(visuals, maps)
    case 'earth':
      return applyEarthMaps(visuals, maps)
    case 'moon':
      return applyMoonMaps(visuals, maps)
    case 'mars':
      return applyMarsMaps(visuals, maps)
    case 'jupiter':
      return applyJupiterMaps(visuals, maps)
    case 'saturn':
      return applySaturnMaps(visuals, maps)
    case 'uranus':
      return applyUranusMaps(visuals, maps)
    case 'neptune':
      return applyNeptuneMaps(visuals, maps)
    default:
      throw new Error(`Not a planet: ${id}`)
  }
}

export function updatePlanetVisuals(
  id: BodyId,
  visuals: PlanetVisuals,
  ctx: PlanetUpdateCtx,
): void {
  switch (id) {
    case 'mercury':
      return updateMercury(visuals, ctx)
    case 'venus':
      return updateVenus(visuals, ctx)
    case 'earth':
      return updateEarth(visuals, ctx)
    case 'moon':
      return updateMoon(visuals, ctx)
    case 'mars':
      return updateMars(visuals, ctx)
    case 'jupiter':
      return updateJupiter(visuals, ctx)
    case 'saturn':
      return updateSaturn(visuals, ctx)
    case 'uranus':
      return updateUranus(visuals, ctx)
    case 'neptune':
      return updateNeptune(visuals, ctx)
    default:
      return
  }
}
