# Orbital Mechanics & Rotation Spec — Cosmic Atlas

Authoritative contract for the "real positions + real rotations" rework.
Every module below is implemented **exactly** to these signatures. Do not rename
exports, do not change parameter order, do not add required parameters.

---

## 0. Ground rules

- TypeScript, `verbatimModuleSyntax: true` → use `import type { … }` for type-only imports.
- `noUnusedLocals` and `noUnusedParameters` are ON. No dead variables, no unused params.
- Tests run under `environment: 'node'` — pure modules must NOT import `three` at module
  top level unless the import is type-only. Use the local `Vec3` plain-object type.
- Existing public API of `bodies.ts` stays intact (`displayRadius`, `orbitDistance` remain,
  even though `orbitDistance` becomes legacy/unused by the scene).
- Prettier-ish house style: no semicolons, single quotes, 2-space indent (match existing files).

---

## 1. Coordinate frames

**Reference frame:** heliocentric ecliptic J2000.
- `x_ecl` → toward the vernal equinox
- `y_ecl` → 90° ahead in the ecliptic plane
- `z_ecl` → ecliptic north

**Ecliptic → three.js scene** (three.js is Y-up, right-handed):

```
sceneX =  x_ecl
sceneY =  z_ecl
sceneZ = -y_ecl
```

This mapping is right-handed (det = +1) and MUST be used for *both* orbital positions
and spin-axis directions. Any code that converts must call the single shared helper
`eclipticToScene()` — no ad-hoc conversions anywhere else.

**Equatorial J2000 → ecliptic J2000** (needed for IAU pole vectors), with
ε = 23.4392911°:

```
x_ecl = x_eq
y_ecl =  y_eq * cos(ε) + z_eq * sin(ε)
z_ecl = -y_eq * sin(ε) + z_eq * cos(ε)
```

---

## 2. `src/data/orbitalElements.ts` (new)

Pure data. No logic beyond `const` tables.

```ts
import type { BodyId } from './bodies'

/** The 8 planets — the Sun is excluded (it sits at the origin). */
export type PlanetId = Exclude<BodyId, 'sun'>

export const PLANET_IDS: readonly PlanetId[]  // sun-order: mercury … neptune

/** Classical Keplerian element set (JPL / Standish convention). */
export interface KeplerianElements {
  /** Semi-major axis, AU */
  a: number
  /** Eccentricity, dimensionless */
  e: number
  /** Inclination to the ecliptic, degrees */
  i: number
  /** Mean longitude L, degrees */
  L: number
  /** Longitude of perihelion ϖ, degrees */
  lp: number
  /** Longitude of ascending node Ω, degrees */
  node: number
}

export interface OrbitalElementSet {
  /** Values at epoch J2000.0 */
  epoch: KeplerianElements
  /** Change per Julian century */
  rates: KeplerianElements
}

export const ORBITS: Record<PlanetId, OrbitalElementSet>
```

Use **exactly** these JPL "Approximate Positions of the Major Planets"
(Standish, valid 1800–2050) values. Order per line:
`a, e, i, L, lp, node` — first line epoch, second line per-century rates.

```
mercury  0.38709927  0.20563593   7.00497902   252.25032350   77.45779628   48.33076593
         0.00000037  0.00001906  -0.00594749  149472.67411175   0.16047689   -0.12534081

venus    0.72333566  0.00677672   3.39467605   181.97909950  131.60246718   76.67984255
         0.00000390 -0.00004107  -0.00078890   58517.81538729   0.00268329   -0.27769418

earth    1.00000261  0.01671123  -0.00001531   100.46457166  102.93768193    0.0
         0.00000562 -0.00004392  -0.01294668   35999.37244981   0.32327364    0.0

mars     1.52371034  0.09339410   1.84969142    -4.55343205  -23.94362959   49.55953891
         0.00001847  0.00007882  -0.00813131   19140.30268499   0.44441088   -0.29257343

jupiter  5.20288700  0.04838624   1.30439695    34.39644051   14.72847983  100.47390909
        -0.00011607 -0.00013253  -0.00183714    3034.74612775   0.21252668    0.20469106

saturn   9.53667594  0.05386179   2.48599187    49.95424423   92.59887831  113.66242448
        -0.00125060 -0.00050991   0.00193609    1222.49362201  -0.41897216   -0.28867794

uranus  19.18916464  0.04725744   0.77263783   313.23810451  170.95427630   74.01692503
        -0.00196176 -0.00004397  -0.00242939     428.48202785   0.40805281    0.04240589

neptune 30.06992276  0.00859048   1.77004347   -55.12002969   44.96476227  131.78422574
         0.00026291  0.00005105   0.00035372     218.45945325  -0.32241464   -0.00508664
```

(The `earth` row is the Earth–Moon barycentre; that is intentional and correct here.)

### Rotation models

```ts
export interface RotationModel {
  /**
   * Sidereal rotation period in hours.
   * NEGATIVE means retrograde (Venus, Uranus) — the sign is load-bearing,
   * spin angle is computed as W0 + 360 * days / (periodHours / 24).
   */
  siderealPeriodHours: number
  /** IAU north-pole right ascension at J2000, degrees (equatorial frame) */
  poleRa: number
  /** IAU north-pole declination at J2000, degrees (equatorial frame) */
  poleDec: number
  /** Prime-meridian angle W at J2000, degrees */
  w0: number
  /** Obliquity to its own orbit, degrees — display/education only */
  obliquityToOrbit: number
}

export const ROTATIONS: Record<BodyId, RotationModel>   // includes 'sun'
```

| body    | siderealPeriodHours | poleRa   | poleDec | w0      | obliquityToOrbit |
|---------|--------------------:|---------:|--------:|--------:|-----------------:|
| sun     | 609.12              | 286.13   | 63.87   | 84.176  | 7.25             |
| mercury | 1407.6              | 281.0103 | 61.4155 | 329.5988| 0.034            |
| venus   | -5832.6             | 272.76   | 67.16   | 160.20  | 177.36           |
| earth   | 23.9344696          | 0.0      | 90.0    | 190.147 | 23.44            |
| mars    | 24.6229             | 317.68143| 52.8865 | 176.630 | 25.19            |
| jupiter | 9.9250              | 268.057  | 64.495  | 284.95  | 3.13             |
| saturn  | 10.656              | 40.589   | 83.537  | 38.90   | 26.73            |
| uranus  | -17.24              | 257.311  | -15.175 | 203.81  | 97.77            |
| neptune | 16.11               | 299.3337 | 42.9504 | 253.198 | 28.32            |

**These pole values are verified, not approximate — do not "correct" them back to
rounder numbers.** Mars uses the IAU/WGCCRE J2000 pole; the frequently-quoted
317.269 / 54.432 pair is wrong and yields a 23.92° obliquity instead of 25.19°.
Neptune's pole carries a periodic term (α₀ = 299.36 + 0.70 sin N,
δ₀ = 43.46 − 0.51 cos N, N = 357.85 + 52.316 T); the values above are that
expression evaluated at T = 0.

**How to check a pole value.** Obliquity is defined against the body's OWN orbit
normal, not the ecliptic, and it is measured from the *angular-momentum* pole —
which is the IAU north pole **negated** for retrograde rotators (Venus, Uranus).
Get either of those wrong and a correct table looks broken:

```
n_orbit = eclipticToScene(sin i·sin Ω, −sin i·cos Ω, cos i)
axis    = spinAxisScene(poleRa, poleDec);  if (period < 0) axis = −axis
obliquity = acos(axis · n_orbit)
```

All eight planets must land within ~0.05° of the published obliquity by this test.

Sanity check the sign convention: Earth → `360 / (23.9344696/24)` = **+360.9856 °/day** ✓,
Venus → `360 / (-5832.6/24)` = **−1.48136 °/day** ✓, Uranus → **−501.16 °/day** ✓.
These match the IAU published rates. If your numbers don't, you have a bug.

---

## 3. `src/scene/orbitalMechanics.ts` (new, PURE — no `three` value import)

```ts
import type { KeplerianElements, OrbitalElementSet, PlanetId } from '../data/orbitalElements'

export interface Vec3 { x: number; y: number; z: number }

/** Unix ms of the J2000.0 epoch (2000-01-01T12:00:00Z). */
export const J2000_EPOCH_MS: number

/** Mean solar days per Julian century. */
export const DAYS_PER_CENTURY = 36525

/** Julian centuries elapsed since J2000.0 for a Unix-ms timestamp. */
export function julianCenturies(unixMs: number): number

/** Days elapsed since J2000.0 for a Unix-ms timestamp. */
export function daysSinceJ2000(unixMs: number): number

/** Linear-propagate an element set to time T (Julian centuries past J2000). */
export function elementsAt(set: OrbitalElementSet, T: number): KeplerianElements

/**
 * Solve Kepler's equation M = E − e·sin(E) for the eccentric anomaly E.
 * Newton–Raphson. Inputs/outputs in RADIANS. Must converge for e up to 0.95.
 */
export function solveKepler(meanAnomalyRad: number, e: number, tolerance?: number): number

/**
 * Heliocentric position in the ecliptic J2000 frame, in AU.
 * Standard chain: M = L − ϖ (wrapped to −180…180) → solve Kepler → perifocal (x',y')
 * → rotate by argument of perihelion (ϖ − Ω), inclination i, then node Ω.
 */
export function heliocentricEcliptic(el: KeplerianElements): Vec3

/** Convenience: elements → position for a planet at a given wall-clock time. */
export function planetPositionAU(id: PlanetId, unixMs: number): Vec3

/** Ecliptic-frame vector → three.js scene axes. Pure, allocation-returning. */
export function eclipticToScene(v: Vec3): Vec3

/** Equatorial J2000 unit vector from RA/Dec in degrees. */
export function raDecToEquatorial(raDeg: number, decDeg: number): Vec3

/** Equatorial J2000 → ecliptic J2000. */
export function equatorialToEcliptic(v: Vec3): Vec3

/**
 * The body's north spin-axis direction expressed in SCENE axes (unit vector).
 * Chain: raDecToEquatorial → equatorialToEcliptic → eclipticToScene.
 */
export function spinAxisScene(poleRaDeg: number, poleDecDeg: number): Vec3

/**
 * Prime-meridian angle W in DEGREES at a given time.
 * W = w0 + 360 * daysSinceJ2000 / (siderealPeriodHours / 24)
 * Not normalised — callers may pass it straight to a rotation.
 */
export function spinAngleDeg(
  rotation: { siderealPeriodHours: number; w0: number },
  unixMs: number,
): number

/** Kepler's third law: sidereal period in days for a semi-major axis in AU. */
export function orbitalPeriodDays(aAU: number): number   // 365.256898326 * a^1.5

/**
 * Closed ellipse sample for drawing the orbit path, in AU, ecliptic frame.
 * Elements are frozen at time T; the loop is swept over ECCENTRIC anomaly
 * 0…2π in `segments` steps so points bunch correctly near perihelion.
 * Returns `segments` points (caller closes the loop).
 */
export function sampleOrbitEcliptic(
  set: OrbitalElementSet,
  T: number,
  segments: number,
): Vec3[]
```

**Notes for the implementer**

- Wrap the mean anomaly into −180…180° before solving; that keeps Newton's
  starting guess `E0 = M + e·sin(M)` well-behaved.
- `heliocentricEcliptic` reference implementation:
  ```
  ω = lp − node                      (argument of perihelion)
  M = wrapDeg180(L − lp)
  E = solveKepler(M_rad, e)
  x' = a * (cos E − e)
  y' = a * sqrt(1 − e²) * sin E      (perifocal plane)
  x = (cosω·cosΩ − sinω·sinΩ·cos i)·x' + (−sinω·cosΩ − cosω·sinΩ·cos i)·y'
  y = (cosω·sinΩ + sinω·cosΩ·cos i)·x' + (−sinω·sinΩ + cosω·cosΩ·cos i)·y'
  z = (sinω·sin i)·x' + (cosω·sin i)·y'
  ```
- Everything here is allocation-light but *does* allocate. The render loop calls it
  ~9×/frame, which is fine. Do not micro-optimise into shared mutable state.

---

## 4. `src/scene/scale.ts` (new, PURE)

Maps astronomical distances to scene units. Sizes are **not** to scale (planets stay
visible); only distances get a mode toggle. Be explicit about that in comments.

```ts
export type DistanceMode = 'compressed' | 'true'

/** Scene units for Earth's orbit in compressed mode. */
export const COMPRESSED_UNIT = 9.6
/** Scene units per AU in true-distance mode. */
export const TRUE_UNITS_PER_AU = 12

/**
 * Scene units per AU for a body whose semi-major axis is `aAU`.
 *
 * compressed:  sceneRadius(a) = COMPRESSED_UNIT * sqrt(a)
 *              → factor = COMPRESSED_UNIT / sqrt(a)
 *              Each orbit is scaled UNIFORMLY by its own factor, so the ellipse
 *              keeps its true shape, eccentricity, and inclination; only the
 *              spacing between orbits is compressed.
 * true:        factor = TRUE_UNITS_PER_AU for every body.
 */
export function orbitScaleFactor(aAU: number, mode: DistanceMode): number

/** Outer extent of the system in scene units, for camera framing / far plane. */
export function systemRadius(mode: DistanceMode): number
```

Compressed sanity table (should match closely — these are the values the old
hand-tuned `orbitDistance` was approximating):
mercury ≈ 6.0, venus ≈ 8.2, earth ≈ 9.6, mars ≈ 11.8, jupiter ≈ 21.9,
saturn ≈ 29.6, uranus ≈ 42.0, neptune ≈ 52.6.

Also expose vertical exaggeration so the "planets are NOT in one plane" point reads
on screen:

```ts
/** Multiplier applied to the scene Y (out-of-ecliptic) component. 1 = truthful. */
export const INCLINATION_EXAGGERATION = { off: 1, on: 4 } as const
```

---

## 5. `src/state/simTime.ts` (new, PURE)

```ts
export interface SimTimeState {
  /** Simulated wall-clock instant, Unix ms. */
  epochMs: number
  /** Simulated seconds per real second. */
  timeScale: number
  playing: boolean
}

export interface TimePreset {
  id: string
  label: string        // e.g. '1 day / s'
  secondsPerSecond: number
}

export const TIME_PRESETS: readonly TimePreset[]
```

Presets, in this order:
`real` "Real time" 1 · `hour` "1 hr / s" 3600 · `day` "1 day / s" 86400 ·
`week` "1 wk / s" 604800 · `month` "1 mo / s" 2629746 · `year` "1 yr / s" 31556952

```ts
/** Defaults to `nowMs` (caller-injected for testability) and the 'day' preset. */
export function createSimTime(nowMs: number): SimTimeState

/** Advance by a REAL-time delta in seconds. No-op when paused. */
export function advanceSimTime(state: SimTimeState, realDtSeconds: number): SimTimeState

export function setTimeScale(state: SimTimeState, secondsPerSecond: number): SimTimeState
export function setPlaying(state: SimTimeState, playing: boolean): SimTimeState
export function setEpoch(state: SimTimeState, unixMs: number): SimTimeState

/** UTC label like '13 Aug 2026 · 14:32 UTC'. */
export function formatSimDate(unixMs: number): string
```

All functions are pure and return NEW state objects. Never mutate the input.

---

## 6. `src/scene/OrbitPaths.ts` (new, uses `three`)

```ts
import * as THREE from 'three'
import type { BodyId } from '../data/bodies'
import type { DistanceMode } from './scale'

export interface OrbitPathOptions {
  mode: DistanceMode
  /** Julian centuries past J2000, for element propagation. */
  T: number
  verticalExaggeration: number
  segments?: number   // default 512
}

export class OrbitPaths {
  readonly root: THREE.Group
  constructor(options: OrbitPathOptions)
  /** Rebuild geometry (call when mode / exaggeration changes, or every ~year of sim time). */
  rebuild(options: OrbitPathOptions): void
  /** Brighten the focused planet's path, dim the rest. */
  setFocused(id: BodyId | null): void
  setVisible(visible: boolean): void
  dispose(): void
}
```

Rendering: one `THREE.LineLoop` per planet using `LineBasicMaterial`, colour taken
from `BODIES[id].color`, `transparent: true`, `depthWrite: false`.
Base opacity `0.22`, focused opacity `0.85`. Add a faint ecliptic-plane reference
grid? **No** — out of scope, keep it to the eight paths.

---

## 7. `src/scene/Starfield.ts` (new, uses `three`)

Replaces the inline `addProceduralStars` + backdrop sphere in `SolarSystem.ts`.

```ts
import * as THREE from 'three'

export interface StarfieldOptions {
  /** Equirectangular Milky Way map, or null to go fully procedural. */
  milkyWay: THREE.Texture | null
  /** Radius of the procedural point cloud. */
  radius: number
}

export class Starfield {
  readonly points: THREE.Points
  constructor(options: StarfieldOptions)
  /** Installs the equirect background + galactic-plane rotation onto the scene. */
  applyTo(scene: THREE.Scene): void
  dispose(): void
}
```

Requirements:

1. **Background at infinity.** Do NOT use a giant textured `SphereGeometry` — it clips
   and forces a huge far plane. Set:
   ```ts
   milkyWay.mapping = THREE.EquirectangularReflectionMapping
   milkyWay.colorSpace = THREE.SRGBColorSpace
   scene.background = milkyWay
   scene.backgroundIntensity = 0.32
   ```
2. **Galactic plane orientation.** The galactic plane is inclined ≈ 60.2° to the
   ecliptic (galactic north pole sits at ecliptic longitude ≈ 180.0°, latitude ≈ +29.8°).
   Orient the backdrop with `scene.backgroundRotation` so the Milky Way band crosses
   the ecliptic at that angle instead of lying flat along it. An approximation to
   within a few degrees is acceptable — comment that it is approximate.
3. **Procedural stars** stay as a `THREE.Points` shell for parallax depth, but the
   radius must come from `options.radius` (the caller passes something derived from
   `systemRadius(mode)`), not a hard-coded 90–210. Vary point size and colour
   temperature slightly; ~6000 points.
4. `scene.fog` must NOT be re-added. Exponential fog washes out the outer planets
   once orbits expand — the integration step removes it.

---

## 8. `src/ui/TimeControls.ts` (new) + styles in `src/style.css`

```ts
import type { SimTimeState } from '../state/simTime'
import type { DistanceMode } from '../scene/scale'

export interface TimeControlsHandlers {
  onPlayToggle: (playing: boolean) => void
  onScaleChange: (secondsPerSecond: number) => void
  onJumpToDate: (unixMs: number) => void
  onJumpToNow: () => void
  onDistanceModeChange: (mode: DistanceMode) => void
  onOrbitLinesToggle: (visible: boolean) => void
  onInclinationExaggerationToggle: (on: boolean) => void
  onTopView: () => void
}

export class TimeControls {
  constructor(container: HTMLElement, handlers: TimeControlsHandlers)
  /** Called every frame — must be cheap; only touch the DOM when text changes. */
  update(state: SimTimeState): void
  setDistanceMode(mode: DistanceMode): void
  dispose(): void
}
```

Layout — a single dock, styled to match the existing glass panels
(`var(--panel)`, `var(--panel-border)`, `var(--radius)`, `var(--shadow)`):

```
┌──────────────────────────────────────────────────────────────┐
│  ▶/⏸   13 Aug 2026 · 14:32 UTC        [ Now ]  [ 📅 date ]   │
│  Speed  (Real)(1 hr/s)[1 day/s](1 wk/s)(1 mo/s)(1 yr/s)      │
│  View   [Compressed|True distance]  ☑Orbits  ☐Tilt×4  ⌖Top   │
└──────────────────────────────────────────────────────────────┘
```

- Speed presets are chips reusing `.body-chip` visual language (own class names).
- Date jump uses `<input type="datetime-local">`; convert to UTC ms on `change`.
- The date readout is a `.mono` element so it doesn't reflow every frame.
- Dock position: top-left area under the topbar. Add to `main.ts` markup as
  `<div class="time-dock" data-time></div>` and place it
  `position:absolute; top:5.5rem; left:1rem; z-index:15;` with
  `pointer-events:none` on the dock and `pointer-events:auto` on the inner card.
- Responsive: collapse to a compact row under `860px`; hide the "View" row under `480px`.
- Full keyboard/ARIA: buttons are real `<button>`, chips carry `aria-pressed`,
  toggles are `<input type="checkbox">` with labels.

---

## 9. `src/scene/SolarSystem.ts` (rewrite of positioning/rotation internals)

### 9.1 Node hierarchy — this is the core fix

For every body, build **three nested objects**:

```
root
└── orbitGroup          position = scene position from ephemeris; orientation = IDENTITY
    └── tiltGroup       fixed quaternion aligning +Y to the body's true spin axis
        ├── spinGroup   rotation.y = spin angle (prime meridian)
        │   ├── globe
        │   └── hotspots…      ← parented here, in LOCAL surface coords
        ├── cloudSpin   rotation.y = spin angle * 1.08   (Earth only)
        │   └── clouds
        ├── atmosphere
        └── rings                 ← Saturn/Uranus: equatorial plane
```

Why: the tilt must live in a frame that does **not** inherit the spin, and the
orbit position must not inherit the tilt. The current code puts obliquity and spin
on one group as Euler Z and Y, which composes as `Ry(spin)·Rz(tilt)` and makes the
pole precess once per rotation. That is the bug behind "rotations look wrong".

`tiltGroup.quaternion` = `setFromUnitVectors(new Vector3(0,1,0), spinAxisScene(poleRa, poleDec))`.
Because `orbitGroup` carries no rotation, the axis stays **fixed in world space** as the
planet orbits — which is exactly what produces seasons. Do not recompute it per frame;
compute once at build time.

### 9.2 Per-frame update

```ts
private updateEphemeris(simMs: number): void
```
For each planet:
1. `pos = planetPositionAU(id, simMs)` (ecliptic AU)
2. `scene = eclipticToScene(pos)`
3. multiply by `orbitScaleFactor(a, mode)`
4. multiply `scene.y` by the current inclination exaggeration
5. `orbitGroup.position.set(...)`

For every body (including the Sun):
6. `spinGroup.rotation.y = degToRad(spinAngleDeg(ROTATIONS[id], simMs))`

The Sun sits at the origin; `sunLight.position` = sun world position.
`updatePlanetVisuals` keeps receiving the Sun's world position.

**Delete** `bodyPosition()`'s fake formula and the `placeBodies()` tilt block entirely.
`bodyPosition(id)` becomes a live world-position read:
```ts
private bodyPosition(id: BodyId): THREE.Vector3   // returns orbitGroup world position (clone)
```

### 9.3 Camera must follow moving bodies

Currently the camera is parked at a static pose. Once planets move it drifts off target.

- Keep a `lastFocusPos: THREE.Vector3`.
- Each frame, after `updateEphemeris`, compute `delta = focusWorldPos − lastFocusPos`
  and add `delta` to BOTH `camera.position` and `controls.target`, then store the new
  position. This preserves whatever manual orbit/zoom the user has applied.
- During a `travelTo` animation, recompute `camTo`/`lookTo` from the LIVE pose each
  frame so the ship leads a moving target instead of arriving where the planet was.
- Add `focusSystem()`: pull back to frame the whole system
  (`camera.position = (0, systemRadius*0.75, systemRadius*1.25)`, target origin).
  Wire it to the TimeControls "Top view" action.

### 9.4 Scene/camera parameter changes

- `camera.far`: 4000 (was 600). `camera.near`: 0.05 (unchanged).
- `controls.maxDistance`: `systemRadius(mode) * 3`.
- **Remove `scene.fog`.** Keep `scene.background` handling in `Starfield`.
- Remove the inline 220-radius star sphere and `addProceduralStars`; use `Starfield`.

### 9.5 Hotspots

`showHotspots(id)` currently computes world positions from the static body position and
adds markers to a top-level `hotspotGroup`. Change it to add markers as children of that
body's `spinGroup` using **local** coordinates:

```
phi   = degToRad(90 − lat)
theta = degToRad(lon + 180)
r     = radius * 1.06
local = (r·sin φ·cos θ, r·cos φ, r·sin φ·sin θ)
```

No quaternion math needed — the parent transform does it. Markers then rotate with the
planet, which is correct. Keep the billboarded ring facing the camera via
`ring.lookAt(cameraWorldPosition)` (three.js `lookAt` handles parented objects).
Raycasting against `hotspotMeshes` continues to work unchanged.

### 9.6 Saturn's rings

`saturn.ts` sets `rings.rotation.x = -Math.PI / 2.12` — a hack that fakes a tilt.
Change it to exactly `-Math.PI / 2` so the ring lies in the body's equatorial plane;
the real 26.73° tilt now comes from `tiltGroup`. Same treatment for Uranus if it has
a ring mesh (it should end up near-perpendicular to the ecliptic — that's correct and
is a great teaching moment).

### 9.7 New public API on `SolarSystem`

```ts
setSimTime(unixMs: number): void
setDistanceMode(mode: DistanceMode): void
setInclinationExaggeration(factor: number): void
setOrbitLinesVisible(visible: boolean): void
focusSystem(): void
getBodyWorldPosition(id: BodyId): THREE.Vector3
```

`tick(dt)` no longer advances rotation itself — it consumes the simulated time that
`main.ts` pushes in via `setSimTime`.

---

## 10. `src/main.ts` wiring

- Own the `SimTimeState`; advance it from the render loop's real delta.
- Add `<div class="time-dock" data-time></div>` to the shell markup.
- Instantiate `TimeControls` and connect every handler.
- Push `solar.setSimTime(state.epochMs)` before each render.
- Extend `window.__COSMIC_ATLAS__` with:
  ```ts
  getSimTime: () => number
  setSimTime: (ms: number) => void
  getBodyPosition: (id: BodyId) => { x: number; y: number; z: number }
  getDistanceMode: () => DistanceMode
  ```
  so the Playwright launch check can assert real positions.
- `structure.test.ts` greps `main.ts` for `panel.update('earth')` and
  `focusImmediate('earth')` and asserts no `TODO` — those must survive.

---

## 11. Tests (vitest, node env)

`src/scene/orbitalMechanics.test.ts`
- `solveKepler(M, 0) === M`; for `e = 0.9`, residual `|E − e·sin E − M| < 1e-10`.
- Earth's heliocentric distance stays within `0.980…1.020` AU over 400 sampled dates
  spanning 1900–2100.
- Per-planet perihelion/aphelion bounds hold: `a(1−e) − 0.01 ≤ r ≤ a(1+e) + 0.01`.
- At J2000 exactly, Earth's heliocentric ecliptic longitude is within 2° of 100.0°.
- Advancing by `orbitalPeriodDays(a)` returns a planet to within 2° of its heliocentric
  longitude (use frozen elements, i.e. the same `T`, to isolate the Kepler solve).
- **The anti-regression test:** at 2026-08-13T00:00:00Z the eight heliocentric ecliptic
  longitudes are mutually distinct — assert that the minimum pairwise separation is
  greater than 1° and that the set is not monotonic in orbital order. This is what
  proves the planets are no longer strung out on a line.
- `eclipticToScene` is right-handed: `eclipticToScene({x:1,y:0,z:0})` → `(1,0,0)`,
  `{x:0,y:1,z:0}` → `(0,0,-1)`, `{x:0,y:0,z:1}` → `(0,1,0)`.
- `spinAxisScene(0, 90)` (Earth's pole) has a scene-Y component of
  `cos(23.4392911°) ≈ 0.9175` and a scene-Z component of `−sin(23.4392911°) ≈ −0.3977`.
- `spinAngleDeg` increases with time for Earth and **decreases** for Venus and Uranus.

`src/state/simTime.test.ts`
- `advanceSimTime` is a no-op when `playing: false`.
- 1 real second at the `day` preset advances exactly 86 400 000 ms.
- Every function returns a new object and leaves the input untouched.

`src/scene/scale.test.ts`
- Compressed factors reproduce the table in §4 to within 0.1 scene units.
- `true` mode returns `TRUE_UNITS_PER_AU` for every body.
- `systemRadius('true') > systemRadius('compressed')`.

---

## 12. Definition of done

1. `npx tsc --noEmit` clean.
2. `npm test` green, including the new suites.
3. `npm run build` succeeds.
4. In the browser: planets sit at scattered, physically-correct heliocentric longitudes
   — visibly NOT in a line — on slightly inclined, slightly eccentric orbits, with
   drawn orbit paths.
5. Pressing play makes inner planets sweep visibly faster than outer ones, with the
   correct period ratios.
6. Uranus rolls on its side about a *fixed* axis; Venus and Uranus spin backwards.
7. Saturn's rings stay in its equatorial plane, tilted ~26.7° and fixed in space as it
   orbits.
8. The camera stays locked on whichever body is focused while that body moves.
9. The Milky Way band is visible and crosses the ecliptic at a steep angle.
