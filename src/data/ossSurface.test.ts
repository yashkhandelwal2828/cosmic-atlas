/**
 * Open-source surface: public docs, license grant, third-party notices,
 * and a product-only tree. Reads the shipped files — no reimplemented oracles.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

function exists(rel: string): boolean {
  return existsSync(resolve(root, rel))
}

describe('stranger-facing README', () => {
  const readme = read('README.md')
  const pkg = JSON.parse(read('package.json')) as {
    scripts: Record<string, string>
    license?: string
  }

  it('leads with a one-sentence hook and the Sylva-style sections', () => {
    expect(readme.startsWith('# Cosmic Atlas\n')).toBe(true)
    const firstParagraph = readme.split('\n').find((line) => /^Cosmic Atlas is /.test(line))
    expect(firstParagraph).toBeDefined()
    expect(firstParagraph!.length).toBeGreaterThan(40)
    expect(readme).toMatch(/^## What is inside$/m)
    expect(readme).toMatch(/^## How it is made$/m)
    expect(readme).toMatch(/^## Run locally$/m)
    expect(readme).toMatch(/^## Project structure$/m)
    expect(readme).toMatch(/^## Design and attribution$/m)
    expect(readme).toMatch(/^## Contributing$/m)
  })

  it('shows an in-repo preview image that actually exists', () => {
    const match = readme.match(/!\[[^\]]*]\(([^)]+)\)/)
    expect(match, 'README must embed a preview image').toBeTruthy()
    const rel = match![1]
    expect(rel).not.toMatch(/^https?:/)
    expect(exists(rel)).toBe(true)
    const bytes = readFileSync(resolve(root, rel))
    expect(bytes.byteLength).toBeGreaterThan(20_000)
    expect(bytes.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  })

  it('documents the real package.json commands', () => {
    expect(readme).toMatch(/npm install/)
    for (const name of ['dev', 'test', 'build', 'preview'] as const) {
      expect(pkg.scripts[name], `package.json missing script ${name}`).toBeTruthy()
      expect(readme).toContain(`npm ${name === 'test' ? 'test' : `run ${name}`}`)
    }
  })

  it('does not invent a hosted demo URL', () => {
    expect(readme).not.toMatch(/https?:\/\/[^\s)]+\.(vercel\.app|github\.io)/)
  })

  it('points strangers at contributing and security docs', () => {
    expect(readme).toMatch(/CONTRIBUTING\.md/)
    expect(readme).toMatch(/SECURITY\.md/)
    expect(exists('CONTRIBUTING.md')).toBe(true)
    expect(exists('SECURITY.md')).toBe(true)
    expect(exists('CODE_OF_CONDUCT.md')).toBe(true)
    expect(exists('.github/workflows/ci.yml')).toBe(true)
  })
})

describe('license grant and third-party notices', () => {
  it('grants MIT for this project’s own code', () => {
    const license = read('LICENSE')
    expect(license).toMatch(/MIT License/)
    expect(license).toMatch(/Permission is hereby granted, free of charge/)
    expect(license).toMatch(/Yash Khandelwal/)
    const pkg = JSON.parse(read('package.json')) as { license?: string }
    expect(pkg.license).toBe('MIT')
  })

  it('keeps Solar System Scope, Three.js, and GSAP under their own terms', () => {
    const notice = read('licenses/NOTICE.md')
    expect(notice).toMatch(/does \*\*not\*\*\s+relicense/i)
    expect(notice).toMatch(/Solar System Scope/)
    expect(notice).toMatch(/CC BY 4\.0|Creative Commons Attribution 4\.0/)
    expect(notice).toMatch(/three\.js/i)
    expect(notice).toMatch(/GSAP/)

    const cc = read('licenses/CC-BY-4.0.txt')
    expect(cc).toMatch(/Creative Commons Attribution 4\.0 International Public License/)

    const three = read('licenses/THREE-LICENSE.txt')
    expect(three).toMatch(/MIT License/i)
    expect(three).toMatch(/three\.js authors/)

    const gsap = read('licenses/GSAP-STANDARD-LICENSE.txt')
    expect(gsap).toMatch(/GSAP License/)
    expect(gsap).toMatch(/https:\/\/gsap\.com\/standard-license/)
    expect(gsap).not.toMatch(/Permission is hereby granted, free of charge/)

    const project = read('LICENSE')
    expect(project).not.toMatch(/Solar System Scope/)
    expect(project).not.toMatch(/relicense/)
  })

  it('names the license in public docs and in the shipped credits footer', () => {
    const readme = read('README.md')
    expect(readme).toMatch(/MIT License/)
    expect(readme).toMatch(/CC BY 4\.0/)
    expect(readme).toMatch(/licenses\//)
    const main = read('src/main.ts')
    expect(main).toMatch(/Solar System Scope \(CC BY 4\.0\)/)
    expect(main).toMatch(/Three\.js/)
  })
})

describe('product-only public tree', () => {
  const privatePaths = [
    'jobs.html',
    'docs/assets-agent-note.md',
    'docs/visual-agent-report.md',
    'src/counter.ts',
    'src/assets/hero.png',
    'src/assets/typescript.svg',
    'src/assets/vite.svg',
    'public/icons.svg',
    'public/textures/raw8k/cookies.txt',
  ]

  it('does not ship the job board, agent notes, unused Vite scaffold, or cookies', () => {
    for (const rel of privatePaths) {
      expect(exists(rel), `${rel} must not be in the working tree`).toBe(false)
    }
  })

  it('gitignore keeps cookie and raw texture archives out of the public surface', () => {
    const ignore = read('.gitignore')
    expect(ignore).toMatch(/^cookies\.txt$/m)
    expect(ignore).toMatch(/public\/textures\/raw8k\//)
    expect(ignore).toMatch(/^docs\/artifacts\/$/m)
    expect(statSync(resolve(root, '.gitignore')).isFile()).toBe(true)
  })

  it('strips local texture archives from the Vite dist copy', () => {
    const vite = read('vite.config.ts')
    expect(vite).toMatch(/omit-texture-archives/)
    expect(vite).toMatch(/raw8k/)
  })
})
