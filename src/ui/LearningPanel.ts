/**
 * Learning panel + hotspot detail — DOM UI bound to body catalog.
 */
import type { BodyContent, BodyId, Hotspot } from '../data/bodies'
import { getEducationalContent } from '../data/content'

/** Outgoing fade/slide before the next brief is written in. */
export const BRIEF_EXIT_MS = 180
/** Incoming title → stats → description beat. */
export const BRIEF_STAGGER_MS = 50

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

export class LearningPanel {
  private root: HTMLElement
  private focused: BodyId | null = null
  private exitTimer: number | null = null
  private enterTimer: number | null = null
  private pending: BodyId | null = null
  private collapsed = false

  constructor(container: HTMLElement) {
    this.root = container
    this.root.classList.add('learning-panel')
    this.root.innerHTML = `
      <div class="learning-panel__chrome" data-stagger="title">
        <div class="learning-panel__head">
          <span class="learning-panel__eyebrow">Mission Brief</span>
          <button type="button" class="learning-panel__toggle" data-el="toggle" aria-expanded="true" aria-label="Collapse mission brief">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5 5.5 9l1.4-1.4L12 12.7l5.1-5.1L18.5 9z"/></svg>
          </button>
        </div>
        <h2 class="learning-panel__title" data-el="title">—</h2>
        <p class="learning-panel__tagline" data-el="tagline"></p>
      </div>
      <div class="learning-panel__scroll">
        <p class="learning-panel__overview" data-stagger="description" data-el="overview"></p>
        <section class="learning-panel__section" data-stagger="stats">
          <h3>Key facts</h3>
          <dl class="learning-panel__facts" data-el="facts"></dl>
        </section>
        <section class="learning-panel__section" data-stagger="description">
          <h3>Composition</h3>
          <p data-el="composition"></p>
        </section>
        <section class="learning-panel__section" data-stagger="description">
          <h3>Notable features</h3>
          <ul class="learning-panel__features" data-el="features"></ul>
        </section>
        <section class="learning-panel__section" data-stagger="description">
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

    // On phones the full brief buries the scene, so start folded down to the
    // header card; desktop keeps it open where there is room for both.
    if (typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 860px)').matches) {
      this.setCollapsed(true)
    }
    const toggle = this.root.querySelector('[data-el="toggle"]') as HTMLButtonElement
    toggle.addEventListener('click', () => this.setCollapsed(!this.collapsed))
  }

  private setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed
    this.root.classList.toggle('learning-panel--collapsed', collapsed)
    const toggle = this.root.querySelector('[data-el="toggle"]') as HTMLButtonElement | null
    const label = collapsed ? 'Expand mission brief' : 'Collapse mission brief'
    toggle?.setAttribute('aria-expanded', String(!collapsed))
    toggle?.setAttribute('aria-label', label)
  }

  update(bodyId: BodyId): void {
    if (this.exitTimer !== null) {
      this.pending = bodyId
      return
    }
    if (this.focused === bodyId) return
    if (this.focused === null || prefersReducedMotion()) {
      this.commit(bodyId, false)
      return
    }
    this.pending = bodyId
    this.root.classList.remove('learning-panel--entering')
    this.root.classList.add('learning-panel--exiting')
    this.exitTimer = window.setTimeout(() => {
      this.exitTimer = null
      const next = this.pending ?? bodyId
      this.pending = null
      this.commit(next, true)
    }, BRIEF_EXIT_MS)
  }

  private commit(bodyId: BodyId, enter: boolean): void {
    this.focused = bodyId
    this.renderBody(getEducationalContent(bodyId))
    this.clearDetail()
    this.root.classList.remove('learning-panel--exiting')
    if (this.enterTimer !== null) {
      window.clearTimeout(this.enterTimer)
      this.enterTimer = null
    }
    if (enter && !prefersReducedMotion()) {
      this.root.classList.remove('learning-panel--entering')
      void this.root.offsetWidth
      this.root.classList.add('learning-panel--entering')
      this.enterTimer = window.setTimeout(() => {
        this.enterTimer = null
        this.root.classList.remove('learning-panel--entering')
      }, BRIEF_EXIT_MS + BRIEF_STAGGER_MS * 2 + 400)
    } else {
      this.root.classList.remove('learning-panel--entering')
    }
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
