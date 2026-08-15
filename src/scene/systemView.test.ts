import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { systemRadius } from './scale'
import {
  SYSTEM_VIEW_CHROME,
  SYSTEM_VIEW_ELEVATION,
  SYSTEM_VIEW_MARGIN,
  SYSTEM_VIEW_MAX_SLACK,
  hudSafeHalfFovRad,
  systemViewDistance,
  systemViewMaxDistance,
} from './systemView'

const DESKTOP = { width: 1440, height: 900, fov: 48 }

function naiveFullCanvasDistance(
  radius: number,
  fovDeg: number,
  aspect: number,
  margin: number,
): number {
  const vFov = THREE.MathUtils.degToRad(fovDeg)
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect)
  return (radius / Math.sin(Math.min(vFov, hFov) / 2)) * margin
}

function projectOrbitDisc(
  radius: number,
  dist: number,
  fov: number,
  width: number,
  height: number,
): THREE.Vector3[] {
  const camera = new THREE.PerspectiveCamera(fov, width / height, 0.05, 8000)
  camera.position.set(
    0,
    Math.sin(SYSTEM_VIEW_ELEVATION) * dist,
    Math.cos(SYSTEM_VIEW_ELEVATION) * dist,
  )
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  camera.updateProjectionMatrix()

  const points: THREE.Vector3[] = []
  for (let i = 0; i < 72; i++) {
    const angle = (i / 72) * Math.PI * 2
    const world = new THREE.Vector3(
      Math.cos(angle) * radius,
      0,
      Math.sin(angle) * radius,
    )
    points.push(world.project(camera))
  }
  return points
}

describe('system view framing', () => {
  it('keeps an oblique elevation so inclination stays readable', () => {
    expect(SYSTEM_VIEW_ELEVATION).toBeCloseTo(Math.atan2(0.75, 1.25), 10)
    expect(SYSTEM_VIEW_ELEVATION).toBeGreaterThan(0.3)
    expect(SYSTEM_VIEW_ELEVATION).toBeLessThan(Math.PI / 2 - 0.25)
  })

  it('pulls back farther than a full-canvas fit at 1440×900 with a 380px right dock', () => {
    const radius = systemRadius('true')
    const hudSafe = systemViewDistance(
      radius,
      DESKTOP.fov,
      DESKTOP.width,
      DESKTOP.height,
    )
    const naive = naiveFullCanvasDistance(
      radius,
      DESKTOP.fov,
      DESKTOP.width / DESKTOP.height,
      SYSTEM_VIEW_MARGIN,
    )
    expect(SYSTEM_VIEW_CHROME.rightPx).toBe(380)
    expect(hudSafe).toBeGreaterThan(naive)
  })

  it('keeps the true-distance outer orbit inside the desktop HUD-safe rectangle', () => {
    const radius = systemRadius('true')
    const dist = systemViewDistance(
      radius,
      DESKTOP.fov,
      DESKTOP.width,
      DESKTOP.height,
    )
    const ndc = projectOrbitDisc(
      radius,
      dist,
      DESKTOP.fov,
      DESKTOP.width,
      DESKTOP.height,
    )

    const rightLimit =
      1 - (2 * SYSTEM_VIEW_CHROME.rightPx) / DESKTOP.width
    const leftLimit = -1 + (2 * SYSTEM_VIEW_CHROME.leftPx) / DESKTOP.width
    const topLimit = 1 - (2 * SYSTEM_VIEW_CHROME.topPx) / DESKTOP.height
    const bottomLimit =
      -1 + (2 * SYSTEM_VIEW_CHROME.bottomPx) / DESKTOP.height

    for (const p of ndc) {
      expect(p.x).toBeLessThan(rightLimit)
      expect(p.x).toBeGreaterThan(leftLimit)
      expect(p.y).toBeLessThan(topLimit)
      expect(p.y).toBeGreaterThan(bottomLimit)
    }
  })

  it('keeps the compressed outer orbit inside the same desktop HUD-safe rectangle', () => {
    const radius = systemRadius('compressed')
    const dist = systemViewDistance(
      radius,
      DESKTOP.fov,
      DESKTOP.width,
      DESKTOP.height,
    )
    const ndc = projectOrbitDisc(
      radius,
      dist,
      DESKTOP.fov,
      DESKTOP.width,
      DESKTOP.height,
    )
    const rightLimit =
      1 - (2 * SYSTEM_VIEW_CHROME.rightPx) / DESKTOP.width
    for (const p of ndc) {
      expect(p.x).toBeLessThan(rightLimit)
    }
  })

  it('the shipped maxDistance is always at least the HUD-safe camera distance', () => {
    expect(SYSTEM_VIEW_CHROME.rightPx).toBe(380)
    for (const mode of ['compressed', 'true'] as const) {
      const dist = systemViewDistance(
        systemRadius(mode),
        DESKTOP.fov,
        DESKTOP.width,
        DESKTOP.height,
      )
      const maxDist = systemViewMaxDistance(
        mode,
        DESKTOP.fov,
        DESKTOP.width,
        DESKTOP.height,
      )
      // The old OrbitControls cap (3× systemRadius) is the live-page bug.
      expect(systemRadius(mode) * 3).toBeLessThan(dist)
      expect(maxDist).toBeGreaterThanOrEqual(dist)
      expect(maxDist).toBe(
        Math.max(systemRadius(mode) * 3, dist * SYSTEM_VIEW_MAX_SLACK),
      )
    }
  })

  it('the HUD-safe half-FOV is tighter than the full vertical FOV on desktop', () => {
    const half = hudSafeHalfFovRad(
      DESKTOP.fov,
      DESKTOP.width / DESKTOP.height,
      DESKTOP.width,
      DESKTOP.height,
      SYSTEM_VIEW_CHROME,
    )
    expect(half).toBeLessThan(THREE.MathUtils.degToRad(DESKTOP.fov) / 2)
  })
})
