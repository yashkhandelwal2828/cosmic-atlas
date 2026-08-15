/**
 * Educational content lookup helpers over the body catalog.
 */
import {
  BODIES,
  BODY_ORDER,
  type BodyContent,
  type BodyId,
  type Hotspot,
} from './bodies'

const BODY_ID_SET = new Set<string>(BODY_ORDER)

export function isValidBodyId(id: string): id is BodyId {
  return BODY_ID_SET.has(id)
}

export function getEducationalContent(id: BodyId): BodyContent {
  const body = BODIES[id]
  if (!body) {
    throw new Error(`No educational content for body: ${id}`)
  }
  return body
}

export function getHotspots(id: BodyId): Hotspot[] {
  return getEducationalContent(id).hotspots
}

export function getBodyName(id: BodyId): string {
  return getEducationalContent(id).name
}

export function getFactLabels(id: BodyId): string[] {
  return getEducationalContent(id).facts.map((f) => f.label)
}
