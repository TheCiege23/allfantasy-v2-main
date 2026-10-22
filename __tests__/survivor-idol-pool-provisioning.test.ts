// @vitest-environment node
/**
 * Idols hide on pool players at draft lock and resolve to whoever drafted them (owner's call,
 * 2026-10-20); the rest stay on the wire, and two immunity idols join them for undrafted players.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const pool = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('@/lib/draft-room/getResolvedDraftPoolForLeague', () => ({ getResolvedDraftPoolForLeague: pool.load }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/survivor/survivorSetupTransaction', () => ({ withSurvivorSetupTransaction: vi.fn() }))

import { placeSurvivorIdolsInPool, seedSurvivorIdols, getIdolSeedStatus } from '@/lib/survivor/survivorIdolProvisioning'
import { SURVIVOR_POOL_IDOL_ROSTER_ID, SURVIVOR_WAIVER_IDOL_ROSTER_ID } from '@/lib/survivor/survivorIdolPoolPlacement'

const resolved = ['immunity', 'steal-three', 'vote-steal', 'vote-steal', 'extra-vote', 'extra-vote']
const entries = Array.from({ length: 80 }, (_, i) => ({ playerId: `nba-${i}`, name: `Player ${i}`, adp: i + 1 }))

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
  pool.load.mockResolvedValue({ entries, sport: 'NBA', count: entries.length, rosterConfigurationIncomplete: false })
})

describe('placeSurvivorIdolsInPool (draft lock)', () => {
  it('hides one idol per sealed type on distinct pool players, owned by nobody, with the league expiry stamped', async () => {
    const db = baseDb()
    const out = await placeSurvivorIdolsInPool('lg', { teamCount: 16, rounds: 2, seed: 11, db: db as never })
    expect(out).toMatchObject({ ok: true, placed: true, count: 6 })
    expect(pool.load).toHaveBeenCalledWith('lg', expect.objectContaining({ limit: 64 }))
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
    const out = await seedSurvivorIdols('lg', { db: db as never, seed: 5 })
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
    expect(pool.load).toHaveBeenCalledWith('lg', expect.objectContaining({ excludeDraftedPlayerIds: new Set(['nba-3', 'nba-9', 'nba-1']) }))
    expect(db.survivorAuditEntry.create.mock.calls.at(-1)[0].data).toMatchObject({ action: 'idols_seeded', data: expect.objectContaining({ fromPool: 3, drafted: 2, undrafted: 1, waiverImmunity: 2 }) })
  })

  it('a pool placement waiting for the draft does not count as seeded', async () => {
    const db = baseDb()
    await getIdolSeedStatus('lg', db as never)
    expect(db.survivorIdol.count).toHaveBeenCalledWith({ where: { leagueId: 'lg', rosterId: { not: SURVIVOR_POOL_IDOL_ROSTER_ID } } })
  })
})
