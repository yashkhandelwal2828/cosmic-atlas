/**
 * Whole-system camera framing that accounts for HUD chrome.
 * The canvas FOV is not the visible FOV: the learning panel, time dock,
 * and journey rail cover the edges, so a full-frustum fit clips Neptune.
 */
import { systemRadius, type DistanceMode } from './scale'

export interface ViewChrome {
  topPx: number
  rightPx: number
  bottomPx: number
  leftPx: number
}

/** Desktop occupancy used when framing the whole system (1440×900 reference). */
export const SYSTEM_VIEW_CHROME: ViewChrome = {
  topPx: 88,
  rightPx: 380,
  bottomPx: 128,
  leftPx: 16,
}

/** Breathing room around the system's bounding sphere after HUD-safe FOV. */
export const SYSTEM_VIEW_MARGIN = 1.12

/** Slack so OrbitControls can sit slightly past the framed pose. */
export const SYSTEM_VIEW_MAX_SLACK = 1.05

/** Oblique elevation — not top-down, so inclinations stay readable. */
export const SYSTEM_VIEW_ELEVATION = Math.atan2(0.75, 1.25)

/**
 * Tightest half-angle (radians) from the look-at centre to a HUD edge.
 * The Sun sits at canvas centre, so the right panel is the binding clip.
 */
export function hudSafeHalfFovRad(
  fovDeg: number,
  aspect: number,
  canvasWidth: number,
  canvasHeight: number,
  chrome: ViewChrome,
): number {
  const width = Math.max(canvasWidth, 1)
  const height = Math.max(canvasHeight, 1)
  const vFov = (fovDeg * Math.PI) / 180
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect)

  const ndcRight = 1 - (2 * chrome.rightPx) / width
  const ndcLeft = -1 + (2 * chrome.leftPx) / width
  const ndcTop = 1 - (2 * chrome.topPx) / height
  const ndcBottom = -1 + (2 * chrome.bottomPx) / height

  const halfHRight = Math.atan(Math.tan(hFov / 2) * Math.max(ndcRight, 0.08))
  const halfHLeft = Math.atan(Math.tan(hFov / 2) * Math.max(-ndcLeft, 0.08))
  const halfVTop = Math.atan(Math.tan(vFov / 2) * Math.max(ndcTop, 0.08))
  const halfVBottom = Math.atan(Math.tan(vFov / 2) * Math.max(-ndcBottom, 0.08))

  return Math.min(halfHRight, halfHLeft, halfVTop, halfVBottom)
}

/** Camera distance that fits a sphere of `radius` inside the HUD-safe frustum. */
export function systemViewDistance(
  radius: number,
  fovDeg: number,
  canvasWidth: number,
  canvasHeight: number,
  chrome: ViewChrome = SYSTEM_VIEW_CHROME,
  margin: number = SYSTEM_VIEW_MARGIN,
): number {
  const aspect = canvasWidth / Math.max(canvasHeight, 1)
  const halfFov = hudSafeHalfFovRad(
    fovDeg,
    aspect,
    canvasWidth,
    canvasHeight,
    chrome,
  )
  return (radius / Math.sin(halfFov)) * margin
}

/**
 * OrbitControls spherical cap. Must never sit below the HUD-safe camera
 * distance — otherwise `controls.update()` pulls Top view back and clips Neptune.
 */
export function systemViewMaxDistance(
  mode: DistanceMode,
  fovDeg: number,
  canvasWidth: number,
  canvasHeight: number,
): number {
  const framed = systemViewDistance(
    systemRadius(mode),
    fovDeg,
    canvasWidth,
    canvasHeight,
  )
  return Math.max(systemRadius(mode) * 3, framed * SYSTEM_VIEW_MAX_SLACK)
}
