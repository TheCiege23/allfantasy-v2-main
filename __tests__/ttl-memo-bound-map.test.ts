import { describe, expect, it } from 'vitest'

import { boundMap } from '@/lib/ttl-memo'

const expired = (v: { expired: boolean }) => v.expired

describe('boundMap', () => {
  it('leaves a map under its cap untouched, expired entries included', () => {
    const map = new Map([['a', { expired: true }], ['b', { expired: false }]])
    boundMap(map, expired, 3)
    expect([...map.keys()]).toEqual(['a', 'b'])
  })

  it('at the cap, drops expired entries first and keeps live ones', () => {
    const map = new Map<string, { expired: boolean }>()
    for (let i = 0; i < 10; i++) map.set(`k${i}`, { expired: i % 2 === 0 })
    boundMap(map, expired, 10)
    expect([...map.keys()]).toEqual(['k1', 'k3', 'k5', 'k7', 'k9'])
  })

  it('at the cap with nothing expired, drops the oldest down to 90%', () => {
    const map = new Map<string, { expired: boolean }>()
    for (let i = 0; i < 10; i++) map.set(`k${i}`, { expired: false })
    boundMap(map, expired, 10)
    expect(map.size).toBe(9)
    expect(map.has('k0')).toBe(false)
    expect(map.has('k9')).toBe(true)
  })

  it('keeps a map written in a loop at or below its cap', () => {
    const map = new Map<string, { expired: boolean }>()
    for (let i = 0; i < 5000; i++) {
      boundMap(map, expired, 100)
      map.set(`k${i}`, { expired: false })
    }
    expect(map.size).toBeLessThanOrEqual(100)
    expect(map.has('k4999')).toBe(true)
  })
})
