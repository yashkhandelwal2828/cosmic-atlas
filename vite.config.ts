import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'vite'

/**
 * Local checkouts may still hold Solar System Scope source archives under
 * public/textures/. Vite copies public/ into dist/ wholesale, so a production
 * build would otherwise ship hundreds of MB that the loader never requests.
 * GitHub deploys never see those dirs (.gitignore); this covers the local path.
 */
const TEXTURE_ARCHIVES = ['full8k', 'raw8k', 'hd8k', 'hd', 'raw'] as const

export default defineConfig({
  plugins: [
    {
      name: 'omit-texture-archives',
      closeBundle() {
        for (const dir of TEXTURE_ARCHIVES) {
          rmSync(join('dist', 'textures', dir), { recursive: true, force: true })
        }
      },
    },
  ],
})
