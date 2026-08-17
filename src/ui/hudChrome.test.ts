import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../style.css'),
  'utf8',
)

describe('HUD glass and brief stagger tokens', () => {
  it('gives panels a 12px frost and a 1px white hairline', () => {
    expect(css).toMatch(/--panel-blur:\s*blur\(12px\)/)
    expect(css).toMatch(/--panel-border:\s*rgba\(\s*255,\s*255,\s*255,\s*0\.1\s*\)/)
    expect(css).toMatch(/backdrop-filter:\s*var\(--panel-blur\)/)
    expect(css).toMatch(/-webkit-backdrop-filter:\s*var\(--panel-blur\)/)
  })

  it('staggers incoming brief groups 50ms apart', () => {
    expect(css).toMatch(/\[data-stagger="title"\][\s\S]*animation-delay:\s*0ms/)
    expect(css).toMatch(/\[data-stagger="stats"\][\s\S]*animation-delay:\s*50ms/)
    expect(css).toMatch(/\[data-stagger="description"\][\s\S]*animation-delay:\s*100ms/)
  })
})
