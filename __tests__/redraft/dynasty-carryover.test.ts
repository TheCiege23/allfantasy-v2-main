import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * A dynasty league keeps its whole roster into next season. Before this, the offseason built
 * next season's rosters empty and opened a keeper window capped at `keeperCount` (0 for a
 * wizard-made league), so year two started with every dynasty roster emptied.
 */

const m = vi.hoisted(() => ({
  rosterFindMany: vi.fn(),
  playerCreate: vi.fn(),
  seasonUpdateMany: vi.fn(),
  leagueUpdate: vi.fn(),
  leagueFindUnique: vi.fn(),
  ensureShell: vi.fn(),
  openWindow: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftRoster: { findMany: m.rosterFindMany },
    redraftRosterPlayer: { create: m.playerCreate },
    redraftSeason: { updateMany: m.seasonUpdateMany },
    league: { update: m.leagueUpdate, findUnique: m.leagueFindUnique },
  },
}))
vi.mock('@/lib/redraft/offseason/ensureNextRedraftSeasonShell', () => ({ ensureNextRedraftSeasonShell: m.ensureShell }))
vi.mock('@/lib/keeper/selectionEngine', () => ({ openKeeperSelectionPhase: m.openWindow }))
vi.mock('@/lib/keeper/eligibilityEngine', () => ({ computeKeeperEligibility: vi.fn() }))
vi.mock('@/lib/commissioner/CommissionerRatingTrigger', () => ({ checkAndTriggerRatingIfOffseason: vi.fn(async () => {}) }))

import { carryDynastyRostersForward, isDynastyFamilyLeague } from '@/lib/redraft/offseason/carryDynastyRosters'
import { triggerKeeperOffseason } from '@/lib/keeper/offseasonEngine'

const player = (playerId: string, extra: Record<string, unknown> = {}) => ({
  playerId,
  playerName: `P ${playerId}`,
  position: 'RB',
  team: 'DAL',
  sport: 'NFL',
  slotType: 'bench',
  injuryStatus: null,
  byeWeek: 7,
  acquisitionType: 'drafted',
  ...extra,
})

beforeEach(() => {
  vi.clearAllMocks()
  m.playerCreate.mockResolvedValue({})
})

describe('carryDynastyRostersForward', () => {
  it("copies every active player onto the same owner's roster next season, once", async () => {
    m.rosterFindMany
      .mockResolvedValueOnce([
        { id: 'old-a', ownerId: 'user-a', players: [player('p1'), player('p2', { slotType: 'taxi' })] },
        { id: 'old-o', ownerId: 'roster:R-9', players: [player('p3')] },
        { id: 'old-x', ownerId: 'left-league', players: [player('p4')] },
      ])
      .mockResolvedValueOnce([
        // p2 is already there — a retry, or both callers running — and must not be duplicated.
        { id: 'new-a', ownerId: 'user-a', players: [{ playerId: 'p2' }] },
        { id: 'new-o', ownerId: 'roster:R-9', players: [] },
      ])

    const r = await carryDynastyRostersForward('L1', 'season-1', 'season-2')

    expect(r).toEqual({ rostersMatched: 2, playersCopied: 2, playersAlreadyPresent: 1, unmatchedOwnerIds: ['left-league'] })
    const created = m.playerCreate.mock.calls.map((c) => [c[0].data.rosterId, c[0].data.playerId])
    expect(created).toEqual([
      ['new-a', 'p1'],
      ['new-o', 'p3'],
    ])
    expect(m.playerCreate.mock.calls[0]![0].data).toMatchObject({ isKept: true, acquisitionType: 'drafted', byeWeek: 7 })
    // Dropped players are excluded by the query itself.
    expect(m.rosterFindMany.mock.calls[0]![0].select.players.where).toEqual({ droppedAt: null })
  })

  it('recognises the dynasty family, including legacy isDynasty rows', () => {
    expect(isDynastyFamilyLeague({ leagueType: 'dynasty' })).toBe(true)
    expect(isDynastyFamilyLeague({ leagueType: 'Devy' })).toBe(true)
    expect(isDynastyFamilyLeague({ leagueType: 'c2c' })).toBe(true)
    expect(isDynastyFamilyLeague({ leagueType: 'redraft', isDynasty: true })).toBe(true)
    expect(isDynastyFamilyLeague({ leagueType: 'keeper', isDynasty: false })).toBe(false)
    expect(isDynastyFamilyLeague({ leagueType: 'redraft' })).toBe(false)
  })
})

describe('triggerKeeperOffseason', () => {
  beforeEach(() => {
    m.ensureShell.mockResolvedValue({ id: 'season-2', season: 2027 })
    m.rosterFindMany.mockResolvedValue([])
  })

  it('dynasty: carries the whole roster and opens no keeper window', async () => {
    m.leagueFindUnique.mockResolvedValue({ leagueType: 'dynasty', isDynasty: true })
    await triggerKeeperOffseason('L1', 'season-1')
    expect(m.rosterFindMany).toHaveBeenCalledTimes(2)
    expect(m.openWindow).not.toHaveBeenCalled()
  })

  it('keeper: opens the keeper window and carries nothing wholesale', async () => {
    m.leagueFindUnique.mockResolvedValue({ leagueType: 'keeper', isDynasty: false })
    await triggerKeeperOffseason('L1', 'season-1')
    expect(m.openWindow).toHaveBeenCalledWith('L1', 'season-2', expect.any(Date))
    expect(m.rosterFindMany).not.toHaveBeenCalled()
  })
})
