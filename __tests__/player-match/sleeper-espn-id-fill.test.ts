// @vitest-environment node
/**
 * `PlayerIdentityMap.espnId` filled from Sleeper's own directory (each Sleeper record names its ESPN
 * id). Measured on production 2026-11-09: 4,532 NFL rows fillable this way, against 928 filled by
 * the name linker. Every rule here is a refusal: fill a blank, never overwrite, never write an
 * ambiguous or already-used ESPN id.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  playerIdentityMap: {
    findMany: vi.fn(),
    count: vi.fn(async () => 0),
    update: vi.fn(async () => ({})),
  },
  $executeRaw: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import {
  fillEspnIdsFromSleeperDirectory,
  planEspnIdFill,
  sleeperDirectoryEntries,
} from '@/lib/player-match/sleeperEspnIdFill'

const dir = (pairs: Array<[string, string | null]>) => pairs.map(([sleeperId, espnId]) => ({ sleeperId, espnId }))

beforeEach(() => {
  vi.clearAllMocks()
  db.$executeRaw.mockImplementation(async (_sql: unknown, ids: string[]) => ids.length)
})

describe('planEspnIdFill', () => {
  it('fills a blank from the row’s own Sleeper record', () => {
    const plan = planEspnIdFill(dir([['s1', 'e1']]), [{ id: 'r1', sleeperId: 's1', espnId: null }])
    expect(plan.writes).toEqual([{ id: 'r1', espnId: 'e1' }])
  })

  it('never overwrites: an agreeing id is already set, a disagreeing one is reported and left', () => {
    const plan = planEspnIdFill(dir([['s1', 'e1'], ['s2', 'e2']]), [
      { id: 'r1', sleeperId: 's1', espnId: 'e1' },
      { id: 'r2', sleeperId: 's2', espnId: 'e-other' },
    ])
    expect(plan).toMatchObject({ writes: [], alreadySet: 1, disagreements: 1 })
  })

  it('refuses an ESPN id Sleeper gives to two players', () => {
    const plan = planEspnIdFill(dir([['s1', 'e1'], ['s2', 'e1']]), [
      { id: 'r1', sleeperId: 's1', espnId: null },
      { id: 'r2', sleeperId: 's2', espnId: null },
    ])
    expect(plan).toMatchObject({ writes: [], refusedAmbiguous: 2 })
  })

  it('refuses an ESPN id another row already holds: two rows, one id, is two athletes', () => {
    const plan = planEspnIdFill(dir([['s1', 'e1']]), [
      { id: 'r1', sleeperId: 's1', espnId: null },
      { id: 'r9', sleeperId: null, espnId: 'e1' },
    ])
    expect(plan).toMatchObject({ writes: [], refusedTaken: 1 })
  })

  it('skips players Sleeper has no ESPN id for, and rows with no Sleeper id', () => {
    const plan = planEspnIdFill(dir([['s1', null]]), [
      { id: 'r1', sleeperId: 's1', espnId: null },
      { id: 'r2', sleeperId: null, espnId: null },
    ])
    expect(plan.writes).toEqual([])
  })
})

describe('sleeperDirectoryEntries', () => {
  it('reads player_id (falling back to the key) and a trimmed espn_id', () => {
    expect(
      sleeperDirectoryEntries({
        '4046': { player_id: '4046', espn_id: ' 3139477 ' },
        '9999': { espn_id: '' },
        DEN: { player_id: 'DEN', espn_id: null },
      }),
    ).toEqual([
      { sleeperId: '4046', espnId: '3139477' },
      { sleeperId: '9999', espnId: null },
      { sleeperId: 'DEN', espnId: null },
    ])
  })
})

describe('fillEspnIdsFromSleeperDirectory', () => {
  const RAW = { s1: { player_id: 's1', espn_id: 'e1' }, s2: { player_id: 's2', espn_id: 'e2' } }

  it('writes only blanks, re-checked in the UPDATE itself', async () => {
    db.playerIdentityMap.findMany.mockResolvedValue([
      { id: 'r1', sleeperId: 's1', espnId: null },
      { id: 'r2', sleeperId: 's2', espnId: 'e2' },
    ])
    const out = await fillEspnIdsFromSleeperDirectory(RAW)
    expect(out).toMatchObject({ planned: 1, written: 1, alreadySet: 1, withEspnBefore: 1 })
    expect(db.$executeRaw).toHaveBeenCalledTimes(1)
    const [sql, ids, espnIds] = db.$executeRaw.mock.calls[0] as [TemplateStringsArray, string[], string[]]
    expect(sql.join('?')).toContain('"espnId" IS NULL')
    expect(ids).toEqual(['r1'])
    expect(espnIds).toEqual(['e1'])
    expect(db.playerIdentityMap.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ sport: 'NFL' }) }))
  })

  it('a dry run plans and writes nothing', async () => {
    db.playerIdentityMap.findMany.mockResolvedValue([{ id: 'r1', sleeperId: 's1', espnId: null }])
    const out = await fillEspnIdsFromSleeperDirectory(RAW, { dryRun: true })
    expect(out).toMatchObject({ planned: 1, written: 0, dryRun: true })
    expect(db.$executeRaw).not.toHaveBeenCalled()
  })

  it('stops between chunks when the run budget is gone', async () => {
    db.playerIdentityMap.findMany.mockResolvedValue([{ id: 'r1', sleeperId: 's1', espnId: null }])
    const out = await fillEspnIdsFromSleeperDirectory(RAW, { isExhausted: () => true })
    expect(out).toMatchObject({ planned: 1, written: 0 })
    expect(db.$executeRaw).not.toHaveBeenCalled()
  })

  it('a directory with no ESPN ids costs no query', async () => {
    const out = await fillEspnIdsFromSleeperDirectory({ s1: { player_id: 's1' } })
    expect(out.planned).toBe(0)
    expect(db.playerIdentityMap.findMany).not.toHaveBeenCalled()
  })
})

describe('the Sleeper-id backfill fills ESPN ids from the download it already made', () => {
  function sleeperServes(universe: Record<string, unknown>) {
    const spy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => universe })
    vi.stubGlobal('fetch', spy)
    return spy
  }

  it('one download, ESPN ids written, reported on the result', async () => {
    const spy = sleeperServes({ s1: { player_id: 's1', full_name: 'Some Player', position: 'WR', espn_id: 'e1' } })
    db.playerIdentityMap.findMany.mockImplementation(async ({ where }: any) =>
      where?.OR ? [{ id: 'r1', sleeperId: 's1', espnId: null }] : [],
    )
    const { backfillSleeperIds } = await import('@/lib/player-match/sleeperIdentitySync')
    const out = await backfillSleeperIds({ sport: 'NFL' })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(out.espnIds).toMatchObject({ planned: 1, written: 1 })
    vi.unstubAllGlobals()
  })

  it('a failed ESPN fill never fails the backfill', async () => {
    sleeperServes({ s1: { player_id: 's1', full_name: 'Some Player', espn_id: 'e1' } })
    db.playerIdentityMap.findMany.mockImplementation(async ({ where }: any) => {
      if (where?.OR) throw new Error('db down')
      return []
    })
    const { backfillSleeperIds } = await import('@/lib/player-match/sleeperIdentitySync')
    const out = await backfillSleeperIds({ sport: 'NFL' })
    expect(out.espnIds).toEqual({ error: 'db down' })
    vi.unstubAllGlobals()
  })
})
