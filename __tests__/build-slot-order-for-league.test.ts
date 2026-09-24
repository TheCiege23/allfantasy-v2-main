import { beforeEach, describe, expect, it, vi } from 'vitest'

const hm = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  resolveWeightedLotterySlotOrderForLeague: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: hm.leagueFindUnique },
  },
}))

vi.mock('@/lib/draft/resolve-draft-context', () => ({
  resolveWeightedLotterySlotOrderForLeague: hm.resolveWeightedLotterySlotOrderForLeague,
}))

beforeEach(() => {
  vi.clearAllMocks()
  hm.resolveWeightedLotterySlotOrderForLeague.mockResolvedValue(null)
})

function league({
  teamCount,
  rosters,
  teams,
  leagueSettings = null,
}: {
  teamCount: number
  rosters: Array<{ id: string }>
  teams: Array<{ id: string; externalId?: string; ownerName?: string | null; teamName?: string | null }>
  leagueSettings?: { draftOrderSlots?: unknown } | null
}) {
  return {
    leagueSize: teamCount,
    rosters,
    teams,
    leagueSettings,
  }
}

describe('buildSlotOrderForLeague (Slice 5: commissioner in slot 1)', () => {
  it('fresh league with 1 human roster + 1 team seats human in slot 1, pads 2..12 with placeholders', async () => {
    hm.leagueFindUnique.mockResolvedValue(
      league({
        teamCount: 12,
        rosters: [{ id: 'human-roster-1' }],
        teams: [{ id: 't1', externalId: 'human-roster-1', ownerName: 'Commish Guy' }],
      }),
    )
    const { buildSlotOrderForLeague } = await import('@/lib/live-draft-engine/DraftSessionService')
    const slotOrder = await buildSlotOrderForLeague('league-1')
    expect(slotOrder).toHaveLength(12)
    expect(slotOrder[0]).toEqual({ slot: 1, rosterId: 'human-roster-1', displayName: 'Commish Guy' })
    for (let i = 1; i < 12; i++) {
      expect(slotOrder[i].rosterId).toBe(`placeholder-${i + 1}`)
      expect(slotOrder[i].slot).toBe(i + 1)
    }
  })

  it('fresh league with ZERO rosters falls back to all placeholders (legacy path)', async () => {
    hm.leagueFindUnique.mockResolvedValue(
      league({ teamCount: 12, rosters: [], teams: [] }),
    )
    const { buildSlotOrderForLeague } = await import('@/lib/live-draft-engine/DraftSessionService')
    const slotOrder = await buildSlotOrderForLeague('league-1')
    expect(slotOrder).toHaveLength(12)
    expect(slotOrder.every((s) => s.rosterId.startsWith('placeholder-'))).toBe(true)
  })

  it('partial: 3 rosters + 3 teams in a 12-team league gives 3 real + 9 placeholders', async () => {
    hm.leagueFindUnique.mockResolvedValue(
      league({
        teamCount: 12,
        rosters: [{ id: 'r-1' }, { id: 'r-2' }, { id: 'r-3' }],
        teams: [
          { id: 't1', externalId: 'r-1', ownerName: 'Owner 1' },
          { id: 't2', externalId: 'r-2', ownerName: 'Owner 2' },
          { id: 't3', externalId: 'r-3', teamName: 'Team Three' },
        ],
      }),
    )
    const { buildSlotOrderForLeague } = await import('@/lib/live-draft-engine/DraftSessionService')
    const slotOrder = await buildSlotOrderForLeague('league-1')
    expect(slotOrder).toHaveLength(12)
    expect(slotOrder[0]).toEqual({ slot: 1, rosterId: 'r-1', displayName: 'Owner 1' })
    expect(slotOrder[1]).toEqual({ slot: 2, rosterId: 'r-2', displayName: 'Owner 2' })
    expect(slotOrder[2]).toEqual({ slot: 3, rosterId: 'r-3', displayName: 'Team Three' })
    expect(slotOrder[3].rosterId).toBe('placeholder-4')
    expect(slotOrder[11].rosterId).toBe('placeholder-12')
  })

  it('full league (rosters.length === teamCount): all real, each named by its own team', async () => {
    const rosters = Array.from({ length: 12 }, (_, i) => ({ id: `r-${i + 1}` }))
    const teams = Array.from({ length: 12 }, (_, i) => ({ id: `t-${i + 1}`, externalId: `r-${i + 1}`, ownerName: `Owner ${i + 1}` }))
    hm.leagueFindUnique.mockResolvedValue(league({ teamCount: 12, rosters, teams }))
    const { buildSlotOrderForLeague } = await import('@/lib/live-draft-engine/DraftSessionService')
    const slotOrder = await buildSlotOrderForLeague('league-1')
    expect(slotOrder).toHaveLength(12)
    for (let i = 0; i < 12; i++) {
      expect(slotOrder[i]).toEqual({
        slot: i + 1,
        rosterId: `r-${i + 1}`,
        displayName: `Owner ${i + 1}`,
      })
    }
  })

  it('partial path falls back to "Team N" when team has no ownerName/teamName', async () => {
    hm.leagueFindUnique.mockResolvedValue(
      league({
        teamCount: 4,
        rosters: [{ id: 'r-1' }],
        teams: [{ id: 't-1' /* no ownerName/teamName */ }],
      }),
    )
    const { buildSlotOrderForLeague } = await import('@/lib/live-draft-engine/DraftSessionService')
    const slotOrder = await buildSlotOrderForLeague('league-1')
    expect(slotOrder[0]).toEqual({ slot: 1, rosterId: 'r-1', displayName: 'Team 1' })
    expect(slotOrder.slice(1).map((s) => s.rosterId)).toEqual([
      'placeholder-2',
      'placeholder-3',
      'placeholder-4',
    ])
  })

  /**
   * The rosters and teams come back as two unordered lists. Zipping them by index labelled each
   * slot with another manager's name; a slot is now named by the team that owns its roster.
   */
  it('names each slot by the team that owns its roster, not by list position', async () => {
    hm.leagueFindUnique.mockResolvedValue(
      league({
        teamCount: 2,
        rosters: [{ id: 'r-amy' }, { id: 'r-ben' }],
        teams: [
          { id: 't-ben', externalId: 'r-ben', ownerName: 'Ben' },
          { id: 't-amy', externalId: 'r-amy', ownerName: 'Amy' },
        ],
      }),
    )
    const { buildSlotOrderForLeague } = await import('@/lib/live-draft-engine/DraftSessionService')
    const slotOrder = await buildSlotOrderForLeague('league-1')
    expect(slotOrder).toEqual([
      { slot: 1, rosterId: 'r-amy', displayName: 'Amy' },
      { slot: 2, rosterId: 'r-ben', displayName: 'Ben' },
    ])
  })

  /** A slot's id must be a ROSTER id — the pick authority checks `Roster.id`, never a team id. */
  it('never seats a team id, even when a league has more teams than rosters', async () => {
    hm.leagueFindUnique.mockResolvedValue(
      league({
        teamCount: 3,
        rosters: [{ id: 'r-1' }],
        teams: [
          { id: 't-1', externalId: 'r-1', ownerName: 'One' },
          { id: 't-2', ownerName: 'Two' },
          { id: 't-3', ownerName: 'Three' },
        ],
      }),
    )
    const { buildSlotOrderForLeague } = await import('@/lib/live-draft-engine/DraftSessionService')
    const slotOrder = await buildSlotOrderForLeague('league-1')
    expect(slotOrder.map((s) => s.rosterId)).toEqual(['r-1', 'placeholder-2', 'placeholder-3'])
  })
})
