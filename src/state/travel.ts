/**
 * Pure travel / focus state machine — no DOM or WebGL.
 */
import type { BodyId } from '../data/bodies'
import { BODIES } from '../data/bodies'

export interface TravelState {
  focusedBodyId: BodyId
  /** Target being traveled to while isTraveling is true */
  targetBodyId: BodyId | null
  previousBodyId: BodyId | null
  isTraveling: boolean
  /** 0…1 camera travel interpolation */
  travelProgress: number
}

export function createInitialTravelState(): TravelState {
  return {
    focusedBodyId: 'earth',
    targetBodyId: null,
    previousBodyId: null,
    isTraveling: false,
    travelProgress: 0,
  }
}

export function canTravelTo(state: TravelState, targetId: BodyId): boolean {
  if (!(targetId in BODIES)) return false
  if (state.isTraveling) return false
  if (state.focusedBodyId === targetId) return false
  return true
}

export function startTravel(state: TravelState, targetId: BodyId): TravelState {
  if (!canTravelTo(state, targetId)) {
    return state
  }
  return {
    ...state,
    previousBodyId: state.focusedBodyId,
    targetBodyId: targetId,
    isTraveling: true,
    travelProgress: 0,
  }
}

/**
 * Clamp progress to 0…1. When progress reaches 1, complete the travel.
 */
export function updateTravelProgress(
  state: TravelState,
  progress: number,
): TravelState {
  if (!state.isTraveling || !state.targetBodyId) {
    return state
  }
  const clamped = Math.min(1, Math.max(0, progress))
  if (clamped >= 1) {
    return completeTravel(state, state.targetBodyId)
  }
  return {
    ...state,
    travelProgress: clamped,
  }
}

export function completeTravel(
  state: TravelState,
  targetId: BodyId,
): TravelState {
  if (!(targetId in BODIES)) {
    return state
  }
  return {
    focusedBodyId: targetId,
    targetBodyId: null,
    previousBodyId: state.previousBodyId ?? state.focusedBodyId,
    isTraveling: false,
    travelProgress: 1,
  }
}

/** Active body for content display (target while traveling, else focus). */
export function getActiveBodyId(state: TravelState): BodyId {
  if (state.isTraveling && state.targetBodyId) {
    return state.targetBodyId
  }
  return state.focusedBodyId
}
