import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { BUNDLED_SURVIVOR_IDOL_TYPES, isSurvivorIdolTypePlayable } from '@/lib/survivor/survivorIdolTypes'
import { balancedDrawViolations } from '@/lib/survivor/survivorIdolDraw'

type Row = {
  leagueId: string; mode: string; count: number; hideFromCommish: boolean; pickedTypeIds: string[]
  resolvedTypeIds: string[]; resolvedAt: Date | null; pointSurgePct: number; tributePct: number
}

function fakeDb(opts: { row?: Partial<Row> | null; draftStatus?: string | null; legacyPool?: string[] | null; idolCount?: number } = {}) {
  let row: Row | null = opts.row === null || opts.row === undefined ? null : {
    leagueId: 'league-1', mode: 'random', count: 7, hideFromCommish: false, pickedTypeIds: [], resolvedTypeIds: [], resolvedAt: null, pointSurgePct: 15, tributePct: 10, ...opts.row,
  }
  const db = {
    $queryRaw: vi.fn(async () => [{ t: 'survivor_idol_types', c: 'survivor_idol_configs' }]),
    survivorIdolType: { findMany: vi.fn(async () => []) },
    draftSession: { findFirst: vi.fn(async () => (opts.draftStatus ? { id: 'draft-1' } : null)) },
    league: {
      findUnique: vi.fn(async () => ({ survivorIdolCount: opts.idolCount ?? 9 })),
      update: vi.fn(async () => ({})),
    },
    survivorLeagueConfig: { findUnique: vi.fn(async () => ({ idolPowerPool: opts.legacyPool ?? null })) },
    survivorIdolConfig: {
      findUnique: vi.fn(async () => (row ? { ...row } : null)),
      upsert: vi.fn(async ({ create, update }: { create: Row; update: Partial<Row> }) => {
        row = row ? { ...row, ...update } : { pickedTypeIds: [], resolvedTypeIds: [], resolvedAt: null, ...create }
        return row
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { resolvedTypeIds: { isEmpty: boolean } }; data: Partial<Row> }) => {
        if (!row || (where.resolvedTypeIds.isEmpty && row.resolvedTypeIds.length)) return { count: 0 }
        row = { ...row, ...data }
        return { count: 1 }
      }),
    },
    get row() { return row },
  }
  return db
}

const typeById = new Map(BUNDLED_SURVIVOR_IDOL_TYPES.map(type => [type.id, type]))

describe('idol setup secrecy', () => {
  it('never shows the drawn types to a manager, or to a commissioner who hid the draw', async () => {
    const { projectSurvivorIdolSetup } = await import('@/lib/survivor/survivorIdolConfigService')
    const base = { types: [...BUNDLED_SURVIVOR_IDOL_TYPES], fallbackCount: 7, locked: true }
    const row = { mode: 'random' as const, count: 7, hideFromCommish: false, pickedTypeIds: [], pointSurgePct: 15, tributePct: 10, resolvedTypeIds: ['immunity', 'tribe-immunity', 'vote-steal', 'captain', 'decoy', 'defector', 'first-claim'], resolvedAt: new Date() }
    expect(projectSurvivorIdolSetup({ ...base, row, isCommissioner: true }).resolvedTypeIds).toEqual(row.resolvedTypeIds)
    const manager = projectSurvivorIdolSetup({ ...base, row, isCommissioner: false })
    expect(manager.resolvedTypeIds).toBeNull()
    expect(manager.resolved).toBe(true)
    expect(JSON.stringify(manager)).not.toContain('"resolvedTypeIds":["')
    const hidden = projectSurvivorIdolSetup({ ...base, row: { ...row, hideFromCommish: true }, isCommissioner: true })
    expect(hidden.resolvedTypeIds).toBeNull()
    // A commissioner who PLAYS edits the setup but is a manager for the draw itself.
    const playing = projectSurvivorIdolSetup({ ...base, row, isCommissioner: true, canSeeDraw: false })
    expect(playing.isCommissioner).toBe(true)
    expect(playing.resolvedTypeIds).toBeNull()
    expect(JSON.stringify(playing)).not.toContain('"resolvedTypeIds":["')
  })

  it('shows pick-mode choices to the commissioner only', async () => {
    const { projectSurvivorIdolSetup } = await import('@/lib/survivor/survivorIdolConfigService')
    const row = { mode: 'pick' as const, count: 6, hideFromCommish: false, pickedTypeIds: ['captain', 'silence', 'decoy', 'revote'], pointSurgePct: 20, tributePct: 12, resolvedTypeIds: [], resolvedAt: null }
    const input = { types: [...BUNDLED_SURVIVOR_IDOL_TYPES], fallbackCount: 7, locked: false, row }
    expect(projectSurvivorIdolSetup({ ...input, isCommissioner: true }).config.pickedTypeIds).toEqual(row.pickedTypeIds)
    const manager = projectSurvivorIdolSetup({ ...input, isCommissioner: false })
    expect(manager.config.pickedTypeIds).toEqual([])
    expect(manager.config).toMatchObject({ count: 6, pointSurgePct: 20, tributePct: 12 })
  })

  it('defaults to a random draw of 7 with +15% Point surge and 10% Tribute', async () => {
    const { projectSurvivorIdolSetup } = await import('@/lib/survivor/survivorIdolConfigService')
    const view = projectSurvivorIdolSetup({ types: [...BUNDLED_SURVIVOR_IDOL_TYPES], row: null, fallbackCount: null, isCommissioner: true, locked: false })
    expect(view.config).toEqual({ mode: 'random', count: 7, hideFromCommish: false, pickedTypeIds: [], pointSurgePct: 15, tributePct: 10 })
  })
})

describe('saving idol setup', () => {
  beforeEach(() => vi.resetModules())

  it('locks once the draft starts', async () => {
    const { saveSurvivorIdolConfig } = await import('@/lib/survivor/survivorIdolConfigService')
    const db = fakeDb({ draftStatus: 'in_progress' })
    const result = await saveSurvivorIdolConfig('league-1', { mode: 'random', count: 7 }, db as never)
    expect(result).toMatchObject({ ok: false, status: 409, code: 'settings_locked' })
    expect(db.survivorIdolConfig.upsert).not.toHaveBeenCalled()
  })

  it('saves before the draft, syncs the league idol count, and discards any provisional draw', async () => {
    const { saveSurvivorIdolConfig } = await import('@/lib/survivor/survivorIdolConfigService')
    const db = fakeDb({ row: { resolvedTypeIds: ['immunity'], hideFromCommish: true } })
    const result = await saveSurvivorIdolConfig('league-1', { mode: 'random', count: 8, hideFromCommish: false, pointSurgePct: 20, tributePct: 5 }, db as never)
    expect(result).toMatchObject({ ok: true, config: { count: 8, pointSurgePct: 20, tributePct: 5 } })
    expect(db.row).toMatchObject({ count: 8, resolvedTypeIds: [], resolvedAt: null })
    expect(db.league.update).toHaveBeenCalledWith({ where: { id: 'league-1' }, data: { survivorIdolCount: 8 } })
  })

  it('refuses a pick that is not exactly count - 2 and an out-of-range count', async () => {
    const { saveSurvivorIdolConfig } = await import('@/lib/survivor/survivorIdolConfigService')
    const db = fakeDb()
    expect(await saveSurvivorIdolConfig('league-1', { mode: 'pick', count: 7, pickedTypeIds: [] }, db as never)).toMatchObject({ ok: false, status: 422 })
    expect(await saveSurvivorIdolConfig('league-1', { mode: 'random', count: 9 }, db as never)).toMatchObject({ ok: false, status: 400 })
    expect(await saveSurvivorIdolConfig('league-1', { mode: 'random', count: 7, tributePct: 80 }, db as never)).toMatchObject({ ok: false, status: 400 })
    expect(db.survivorIdolConfig.upsert).not.toHaveBeenCalled()
  })
})

describe('pick mode server-side', () => {
  beforeEach(() => vi.resetModules())

  it('rejects coming-soon (non-playable) idol ids and saves playable picks', async () => {
    const { saveSurvivorIdolConfig } = await import('@/lib/survivor/survivorIdolConfigService')
    const db = fakeDb()
    for (const id of ['captain', 'point-surge', 'tribute', 'tribe-immunity']) {
      expect(await saveSurvivorIdolConfig('league-1', { mode: 'pick', count: 7, pickedTypeIds: [id] }, db as never)).toMatchObject({ ok: false, status: 422 })
    }
    expect(db.survivorIdolConfig.upsert).not.toHaveBeenCalled()
    expect(await saveSurvivorIdolConfig('league-1', { mode: 'pick', count: 7, pickedTypeIds: ['vote-steal', 'steal-three'] }, db as never)).toMatchObject({ ok: true })
  })
})

describe('the draw at draft lock', () => {
  beforeEach(() => vi.resetModules())

  it('draws once with the supplied RNG, seals it, and returns the same draw afterwards', async () => {
    const { lockSurvivorIdolDraw } = await import('@/lib/survivor/survivorIdolConfigService')
    const db = fakeDb({ row: { count: 8 } })
    const rng = vi.fn((max: number) => max - 1)
    const first = await lockSurvivorIdolDraw('league-1', db as never, rng)
    expect(rng).toHaveBeenCalled()
    expect(first?.drawnNow).toBe(true)
    expect(first?.typeIds).toHaveLength(8)
    expect(first?.typeIds[0]).toBe('immunity')
    expect(first?.typeIds.every(id => isSurvivorIdolTypePlayable(typeById.get(id)!))).toBe(true)
    expect(balancedDrawViolations(first!.typeIds.slice(1).map(id => typeById.get(id)!)).filter(rule => !rule.startsWith('more than two'))).toEqual([])
    expect(db.row?.resolvedTypeIds).toEqual(first?.typeIds)

    const again = await lockSurvivorIdolDraw('league-1', db as never, () => 0)
    expect(again).toMatchObject({ typeIds: first!.typeIds, drawnNow: false })
  })

  it('uses the commissioner picks in pick mode', async () => {
    const { lockSurvivorIdolDraw } = await import('@/lib/survivor/survivorIdolConfigService')
    const db = fakeDb({ row: { mode: 'pick', count: 6, pickedTypeIds: ['vote-steal', 'extra-vote'] } })
    const locked = await lockSurvivorIdolDraw('league-1', db as never, () => 0)
    expect(locked?.typeIds).toEqual(['immunity', 'vote-steal', 'vote-steal', 'vote-steal', 'extra-vote', 'extra-vote'])
  })

  it('never seals a coming-soon idol: saved picks that are no longer playable fall back to the balanced draw', async () => {
    const { lockSurvivorIdolDraw } = await import('@/lib/survivor/survivorIdolConfigService')
    const db = fakeDb({ row: { mode: 'pick', count: 7, pickedTypeIds: ['captain', 'silence'] } })
    const locked = await lockSurvivorIdolDraw('league-1', db as never, () => 0)
    expect(locked?.typeIds).toHaveLength(7)
    expect(locked?.typeIds.every(id => isSurvivorIdolTypePlayable(typeById.get(id)!))).toBe(true)
  })

  it('redraws a sealed draw that holds a type without a play engine', async () => {
    const { lockSurvivorIdolDraw } = await import('@/lib/survivor/survivorIdolConfigService')
    const stale = ['immunity', 'tribe-immunity', 'vote-steal', 'captain', 'decoy', 'defector', 'first-claim']
    const db = fakeDb({ row: { count: 7, resolvedTypeIds: stale, resolvedAt: new Date() } })
    db.survivorIdolConfig.updateMany.mockImplementationOnce(async ({ where, data }: any) => {
      expect(where.resolvedTypeIds).toEqual({ equals: stale })
      Object.assign(db.row!, data)
      return { count: 1 }
    })
    const locked = await lockSurvivorIdolDraw('league-1', db as never, () => 0)
    expect(locked?.drawnNow).toBe(true)
    expect(locked?.typeIds.every(id => isSurvivorIdolTypePlayable(typeById.get(id)!))).toBe(true)
  })

  it('creates the default setup for a league that never opened it, clamping a legacy count to 6–8', async () => {
    const { lockSurvivorIdolDraw } = await import('@/lib/survivor/survivorIdolConfigService')
    const db = fakeDb({ row: null, idolCount: 12 })
    const locked = await lockSurvivorIdolDraw('league-1', db as never, () => 0)
    expect(locked?.typeIds).toHaveLength(8)
    expect(db.row).toMatchObject({ mode: 'random', count: 8 })
  })

  it('keeps the legacy power-pool path when the commissioner saved one and never opened idol setup', async () => {
    const { lockSurvivorIdolDraw } = await import('@/lib/survivor/survivorIdolConfigService')
    const db = fakeDb({ row: null, legacyPool: ['vote_shield'] })
    expect(await lockSurvivorIdolDraw('league-1', db as never, () => 0)).toBeNull()
    expect(db.survivorIdolConfig.upsert).not.toHaveBeenCalled()
  })

  it('falls back cleanly when the tables are not migrated', async () => {
    const { lockSurvivorIdolDraw } = await import('@/lib/survivor/survivorIdolConfigService')
    const db = fakeDb({ row: { count: 7 } })
    db.$queryRaw.mockResolvedValueOnce([{ t: null, c: null }])
    expect(await lockSurvivorIdolDraw('league-1', db as never, () => 0)).toBeNull()
    expect(db.survivorIdolConfig.findUnique).not.toHaveBeenCalled()
  })

  it('draws with node:crypto by default', async () => {
    const randomInt = vi.fn((min: number, max: number) => min + (max - min - 1))
    vi.doMock('node:crypto', () => ({ randomInt, default: { randomInt } }))
    const { lockSurvivorIdolDraw } = await import('@/lib/survivor/survivorIdolConfigService')
    const locked = await lockSurvivorIdolDraw('league-1', fakeDb({ row: { count: 7 } }) as never)
    expect(locked?.typeIds).toHaveLength(7)
    expect(randomInt).toHaveBeenCalled()
    vi.doUnmock('node:crypto')
  })
})
