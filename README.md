# Cosmic Atlas

Interactive **3D solar-system education** site built with **Vite + TypeScript + Three.js**.

Start at **Earth**, travel to the **Sun** and every major planet (**Mercury → Neptune**), and learn through researched facts and **clickable hotspots** — the same “inspect to learn” pattern as anatomy / empire explorer inspirations, applied to space.

## Quick start

```bash
npm install
npm run dev
```

Open the local URL Vite prints (typically `http://localhost:5173`).  
Use a local static server (do not open `index.html` via `file://` — ES modules will fail).

```bash
npm test          # pure unit tests (catalog, travel, content)
npm run build     # production build → dist/
npm run preview   # serve dist/
```

## What you get

| Feature | Detail |
|--------|--------|
| Bodies | Sun + Mercury, Venus, Earth, Mars, Jupiter, Saturn (rings), Uranus, Neptune |
| Start | Camera + learning panel focused on **Earth** |
| Travel | Journey rail animates the camera to the selected body |
| Learning | Mission brief panel: overview, key facts, composition, features |
| Hotspots | 3–4 markers per body; click in 3D or in the panel |
| Assets | **HD WebP** maps (Earth from 8K source → 4K web; others high-quality 2K + unsharp); Earth normal/specular/clouds PBR stack; fresnel atmospheres; galaxy starfield; ~6–7 MB critical textures |

## Architecture

- **`src/data/`** — pure body catalog + educational content (no DOM / WebGL)
- **`src/state/travel.ts`** — pure focus / travel state machine
- **`src/scene/`** — Three.js scene, textures, camera travel
- **`src/ui/`** — learning panel + journey selector

Unit tests import the pure modules directly (no re-implemented oracles).

## Credits

- Planetary textures: [Solar System Scope](https://www.solarsystemscope.com/textures/) (CC BY 4.0)
- Rendering: [three.js](https://threejs.org/)

## Inspiration

Interaction + production-asset patterns from educational 3D explorers (anatomy / historical atlas style): polished UI, on-demand assets, hotspot learning — not a content clone of those projects.
