# Cosmic Atlas texture manifest — FULL native resolution

**Source:** [Solar System Scope](https://www.solarsystemscope.com/textures/) (CC BY 4.0)  
**Raw archive:** `public/textures/raw8k/`  
**Loader order:** `.jpg` → `.png` → `.webp` (full-res JPG preferred)

| Body / map | Source file | Native pixels | Ship |
|------------|-------------|---------------|------|
| Sun | `8k_sun.jpg` | **4096×2048** (SSS “8k” pack max for sun) | full |
| Mercury | `8k_mercury.jpg` | **8192×4096** | full 8K |
| Venus surface | `8k_venus_surface.jpg` | **8192×4096** | full 8K |
| Venus atmosphere | `4k_venus_atmosphere.jpg` | **4096×2048** | full |
| Earth day | `8k_earth_daymap.jpg` | **8192×4096** | full 8K |
| Earth night | `8k_earth_nightmap.jpg` | **8192×4096** | full 8K |
| Earth clouds | `8k_earth_clouds.jpg` | **8192×4096** | full 8K |
| Earth normal | `8k_earth_normal_map.tif` | **8192×4096** | full 8K |
| Earth specular | `8k_earth_specular_map.tif` | **8192×4096** | full 8K |
| Mars | `8k_mars.jpg` | **8192×4096** | full 8K |
| Mars normal | derived from 8K mars | **8192×4096** | full 8K |
| Jupiter | `8k_jupiter.jpg` | **4096×2048** (SSS max under that name) | full |
| Saturn | `8k_saturn.jpg` | **4096×2048** | full |
| Saturn rings | `8k_saturn_ring_alpha.png` | **8192×500** | full |
| Stars | `8k_stars_milky_way.jpg` | **8192×4096** | full 8K |
| Uranus | `2k_uranus.jpg` | **2048×1024** (SSS only publishes 2K) | full available |
| Neptune | `2k_neptune.jpg` | **2048×1024** | full available |

**Note:** SSS labels some maps “8k” but ships them at 4K for sun/jupiter/saturn. Where true 8192 exists, we ship 8192 — **no downscale**.

Hard-refresh the browser (Cmd+Shift+R) after pulling so the GPU reloads textures.
