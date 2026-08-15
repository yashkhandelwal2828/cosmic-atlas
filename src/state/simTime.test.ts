import { afterEach, describe, expect, it } from 'vitest'
import {
  EPOCH_MAX_MS,
  EPOCH_MIN_MS,
  TIME_PRESETS,
  advanceSimTime,
  createSimTime,
  formatSimDate,
  setEpoch,
  setPlaying,
  setTimeScale,
} from './simTime'

/** 2026-08-13T14:32:00Z — the date used in the spec's example readout. */
const SAMPLE_MS = Date.UTC(2026, 7, 13, 14, 32, 0)

const DAY_PRESET = TIME_PRESETS.find((preset) => preset.id === 'day')!

describe('sim time state', () => {
  it('starts paused at the injected instant with the day preset', () => {
    const state = createSimTime(SAMPLE_MS)
    expect(state.epochMs).toBe(SAMPLE_MS)
    expect(state.timeScale).toBe(86400)
    expect(state.timeScale).toBe(DAY_PRESET.secondsPerSecond)
    expect(state.playing).toBe(false)
  })

  it('exposes the six presets in order', () => {
    expect(TIME_PRESETS.map((preset) => preset.id)).toEqual([
      'real',
      'hour',
      'day',
      'week',
      'month',
      'year',
    ])
    expect(TIME_PRESETS.map((preset) => preset.secondsPerSecond)).toEqual([
      1, 3600, 86400, 604800, 2629746, 31556952,
    ])
  })

  it('advances exactly 86 400 000 ms per real second at the day preset', () => {
    const state = setPlaying(createSimTime(SAMPLE_MS), true)
    const next = advanceSimTime(state, 1)
    expect(next.epochMs - state.epochMs).toBe(86_400_000)
  })

  it('advances proportionally to the real delta', () => {
    const state = setPlaying(setTimeScale(createSimTime(SAMPLE_MS), 3600), true)
    expect(advanceSimTime(state, 0.5).epochMs - SAMPLE_MS).toBe(1_800_000)
  })

  it('is a no-op when paused', () => {
    const paused = setPlaying(createSimTime(SAMPLE_MS), false)
    const next = advanceSimTime(paused, 10)
    expect(next.epochMs).toBe(SAMPLE_MS)
    expect(next.playing).toBe(false)
    expect(next.timeScale).toBe(paused.timeScale)
  })

  it('every mutator returns a new object and leaves the input untouched', () => {
    const state = createSimTime(SAMPLE_MS)
    const snapshot = { ...state }

    const results = [
      advanceSimTime(state, 1),
      advanceSimTime(setPlaying(state, false), 1),
      setTimeScale(state, 1),
      setPlaying(state, false),
      setEpoch(state, 0),
    ]

    for (const result of results) {
      expect(result).not.toBe(state)
    }
    expect(state).toEqual(snapshot)
  })

  it('setters change only their own field', () => {
    const state = createSimTime(SAMPLE_MS)
    expect(setTimeScale(state, 7)).toEqual({ ...state, timeScale: 7 })
    expect(setPlaying(state, true)).toEqual({ ...state, playing: true })
    expect(setEpoch(state, SAMPLE_MS)).toEqual({ ...state, epochMs: SAMPLE_MS })
  })

  it('clamps the initial epoch to the Standish window', () => {
    expect(createSimTime(Date.UTC(1799, 0, 1)).epochMs).toBe(EPOCH_MIN_MS)
    expect(createSimTime(Date.UTC(2051, 0, 1)).epochMs).toBe(EPOCH_MAX_MS)
    expect(createSimTime(SAMPLE_MS).epochMs).toBe(SAMPLE_MS)
  })

  it('clamps setEpoch to the Standish 1800–2050 window', () => {
    const state = createSimTime(SAMPLE_MS)
    const minMs = Date.UTC(1800, 0, 1, 0, 0, 0)
    const maxMs = Date.UTC(2050, 11, 31, 23, 59, 0)

    expect(setEpoch(state, Date.UTC(1799, 5, 15)).epochMs).toBe(minMs)
    expect(setEpoch(state, Date.UTC(2051, 0, 1)).epochMs).toBe(maxMs)
    expect(setEpoch(state, SAMPLE_MS).epochMs).toBe(SAMPLE_MS)
    expect(setEpoch(state, Number.NaN).epochMs).toBe(minMs)
  })

  it('playing cannot walk the clock outside the Standish window', () => {
    const maxMs = Date.UTC(2050, 11, 31, 23, 59, 0)
    const nearEnd = setPlaying(
      setEpoch(createSimTime(SAMPLE_MS), Date.UTC(2050, 11, 31, 12, 0, 0)),
      true,
    )
    expect(advanceSimTime(nearEnd, 2).epochMs).toBe(maxMs)
  })
})

describe('formatSimDate', () => {
  const originalTz = process.env.TZ

  afterEach(() => {
    if (originalTz === undefined) {
      delete process.env.TZ
    } else {
      process.env.TZ = originalTz
    }
  })

  it('renders the spec label', () => {
    expect(formatSimDate(SAMPLE_MS)).toBe('13 Aug 2026 · 14:32 UTC')
  })

  it('zero-pads day, hour and minute so the mono readout never reflows', () => {
    expect(formatSimDate(Date.UTC(2026, 0, 5, 4, 7, 0))).toBe(
      '05 Jan 2026 · 04:07 UTC',
    )
    expect(formatSimDate(Date.UTC(2000, 11, 31, 23, 59, 0))).toBe(
      '31 Dec 2000 · 23:59 UTC',
    )
  })

  it('reports the UTC calendar day, not the local one', () => {
    // 00:30 UTC is still the previous day west of Greenwich, and 23:30 UTC is
    // already the next day east of it — a local-time implementation drifts here.
    expect(formatSimDate(Date.UTC(2026, 7, 13, 0, 30, 0))).toBe(
      '13 Aug 2026 · 00:30 UTC',
    )
    expect(formatSimDate(Date.UTC(2026, 7, 13, 23, 30, 0))).toBe(
      '13 Aug 2026 · 23:30 UTC',
    )
  })

  it('is identical whatever the host timezone is', () => {
    const zones = ['UTC', 'Pacific/Kiritimati', 'Pacific/Niue', 'Asia/Kolkata']
    const localHours = new Set<number>()
    const labels = new Set<string>()

    for (const zone of zones) {
      process.env.TZ = zone
      localHours.add(new Date(SAMPLE_MS).getHours())
      labels.add(formatSimDate(SAMPLE_MS))
    }

    // Guard: the sweep must actually be moving the host clock, otherwise the
    // assertion below would pass vacuously.
    expect(localHours.size).toBeGreaterThan(1)
    expect([...labels]).toEqual(['13 Aug 2026 · 14:32 UTC'])
  })
})
