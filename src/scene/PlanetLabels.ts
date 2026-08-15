/**
 * Cute floating planet identity labels (CSS2D).
 * Labels live on a dedicated root with world positions (not parented under spinning bodies)
 * so every body — including the Sun — always has a stable tag.
 */
import {
  CSS2DObject,
  CSS2DRenderer,
} from 'three/addons/renderers/CSS2DRenderer.js'
import * as THREE from 'three'
import type { BodyId } from '../data/bodies'
import { BODIES, BODY_ORDER } from '../data/bodies'

export class PlanetLabels {
  readonly renderer: CSS2DRenderer
  readonly root = new THREE.Group()
  private labels = new Map<BodyId, CSS2DObject>()
  private focused: BodyId = 'earth'
  private getWorldPos: ((id: BodyId) => THREE.Vector3) | null = null
  private getRadius: ((id: BodyId) => number) | null = null

  constructor(container: HTMLElement) {
    this.renderer = new CSS2DRenderer()
    this.renderer.setSize(container.clientWidth, container.clientHeight)
    const el = this.renderer.domElement
    el.className = 'planet-labels-layer'
    el.style.position = 'absolute'
    el.style.inset = '0'
    el.style.pointerEvents = 'none'
    el.style.zIndex = '8'
    container.appendChild(el)
    this.root.name = 'planet-labels'
  }

  /**
   * Create one label per body. Positions are refreshed every frame via `syncPositions`.
   */
  attachAll(
    getWorldPos: (id: BodyId) => THREE.Vector3,
    getRadius: (id: BodyId) => number,
  ): void {
    this.getWorldPos = getWorldPos
    this.getRadius = getRadius

    // Clear previous
    for (const obj of this.labels.values()) {
      this.root.remove(obj)
    }
    this.labels.clear()

    for (const id of BODY_ORDER) {
      const body = BODIES[id]
      const wrap = document.createElement('div')
      wrap.className = 'planet-tag'
      wrap.dataset.body = id
      wrap.setAttribute('data-planet-label', id)
      wrap.innerHTML = `
        <span class="planet-tag__dot" style="--tag-color:${body.color}"></span>
        <span class="planet-tag__name">${body.name}</span>
      `

      const obj = new CSS2DObject(wrap)
      obj.name = `label-${id}`
      obj.center.set(0.5, 1)
      // Pre-mount every tag so DOM always has every body (CSS2D only appends when visible)
      wrap.style.display = 'none'
      this.renderer.domElement.appendChild(wrap)
      this.root.add(obj)
      this.labels.set(id, obj)
    }

    this.syncPositions()
    this.setFocused(this.focused)
  }

  /** Call each frame so tags sit above bodies even as the system layout is fixed. */
  syncPositions(): void {
    if (!this.getWorldPos || !this.getRadius) return
    for (const id of BODY_ORDER) {
      const obj = this.labels.get(id)
      if (!obj) continue
      const pos = this.getWorldPos(id)
      const r = this.getRadius(id)
      const lift = id === 'sun' ? r * 1.2 : r * 1.35
      obj.position.set(pos.x, pos.y + lift, pos.z)
    }
  }

  setFocused(id: BodyId): void {
    this.focused = id
    for (const [bid, obj] of this.labels) {
      obj.element.classList.toggle('planet-tag--active', bid === id)
    }
  }

  setSize(width: number, height: number): void {
    this.renderer.setSize(width, height)
  }

  /** Fade the whole tag layer — used to hold labels back during the intro. */
  setOpacity(value: number): void {
    const el = this.renderer.domElement
    el.style.opacity = String(Math.max(0, Math.min(1, value)))
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.syncPositions()
    this.renderer.render(scene, camera)
  }

  get count(): number {
    return this.labels.size
  }

  dispose(container: HTMLElement): void {
    for (const obj of this.labels.values()) {
      this.root.remove(obj)
    }
    this.labels.clear()
    this.root.parent?.remove(this.root)
    if (this.renderer.domElement.parentElement === container) {
      container.removeChild(this.renderer.domElement)
    }
  }
}
