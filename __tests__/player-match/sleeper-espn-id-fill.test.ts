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
  playerProviderIdentity: { findMany: vi.fn() },
  $executeRaw: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import {
  fillEspnIdsFromSleeperDirectory,
  planEspnIdBirthdayMatch,
  planEspnIdFill,
  sleeperDirectoryEntries,
} from '@/lib/player-match/sleeperEspnIdFill'

const dir = (pairs: Array<[string, string | null]>) => pairs.map(([sleeperId, espnId]) => ({ sleeperId, espnId }))

beforeEach(() => {
  vi.clearAllMocks()
  db.$executeRaw.mockImplementation(async (_sql: unknown, ids: string[]) => ids.length)
  db.playerProviderIdentity.findMany.mockResolvedValue([])
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
  it('reads player_id (falling back to the key), a trimmed espn_id, the name and the birthday', () => {
    expect(
      sleeperDirectoryEntries({
        '4046': { player_id: '4046', espn_id: ' 3139477 ', full_name: 'Patrick Mahomes', birth_date: '1995-09-17' },
        '9999': { espn_id: '', first_name: 'Some', last_name: 'One' },
        DEN: { player_id: 'DEN', espn_id: null },
      }),
    ).toEqual([
      { sleeperId: '4046', espnId: '3139477', name: 'Patrick Mahomes', birthDate: '1995-09-17' },
      { sleeperId: '9999', espnId: null, name: 'Some One', birthDate: null },
      { sleeperId: 'DEN', espnId: null, name: null, birthDate: null },
    ])
  })
})

describe('planEspnIdBirthdayMatch: ESPN athletes whose Sleeper record names no ESPN id', () => {
  // James Cook III, measured: Sleeper 8138 carries no espn_id; ESPN 4379399 carries his birthday.
  const cook = { sleeperId: '8138', espnId: null, name: 'James Cook III', birthDate: '1999-09-25' }
  const cookRow = { id: 'r-cook', sleeperId: '8138', espnId: null }
  const espnCook = { espnId: '4379399', name: 'James Cook III', dob: '1999-09-25T07:00Z' }

  it('fills the row when exactly one Sleeper record has the same name AND birthday', () => {
    const plan = planEspnIdBirthdayMatch([cook], [espnCook], [cookRow])
    expect(plan.writes).toEqual([{ id: 'r-cook', espnId: '4379399' }])
  })

  it('a name alone is not enough: a different birthday is a different person', () => {
    const plan = planEspnIdBirthdayMatch([cook], [{ ...espnCook, dob: '1999-09-26T07:00Z' }], [cookRow])
    expect(plan).toMatchObject({ writes: [], noMatch: 1 })
  })

  it('no birthday on the ESPN side means no attempt', () => {
    const plan = planEspnIdBirthdayMatch([cook], [{ ...espnCook, dob: null }], [cookRow])
    expect(plan).toMatchObject({ writes: [], noEvidence: 1 })
  })

  it('refuses when two Sleeper records share the name and the birthday', () => {
    const twin = { ...cook, sleeperId: '9001' }
    const plan = planEspnIdBirthdayMatch([cook, twin], [espnCook], [cookRow, { id: 'r2', sleeperId: '9001', espnId: null }])
    expect(plan).toMatchObject({ writes: [], refusedAmbiguous: 1 })
  })

  it('believes Sleeper when its record names a different ESPN id', () => {
    const plan = planEspnIdBirthdayMatch([{ ...cook, espnId: '777' }], [espnCook], [cookRow])
    expect(plan).toMatchObject({ writes: [], refusedSleeperDisagrees: 1 })
  })

  it('drops both when two ESPN athletes land on one Sleeper record', () => {
    const plan = planEspnIdBirthdayMatch([cook], [espnCook, { ...espnCook, espnId: '5550000' }], [cookRow])
    expect(plan).toMatchObject({ writes: [], refusedAmbiguous: 2 })
  })

  it('one ESPN id on two identity rows: agreeing copies are fine, disagreeing ones are dropped', () => {
    expect(planEspnIdBirthdayMatch([cook], [espnCook, { ...espnCook }], [cookRow]).writes).toHaveLength(1)
    const plan = planEspnIdBirthdayMatch([cook], [espnCook, { ...espnCook, name: 'Jim Cook' }], [cookRow])
    expect(plan).toMatchObject({ writes: [], refusedInconsistent: 1 })
  })

  it('leaves ids the first pass owns: one already on a row, or one Sleeper names elsewhere', () => {
    const taken = planEspnIdBirthdayMatch([cook], [espnCook], [cookRow, { id: 'r9', sleeperId: null, espnId: '4379399' }])
    expect(taken.writes).toEqual([])
    const named = planEspnIdBirthdayMatch([cook, { sleeperId: 's5', espnId: '4379399' }], [espnCook], [cookRow])
    expect(named.writes).toEqual([])
  })

  it('never overwrites, and needs a row to write to', () => {
    expect(planEspnIdBirthdayMatch([cook], [espnCook], [{ ...cookRow, espnId: 'e-other' }])).toMatchObject({ writes: [], noTargetRow: 1 })
    expect(planEspnIdBirthdayMatch([cook], [espnCook], [])).toMatchObject({ writes: [], noTargetRow: 1 })
  })

  it('skips team defenses, which are named from their id elsewhere', () => {
    const plan = planEspnIdBirthdayMatch([cook], [{ espnId: '-16002', name: 'BUF D/ST', dob: null }], [cookRow])
    expect(plan).toMatchObject({ writes: [], noEvidence: 0 })
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

  it('runs the birthday pass after the direct one, in the same guarded UPDATE', async () => {
    const raw = {
      s1: { player_id: 's1', espn_id: 'e1', full_name: 'Direct Guy', birth_date: '2000-01-01' },
      '8138': { player_id: '8138', full_name: 'James Cook III', birth_date: '1999-09-25' },
    }
    db.playerIdentityMap.findMany.mockResolvedValue([
      { id: 'r1', sleeperId: 's1', espnId: null },
      { id: 'r-cook', sleeperId: '8138', espnId: null },
    ])
    db.playerProviderIdentity.findMany.mockResolvedValue([
      // e1 is filled by the direct pass; the birthday pass must not claim it again.
      { providerPlayerId: 'e1', displayName: 'Direct Guy', rawPayload: { dob: '2000-01-01T08:00Z' } },
      { providerPlayerId: '4379399', displayName: 'James Cook III', rawPayload: { dob: '1999-09-25T07:00Z' } },
    ])
    const out = await fillEspnIdsFromSleeperDirectory(raw)
    expect(out).toMatchObject({ planned: 2, written: 2, byBirthday: { planned: 1 } })
    const [sql, ids, espnIds] = db.$executeRaw.mock.calls[0] as [TemplateStringsArray, string[], string[]]
    expect(sql.join('?')).toContain('"espnId" IS NULL')
    expect(ids).toEqual(['r1', 'r-cook'])
    expect(espnIds).toEqual(['e1', '4379399'])
    expect(db.playerProviderIdentity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { provider: 'espn', sportKey: 'NFL' } }),
    )
  })

  it('a failed birthday pass keeps the direct writes and reports the error', async () => {
    db.playerIdentityMap.findMany.mockResolvedValue([{ id: 'r1', sleeperId: 's1', espnId: null }])
    db.playerProviderIdentity.findMany.mockRejectedValue(new Error('identity read failed'))
    const out = await fillEspnIdsFromSleeperDirectory(RAW)
    expect(out).toMatchObject({ planned: 1, written: 1, byBirthday: { planned: 0, error: 'identity read failed' } })
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
