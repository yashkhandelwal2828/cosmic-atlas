# Cosmic Atlas texture manifest

**Source:** [Solar System Scope](https://www.solarsystemscope.com/textures/) (CC BY 4.0)

Three tiers ship. The loader always boots on `lo`, then `upgrade()` raises maps toward the device ceiling.

| Tier | Layout | Longest edge | Used for |
|------|--------|--------------|----------|
| `lo` | `lo/<key>.webp` | ≤ 2048 px | Intro + phones |
| `mid` | `mid/<key>.webp` | ≤ 4096 px | Most laptops; all companion maps (clouds, normals, rings, haze) |
| `hi` | `<stem>.jpg` at this folder’s root | native (up to 8192) | Albedo, Earth night, starfield on capable desktops |

Companion maps do **not** have a native root file. They cap at `mid` by design (`companionCeiling` in `src/scene/textureTier.ts`).

The Moon is catalogued in code but not in `BODY_ORDER`, so no Moon map ships.

Source archives (`raw8k/`, `full8k/`, `hd8k/`, `hd/`, `raw/`) are gitignored. Re-download from Solar System Scope if you need to regenerate tiers (`npm run build:textures`).
