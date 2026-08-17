/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest'
import { BodySelector } from './BodySelector'

function mount(): {
  root: HTMLElement
  selector: BodySelector
  picks: string[]
} {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const picks: string[] = []
  const selector = new BodySelector(root, (id) => {
    picks.push(id)
  })
  return { root, selector, picks }
}

function stubRect(el: Element, box: { x: number; y: number; w: number; h: number }): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () =>
      ({
        x: box.x,
        y: box.y,
        width: box.w,
        height: box.h,
        top: box.y,
        left: box.x,
        right: box.x + box.w,
        bottom: box.y + box.h,
        toJSON: () => ({}),
      }) as DOMRect,
  })
}

describe('BodySelector journey rail', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('surrounds the active body with an orbit ring', () => {
    const { root, selector } = mount()
    selector.setFocused('mars')
    const active = root.querySelector<HTMLElement>('.body-chip--active')
    expect(active).not.toBeNull()
    expect(active!.dataset.id).toBe('mars')
    expect(active!.querySelector('.body-chip__orbit')).not.toBeNull()
    expect(active!.getAttribute('aria-pressed')).toBe('true')
  })

  it('scales a chip even when the pointer sits on its centre', () => {
    const { root } = mount()
    const rail = root.querySelector<HTMLElement>('.body-selector__rail')!
    const earth = root.querySelector<HTMLElement>('[data-id="earth"]')!
    stubRect(earth, { x: 100, y: 100, w: 80, h: 80 })

    rail.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 140, clientY: 140, bubbles: true }),
    )

    expect(earth.style.getPropertyValue('--mx')).toBe('0px')
    expect(earth.style.getPropertyValue('--my')).toBe('0px')
    expect(Number.parseFloat(earth.style.getPropertyValue('--ms'))).toBeGreaterThan(1)
  })

  it('pulls a chip toward the pointer when the rail is hovered', () => {
    const { root } = mount()
    const rail = root.querySelector<HTMLElement>('.body-selector__rail')!
    const earth = root.querySelector<HTMLElement>('[data-id="earth"]')!
    stubRect(earth, { x: 100, y: 100, w: 80, h: 80 })

    rail.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 150, clientY: 130, bubbles: true }),
    )

    expect(earth.style.getPropertyValue('--mx')).not.toBe('')
    expect(earth.style.getPropertyValue('--my')).not.toBe('')
    expect(Number.parseFloat(earth.style.getPropertyValue('--ms'))).toBeGreaterThan(1)
  })

  it('clears the magnetic offset when the pointer leaves the rail', () => {
    const { root } = mount()
    const rail = root.querySelector<HTMLElement>('.body-selector__rail')!
    const earth = root.querySelector<HTMLElement>('[data-id="earth"]')!
    stubRect(earth, { x: 100, y: 100, w: 80, h: 80 })

    rail.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 150, clientY: 130, bubbles: true }),
    )
    rail.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }))

    expect(earth.style.getPropertyValue('--mx')).toBe('0px')
    expect(earth.style.getPropertyValue('--my')).toBe('0px')
    expect(earth.style.getPropertyValue('--ms')).toBe('')
  })
})
