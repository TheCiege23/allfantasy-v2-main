// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  flushQueuedLineupEdits,
  queueLineupEdit,
  readOfflineRosterData,
  readQueuedLineupEdit,
  saveOfflineRosterData,
  type QueuedLineupEdit,
} from '@/lib/pwa/offlineLineupQueue'

function cacheStorage() {
  const stores = new Map<string, Map<string, Response>>()
  const keyOf = (k: Request | string) => (typeof k === 'string' ? k : new URL(k.url).pathname)
  const cacheFor = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map())
    const s = stores.get(name)!
    return {
      put: async (k: Request | string, v: Response) => void s.set(keyOf(k), v),
      match: async (k: Request | string) => s.get(keyOf(k))?.clone(),
      delete: async (k: Request | string) => s.delete(keyOf(k)),
      keys: async () => [...s.keys()].map((p) => new Request(`https://www.allfantasy.ai${p}`)),
    }
  }
  return {
    stores,
    open: async (name: string) => cacheFor(name),
    match: async (k: Request | string) => {
      for (const s of stores.values()) if (s.has(keyOf(k))) return s.get(keyOf(k))!.clone()
      return undefined
    },
  }
}

const lists = (starters: string[]) => ({ starters, bench: [], ir: [], taxi: [], devy: [] })
const edit = (over: Partial<QueuedLineupEdit> = {}) => ({
  leagueId: 'lg1',
  rosterId: 'ros1',
  week: 5,
  roster: { starters: [{ id: 'qb1' }] },
  lists: lists(['qb1']),
  baseVersion: 'ver-1' as string | null,
  ...over,
})
const answer = (status: number, json: unknown = {}) => vi.fn(async () => new Response(JSON.stringify(json), { status }))

let caches: ReturnType<typeof cacheStorage>
beforeEach(() => {
  caches = cacheStorage()
  vi.stubGlobal('caches', caches)
})
afterEach(() => vi.unstubAllGlobals())

describe('queueLineupEdit', () => {
  it('a later offline edit replaces the earlier one but keeps the version the first was built on', async () => {
    await queueLineupEdit(edit())
    await queueLineupEdit(edit({ lists: lists(['qb2']), baseVersion: 'ver-1-local' }))
    const q = await readQueuedLineupEdit('lg1')
    expect(q?.lists.starters).toEqual(['qb2'])
    expect(q?.baseVersion).toBe('ver-1')
  })

  it('a new week starts from its own version', async () => {
    await queueLineupEdit(edit())
    await queueLineupEdit(edit({ week: 6, baseVersion: 'ver-6' }))
    expect((await readQueuedLineupEdit('lg1'))?.baseVersion).toBe('ver-6')
  })

  it('returns null rather than pretending, when the device cannot store it', async () => {
    vi.stubGlobal('caches', { open: async () => { throw new Error('quota') } })
    expect(await queueLineupEdit(edit())).toBeNull()
  })
})

describe('flushQueuedLineupEdits', () => {
  it('sends the edit with its base version and clears it once accepted', async () => {
    await queueLineupEdit(edit())
    const fetch = answer(200, { ok: true })
    expect(await flushQueuedLineupEdits(fetch as never)).toEqual([{ leagueId: 'lg1', outcome: 'saved' }])
    const body = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(body).toEqual({ leagueId: 'lg1', rosterId: 'ros1', week: 5, roster: { starters: [{ id: 'qb1' }] }, expectedLineupVersion: 'ver-1' })
    expect(await readQueuedLineupEdit('lg1')).toBeNull()
  })

  it('a roster that changed meanwhile: dropped, reported as a conflict', async () => {
    await queueLineupEdit(edit())
    const [r] = await flushQueuedLineupEdits(answer(409, { error: 'Your roster changed…', code: 'LINEUP_CONFLICT' }) as never)
    expect(r).toEqual({ leagueId: 'lg1', outcome: 'rejected', message: 'Your roster changed…', conflict: true })
    expect(await readQueuedLineupEdit('lg1')).toBeNull()
  })

  it('a game that kicked off first: dropped with the server reason', async () => {
    await queueLineupEdit(edit())
    const [r] = await flushQueuedLineupEdits(answer(403, { error: "That player's game has started" }) as never)
    expect(r).toMatchObject({ outcome: 'rejected', message: "That player's game has started", conflict: false })
    expect(await readQueuedLineupEdit('lg1')).toBeNull()
  })

  it.each([
    ['no network', vi.fn(async () => { throw new TypeError('Failed to fetch') })],
    ['a server error', answer(503)],
    ['a lapsed session', answer(401)],
  ])('%s: kept for the next attempt', async (_label, fetch) => {
    await queueLineupEdit(edit())
    expect(await flushQueuedLineupEdits(fetch as never)).toEqual([{ leagueId: 'lg1', outcome: 'kept' }])
    expect(await readQueuedLineupEdit('lg1')).not.toBeNull()
  })

  it('two callers at once send each edit once', async () => {
    await queueLineupEdit(edit())
    await queueLineupEdit(edit({ leagueId: 'lg2' }))
    const fetch = answer(200, { ok: true })
    const [a, b] = await Promise.all([flushQueuedLineupEdits(fetch as never), flushQueuedLineupEdits(fetch as never)])
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(a).toBe(b)
  })

  it('an edit made while one was being sent is not cleared by it', async () => {
    await queueLineupEdit(edit())
    const fetch = vi.fn(async () => {
      await queueLineupEdit(edit({ lists: lists(['qb9']) }))
      return new Response('{}', { status: 200 })
    })
    await flushQueuedLineupEdits(fetch as never)
    expect((await readQueuedLineupEdit('lg1'))?.lists.starters).toEqual(['qb9'])
  })

  it('leaves the editor copy alone', async () => {
    await saveOfflineRosterData('lg1', { rosterId: 'ros1' })
    await queueLineupEdit(edit())
    await flushQueuedLineupEdits(answer(200) as never)
    expect((await readOfflineRosterData('lg1'))?.data).toEqual({ rosterId: 'ros1' })
  })
})
