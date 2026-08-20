# Contributing to Cosmic Atlas

## Setup

Node 20+ and npm. A browser with WebGL is required to run the scene.

```bash
npm install
npm run dev
npm test
```

Optional visual checks (need Chromium via Playwright):

```bash
npx playwright install chromium
npm run check:intro
npm run check:launch
```

Regenerating `lo/` and `mid/` texture tiers from native maps needs ImageMagick:

```bash
brew install imagemagick
npm run build:textures
```

Companion maps (clouds, normals, specular, Venus haze, Saturn rings) ship only as `lo/` and `mid/` WebP. Native 8K albedo / night / star maps sit at `public/textures/<name>.jpg`. Source archives (`raw8k/`, `full8k/`, …) stay gitignored and are not required to run the app.

## Scope

Please keep the existing HUD, motion, and visual treatment. Fixes, tests, docs, and performance work are welcome. Please open an issue before a large feature or a Moon re-enable (the body is catalogued but out of `BODY_ORDER` on purpose).

Planetary maps remain [CC BY 4.0](licenses/CC-BY-4.0.txt) Solar System Scope. Do not replace them with assets that cannot be redistributed. GSAP stays under its Standard license — see [`licenses/NOTICE.md`](licenses/NOTICE.md).
