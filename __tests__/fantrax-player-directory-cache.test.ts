// @vitest-environment node
/**
 * Fantrax player directories are reused between imports instead of downloaded six at a time on
 * every one. These pin what is shared, for how long, and what must never be kept.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ players: vi.fn() }))
vi.mock('@/lib/league-import/fantrax/fantraxApi', async (original) => ({
  ...await original<object>(),
  getFantraxPlayerIds: h.players,
}))

import {
  clearFantraxPlayerDirectoryCache,
  getCachedFantraxPlayerIds,
} from '@/lib/league-import/fantrax/fantraxPlayerDirectoryCache'

const directory = (name: string) => ({ ok: true as const, data: { p1: { fantraxId: 'p1', name, team: 'KC', position: 'WR' } } })
const HOUR = 60 * 60 * 1000

beforeEach(() => {
  vi.resetAllMocks()
  clearFantraxPlayerDirectoryCache()
})

describe('a directory is fetched once and shared', () => {
  it('serves the second ask from the first answer', async () => {
    h.players.mockResolvedValue(directory('One, Player'))
    const first = await getCachedFantraxPlayerIds('NFL', { ttlMs: HOUR })
    const second = await getCachedFantraxPlayerIds('NFL', { ttlMs: HOUR })
    expect(h.players).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
  })

  it('keeps each sport apart', async () => {
    h.players.mockImplementation(async (sport: string) => directory(sport))
    await getCachedFantraxPlayerIds('NFL', { ttlMs: HOUR })
    const cfb = await getCachedFantraxPlayerIds('CFB', { ttlMs: HOUR })
    expect(h.players).toHaveBeenCalledTimes(2)
    expect(cfb.ok && cfb.data.p1!.name).toBe('CFB')
  })

  /** Two imports starting together must not each download the same list. */
  it('shares one request between two asks made at the same time', async () => {
    let release: (v: ReturnType<typeof directory>) => void = () => {}
    h.players.mockReturnValue(new Promise((resolve) => { release = resolve }))
    const a = getCachedFantraxPlayerIds('NFL', { ttlMs: HOUR })
    const b = getCachedFantraxPlayerIds('NFL', { ttlMs: HOUR })
    release(directory('One, Player'))
    expect(await a).toBe(await b)
    expect(h.players).toHaveBeenCalledTimes(1)
  })
})

describe('what is never kept', () => {
  /**
   * 🛑 A FAILURE MUST NOT BE CACHED. Keeping one would turn a single throttled request into an
   * hour of every import being told that sport is unavailable.
   */
  it('a failed read is returned and forgotten', async () => {
    h.players.mockResolvedValueOnce({ ok: false, failure: { kind: 'unavailable', message: 'rate limited' } })
    h.players.mockResolvedValueOnce(directory('One, Player'))
    const failed = await getCachedFantraxPlayerIds('NFL', { ttlMs: HOUR })
    const retried = await getCachedFantraxPlayerIds('NFL', { ttlMs: HOUR })
    expect(failed.ok).toBe(false)
    expect(retried.ok).toBe(true)
    expect(h.players).toHaveBeenCalledTimes(2)
  })

  it('a thrown request is not left blocking the next ask', async () => {
    h.players.mockRejectedValueOnce(new Error('socket hang up'))
    h.players.mockResolvedValueOnce(directory('One, Player'))
    await expect(getCachedFantraxPlayerIds('NFL', { ttlMs: HOUR })).rejects.toThrow('socket hang up')
    expect((await getCachedFantraxPlayerIds('NFL', { ttlMs: HOUR })).ok).toBe(true)
  })

  /** A stale directory lacks new players, and a rostered player missing from it imports nameless. */
  it('an answer older than the limit is fetched again', async () => {
    let clock = 1_000
    const now = () => clock
    h.players.mockResolvedValueOnce(directory('Old')).mockResolvedValueOnce(directory('New'))
    await getCachedFantraxPlayerIds('NFL', { ttlMs: HOUR, now })
    clock += HOUR - 1
    expect(h.players).toHaveBeenCalledTimes(1)
    await getCachedFantraxPlayerIds('NFL', { ttlMs: HOUR, now })
    expect(h.players).toHaveBeenCalledTimes(1)
    clock += 2
    const fresh = await getCachedFantraxPlayerIds('NFL', { ttlMs: HOUR, now })
    expect(h.players).toHaveBeenCalledTimes(2)
    expect(fresh.ok && fresh.data.p1!.name).toBe('New')
  })
})

describe('under test the cache is off unless asked for', () => {
  /** Otherwise one test's directory would leak into the next, and suites would pass by run order. */
  it('every ask reaches the API by default', async () => {
    h.players.mockResolvedValue(directory('One, Player'))
    await getCachedFantraxPlayerIds('NFL')
    await getCachedFantraxPlayerIds('NFL')
    expect(h.players).toHaveBeenCalledTimes(2)
  })
})

describe('the import uses the shared copy', () => {
  it('asks the cache, not the API directly, for every sport directory', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync('lib/league-import/fantrax/importFantraxLeague.ts', 'utf8')
    expect(source).toMatch(/^\s*const loadDirectory = .*getCachedFantraxPlayerIds\(sport\)/m)
    /* And nowhere does it call the uncached reader. */
    expect(source).not.toMatch(/[^d]getFantraxPlayerIds\(/)
  })
})
