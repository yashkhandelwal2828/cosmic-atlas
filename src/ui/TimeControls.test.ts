/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import { createSimTime } from '../state/simTime'
import {
  TimeControls,
  parseUtcInput,
  type TimeControlsHandlers,
} from './TimeControls'

function mount(
  overrides: Partial<TimeControlsHandlers> = {},
): { root: HTMLElement; controls: TimeControls } {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const controls = new TimeControls(root, {
    onPlayToggle: () => undefined,
    onScaleChange: () => undefined,
    onJumpToDate: () => undefined,
    onJumpToNow: () => undefined,
    onDistanceModeChange: () => undefined,
    onOrbitLinesToggle: () => undefined,
    onInclinationExaggerationToggle: () => undefined,
    onTopView: () => undefined,
    ...overrides,
  })
  return { root, controls }
}

describe('TimeControls first paint', () => {
  it('paints the paused state on first render', () => {
    const { root, controls } = mount()
    const play = root.querySelector<HTMLButtonElement>('[data-el="play"]')
    expect(play).not.toBeNull()
    expect(play!.getAttribute('aria-label')).toBe('Play the simulation')
    expect(play!.getAttribute('aria-pressed')).toBe('false')
    expect(play!.classList.contains('time-play--playing')).toBe(false)

    const state = createSimTime(Date.UTC(2026, 7, 13, 14, 32, 0))
    expect(state.playing).toBe(false)
    controls.update(state)
    expect(play!.getAttribute('aria-label')).toBe('Play the simulation')
    controls.dispose()
    root.remove()
  })

  it('sets a Standish validity window on the datetime-local input', () => {
    const { root, controls } = mount()
    const input = root.querySelector<HTMLInputElement>('[data-el="date-input"]')
    expect(input).not.toBeNull()
    expect(input!.min).toBe('1800-01-01T00:00')
    expect(input!.max).toBe('2050-12-31T23:59')
    controls.dispose()
    root.remove()
  })

  it('clamps the date-input parse path to 1800–2050', () => {
    const jumped: number[] = []
    const { root, controls } = mount({
      onJumpToDate: (unixMs) => {
        jumped.push(unixMs)
      },
    })
    const input = root.querySelector<HTMLInputElement>('[data-el="date-input"]')!

    input.value = '1799-06-01T00:00'
    input.dispatchEvent(new Event('change'))
    expect(jumped[0]).toBe(Date.UTC(1800, 0, 1, 0, 0, 0))

    input.value = '2051-01-01T00:00'
    input.dispatchEvent(new Event('change'))
    expect(jumped[1]).toBe(Date.UTC(2050, 11, 31, 23, 59, 0))

    expect(parseUtcInput('1799-12-31T23:59')).toBe(Date.UTC(1800, 0, 1, 0, 0, 0))
    expect(parseUtcInput('2051-06-01T12:00')).toBe(
      Date.UTC(2050, 11, 31, 23, 59, 0),
    )

    controls.dispose()
    root.remove()
  })
})
