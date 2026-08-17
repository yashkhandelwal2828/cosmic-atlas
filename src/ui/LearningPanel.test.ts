/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LearningPanel, BRIEF_EXIT_MS } from './LearningPanel'

function stubMatchMedia(reduced: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: reduced && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })
}

function mount(): { root: HTMLElement; panel: LearningPanel } {
  const root = document.createElement('aside')
  document.body.appendChild(root)
  return { root, panel: new LearningPanel(root) }
}

describe('LearningPanel mission-brief stagger', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    stubMatchMedia(false)
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  it('marks title, stats, and description as stagger groups', () => {
    const { root, panel } = mount()
    panel.update('earth')
    expect(root.querySelector('[data-stagger="title"]')).not.toBeNull()
    expect(root.querySelector('[data-stagger="stats"]')).not.toBeNull()
    expect(root.querySelector('[data-stagger="description"]')).not.toBeNull()
  })

  it('paints the first brief immediately without an exit', () => {
    const { root, panel } = mount()
    panel.update('earth')
    expect(root.classList.contains('learning-panel--exiting')).toBe(false)
    expect(root.querySelector('[data-el="title"]')!.textContent).toBe('Earth')
  })

  it('fades the old brief up and out before swapping in the next body', () => {
    const { root, panel } = mount()
    panel.update('earth')
    panel.update('mars')

    expect(root.classList.contains('learning-panel--exiting')).toBe(true)
    expect(root.querySelector('[data-el="title"]')!.textContent).toBe('Earth')

    vi.advanceTimersByTime(BRIEF_EXIT_MS - 1)
    expect(root.querySelector('[data-el="title"]')!.textContent).toBe('Earth')

    vi.advanceTimersByTime(1)
    expect(root.querySelector('[data-el="title"]')!.textContent).toBe('Mars')
    expect(root.classList.contains('learning-panel--exiting')).toBe(false)
    expect(root.classList.contains('learning-panel--entering')).toBe(true)
  })

  it('queues rapid selections so the last requested body wins', () => {
    const { root, panel } = mount()
    panel.update('earth')
    panel.update('mars')
    panel.update('jupiter')
    vi.advanceTimersByTime(BRIEF_EXIT_MS)
    expect(root.querySelector('[data-el="title"]')!.textContent).toBe('Jupiter')
  })

  it('skips the exit/enter dance when reduced motion is preferred', () => {
    stubMatchMedia(true)
    const { root, panel } = mount()
    panel.update('earth')
    panel.update('mars')
    expect(root.querySelector('[data-el="title"]')!.textContent).toBe('Mars')
    expect(root.classList.contains('learning-panel--exiting')).toBe(false)
    expect(root.classList.contains('learning-panel--entering')).toBe(false)
  })
})
