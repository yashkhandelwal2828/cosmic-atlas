# Cosmic Atlas — architecture

## Goal

Production-ready interactive solar-system education site: Earth-first camera, travel to Sun + eight planets, learning panel + hotspots. Inspiration patterns from anatomy / empire 3D explorers (asset optimization, on-demand loads, inspect-to-learn) without cloning their content.

## File tree

```
index.html
public/textures/          # native maps, up to 8192x4096 ("hi")
  lo/                     # <=2048 WebP — what the intro and phones run on
  mid/                    # <=4096 WebP — the steady state on most laptops
scripts/
  build-texture-tiers.mjs # regenerates lo/ and mid/ from the native set
src/
  main.ts                 # boot, wire travel ↔ scene ↔ UI
  style.css
  data/
    bodies.ts             # catalog + educational content
    content.ts            # lookup helpers
    *.test.ts
  state/
    travel.ts             # pure focus/travel FSM
    travel.test.ts
  scene/
    SolarSystem.ts        # Three.js scene controller
    cameraArc.ts          # pure travel arc: swoop out, then back in
    textures.ts           # cache, paths, procedural rings
  intro/
    IntroSequence.ts      # conductor: owns the clock, drives everything below
    timeline.ts           # pure phase table + easing
    launchPath.ts         # pure flight trajectories
    quality.ts            # pure tier selection + frame watchdog
    Singularity.ts        # horizon, photon ring, accretion disk, infall motes
    Shockwave.ts          # flare, blast shell, GPU ejecta
    Trails.ts             # per-body light streaks
    IntroOverlay.ts       # skip button, chrome gating, shouldPlayIntro
    postfx/
      Pipeline.ts         # EffectComposer, intro -> explore demotion
      shaders.ts          # lens, radial blur, film
  ui/
    LearningPanel.ts
    BodySelector.ts
```

## Moon: disabled (2026-08-15)

The Moon is commented out of `BODY_ORDER`, which is the single switch for what
the app builds — scene graph, labels, journey rail, and the intro's launch list
all iterate it. Nothing was deleted: `BODIES.moon`, its educational content,
texture entry, `MOON_ORBIT` elements, `moonPositionAU`, and the earthshine
material in `planets/moon.ts` are all intact and still unit-tested.

Re-enabling is one line in `bodies.ts` plus the call sites marked
`MOON DISABLED` in `SolarSystem.ts`, `OrbitPaths.ts`, `IntroSequence.ts`,
`main.ts`, and `scripts/intro-check.mjs`.

Note `isValidBodyId` derives from `BODY_ORDER`, so it answers "can the user
travel here" — currently `false` for the Moon, while `getEducationalContent`
(which reads `BODIES`) still returns its content.

## Intro sequence

A 7.5s black-hole detonation plays on load and places every body at its true
ephemeris position. It replaces the loading card: the render loop starts on the
first frame and textures stream underneath it.

Everything is a function of one number, `IntroSequence.t`, read through
`timeline.ts`. Three integration points on `SolarSystem`, all null in steady
state:

- `setBodyTransformOverride` — called per body per frame with that body's TRUE
  ephemeris position, pre-loaded as the default answer. `launchPositionAt`
  returns the target exactly at t=1, so releasing the override is a no-op rather
  than a snap. Verified numerically by `scripts/intro-check.mjs`.
- `setCameraDriver` — suspends focus-following, GSAP travel, and OrbitControls
  damping so nothing fights the choreography.
- `setRenderOverride` — routes drawing through the composer. Bloom stays on
  permanently after handoff; the lens, radial-blur, and film passes are disposed.

The clock **holds** at the detonation until first-wave textures resolve (ceiling
`LAUNCH_GATE_MAX_WAIT`), so planets are not born wearing fallback materials.

`?intro=0` bypasses it, as does `prefers-reduced-motion`.

## Texture resolution tiering

Because the intro is the loading screen, whatever boot asks for is decoded and
uploaded *while the cinematic plays*. The native maps are up to 8192x4096 —
134 MB of decoded RGBA each, a synchronous `texImage2D` and a
`glGenerateMipmap` — and nine of them used to land across the detonation. On a
MacBook Air that measured as a **2.4-second frozen frame**.

So every map enters at `lo` (2048) and resolution is raised afterwards:

- `scene/textureTier.ts` — pure policy. `selectTextureCeiling` picks lo/mid/hi
  from `maxTextureSize`, `deviceMemory`, core count, pointer coarseness and Data
  Saver. Surface maps get the ceiling; cloud/normal/specular/ring maps are held
  one tier lower by `companionCeiling`.
- `scene/TextureUpgrader.ts` — drains an upgrade queue one map per idle slot, so
  at most one upload happens per frame. `boost()` jumps a travel target ahead.
- `TextureCache.upgrade` mutates the existing `THREE.Texture` in place, so no
  material has to be rebound; `scheduleUpload` chains uploads through
  `requestAnimationFrame` so an arriving map never piles onto a busy frame.

Only what is on screen is ever raised — the sky, the Sun and the focused body.
Nine planets at 8K would be over a gigabyte of texture memory for eight things
nobody is pointed at.

Decode runs off the main thread via `ImageBitmapLoader`. That path bakes the
vertical flip in at decode (`imageOrientation: 'flipY'`, `texture.flipY = false`)
rather than trusting `UNPACK_FLIP_Y_WEBGL`, whose ImageBitmap behaviour has
differed between browsers — and `bitmapFlipIsHonoured()` proves the option works
here before using it, because the failure mode is silent upside-down planets.

Regenerate the derived tiers with `npm run build:textures` (needs ImageMagick).

### Verification

`npm run check:intro` drives the real build: shoots each phase on the sequence's
own clock via `seekIntro`, then asserts that after both a natural finish and a
mid-flight skip every body sits exactly where an `?intro=0` load puts it.

## Pure state

`TravelState`: `focusedBodyId`, `targetBodyId`, `previousBodyId`, `isTraveling`, `travelProgress`.

- Initial: Earth focused, not traveling
- `startTravel` → animating toward target
- `updateTravelProgress` / `completeTravel` → focused on target

Scene and UI **consume** this state; they do not own educational truth.

## Content schema

Each body: name, tagline, facts[], overview, composition, notableFeatures[], hotspots[{id,label,description,lat,lon}], textureKey, displayRadius, orbitDistance, optional rings/atmosphere.

## Rendering

- SphereGeometry + MeshStandardMaterial (MeshBasic for Sun)
- TextureCache prefers `.webp`, falls back to `.jpg`
- Critical load: stars, sun, earth, clouds → first paint
- Remaining planets lazy after paint
- Saturn rings: procedural canvas texture with alpha bands
- Camera travel: GSAP `power2.inOut` ~1.6s along a `sin(πt)` arc that lifts
  up and out, then back in. Destination pose is re-read live each frame.
  Look-at uses a shallower bow and stays outside the Sun so hops across the
  system frame the void, not the photosphere.

## UI

- Journey rail (bottom): select body → `requestTravel`
- Learning panel (right): mission brief bound to active body
- Hotspot chips + 3D markers share the same hotspot records
