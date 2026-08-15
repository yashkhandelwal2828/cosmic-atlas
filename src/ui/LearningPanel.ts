/**
 * Learning panel + hotspot detail — DOM UI bound to body catalog.
 */
import type { BodyContent, BodyId, Hotspot } from '../data/bodies'
import { getEducationalContent } from '../data/content'

export class LearningPanel {
  private root: HTMLElement

  constructor(container: HTMLElement) {
    this.root = container
    this.root.classList.add('learning-panel')
    this.root.innerHTML = `
      <div class="learning-panel__chrome">
        <span class="learning-panel__eyebrow">Mission Brief</span>
        <h2 class="learning-panel__title" data-el="title">—</h2>
        <p class="learning-panel__tagline" data-el="tagline"></p>
      </div>
      <div class="learning-panel__scroll">
        <p class="learning-panel__overview" data-el="overview"></p>
        <section class="learning-panel__section">
          <h3>Key facts</h3>
          <dl class="learning-panel__facts" data-el="facts"></dl>
        </section>
        <section class="learning-panel__section">
          <h3>Composition</h3>
          <p data-el="composition"></p>
        </section>
        <section class="learning-panel__section">
          <h3>Notable features</h3>
          <ul class="learning-panel__features" data-el="features"></ul>
        </section>
        <section class="learning-panel__section">
          <h3>Explore hotspots</h3>
          <p class="learning-panel__hint">Click markers on the planet or select below.</p>
          <div class="learning-panel__hotspots" data-el="hotspots"></div>
        </section>
        <section class="learning-panel__section learning-panel__detail" data-el="detail" hidden>
          <h3 data-el="detail-title"></h3>
          <p data-el="detail-body"></p>
        </section>
      </div>
    `
  }

  update(bodyId: BodyId): void {
    const content = getEducationalContent(bodyId)
    this.renderBody(content)
    this.clearDetail()
  }

  highlightHotspot(hotspot: Hotspot): void {
    const detail = this.root.querySelector('[data-el="detail"]') as HTMLElement
    const title = this.root.querySelector('[data-el="detail-title"]') as HTMLElement
    const body = this.root.querySelector('[data-el="detail-body"]') as HTMLElement
    detail.hidden = false
    title.textContent = hotspot.label
    body.textContent = hotspot.description

    this.root.querySelectorAll('.hotspot-chip').forEach((el) => {
      el.classList.toggle(
        'hotspot-chip--active',
        (el as HTMLElement).dataset.id === hotspot.id,
      )
    })
  }

  private clearDetail(): void {
    const detail = this.root.querySelector('[data-el="detail"]') as HTMLElement
    if (detail) detail.hidden = true
  }

  private renderBody(content: BodyContent): void {
    const q = (sel: string) => this.root.querySelector(sel) as HTMLElement
    q('[data-el="title"]').textContent = content.name
    q('[data-el="tagline"]').textContent = content.tagline
    q('[data-el="overview"]').textContent = content.overview
    q('[data-el="composition"]').textContent = content.composition

    const facts = q('[data-el="facts"]')
    facts.innerHTML = content.facts
      .map(
        (f) =>
          `<div class="fact-row"><dt>${escapeHtml(f.label)}</dt><dd>${escapeHtml(f.value)}</dd></div>`,
      )
      .join('')

    const features = q('[data-el="features"]')
    features.innerHTML = content.notableFeatures
      .map((f) => `<li>${escapeHtml(f)}</li>`)
      .join('')

    const hotspots = q('[data-el="hotspots"]')
    hotspots.innerHTML = content.hotspots
      .map(
        (h) =>
          `<button type="button" class="hotspot-chip" data-id="${escapeHtml(h.id)}" data-hotspot>${escapeHtml(h.label)}</button>`,
      )
      .join('')

    hotspots.querySelectorAll('[data-hotspot]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.id
        const hs = content.hotspots.find((h) => h.id === id)
        if (hs) this.highlightHotspot(hs)
      })
    })
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
