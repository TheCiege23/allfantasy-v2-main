// @vitest-environment node
/**
 * Idols hide on pool players at draft lock and resolve to whoever drafted them (owner's call,
 * 2026-10-20); the rest stay on the wire, and two immunity idols join them for undrafted players.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const pool = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('@/lib/draft-room/getResolvedDraftPoolForLeague', () => ({ getResolvedDraftPoolForLeague: pool.load }))
const outer = vi.hoisted(() => ({ prisma: {} as Record<string, unknown>, tx: vi.fn(), order: [] as string[] }))
vi.mock('@/lib/prisma', () => ({ prisma: outer.prisma }))
vi.mock('@/lib/survivor/survivorSetupTransaction', () => ({ withSurvivorSetupTransaction: outer.tx }))

import { placeSurvivorIdolsInPool, seedSurvivorIdols, getIdolSeedStatus, loadSurvivorWaiverIdolPool } from '@/lib/survivor/survivorIdolProvisioning'
import { SURVIVOR_POOL_IDOL_ROSTER_ID, SURVIVOR_WAIVER_IDOL_ROSTER_ID } from '@/lib/survivor/survivorIdolPoolPlacement'

const resolved = ['immunity', 'steal-three', 'vote-steal', 'vote-steal', 'extra-vote', 'extra-vote']
const entries = Array.from({ length: 80 }, (_, i) => ({ playerId: `nba-${i}`, name: `Player ${i}`, adp: i + 1 }))
const candidates = entries.map(entry => ({ playerId: entry.playerId, playerName: entry.name, adp: entry.adp }))

function baseDb() {
  let idolSeq = 0
  return {
    $queryRaw: vi.fn(async () => [{ t: 'survivor_idol_types', c: 'survivor_idol_configs' }]),
    survivorIdolType: { findMany: vi.fn(async () => []) },
    survivorIdolConfig: { findUnique: vi.fn(async () => ({ mode: 'random', count: 6, hideFromCommish: false, pickedTypeIds: [], resolvedTypeIds: resolved, resolvedAt: new Date(), pointSurgePct: 15, tributePct: 10 })) },
    survivorIdol: { count: vi.fn(async () => 0), create: vi.fn(async () => ({ id: `idol-${idolSeq++}` })), findMany: vi.fn(async () => []), update: vi.fn(async () => ({})) },
    league: { findUnique: vi.fn(async () => ({ settings: { tribeCount: 2, idolExpiryMode: 'merge' }, survivorIdolCount: 6, userId: 'commissioner' })) },
    survivorLeagueConfig: { findUnique: vi.fn(async () => ({ id: 'config-1', idolCount: 6, idolPowerPool: null })), update: vi.fn(async () => ({})) },
    survivorIdolLedgerEntry: { create: vi.fn(async () => ({})) },
    survivorAuditEntry: { create: vi.fn(async () => ({})) },
    survivorTribe: { count: vi.fn(async () => 2) },
    draftSession: { findFirst: vi.fn(async () => ({ id: 'draft-1', status: 'completed', sessionKind: 'real' })) },
    survivorPlayer: { findMany: vi.fn(async () => [{ userId: 'user-1', redraftRosterId: 'roster-1' }, { userId: 'user-2', redraftRosterId: 'roster-2' }]), findUnique: vi.fn(async () => ({ idolIds: [] })), update: vi.fn(async () => ({})) },
    roster: { findMany: vi.fn(async () => [{ id: 'roster-1', redraftRosterId: 'season-1' }, { id: 'roster-2', redraftRosterId: 'season-2' }]) },
    draftPick: { findMany: vi.fn(async () => []) },
    sportsPlayer: { findFirst: vi.fn(async () => ({ name: 'Player', imageUrl: null })) },
    leagueChatMessage: { create: vi.fn(async () => ({})) },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  outer.order.length = 0
  for (const key of Object.keys(outer.prisma)) delete outer.prisma[key]
  pool.load.mockImplementation(async () => { outer.order.push('pool'); return { entries, sport: 'NBA', count: entries.length, rosterConfigurationIncomplete: false } })
})

/*
 * The pool build takes ~95 s cold; the setup transaction times out at 30 s. Measured in the season
 * rehearsal as "Transaction already closed", so every draft-lock placement died. The lock-free outer
 * call reads the pool first; the transaction only ever gets rows.
 */
describe('the draft pool is read before the setup transaction opens', () => {
  it('draft-lock placement loads the pool, then opens the transaction with the rows', async () => {
    const db = baseDb()
    Object.assign(outer.prisma, { survivorIdol: { count: vi.fn(async () => 0) }, league: { findUnique: vi.fn(async () => ({ settings: {} })) } })
    outer.tx.mockImplementation(async (_leagueId: string, work: (tx: unknown) => unknown) => { outer.order.push('tx'); return work(db) })
    expect(await placeSurvivorIdolsInPool('lg', { teamCount: 16, rounds: 2, seed: 11 })).toMatchObject({ ok: true, placed: true, count: 6 })
    expect(outer.order).toEqual(['pool', 'tx'])
    // Twice the largest window it can use: 16 teams x 2 rounds.
    expect(pool.load).toHaveBeenCalledWith('lg', expect.objectContaining({ limit: 64 }))
  })

  it('a league that already placed, or has idols off, never pays for a pool build', async () => {
    Object.assign(outer.prisma, { survivorIdol: { count: vi.fn(async () => 6) }, league: { findUnique: vi.fn(async () => ({ settings: {} })) } })
    expect(await placeSurvivorIdolsInPool('lg', { teamCount: 16, rounds: 2 })).toMatchObject({ ok: true, alreadyPlaced: true })
    Object.assign(outer.prisma, { survivorIdol: { count: vi.fn(async () => 0) }, league: { findUnique: vi.fn(async () => ({ settings: { idolsEnabled: false } })) } })
    expect(await placeSurvivorIdolsInPool('lg', { teamCount: 16, rounds: 2 })).toMatchObject({ ok: true, placed: false, count: 0 })
    expect(pool.load).not.toHaveBeenCalled()
    expect(outer.tx).not.toHaveBeenCalled()
  })

  it('inside a transaction with no rows handed in, it refuses rather than building the pool there', async () => {
    expect(await placeSurvivorIdolsInPool('lg', { teamCount: 16, rounds: 2, db: baseDb() as never })).toMatchObject({ ok: false, code: 'pool_not_loaded' })
    expect(pool.load).not.toHaveBeenCalled()
  })

  it('the waiver pool is read without drafted players, and only while idols wait in the pool', async () => {
    const count = vi.fn(async (args: { where: { rosterId: unknown } }) => (args.where.rosterId === SURVIVOR_POOL_IDOL_ROSTER_ID ? 3 : 0))
    Object.assign(outer.prisma, {
      survivorIdol: { count },
      draftSession: { findFirst: vi.fn(async () => ({ id: 'draft-1', status: 'completed' })) },
      draftPick: { findMany: vi.fn(async () => [{ playerId: 'nba-3' }, { playerId: null }, { playerId: 'nba-9' }]) },
    })
    expect(await loadSurvivorWaiverIdolPool('lg')).toHaveLength(80)
    expect(pool.load).toHaveBeenCalledWith('lg', expect.objectContaining({ limit: 120, excludeDraftedPlayerIds: new Set(['nba-3', 'nba-9']) }))
    pool.load.mockClear()
    count.mockImplementation(async () => 3)
    expect(await loadSurvivorWaiverIdolPool('lg')).toBeUndefined()
    expect(pool.load).not.toHaveBeenCalled()
  })

  it('seeding opens its transaction only after the waiver pool is read', async () => {
    Object.assign(outer.prisma, {
      survivorIdol: { count: vi.fn(async (args: { where: { rosterId: unknown } }) => (args.where.rosterId === SURVIVOR_POOL_IDOL_ROSTER_ID ? 1 : 0)) },
      draftSession: { findFirst: vi.fn(async () => ({ id: 'draft-1', status: 'completed' })) },
      draftPick: { findMany: vi.fn(async () => []) },
    })
    outer.tx.mockImplementation(async () => { outer.order.push('tx'); return { ok: true } })
    await seedSurvivorIdols('lg', {})
    expect(outer.order).toEqual(['pool', 'tx'])
    expect(outer.tx.mock.calls).toHaveLength(1)
  })
})

describe('placeSurvivorIdolsInPool (draft lock)', () => {
  it('hides one idol per sealed type on distinct pool players, owned by nobody, with the league expiry stamped', async () => {
    const db = baseDb()
    const out = await placeSurvivorIdolsInPool('lg', { teamCount: 16, rounds: 2, seed: 11, db: db as never, poolCandidates: candidates })
    expect(out).toMatchObject({ ok: true, placed: true, count: 6 })
    const created = db.survivorIdol.create.mock.calls.map(([arg]: any) => arg.data)
    expect(created).toHaveLength(6)
    expect(new Set(created.map((row: any) => row.playerId)).size).toBe(6)
    expect(created.every((row: any) => row.rosterId === SURVIVOR_POOL_IDOL_ROSTER_ID && row.currentOwnerUserId === null && row.status === 'hidden' && row.expiresAtMerge === true)).toBe(true)
    expect(created.map((row: any) => row.powerType).sort()).toEqual(['extra_vote', 'extra_vote', 'triple_steal', 'vote_shield', 'vote_steal', 'vote_steal'])
    // The audit says how many, never which players.
    expect(db.survivorAuditEntry.create.mock.calls[0][0].data).toMatchObject({ action: 'idols_placed', isVisibleToPublic: false, data: { count: 6, windowSize: 32 } })
    expect(JSON.stringify(db.survivorAuditEntry.create.mock.calls[0][0].data)).not.toMatch(/nba-/)
  })

  it('is idempotent and respects idols being switched off', async () => {
    const db = baseDb()
    db.survivorIdol.count.mockResolvedValue(6)
    expect(await placeSurvivorIdolsInPool('lg', { teamCount: 16, rounds: 2, db: db as never })).toMatchObject({ ok: true, placed: false, alreadyPlaced: true })
    expect(db.survivorIdol.create).not.toHaveBeenCalled()
    const off = baseDb()
    off.league.findUnique.mockResolvedValue({ settings: { idolsEnabled: false }, survivorIdolCount: 6, userId: 'c' } as never)
    expect(await placeSurvivorIdolsInPool('lg', { teamCount: 16, rounds: 2, db: off as never })).toMatchObject({ ok: true, placed: false, count: 0 })
  })
})

describe('seedSurvivorIdols after a draft with pooled idols', () => {
  it('gives drafted idols to their drafters with a private reveal, parks undrafted ones on the wire, and adds two immunity idols there', async () => {
    const db = baseDb()
    const pooled = [
      { id: 'idol-a', playerId: 'nba-3', powerType: 'vote_shield', powerLabel: 'Immunity idol', powerDesc: 'Votes against you do not count.', auditLog: { assignedSource: 'draft_pool' } },
      { id: 'idol-b', playerId: 'nba-9', powerType: 'vote_steal', powerLabel: 'Vote steal', powerDesc: 'Take a vote.', auditLog: { assignedSource: 'draft_pool' } },
      { id: 'idol-c', playerId: 'nba-70', powerType: 'extra_vote', powerLabel: 'Extra vote', powerDesc: 'One more ballot.', auditLog: { assignedSource: 'draft_pool' } },
    ]
    db.survivorIdol.findMany.mockResolvedValue(pooled as never)
    db.draftPick.findMany.mockResolvedValue([
      { playerId: 'nba-3', playerName: 'Player 3', rosterId: 'roster-1', assetType: 'player' },
      { playerId: 'nba-9', playerName: 'Player 9', rosterId: 'roster-2', assetType: 'player' },
      { playerId: 'nba-1', playerName: 'Player 1', rosterId: 'roster-1', assetType: 'player' },
    ] as never)
    const waiverPool = candidates.filter(c => !['nba-3', 'nba-9', 'nba-1'].includes(c.playerId))
    const out = await seedSurvivorIdols('lg', { db: db as never, seed: 5, waiverPool })
    expect(out).toMatchObject({ ok: true, seeded: true, fromPool: 3, waiverImmunity: 2, voteShieldCount: 4, ownerCount: 2 })
    const updates = db.survivorIdol.update.mock.calls.map(([arg]: any) => arg)
    expect(updates.find((u: any) => u.where.id === 'idol-a').data).toMatchObject({ rosterId: 'roster-1', currentOwnerUserId: 'user-1', originalOwnerUserId: 'user-1' })
    expect(updates.find((u: any) => u.where.id === 'idol-b').data).toMatchObject({ rosterId: 'roster-2', currentOwnerUserId: 'user-2' })
    expect(updates.find((u: any) => u.where.id === 'idol-c').data).toMatchObject({ rosterId: SURVIVOR_WAIVER_IDOL_ROSTER_ID })
    // Private reveals for the two drafters only; the expiry sentence rides along.
    const dms = db.leagueChatMessage.create.mock.calls.map(([arg]: any) => arg.data)
    expect(dms).toHaveLength(2)
    expect(dms.map((dm: any) => dm.visibleToUserId).sort()).toEqual(['user-1', 'user-2'])
    expect(dms[0]).toMatchObject({ isPrivate: true, metadata: expect.objectContaining({ survivorIdolReveal: true, foundInDraft: true, idolLabel: 'Immunity idol', expiryText: expect.stringMatching(/before the tribes merge/) }) })
    expect(dms[0].message).toMatch(/You drafted Player and found a hidden Immunity idol/)
    // Two immunity idols on undrafted players: never a drafted one, never one already carrying an idol.
    const waiver = db.survivorIdol.create.mock.calls.map(([arg]: any) => arg.data)
    expect(waiver).toHaveLength(2)
    expect(waiver.every((row: any) => row.rosterId === SURVIVOR_WAIVER_IDOL_ROSTER_ID && row.powerType === 'vote_shield' && row.currentOwnerUserId === null && row.expiresAtMerge === true)).toBe(true)
    expect(waiver.every((row: any) => !['nba-3', 'nba-9', 'nba-1', 'nba-70'].includes(row.playerId))).toBe(true)
    expect(pool.load).not.toHaveBeenCalled()
    expect(db.survivorAuditEntry.create.mock.calls.at(-1)[0].data).toMatchObject({ action: 'idols_seeded', data: expect.objectContaining({ fromPool: 3, drafted: 2, undrafted: 1, waiverImmunity: 2 }) })
  })

  it('a pool placement waiting for the draft does not count as seeded', async () => {
    const db = baseDb()
    await getIdolSeedStatus('lg', db as never)
    expect(db.survivorIdol.count).toHaveBeenCalledWith({ where: { leagueId: 'lg', rosterId: { not: SURVIVOR_POOL_IDOL_ROSTER_ID } } })
  })
})
