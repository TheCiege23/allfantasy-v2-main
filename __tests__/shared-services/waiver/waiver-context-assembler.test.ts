/**
 * Tests for WaiverContextAssembler.ts — mocks only the true external
 * boundaries (prisma, getEffectiveLeagueWaiverSettings, getPlayerPoolForLeague,
 * fetchFantasyCalcValues), same pattern as the Trade OS context-assembler
 * tests. getNormalizedLineupSections/getRosterPlayerIds/expandRosterPositionTokens/
 * computeTeamNeeds are real, pure functions and run unmocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLeagueFindUnique, mockRosterFindUnique, mockRosterFindMany, mockGetEffectiveLeagueWaiverSettings, mockGetPlayerPoolForLeague, mockFetchFantasyCalcValues, mockResolvePlayers } =
  vi.hoisted(() => ({
    mockLeagueFindUnique: vi.fn(),
    mockRosterFindUnique: vi.fn(),
    mockRosterFindMany: vi.fn(),
    mockGetEffectiveLeagueWaiverSettings: vi.fn(),
    mockGetPlayerPoolForLeague: vi.fn(),
    mockFetchFantasyCalcValues: vi.fn(),
    mockResolvePlayers: vi.fn(),
  }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: mockLeagueFindUnique },
    roster: { findUnique: mockRosterFindUnique, findMany: mockRosterFindMany },
  },
}))
vi.mock('@/lib/waiver-wire/settings-service', () => ({ getEffectiveLeagueWaiverSettings: mockGetEffectiveLeagueWaiverSettings }))
vi.mock('@/lib/sport-teams/SportPlayerPoolResolver', () => ({ getPlayerPoolForLeague: mockGetPlayerPoolForLeague }))
vi.mock('@/lib/player-valuations/canonicalPlayerValuations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/player-valuations/canonicalPlayerValuations')>('@/lib/player-valuations/canonicalPlayerValuations')
  return { ...actual, fetchFantasyCalcValues: mockFetchFantasyCalcValues }
})
vi.mock('@/lib/shared-services/player-identity', () => ({ resolvePlayers: mockResolvePlayers }))

import { buildWaiverDecisionContext } from '@/lib/shared-services/waiver/WaiverContextAssembler'

function rosterPlayerData(overrides: { starters?: unknown[]; bench?: unknown[] } = {}) {
  return {
    lineup_sections: {
      starters: overrides.starters ?? [{ id: 'p1', name: 'Player One', position: 'RB', team: 'KC', age: 24 }],
      bench: overrides.bench ?? [],
      ir: [],
      taxi: [],
      devy: [],
    },
    players: [...(overrides.starters ?? [{ id: 'p1' }]), ...(overrides.bench ?? [])].map((p: any) => p.id ?? p),
  }
}

const BASE_LEAGUE = {
  id: 'league-1',
  sport: 'NFL',
  platform: 'sleeper',
  isDynasty: true,
  leagueSize: 12,
  settings: { rosterSettings: { starterSlots: { QB: 1 } } },
  starters: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN'],
}

describe('buildWaiverDecisionContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetEffectiveLeagueWaiverSettings.mockResolvedValue({ normalizedWaiverType: 'faab', faabBudget: 100 })
    mockGetPlayerPoolForLeague.mockResolvedValue([])
    mockFetchFantasyCalcValues.mockResolvedValue([])
    mockResolvePlayers.mockImplementation(async (refs: Array<{ provider: string; sourceId: string }>) =>
      refs.map((ref) => ({
        input: ref,
        player: null,
        confidence: 'unresolved',
        source: 'unresolved',
        resolvedAt: new Date().toISOString(),
        diagnostics: { matchedField: null, candidateCount: 0, tiedCandidates: 0, reason: 'no mock configured for this id' },
      }))
    )
  })

  it('throws honestly when the league does not exist', async () => {
    mockLeagueFindUnique.mockResolvedValue(null)
    await expect(buildWaiverDecisionContext({ leagueId: 'league-1', rosterId: 'roster-1' })).rejects.toThrow('League not found: league-1')
  })

  it('throws honestly when the roster does not exist', async () => {
    mockLeagueFindUnique.mockResolvedValue(BASE_LEAGUE)
    mockRosterFindUnique.mockResolvedValue(null)
    await expect(buildWaiverDecisionContext({ leagueId: 'league-1', rosterId: 'roster-1' })).rejects.toThrow('Roster not found: roster-1')
  })

  it('assembles a real context from Roster.playerData via getNormalizedLineupSections', async () => {
    mockLeagueFindUnique.mockResolvedValue(BASE_LEAGUE)
    mockRosterFindUnique.mockResolvedValue({
      playerData: rosterPlayerData(),
      faabRemaining: 80,
      waiverPriority: 3,
      platformUserId: 'manager-1',
    })
    mockRosterFindMany.mockResolvedValue([{ id: 'roster-1', playerData: rosterPlayerData() }])

    const ctx = await buildWaiverDecisionContext({ leagueId: 'league-1', rosterId: 'roster-1' })

    expect(ctx.platform).toBe('sleeper')
    expect(ctx.managerKey).toBe('manager-1')
    expect(ctx.faabRemaining).toBe(80)
    expect(ctx.waiverPriority).toBe(3)
    expect(ctx.waiverType).toBe('faab')
    expect(ctx.faabBudget).toBe(100)
    expect(ctx.engineInput.roster).toHaveLength(1)
    expect(ctx.engineInput.roster![0]).toMatchObject({ id: 'p1', name: 'Player One', position: 'RB', team: 'KC', slot: 'starter', age: 24 })
  })

  it('excludes already-rostered players from the free-agent pool', async () => {
    mockLeagueFindUnique.mockResolvedValue(BASE_LEAGUE)
    mockRosterFindUnique.mockResolvedValue({ playerData: rosterPlayerData(), faabRemaining: null, waiverPriority: null, platformUserId: 'manager-1' })
    mockRosterFindMany.mockResolvedValue([{ id: 'roster-1', playerData: rosterPlayerData() }])
    mockGetPlayerPoolForLeague.mockResolvedValue([
      { player_id: 'p1', full_name: 'Player One', position: 'RB', team_abbreviation: 'KC', team: null, age: 24, injury_status: null, sport_type: 'NFL', team_id: null, status: null, external_source_id: null },
      { player_id: 'p2', full_name: 'Free Agent Two', position: 'WR', team_abbreviation: 'SF', team: null, age: 22, injury_status: null, sport_type: 'NFL', team_id: null, status: null, external_source_id: null },
    ])

    const ctx = await buildWaiverDecisionContext({ leagueId: 'league-1', rosterId: 'roster-1' })

    expect(ctx.dataCompleteness.freeAgentPoolSize).toBe(1)
    expect(ctx.engineInput.availablePlayers).toHaveLength(1)
    expect(ctx.engineInput.availablePlayers[0].playerId).toBe('p2')
  })

  it('falls back to the unmatched-player valuation and reports the count when FantasyCalc has no match', async () => {
    mockLeagueFindUnique.mockResolvedValue(BASE_LEAGUE)
    mockRosterFindUnique.mockResolvedValue({ playerData: rosterPlayerData(), faabRemaining: null, waiverPriority: null, platformUserId: 'manager-1' })
    mockRosterFindMany.mockResolvedValue([{ id: 'roster-1', playerData: rosterPlayerData() }])
    mockFetchFantasyCalcValues.mockResolvedValue([]) // no matches at all

    const ctx = await buildWaiverDecisionContext({ leagueId: 'league-1', rosterId: 'roster-1' })

    expect(ctx.engineInput.roster![0].value).toBe(200)
    expect(ctx.dataCompleteness.unmatchedValuationCount).toBeGreaterThan(0)
  })

  it('leaves needs/surplus empty and documents the gap when League.starters is not a resolvable array', async () => {
    mockLeagueFindUnique.mockResolvedValue({ ...BASE_LEAGUE, starters: null })
    mockRosterFindUnique.mockResolvedValue({ playerData: rosterPlayerData(), faabRemaining: null, waiverPriority: null, platformUserId: 'manager-1' })
    mockRosterFindMany.mockResolvedValue([{ id: 'roster-1', playerData: rosterPlayerData() }])

    const ctx = await buildWaiverDecisionContext({ leagueId: 'league-1', rosterId: 'roster-1' })

    expect(ctx.needs).toEqual([])
    expect(ctx.surplus).toEqual([])
    expect(ctx.engineInput.rosterPositions).toBeUndefined()
  })

  it('derives isSF from the league settings snapshot (starterSlots.QB >= 2)', async () => {
    mockLeagueFindUnique.mockResolvedValue({ ...BASE_LEAGUE, settings: { rosterSettings: { starterSlots: { QB: 2 } } } })
    mockRosterFindUnique.mockResolvedValue({ playerData: rosterPlayerData(), faabRemaining: null, waiverPriority: null, platformUserId: 'manager-1' })
    mockRosterFindMany.mockResolvedValue([{ id: 'roster-1', playerData: rosterPlayerData() }])

    const ctx = await buildWaiverDecisionContext({ leagueId: 'league-1', rosterId: 'roster-1' })
    expect(ctx.engineInput.leagueSettings.isSF).toBe(true)
  })

  // Phase 13 real-data validation: a real imported Sleeper dynasty league's Roster.playerData
  // was found to have never gone through the `lineup_sections` normalization step (background
  // sync never completed — a real, honest, pre-existing "pre-draft/legacy state" documented in
  // lib/waiver-wire/roster-utils.ts's own updateRosterAfterWaiverMove comment). It only carries
  // Sleeper's native flat ID-array shape: playerData.players/starters/taxi/reserve. Before this
  // fix, getNormalizedLineupSections() silently returned all-empty sections for that shape,
  // so the shared Waiver Service saw an empty roster for a real, fully-rostered team.
  it('falls back to the flat players/starters/taxi/reserve ID arrays when lineup_sections is absent (real Sleeper-import shape)', async () => {
    const flatPlayerData = {
      players: ['100', '200', '300', '400'],
      starters: ['100', '200'],
      taxi: ['300'],
      reserve: ['400'],
      // No lineup_sections key at all — the real, observed state for an un-synced Sleeper import.
    }
    mockLeagueFindUnique.mockResolvedValue(BASE_LEAGUE)
    mockRosterFindUnique.mockResolvedValue({ playerData: flatPlayerData, faabRemaining: null, waiverPriority: 6, platformUserId: 'manager-1' })
    mockRosterFindMany.mockResolvedValue([{ id: 'roster-1', playerData: flatPlayerData }])
    const FIXTURE_PLAYERS: Record<string, { name: string; position: string; team: string }> = {
      '100': { name: 'Starter One', position: 'RB', team: 'KC' },
      '200': { name: 'Starter Two', position: 'WR', team: 'SF' },
      '300': { name: 'Taxi Prospect', position: 'WR', team: 'MIA' },
      '400': { name: 'Reserve Guy', position: 'RB', team: 'DAL' },
    }
    mockResolvePlayers.mockImplementation(async (refs: Array<{ provider: string; sourceId: string }>) =>
      refs.map((ref) => {
        const fixture = FIXTURE_PLAYERS[ref.sourceId]
        return {
          input: ref,
          player: fixture
            ? {
                canonicalPlayerId: `pim-${ref.sourceId}`,
                canonicalName: fixture.name,
                normalizedName: fixture.name.toLowerCase(),
                position: fixture.position,
                team: fixture.team,
                sport: 'NFL',
                providerIds: { sleeper: ref.sourceId },
              }
            : null,
          confidence: fixture ? 'direct' : 'unresolved',
          source: fixture ? 'player_identity_map_direct' : 'unresolved',
          resolvedAt: new Date().toISOString(),
          diagnostics: { matchedField: fixture ? 'sleeperId' : null, candidateCount: fixture ? 1 : 0, tiedCandidates: fixture ? 1 : 0, reason: fixture ? 'direct match' : 'no fixture' },
        }
      })
    )

    const ctx = await buildWaiverDecisionContext({ leagueId: 'league-1', rosterId: 'roster-1' })

    expect(ctx.dataCompleteness.rosterPlayerCount).toBe(4)
    expect(ctx.engineInput.roster).toHaveLength(4)
    const bySlot = Object.fromEntries((ctx.engineInput.roster ?? []).map((p) => [p.id, p.slot]))
    expect(bySlot['100']).toBe('starter')
    expect(bySlot['200']).toBe('starter')
    expect(bySlot['300']).toBe('taxi')
    expect(bySlot['400']).toBe('ir')
    const starterTwo = (ctx.engineInput.roster ?? []).find((p) => p.id === '200')
    expect(starterTwo).toMatchObject({ name: 'Starter Two', position: 'WR', team: 'SF' })
    expect(mockResolvePlayers).toHaveBeenCalled()
  })

  it('reports players as unresolved (never a fabricated match) when the resolver has no data for them', async () => {
    const flatPlayerData = { players: ['999'], starters: ['999'], taxi: [], reserve: [] }
    mockLeagueFindUnique.mockResolvedValue(BASE_LEAGUE)
    mockRosterFindUnique.mockResolvedValue({ playerData: flatPlayerData, faabRemaining: null, waiverPriority: null, platformUserId: 'manager-1' })
    mockRosterFindMany.mockResolvedValue([{ id: 'roster-1', playerData: flatPlayerData }])
    // beforeEach's default mockResolvePlayers already returns unresolved for everything.

    const ctx = await buildWaiverDecisionContext({ leagueId: 'league-1', rosterId: 'roster-1' })

    expect(ctx.engineInput.roster).toHaveLength(1)
    expect(ctx.engineInput.roster![0]).toMatchObject({ id: '999', name: 'Player 999', position: 'UNKNOWN', team: null, slot: 'starter' })
  })

  it('never calls the identity resolver for a non-provider platform (native/manual leagues)', async () => {
    const flatPlayerData = { players: ['1'], starters: ['1'], taxi: [], reserve: [] }
    mockLeagueFindUnique.mockResolvedValue({ ...BASE_LEAGUE, platform: 'manual' })
    mockRosterFindUnique.mockResolvedValue({ playerData: flatPlayerData, faabRemaining: null, waiverPriority: null, platformUserId: 'manager-1' })
    mockRosterFindMany.mockResolvedValue([{ id: 'roster-1', playerData: flatPlayerData }])

    const ctx = await buildWaiverDecisionContext({ leagueId: 'league-1', rosterId: 'roster-1' })

    expect(mockResolvePlayers).not.toHaveBeenCalled()
    expect(ctx.engineInput.roster).toHaveLength(1)
    expect(ctx.engineInput.roster![0]).toMatchObject({ id: '1', name: 'Player 1', position: 'UNKNOWN' })
  })

  it('still reports an empty roster honestly when neither lineup_sections nor flat player arrays exist', async () => {
    mockLeagueFindUnique.mockResolvedValue(BASE_LEAGUE)
    mockRosterFindUnique.mockResolvedValue({ playerData: {}, faabRemaining: null, waiverPriority: null, platformUserId: 'manager-1' })
    mockRosterFindMany.mockResolvedValue([{ id: 'roster-1', playerData: {} }])

    const ctx = await buildWaiverDecisionContext({ leagueId: 'league-1', rosterId: 'roster-1' })

    expect(ctx.engineInput.roster).toEqual([])
    expect(ctx.dataCompleteness.rosterPlayerCount).toBe(0)
  })
})
