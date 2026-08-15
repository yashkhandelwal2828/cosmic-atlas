import { describe, expect, it } from 'vitest'
import {
  INTRO_DURATION,
  PHASES,
  clamp01,
  easeOutExpo,
  phaseAt,
  progressBetween,
  progressIn,
  pulse,
  smoothstep,
  spanOf,
} from './timeline'

describe('phase table', () => {
  it('is contiguous and ordered', () => {
    for (let i = 1; i < PHASES.length; i++) {
      expect(PHASES[i].start).toBe(PHASES[i - 1].end)
      expect(PHASES[i].end).toBeGreaterThan(PHASES[i].start)
    }
  })

  it('starts at zero and defines the total duration', () => {
    expect(PHASES[0].start).toBe(0)
    expect(INTRO_DURATION).toBe(PHASES[PHASES.length - 1].end)
  })
})

describe('phaseAt', () => {
  it('reports the opening phase at t = 0', () => {
    expect(phaseAt(0)).toEqual({ phase: 'void', progress: 0 })
  })

  it('treats a boundary as the start of the later phase', () => {
    const singularity = spanOf('singularity')
    expect(phaseAt(singularity.start).phase).toBe('singularity')
    expect(phaseAt(singularity.start).progress).toBe(0)
  })

  it('reaches the midpoint of a phase at half its width', () => {
    const launch = spanOf('launch')
    const mid = launch.start + (launch.end - launch.start) / 2
    const state = phaseAt(mid)
    expect(state.phase).toBe('launch')
    expect(state.progress).toBeCloseTo(0.5, 10)
  })

  it('is done once the duration elapses, and stays done', () => {
    expect(phaseAt(INTRO_DURATION)).toEqual({ phase: 'done', progress: 1 })
    expect(phaseAt(INTRO_DURATION + 100)).toEqual({ phase: 'done', progress: 1 })
  })

  it('clamps negative time into the opening phase', () => {
    expect(phaseAt(-5).phase).toBe('void')
    expect(phaseAt(-5).progress).toBe(0)
  })

  it('never leaves a gap between phases across the whole sequence', () => {
    for (let t = 0; t < INTRO_DURATION; t += 0.01) {
      const state = phaseAt(t)
      expect(state.phase).not.toBe('done')
      expect(state.progress).toBeGreaterThanOrEqual(0)
      expect(state.progress).toBeLessThanOrEqual(1)
    }
  })
})

describe('progressIn', () => {
  it('is 0 before its phase and 1 after', () => {
    const orbits = spanOf('orbits')
    expect(progressIn('orbits', orbits.start - 0.5)).toBe(0)
    expect(progressIn('orbits', orbits.end + 0.5)).toBe(1)
  })

  it('ramps linearly inside its phase', () => {
    const approach = spanOf('approach')
    const quarter = approach.start + (approach.end - approach.start) * 0.25
    expect(progressIn('approach', quarter)).toBeCloseTo(0.25, 10)
  })

  it('throws for an unknown phase rather than silently returning 0', () => {
    // 'done' is a reported state, not a span — asking for its progress is a bug.
    expect(() => progressIn('done', 1)).toThrow()
  })
})

describe('progressBetween', () => {
  it('clamps outside the window', () => {
    expect(progressBetween(-1, 2, 4)).toBe(0)
    expect(progressBetween(9, 2, 4)).toBe(1)
  })

  it('handles a zero-width window without dividing by zero', () => {
    expect(progressBetween(1, 3, 3)).toBe(0)
    expect(progressBetween(3, 3, 3)).toBe(1)
    expect(Number.isNaN(progressBetween(3, 3, 3))).toBe(false)
  })
})

describe('easing', () => {
  it('pins both endpoints', () => {
    for (const fn of [clamp01, smoothstep, easeOutExpo]) {
      expect(fn(0)).toBe(0)
      expect(fn(1)).toBe(1)
    }
  })

  it('clamps out-of-range input', () => {
    expect(smoothstep(-3)).toBe(0)
    expect(easeOutExpo(4)).toBe(1)
  })

  it('pulse returns to zero at both ends and peaks in the middle', () => {
    expect(pulse(0)).toBeCloseTo(0, 10)
    expect(pulse(1)).toBeCloseTo(0, 10)
    expect(pulse(0.5)).toBeCloseTo(1, 10)
  })
})
