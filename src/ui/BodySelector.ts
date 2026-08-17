/**
 * Journey rail — select Sun + planets to travel.
 */
import { BODY_ORDER, BODIES, type BodyId } from '../data/bodies'

const MAGNET_RADIUS_PX = 88
const MAGNET_PULL_PX = 10

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

export class BodySelector {
  private root: HTMLElement
  private onSelect: (id: BodyId) => void
  private focused: BodyId = 'earth'

  constructor(container: HTMLElement, onSelect: (id: BodyId) => void) {
    this.root = container
    this.onSelect = onSelect
    this.root.classList.add('body-selector')
    this.render()
    this.bindMagnet()
  }

  setFocused(id: BodyId): void {
    this.focused = id
    this.root.querySelectorAll('.body-chip').forEach((el) => {
      const chip = el as HTMLElement
      chip.classList.toggle('body-chip--active', chip.dataset.id === id)
      chip.setAttribute('aria-pressed', chip.dataset.id === id ? 'true' : 'false')
    })
  }

  setTraveling(traveling: boolean): void {
    this.root.classList.toggle('body-selector--locked', traveling)
    this.root.querySelectorAll('button').forEach((btn) => {
      ;(btn as HTMLButtonElement).disabled = traveling
    })
  }

  private render(): void {
    this.root.innerHTML = `
      <div class="body-selector__label">Journey</div>
      <div class="body-selector__rail" role="toolbar" aria-label="Select a celestial body">
        ${BODY_ORDER.map((id) => {
          const body = BODIES[id]
          const active = id === this.focused ? ' body-chip--active' : ''
          return `
            <button type="button"
              class="body-chip${active}"
              data-id="${id}"
              aria-pressed="${id === this.focused}"
              title="${body.name}"
              style="--chip-color:${body.color}">
              <span class="body-chip__glyph">
                <span class="body-chip__orbit" aria-hidden="true">
                  <span class="body-chip__sat"></span>
                </span>
                <span class="body-chip__dot"></span>
              </span>
              <span class="body-chip__name">${body.name}</span>
            </button>`
        }).join('')}
      </div>
    `

    this.root.querySelectorAll('.body-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.id as BodyId
        if (id) this.onSelect(id)
      })
    })
  }

  private bindMagnet(): void {
    const rail = this.root.querySelector('.body-selector__rail')
    if (!rail) return
    rail.addEventListener('pointermove', (event) => {
      this.magnetize(event as PointerEvent)
    })
    rail.addEventListener('pointerleave', () => this.clearMagnet())
  }

  private magnetize(event: PointerEvent): void {
    if (prefersReducedMotion()) return
    this.root.querySelectorAll<HTMLElement>('.body-chip').forEach((chip) => {
      if ((chip as HTMLButtonElement).disabled) {
        this.resetChip(chip)
        return
      }
      const box = chip.getBoundingClientRect()
      const dx = event.clientX - (box.left + box.width / 2)
      const dy = event.clientY - (box.top + box.height / 2)
      const dist = Math.hypot(dx, dy)
      if (dist > MAGNET_RADIUS_PX) {
        this.resetChip(chip)
        return
      }
      const t = 1 - dist / MAGNET_RADIUS_PX
      const pull = t * t * MAGNET_PULL_PX
      const nx = dist === 0 ? 0 : dx / dist
      const ny = dist === 0 ? 0 : dy / dist
      chip.style.setProperty('--mx', `${nx * pull}px`)
      chip.style.setProperty('--my', `${ny * pull}px`)
      chip.style.setProperty('--ms', String(1 + 0.16 * t))
    })
  }

  private clearMagnet(): void {
    this.root.querySelectorAll<HTMLElement>('.body-chip').forEach((chip) => {
      this.resetChip(chip)
    })
  }

  private resetChip(chip: HTMLElement): void {
    chip.style.setProperty('--mx', '0px')
    chip.style.setProperty('--my', '0px')
    chip.style.removeProperty('--ms')
  }
}
