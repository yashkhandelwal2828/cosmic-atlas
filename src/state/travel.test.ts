import { describe, expect, it } from 'vitest'
import { BODY_ORDER, type BodyId } from '../data/bodies'
import {
  canTravelTo,
  completeTravel,
  createInitialTravelState,
  getActiveBodyId,
  startTravel,
  updateTravelProgress,
} from './travel'

describe('travel state', () => {
  it('starts focused on Earth', () => {
    const state = createInitialTravelState()
    expect(state.focusedBodyId).toBe('earth')
    expect(state.isTraveling).toBe(false)
    expect(state.travelProgress).toBe(0)
    expect(state.targetBodyId).toBeNull()
    expect(getActiveBodyId(state)).toBe('earth')
  })

  it('travels from Earth to Mars and completes focus', () => {
    let state = createInitialTravelState()
    expect(canTravelTo(state, 'mars')).toBe(true)

    state = startTravel(state, 'mars')
    expect(state.isTraveling).toBe(true)
    expect(state.targetBodyId).toBe('mars')
    expect(state.previousBodyId).toBe('earth')
    expect(state.focusedBodyId).toBe('earth')
    expect(getActiveBodyId(state)).toBe('mars')

    state = updateTravelProgress(state, 0.5)
    expect(state.travelProgress).toBe(0.5)
    expect(state.isTraveling).toBe(true)

    state = updateTravelProgress(state, 1)
    expect(state.isTraveling).toBe(false)
    expect(state.focusedBodyId).toBe('mars')
    expect(state.targetBodyId).toBeNull()
    expect(getActiveBodyId(state)).toBe('mars')
  })

  it('completeTravel focuses the target body', () => {
    let state = createInitialTravelState()
    state = startTravel(state, 'jupiter')
    state = completeTravel(state, 'jupiter')
    expect(state.focusedBodyId).toBe('jupiter')
    expect(state.isTraveling).toBe(false)
  })

  it('cannot travel to the same body when idle', () => {
    const state = createInitialTravelState()
    expect(canTravelTo(state, 'earth')).toBe(false)
    const next = startTravel(state, 'earth')
    expect(next).toEqual(state)
  })

  it('cannot start a second travel while already traveling', () => {
    let state = createInitialTravelState()
    state = startTravel(state, 'venus')
    expect(canTravelTo(state, 'mars')).toBe(false)
    const blocked = startTravel(state, 'mars')
    expect(blocked.targetBodyId).toBe('venus')
  })

  it('can travel to every major body from Earth', () => {
    for (const id of BODY_ORDER) {
      if (id === 'earth') continue
      let state = createInitialTravelState()
      expect(canTravelTo(state, id as BodyId)).toBe(true)
      state = startTravel(state, id as BodyId)
      state = completeTravel(state, id as BodyId)
      expect(state.focusedBodyId).toBe(id)
    }
  })

  it('clamps progress into 0…1', () => {
    let state = createInitialTravelState()
    state = startTravel(state, 'saturn')
    state = updateTravelProgress(state, -0.2)
    expect(state.travelProgress).toBe(0)
    state = updateTravelProgress(state, 0.3)
    expect(state.travelProgress).toBe(0.3)
  })
})
