# Cosmic Atlas — architecture

## Goal

Production-ready interactive solar-system education site: Earth-first camera, travel to Sun + eight planets, learning panel + hotspots. Inspiration patterns from anatomy / empire 3D explorers (asset optimization, on-demand loads, inspect-to-learn) without cloning their content.

## File tree

```
index.html
public/textures/          # WebP (+ JPG fallback) planetary maps
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
- `setCameraDriver` — suspends focus-following, travel lerp, and OrbitControls
  damping so nothing fights the choreography.
- `setRenderOverride` — routes drawing through the composer. Bloom stays on
  permanently after handoff; the lens, radial-blur, and film passes are disposed.

The clock **holds** at the detonation until first-wave textures resolve (ceiling
`LAUNCH_GATE_MAX_WAIT`), so planets are not born wearing fallback materials.

`?intro=0` bypasses it, as does `prefers-reduced-motion`.

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
- Camera travel: smoothstep lerp ~1.6s between poses

## UI

- Journey rail (bottom): select body → `requestTravel`
- Learning panel (right): mission brief bound to active body
- Hotspot chips + 3D markers share the same hotspot records
