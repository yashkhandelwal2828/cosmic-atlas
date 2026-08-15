/**
 * Journey rail — select Sun + planets to travel.
 */
import { BODY_ORDER, BODIES, type BodyId } from '../data/bodies'

export class BodySelector {
  private root: HTMLElement
  private onSelect: (id: BodyId) => void
  private focused: BodyId = 'earth'

  constructor(container: HTMLElement, onSelect: (id: BodyId) => void) {
    this.root = container
    this.onSelect = onSelect
    this.root.classList.add('body-selector')
    this.render()
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
              title="${body.name}">
              <span class="body-chip__dot" style="--chip-color:${body.color}"></span>
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
}
