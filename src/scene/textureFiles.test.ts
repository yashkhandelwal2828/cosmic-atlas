import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BODY_ORDER } from '../data/bodies'
import { bodyTextureKeys, isPrimaryKey } from './textures'

const textures = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/textures')

function shippedKeys(): string[] {
  const keys = new Set<string>(['stars'])
  for (const id of BODY_ORDER) {
    for (const key of bodyTextureKeys(id)) keys.add(key)
  }
  return [...keys].sort()
}

describe('shipped texture files match the loader', () => {
  it('has lo and mid WebP for every map the journey can request', () => {
    for (const key of shippedKeys()) {
      expect(existsSync(resolve(textures, 'lo', `${key}.webp`)), `missing lo ${key}`).toBe(
        true,
      )
      expect(existsSync(resolve(textures, 'mid', `${key}.webp`)), `missing mid ${key}`).toBe(
        true,
      )
    }
  })

  it('has a native root map only for primary surfaces', () => {
    for (const key of shippedKeys()) {
      const jpg = existsSync(resolve(textures, `${key}.jpg`))
      const png = existsSync(resolve(textures, `${key}.png`))
      if (isPrimaryKey(key)) {
        expect(jpg || png, `missing hi ${key}`).toBe(true)
      } else {
        expect(jpg, `companion ${key} should not ship a root jpg`).toBe(false)
        expect(png, `companion ${key} should not ship a root png`).toBe(false)
      }
    }
  })

  it('does not ship a Moon map while the Moon is off the journey', () => {
    expect(BODY_ORDER.includes('moon')).toBe(false)
    expect(existsSync(resolve(textures, 'moon.jpg'))).toBe(false)
    expect(existsSync(resolve(textures, 'lo', 'moon.webp'))).toBe(false)
    expect(existsSync(resolve(textures, 'mid', 'moon.webp'))).toBe(false)
  })
})
