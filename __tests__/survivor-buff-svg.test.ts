import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buffColorsForTribe, buffSvg, shadeHex } from '@/lib/survivor/buffSvg'
import catalog from '@/lib/survivor/tribeCatalog.json'

const asset = (name: string) => readFileSync(path.join(process.cwd(), 'public/survivor/late', name), 'utf8')

describe('buffSvg (port of gen_late.py buff)', () => {
  it('matches the shipped package SVG byte-for-byte for sample tribes', () => {
    expect(buffSvg('#e2563b', '#f2b33d', 'bfka')).toBe(asset('buff-kaniva.svg'))
    expect(buffSvg('#8b7be0', '#f2c94c', 'bfve')).toBe(asset('buff-vela.svg'))
    expect(buffSvg('#d9b45a', '#1b2a4a', 'bfme')).toBe(asset('buff-merge.svg'))
  })

  it('prefixes every gradient and clip id with the uid so buffs can share a page', () => {
    const svg = buffSvg('#3fa7b5', '#e8eef2', 'tribeA')
    const ids = [...svg.matchAll(/id="([^"]+)"/g)].map((m) => m[1])
    expect(ids.length).toBe(3)
    expect(ids.every((id) => id.startsWith('tribeA-'))).toBe(true)
    expect(svg).not.toMatch(/url\(#(?!tribeA-)/)
  })

  it('refuses markup in colours and ids', () => {
    const svg = buffSvg('"/><script>', '#fff"', 'x1')
    expect(svg).not.toContain('<script>')
    expect(() => buffSvg('#000000', '#ffffff', '"><x')).toThrow()
  })

  it('shades like the python helper (truncating)', () => {
    expect(shadeHex('#e2563b', -0.45)).toBe('#7c2f20')
    expect(shadeHex('#e2563b', 0.25)).toBe('#e9806c')
  })

  it('takes the secondary colour from the tribe catalogue', () => {
    expect(buffColorsForTribe({ name: 'Koa', colorHex: '#3fa7b5' }, catalog)).toEqual({ primary: '#3fa7b5', secondary: '#e8eef2' })
    expect(buffColorsForTribe({ name: 'Unknown', colorHex: null }, catalog).secondary).toBe('#f2c94c')
  })
})
