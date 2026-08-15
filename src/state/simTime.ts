/**
 * Pure simulated-clock state — no DOM, no WebGL, no ambient `Date.now()`.
 *
 * Every function returns a NEW state object and never mutates its input, so the
 * render loop can treat the clock the same way it treats the travel state.
 */

export interface SimTimeState {
  /** Simulated wall-clock instant, Unix ms. */
  epochMs: number
  /** Simulated seconds per real second. */
  timeScale: number
  playing: boolean
}

export interface TimePreset {
  id: string
  label: string
  secondsPerSecond: number
}

export const TIME_PRESETS: readonly TimePreset[] = [
  { id: 'real', label: 'Real time', secondsPerSecond: 1 },
  { id: 'hour', label: '1 hr / s', secondsPerSecond: 3600 },
  { id: 'day', label: '1 day / s', secondsPerSecond: 86400 },
  { id: 'week', label: '1 wk / s', secondsPerSecond: 604800 },
  { id: 'month', label: '1 mo / s', secondsPerSecond: 2629746 },
  { id: 'year', label: '1 yr / s', secondsPerSecond: 31556952 },
]

const DEFAULT_PRESET =
  TIME_PRESETS.find((preset) => preset.id === 'day') ?? TIME_PRESETS[0]

/** Standish elements are valid 1800-01-01 through 2050-12-31. */
export const EPOCH_MIN_MS = Date.UTC(1800, 0, 1, 0, 0, 0)
export const EPOCH_MAX_MS = Date.UTC(2050, 11, 31, 23, 59, 0)

/** Snap an instant onto the nearest bound of the Standish window. */
export function clampEpochMs(unixMs: number): number {
  if (!Number.isFinite(unixMs)) return EPOCH_MIN_MS
  if (unixMs < EPOCH_MIN_MS) return EPOCH_MIN_MS
  if (unixMs > EPOCH_MAX_MS) return EPOCH_MAX_MS
  return unixMs
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`
}

/** Defaults to `nowMs` (caller-injected for testability) and the 'day' preset. */
export function createSimTime(nowMs: number): SimTimeState {
  return {
    epochMs: clampEpochMs(nowMs),
    timeScale: DEFAULT_PRESET.secondsPerSecond,
    playing: false,
  }
}

/** Advance by a REAL-time delta in seconds. No-op when paused. */
export function advanceSimTime(
  state: SimTimeState,
  realDtSeconds: number,
): SimTimeState {
  if (!state.playing) {
    return { ...state }
  }
  return {
    ...state,
    epochMs: clampEpochMs(
      state.epochMs + realDtSeconds * state.timeScale * 1000,
    ),
  }
}

export function setTimeScale(
  state: SimTimeState,
  secondsPerSecond: number,
): SimTimeState {
  return { ...state, timeScale: secondsPerSecond }
}

export function setPlaying(state: SimTimeState, playing: boolean): SimTimeState {
  return { ...state, playing }
}

export function setEpoch(state: SimTimeState, unixMs: number): SimTimeState {
  return { ...state, epochMs: clampEpochMs(unixMs) }
}

/**
 * UTC label like '13 Aug 2026 · 14:32 UTC'.
 * Built from explicit UTC getters so the readout is identical on every machine,
 * whatever the host timezone or locale is set to.
 */
export function formatSimDate(unixMs: number): string {
  const date = new Date(unixMs)
  const day = pad2(date.getUTCDate())
  const month = MONTHS[date.getUTCMonth()]
  const year = date.getUTCFullYear()
  const hours = pad2(date.getUTCHours())
  const minutes = pad2(date.getUTCMinutes())
  return `${day} ${month} ${year} · ${hours}:${minutes} UTC`
}
