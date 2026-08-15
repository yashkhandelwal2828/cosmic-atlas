/**
 * Intro timeline — pure timing. No Three.js, no DOM.
 *
 * The whole sequence is a function of one number: seconds since the intro began.
 * Every visual module asks this module "how far into MY phase are we" and gets a
 * clamped 0..1, so a module can be written without knowing where it sits in the
 * running order. Moving a phase boundary here moves it everywhere.
 */

export type IntroPhase =
  | 'void'
  | 'singularity'
  | 'flash'
  | 'launch'
  | 'settle'
  | 'orbits'
  | 'approach'
  | 'handoff'
  | 'done'

export interface PhaseSpan {
  phase: IntroPhase
  start: number
  end: number
}

/**
 * Phase boundaries in seconds. Contiguous and ordered — `phaseAt` relies on both.
 * `launch` may be *delayed* by the texture gate (see LAUNCH_GATE_*), which shifts
 * the whole tail; the conductor handles that by holding the clock, not by editing
 * these numbers.
 */
export const PHASES: readonly PhaseSpan[] = [
  { phase: 'void', start: 0.0, end: 0.8 },
  { phase: 'singularity', start: 0.8, end: 1.6 },
  { phase: 'flash', start: 1.6, end: 1.75 },
  { phase: 'launch', start: 1.75, end: 4.0 },
  { phase: 'settle', start: 4.0, end: 5.0 },
  { phase: 'orbits', start: 5.0, end: 6.0 },
  { phase: 'approach', start: 6.0, end: 7.2 },
  { phase: 'handoff', start: 7.2, end: 7.5 },
] as const

export const INTRO_DURATION = PHASES[PHASES.length - 1].end

/**
 * The clock holds at this instant until planetary textures resolve, so bodies
 * never fly out wearing fallback materials on a merely-slow connection.
 */
export const LAUNCH_GATE_AT = PHASES[2].start

/** …but never holds longer than this. A dead CDN must not mean a dead intro. */
export const LAUNCH_GATE_MAX_WAIT = 1.75

/** Reduced-motion path: no sequence at all, just this much crossfade. */
export const REDUCED_MOTION_FADE = 0.6

const SPAN_BY_PHASE = new Map<IntroPhase, PhaseSpan>(
  PHASES.map((span) => [span.phase, span]),
)

export function spanOf(phase: IntroPhase): PhaseSpan {
  const span = SPAN_BY_PHASE.get(phase)
  if (!span) throw new Error(`No span for phase "${phase}"`)
  return span
}

export interface PhaseState {
  phase: IntroPhase
  /** 0..1 through the current phase. Always 1 once the sequence is done. */
  progress: number
}

/** Which phase `t` seconds lands in, and how far through it. */
export function phaseAt(t: number): PhaseState {
  if (t >= INTRO_DURATION) return { phase: 'done', progress: 1 }
  const clamped = Math.max(0, t)
  for (const span of PHASES) {
    if (clamped < span.end) {
      const width = span.end - span.start
      return {
        phase: span.phase,
        progress: width <= 0 ? 1 : (clamped - span.start) / width,
      }
    }
  }
  return { phase: 'done', progress: 1 }
}

/**
 * Progress through `phase` at time `t`, clamped: 0 before the phase starts,
 * 1 after it ends. This is what lets a module own an effect that ramps during
 * one phase and simply stays finished afterwards.
 */
export function progressIn(phase: IntroPhase, t: number): number {
  const span = spanOf(phase)
  return progressBetween(t, span.start, span.end)
}

/** Clamped 0..1 ramp between two absolute times. */
export function progressBetween(t: number, start: number, end: number): number {
  if (end <= start) return t >= end ? 1 : 0
  return clamp01((t - start) / (end - start))
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

export function smoothstep(t: number): number {
  const x = clamp01(t)
  return x * x * (3 - 2 * x)
}

export function smootherstep(t: number): number {
  const x = clamp01(t)
  return x * x * x * (x * (x * 6 - 15) + 10)
}

export function easeOutExpo(t: number): number {
  const x = clamp01(t)
  return x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)
}

export function easeOutCubic(t: number): number {
  const x = clamp01(t)
  return 1 - Math.pow(1 - x, 3)
}

export function easeInQuint(t: number): number {
  const x = clamp01(t)
  return x * x * x * x * x
}

/** Rises to 1 at the midpoint and returns to 0 — for one-shot spikes. */
export function pulse(t: number): number {
  return Math.sin(Math.PI * clamp01(t))
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
