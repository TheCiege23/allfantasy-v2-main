import { afterEach, describe, expect, it, vi } from 'vitest'

const { upsert, findUnique } = vi.hoisted(() => ({
  upsert: vi.fn(async () => ({})),
  findUnique: vi.fn(async () => null as unknown),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsDataCache: { upsert, findUnique } } }))

import {
  __resetCfbdQuotaForTests,
  backgroundReserve,
  cfbdBackgroundAllowed,
  decideBackground,
  noteCfbdResponse,
  parseRemaining,
  readCfbdQuota,
} from '@/lib/cfbd-quota'

const headers = (remaining?: string) => new Headers(remaining == null ? {} : { 'x-calllimit-remaining': remaining })
const NOV = new Date('2026-11-21T12:00:00Z')

afterEach(() => {
  __resetCfbdQuotaForTests()
  upsert.mockClear()
  findUnique.mockReset()
  findUnique.mockResolvedValue(null)
  vi.restoreAllMocks()
})

describe('decideBackground', () => {
  it('lets background jobs run above the reserve and stops them at or below it', () => {
    const at = (remaining: number) => decideBackground({ reading: { remaining, observedAt: NOV.toISOString() }, reserve: 15_000, now: NOV })
    expect(at(40_000).allowed).toBe(true)
    expect(at(15_001).allowed).toBe(true)
    expect(at(15_000).allowed).toBe(false)
    expect(at(0)).toMatchObject({ allowed: false, remaining: 0 })
    expect(at(0).reason).toContain('kept for stats and scores')
  })

  it('fails open on an unknown quota', () => {
    expect(decideBackground({ reading: null, reserve: 15_000, now: NOV })).toEqual({ allowed: true, remaining: null, reason: null })
  })

  it('a wall from last month is not a wall this month', () => {
    const october = { remaining: 0, observedAt: '2026-10-31T23:59:00Z' }
    expect(decideBackground({ reading: october, reserve: 15_000, now: NOV }).allowed).toBe(true)
  })
})

describe('parseRemaining', () => {
  it('never turns a missing header into 0', () => {
    expect(parseRemaining(headers())).toBeNull()
    expect(parseRemaining(headers('abc'))).toBeNull()
    expect(parseRemaining(headers('57567'))).toBe(57567)
  })
})

describe('noteCfbdResponse', () => {
  it('records the header, and a 429 without one as an exhausted month', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    noteCfbdResponse({ status: 200, headers: headers('40000') }, NOV)
    expect(await readCfbdQuota(NOV)).toEqual({ remaining: 40_000, observedAt: NOV.toISOString() })

    __resetCfbdQuotaForTests()
    noteCfbdResponse({ status: 429, headers: headers() }, NOV)
    expect((await readCfbdQuota(NOV))?.remaining).toBe(0)
  })

  it('never throws on a response without headers (test doubles, odd fetch shims)', () => {
    expect(() => noteCfbdResponse({ status: 200 } as never, NOV)).not.toThrow()
    expect(() => noteCfbdResponse(undefined as never, NOV)).not.toThrow()
  })

  it('warns once when the quota crosses a line, and writes the shared row then', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    noteCfbdResponse({ status: 200, headers: headers('20000') }, NOV)
    noteCfbdResponse({ status: 200, headers: headers('14000') }, new Date(NOV.getTime() + 1000))
    noteCfbdResponse({ status: 200, headers: headers('13999') }, new Date(NOV.getTime() + 2000))
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toContain('14000 calls left')
    // First reading persists, the crossing persists immediately, the third waits for the minute.
    expect(upsert).toHaveBeenCalledTimes(2)
  })
})

describe('cfbdBackgroundAllowed', () => {
  it('reads the shared row another replica wrote', async () => {
    findUnique.mockResolvedValue({ data: { remaining: 900, observedAt: new Date().toISOString() } })
    const r = await cfbdBackgroundAllowed()
    expect(r).toMatchObject({ allowed: false, remaining: 900 })
  })

  it('fails open when the shared row cannot be read', async () => {
    findUnique.mockRejectedValue(new Error('db down'))
    expect((await cfbdBackgroundAllowed()).allowed).toBe(true)
  })

  it('takes the reserve from CFBD_BACKGROUND_RESERVE when set', () => {
    expect(backgroundReserve({ CFBD_BACKGROUND_RESERVE: '5000' })).toBe(5000)
    expect(backgroundReserve({})).toBe(15_000)
    expect(backgroundReserve({ CFBD_BACKGROUND_RESERVE: 'nope' })).toBe(15_000)
  })
})
