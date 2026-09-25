/**
 * 🛑 A Trade Center analysis in a Sleeper league queued a whole-sport importer run (2026-09-25).
 *
 * The screen sends each roster player's BARE Sleeper id (`10218`), `getPlayer` looked it up as a
 * `SportsPlayerRecord.id` — which is keyed `NFL:10218` — missed every time, and every miss called
 * `requestPlayerImportRefresh(…, 'get_player_miss')`. These pin the fix: a bare id resolves through
 * its sport prefix, and a stale hit never imports from the request path.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  rows: new Map<string, { id: string; sport: string; name: string; lastUpdated: Date }>(),
  refresh: vi.fn(),
  importer: vi.fn(async () => ({})),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: { sportsPlayerRecord: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => h.rows.get(where.id) ?? null) } },
}))
vi.mock('@/lib/workers/sports-data-import-coordinator', () => ({ requestPlayerImportRefresh: h.refresh }))
vi.mock('@/lib/workers/sports-data-importer', () => ({ runSportsDataImporter: h.importer }))
vi.mock('@/lib/workers/injury-importer', () => ({ runInjuryImporter: vi.fn() }))
vi.mock('@/lib/workers/news-importer', () => ({ runNewsImporter: vi.fn() }))

import { getPlayer } from '@/lib/data/players'

const STALE = new Date('2026-09-07T00:00:00Z') // weeks old, like every NFL row measured on the test DB

beforeEach(() => {
  h.rows = new Map([
    ['NFL:10218', { id: 'NFL:10218', sport: 'NFL', name: 'Xavier Hutchinson', lastUpdated: STALE }],
    ['NBA:3001', { id: 'NBA:3001', sport: 'NBA', name: 'A Guard', lastUpdated: STALE }],
  ])
  h.refresh.mockClear()
  h.importer.mockClear()
})

describe('getPlayer reads a bare Sleeper id', () => {
  it('🛑 resolves `10218` in an NFL league to `NFL:10218` and queues NO import', async () => {
    const row = await getPlayer('10218', { sport: 'NFL' })
    expect(row?.name).toBe('Xavier Hutchinson')
    expect(h.refresh).not.toHaveBeenCalled()
    expect(h.importer).not.toHaveBeenCalled()
  })

  it("uses the caller's league sport for the prefix", async () => {
    expect((await getPlayer('3001', { sport: 'NBA' }))?.name).toBe('A Guard')
    expect(h.refresh).not.toHaveBeenCalled()
  })

  it('🛑 never guesses a sport — an NBA roster id is not read as the NFL player sharing the number', async () => {
    h.rows.set('NFL:3001', { id: 'NFL:3001', sport: 'NFL', name: 'A Different Man', lastUpdated: STALE })
    expect((await getPlayer('3001', { sport: 'NBA' }))?.name).toBe('A Guard')
    // No sport named: the bare id is read as given, which is a miss — never the NFL row.
    expect(await getPlayer('3001')).toBeNull()
    expect(await getPlayer('10218')).toBeNull()
  })

  it('a prefixed id is read as given', async () => {
    expect((await getPlayer('NFL:10218'))?.name).toBe('Xavier Hutchinson')
  })

  it('a genuinely missing player still asks the (throttled) coordinator for an import, once', async () => {
    expect(await getPlayer('99999', { sport: 'NFL' })).toBeNull()
    expect(h.refresh).toHaveBeenCalledTimes(1)
    expect(h.refresh).toHaveBeenCalledWith('NFL', 'get_player_miss')
  })

  it('🛑 a STALE hit never runs the importer from the request path — the cron owns freshness', async () => {
    await getPlayer('NFL:10218')
    await getPlayer('10218', { sport: 'NFL' })
    expect(h.importer).not.toHaveBeenCalled()
    expect(h.refresh).not.toHaveBeenCalled()
  })
})
