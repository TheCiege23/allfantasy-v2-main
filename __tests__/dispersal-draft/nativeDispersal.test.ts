/**
 * The dispersal draft in a league AllFantasy runs (lib/dispersal-draft/nativeDispersal.ts): the pool
 * comes from the orphan team's RedraftRosterPlayer rows, native future picks and faabBalance — not
 * the lineup JSON, which held no usable player rows — and a completed draft moves the claimed
 * players' rows, picks and FAAB where native scoring and the roster screen read them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  picks: vi.fn(),
  transfer: vi.fn(),
  mirror: vi.fn(),
  db: {
    league: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    redraftSeason: { findFirst: vi.fn() },
    redraftRoster: { findMany: vi.fn(), updateMany: vi.fn() },
    redraftRosterPlayer: { findMany: vi.fn(), updateMany: vi.fn() },
    roster: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    dispersalDraft: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: m.db }))
vi.mock('@/lib/league-trade-engine/nativeFuturePicks', () => ({ loadNativeFuturePicks: m.picks, transferNativeFuturePick: m.transfer }))
vi.mock('@/lib/league/faabMirror', () => ({ copyRedraftFaabToGeneric: m.mirror }))

import { addToBench, applyNativeDispersal, buildNativeAssetPool, removeFromLineup, seasonTeamsByRoster } from '@/lib/dispersal-draft/nativeDispersal'
import { buildAssetPoolFromRosters } from '@/lib/dispersal-draft/assetPoolBuilder'
import { DispersalDraftEngine } from '@/lib/dispersal-draft/DispersalDraftEngine'
import type { DispersalAsset } from '@/lib/dispersal-draft/types'

const db = m.db as never

// Draft rosters (Roster.id) and their season teams (RedraftRoster.id), mapped by owner.
const ROSTERS = [
  { id: 'orphan', platformUserId: 'orphan-1' },
  { id: 'aces', platformUserId: 'u-aces' },
  { id: 'bees', platformUserId: 'u-bees' },
]
const TEAMS = [
  { id: 'rr-orphan', ownerId: 'orphan-1', faabBalance: 40 },
  { id: 'rr-aces', ownerId: 'u-aces', faabBalance: 60 },
  { id: 'rr-bees', ownerId: 'roster:bees', faabBalance: 10 },
]

function seed() {
  m.db.league.findUnique.mockResolvedValue({ platform: 'allfantasy' })
  m.db.redraftSeason.findFirst.mockResolvedValue({ id: 's27' })
  m.db.redraftRoster.findMany.mockImplementation(async (args: { where: { seasonId?: string; id?: { in: string[] } } }) =>
    args.where.seasonId ? TEAMS : TEAMS.filter((t) => args.where.id?.in.includes(t.id)),
  )
  m.db.roster.findMany.mockResolvedValue(ROSTERS)
  m.db.redraftRosterPlayer.findMany.mockResolvedValue([
    { rosterId: 'rr-orphan', playerId: 'p1', playerName: 'Ace Back', position: 'RB', team: 'KC' },
    { rosterId: 'rr-orphan', playerId: 'p2', playerName: 'Bo Wide', position: 'WR', team: '' },
  ])
  m.picks.mockResolvedValue({
    picks: [
      { season: 2027, round: 1, ownerTeamId: 'orphan', originalTeamId: 'orphan', source: 'own' },
      { season: 2027, round: 2, ownerTeamId: 'orphan', originalTeamId: 'aces', source: 'stored' },
      { season: 2027, round: 1, ownerTeamId: 'aces', originalTeamId: 'aces', source: 'own' },
    ],
  })
  m.db.redraftRosterPlayer.updateMany.mockResolvedValue({ count: 1 })
  m.db.roster.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({
    playerData:
      where.id === 'orphan'
        ? { players: ['p1', 'p2'], starters: ['p1'], lineup_sections: { starters: [{ id: 'p1' }], bench: [{ id: 'p2' }], ir: [], taxi: [], devy: [] } }
        : { players: ['a1'], lineup_sections: { starters: [{ id: 'a1' }], bench: [], ir: [], taxi: [], devy: [] } },
  }))
}

describe('the pool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seed()
  })
  it('maps each draft roster to its team this season by owner, including roster: owners', async () => {
    expect(await seasonTeamsByRoster(db, 'L')).toEqual(new Map([['orphan', 'rr-orphan'], ['aces', 'rr-aces'], ['bees', 'rr-bees']]))
  })
  it('is the orphan team’s players, its own and acquired future picks, and its FAAB', async () => {
    const pool = await buildNativeAssetPool(db, 'L', ['orphan'])
    expect(pool.map((a) => [a.assetType, a.playerId ?? a.pickId ?? a.faabAmount])).toEqual([
      ['player', 'p1'],
      ['player', 'p2'],
      ['draft_pick', 'fdp:2027:1:orphan'],
      ['draft_pick', 'fdp:2027:2:aces'],
      ['faab', 40],
    ])
    expect(pool[0]).toMatchObject({ sourceRosterId: 'orphan', playerName: 'Ace Back', playerPosition: 'RB', playerTeam: 'KC', isAvailable: true })
    expect(pool[1].playerTeam).toBeUndefined()
    expect(pool[3]).toMatchObject({ pickLabel: '2027 2nd round (acquired)', isTradedPick: true, originalOwnerRosterId: 'aces', tradedToRosterId: 'orphan' })
    expect(m.db.redraftRosterPlayer.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { rosterId: { in: ['rr-orphan'] }, droppedAt: null } }))
  })
  it('the builder takes this path for a native league and the JSON path for any other', async () => {
    const native = await buildAssetPoolFromRosters('L', ['orphan'])
    expect(native).toMatchObject({ playerCount: 2, draftPickCount: 2, faabCount: 1, totalFaab: 40, totalCount: 5 })
    m.db.league.findUnique.mockResolvedValue({ platform: 'sleeper' })
    m.db.roster.findMany.mockResolvedValue([{ id: 'orphan', playerData: [{ player_id: 'x9', full_name: 'Imported Guy' }], faabRemaining: 0 }])
    const imported = await buildAssetPoolFromRosters('L', ['orphan'])
    expect(imported.assets.map((a) => a.playerId)).toEqual(['x9'])
  })
})

describe('the lineup edits', () => {
  it('take the players off every list, keeping everyone else in place', () => {
    const before = { players: ['p1', 'p2', 'p3'], starters: ['p1'], reserve: ['p3'], lineup_sections: { starters: [{ id: 'p1' }], bench: [{ id: 'p2' }], ir: [{ id: 'p3' }] }, other: 1 }
    expect(removeFromLineup(before, ['p1', 'p3'])).toEqual({ players: ['p2'], starters: [], reserve: [], lineup_sections: { starters: [], bench: [{ id: 'p2' }], ir: [] }, other: 1 })
  })
  it('add to the end of the bench, never twice', () => {
    const before = { players: ['a1'], lineup_sections: { starters: [{ id: 'a1' }], bench: [] } }
    const after = addToBench(before, [{ id: 'p1', name: 'Ace Back', position: 'RB' }, { id: 'a1' }])
    expect(after.players).toEqual(['a1', 'p1'])
    expect((after.lineup_sections as { bench: unknown[] }).bench).toEqual([{ id: 'p1', name: 'Ace Back', position: 'RB', team: undefined }])
  })
})

const claimed = (over: Partial<DispersalAsset>): DispersalAsset => ({ id: 'x', assetType: 'player', sourceRosterId: 'orphan', isAvailable: false, ...over })

describe('a completed draft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seed()
  })
  const assets: DispersalAsset[] = [
    claimed({ playerId: 'p1', playerName: 'Ace Back', playerPosition: 'RB', claimedByRosterId: 'aces' }),
    claimed({ playerId: 'p2', isAvailable: true, claimedByRosterId: null }),
    claimed({ assetType: 'draft_pick', pickId: 'fdp:2027:1:orphan', claimedByRosterId: 'bees' }),
    claimed({ assetType: 'draft_pick', pickId: 'fdp:2027:2:aces', claimedByRosterId: null }),
    claimed({ assetType: 'faab', faabAmount: 40, claimedByRosterId: 'aces' }),
  ]
  const now = new Date('2026-11-01T00:00:00Z')

  it('moves the claimed player’s row to the claiming team’s bench, as a trade does', async () => {
    const r = await applyNativeDispersal(db, { leagueId: 'L', assets, now })
    expect(m.db.redraftRosterPlayer.updateMany).toHaveBeenCalledWith({
      where: { rosterId: 'rr-orphan', playerId: 'p1', droppedAt: null },
      data: { rosterId: 'rr-aces', slotType: 'BENCH', acquisitionType: 'dispersal_draft', isLocked: false, addedAt: now },
    })
    expect(r).toMatchObject({ playersMoved: 1, playersDropped: 1, picksMoved: 1, missing: [] })
  })
  it('drops the unclaimed player to free agency; moves the claimed pick; leaves the unclaimed one', async () => {
    await applyNativeDispersal(db, { leagueId: 'L', assets, now })
    expect(m.db.redraftRosterPlayer.updateMany).toHaveBeenCalledWith({ where: { rosterId: 'rr-orphan', playerId: 'p2', droppedAt: null }, data: { droppedAt: now } })
    expect(m.transfer).toHaveBeenCalledTimes(1)
    expect(m.transfer).toHaveBeenCalledWith(db, { leagueId: 'L', ref: 'fdp:2027:1:orphan', fromRosterId: 'orphan', toRosterId: 'bees', now })
  })
  it('the orphan team’s FAAB is consumed and mirrored, never credited', async () => {
    await applyNativeDispersal(db, { leagueId: 'L', assets, now })
    expect(m.db.redraftRoster.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['rr-orphan'] } }, data: { faabBalance: 0 } })
    expect(m.mirror).toHaveBeenCalledWith(db, ['rr-orphan'])
  })
  it('edits both lineups for the players that moved, and only those', async () => {
    await applyNativeDispersal(db, { leagueId: 'L', assets, now })
    const writes = Object.fromEntries(m.db.roster.update.mock.calls.map(([a]: [{ where: { id: string }; data: { playerData: Record<string, unknown> } }]) => [a.where.id, a.data.playerData]))
    expect(writes.orphan.players).toEqual([])
    expect(writes.aces.players).toEqual(['a1', 'p1'])
    expect(writes.bees).toBeUndefined()
  })
  it('a claim on a player or pick that left the team meanwhile is reported, not fatal', async () => {
    m.db.redraftRosterPlayer.updateMany.mockResolvedValueOnce({ count: 0 })
    m.transfer.mockRejectedValueOnce(new Error('Pick is no longer tradeable'))
    const r = await applyNativeDispersal(db, { leagueId: 'L', assets, now })
    expect(r.missing).toEqual(['p1', 'fdp:2027:1:orphan'])
    expect(r.playersMoved).toBe(0)
  })
})

describe('the engine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seed()
    m.db.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(m.db))
    m.db.league.findFirst.mockResolvedValue({ settings: {} })
    m.db.dispersalDraft.findUnique.mockResolvedValue({
      id: 'D', status: 'completed', leagueId: 'L', participantRosterIds: ['aces', 'bees'],
      assetPool: [
        claimed({ playerId: 'p1', claimedByRosterId: 'aces' }),
        claimed({ playerId: 'p2', claimedByRosterId: null, isAvailable: true }),
      ],
    })
  })
  it('a native league completes through the native tables, and records what went unclaimed', async () => {
    await DispersalDraftEngine.completeDraft('D')
    expect(m.db.redraftRosterPlayer.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ rosterId: 'rr-aces' }) }))
    // The JSON path's own writes (roster.findFirst reads of playerData) never ran.
    expect(m.db.roster.findFirst).not.toHaveBeenCalled()
    const settings = m.db.league.update.mock.calls[0][0].data.settings
    expect(settings.dispersalDraftLastCompletion).toMatchObject({ draftId: 'D', waiverWirePlayerIds: ['p2'] })
  })
  it('any other league keeps the JSON path', async () => {
    m.db.league.findUnique.mockResolvedValue({ platform: 'sleeper' })
    m.db.roster.findFirst.mockResolvedValue({ playerData: { players: [] } })
    await DispersalDraftEngine.completeDraft('D')
    expect(m.db.roster.findFirst).toHaveBeenCalled()
    expect(m.db.redraftRosterPlayer.updateMany).not.toHaveBeenCalled()
  })
})
