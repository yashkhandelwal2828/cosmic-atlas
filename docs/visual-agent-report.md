# Visual validation report (orchestrator + agents)

## Herdr agents

| Agent | Role | Status |
|-------|------|--------|
| `assets` (wB:p5) | Validate real SSS raw8k pack | **Pass** — wrote `docs/assets-agent-note.md`; confirmed real JPEGs/TIFFs/PNG from solarsystemscope.com |
| `visual` (wB:p6) | Day/night + labels review | Prompted; implementation done in-process by orchestrator (multi-line herdr prompts failed; short prompts OK) |

## Checklist

| Item | Status |
|------|--------|
| Real 8K (or max published) SSS maps in `raw8k/` | Pass |
| Shipped WebP from real sources (4K ship) | Pass (~19 MB primary set) |
| Earth day + night maps + N·L blend shader | Pass (`earthMaterial.ts`) |
| Earth normal + specular (real SSS TIFFs) | Pass |
| Mars normal (derived from real 8K albedo gradients) | Pass — documented, not painted solid |
| Saturn ring real alpha PNG | Pass |
| Planet name tags (cute pills) for all bodies | Pass (CSS2D) |
| Hotspots still work | Pass |
| `npm test` / `npm run build` | Pass |

## Honesty notes

- Uranus/Neptune: SSS only publishes **2K** — we ship those real maps, not fake upscaled fiction.
- Mars normal: no dedicated SSS Mars normal; **sobel normals from real 8K albedo** (standard photogrammetry-style approach).
- Credit: Solar System Scope CC BY 4.0.
