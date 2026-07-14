/**
 * Tests for DraftContextAssembler.ts — mocks only the true external
 * boundaries (prisma, readAllFantasyAdpForLeague, getRosterTemplate,
 * getPlayerPoolForLeague), same pattern as Waiver OS's context-assembler
 * tests. assembleEngineInputFromPicks/playerKey/resolveLeagueScoringFlags are
 * real, pure functions and run unmocked (also exercised directly below).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockLeagueFindUnique,
  mockDraftSessionFindUnique,
  mockRosterFindUnique,
  mockDraftPickFindMany,
  mockReadAllFantasyAdpForLeague,
  mockGetRosterTemplate,
  mockGetPlayerPoolForLeague,
  mockIsIdpLeague,
} = vi.hoisted(() => ({
  mockLeagueFindUnique: vi.fn(),
  mockDraftSessionFindUnique: vi.fn(),
  mockRosterFindUnique: vi.fn(),
  mockDraftPickFindMany: vi.fn(),
  mockReadAllFantasyAdpForLeague: vi.fn(),
  mockGetRosterTemplate: vi.fn(),
  mockGetPlayerPoolForLeague: vi.fn(),
  mockIsIdpLeague: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: mockLeagueFindUnique },
    draftSession: { findUnique: mockDraftSessionFindUnique },
    roster: { findUnique: mockRosterFindUnique },
    draftPick: { findMany: mockDraftPickFindMany },
  },
}))
vi.mock('@/lib/adp/readSnapshotForLeague', () => ({ readAllFantasyAdpForLeague: mockReadAllFantasyAdpForLeague }))
vi.mock('@/lib/multi-sport/RosterTemplateService', () => ({ getRosterTemplate: mockGetRosterTemplate }))
vi.mock('@/lib/sport-teams/SportPlayerPoolResolver', () => ({ getPlayerPoolForLeague: mockGetPlayerPoolForLeague }))
vi.mock('@/lib/idp', () => ({ isIdpLeague: mockIsIdpLeague }))

import { assembleEngineInputFromPicks, buildDraftDecisionContext, playerKey, resolveLeagueScoringFlags } from '@/lib/shared-services/draft/DraftContextAssembler'

const BASE_LEAGUE = { sport: 'NFL', platform: 'sleeper', isDynasty: true, settings: { rosterSettings: { starterSlots: { QB: 1 } } } }
const BASE_SESSION = { id: 'session-1', status: 'in_progress', draftType: 'snake', devyConfig: null, currentRoundNum: 3, nextOverallPick: 30, teamCount: 12 }
const BASE_TEMPLATE = { templateId: 't1', sportType: 'NFL', name: 'Default', formatType: 'standard', slots: [{ slotName: 'QB', allowedPositions: ['QB'], starterCount: 1, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 1 }] }

describe('buildDraftDecisionContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadAllFantasyAdpForLeague.mockResolvedValue({ entries: [], totalDrafts: 0, computedAt: null, contextHash: '', draftMode: 'real' })
    mockGetRosterTemplate.mockResolvedValue(BASE_TEMPLATE)
    mockGetPlayerPoolForLeague.mockResolvedValue([])
    mockDraftPickFindMany.mockResolvedValue([])
    mockRosterFindUnique.mockResolvedValue({ platformUserId: 'manager-1' })
    mockIsIdpLeague.mockResolvedValue(false)
  })

  it('throws honestly when the league does not exist', async () => {
    mockLeagueFindUnique.mockResolvedValue(null)
    await expect(buildDraftDecisionContext({ leagueId: 'league-1', rosterId: 'roster-1' })).rejects.toThrow('League not found: league-1')
  })

  it('throws honestly when no DraftSession exists for the league', async () => {
    mockLeagueFindUnique.mockResolvedValue(BASE_LEAGUE)
    mockDraftSessionFindUnique.mockResolvedValue(null)
    await expect(buildDraftDecisionContext({ leagueId: 'league-1', rosterId: 'roster-1' })).rejects.toThrow('No DraftSession exists for league: league-1')
  })

  it('throws honestly when the roster does not exist', async () => {
    mockLeagueFindUnique.mockResolvedValue(BASE_LEAGUE)
    mockDraftSessionFindUnique.mockResolvedValue(BASE_SESSION)
    mockRosterFindUnique.mockResolvedValue(null)
    await expect(buildDraftDecisionContext({ leagueId: 'league-1', rosterId: 'roster-1' })).rejects.toThrow('Roster not found: roster-1')
  })

  it('assembles a real context from DraftSession/DraftPick + the real ADP snapshot', async () => {
    mockLeagueFindUnique.mockResolvedValue(BASE_LEAGUE)
    mockDraftSessionFindUnique.mockResolvedValue(BASE_SESSION)
    mockReadAllFantasyAdpForLeague.mockResolvedValue({
      entries: [{ playerName: 'Player One', position: 'RB', team: null, playerKey: 'player one|rb', adp: 25, averageRound: 2, averagePickInRound: 1, minPick: 20, maxPick: 30, sampleSize: 40, lowSample: false, sevenDayTrend: null, thirtyDayTrend: null }],
      totalDrafts: 40,
      computedAt: null,
      contextHash: 'hash',
      draftMode: 'real',
    })
    mockGetPlayerPoolForLeague.mockResolvedValue([
      { player_id: 'p1', full_name: 'Player One', position: 'RB', team_abbreviation: 'KC', team: null, age: 24, injury_status: null, sport_type: 'NFL', team_id: null, status: null, external_source_id: null },
    ])

    const ctx = await buildDraftDecisionContext({ leagueId: 'league-1', rosterId: 'roster-1' })

    expect(ctx.round).toBe(3)
    expect(ctx.pick).toBe(30)
    expect(ctx.totalTeams).toBe(12)
    expect(ctx.managerKey).toBe('manager-1')
    expect(ctx.engineInput.available).toEqual([{ name: 'Player One', position: 'RB', team: 'KC', adp: 25, byeWeek: null, age: 24 }])
    expect(ctx.playerIdByKey.get('player one|rb')).toBe('p1')
  })

  it('excludes already-drafted players from the available pool', async () => {
    mockLeagueFindUnique.mockResolvedValue(BASE_LEAGUE)
    mockDraftSessionFindUnique.mockResolvedValue(BASE_SESSION)
    mockDraftPickFindMany.mockResolvedValue([{ rosterId: 'roster-2', position: 'RB', team: 'KC', byeWeek: null, playerName: 'Player One' }])
    mockReadAllFantasyAdpForLeague.mockResolvedValue({
      entries: [
        { playerName: 'Player One', position: 'RB', team: null, playerKey: 'player one|rb', adp: 25, averageRound: 2, averagePickInRound: 1, minPick: 20, maxPick: 30, sampleSize: 40, lowSample: false, sevenDayTrend: null, thirtyDayTrend: null },
        { playerName: 'Player Two', position: 'WR', team: null, playerKey: 'player two|wr', adp: 30, averageRound: 3, averagePickInRound: 1, minPick: 25, maxPick: 35, sampleSize: 40, lowSample: false, sevenDayTrend: null, thirtyDayTrend: null },
      ],
      totalDrafts: 40,
      computedAt: null,
      contextHash: 'hash',
      draftMode: 'real',
    })

    const ctx = await buildDraftDecisionContext({ leagueId: 'league-1', rosterId: 'roster-1' })
    expect(ctx.engineInput.available).toHaveLength(1)
    expect(ctx.engineInput.available[0].name).toBe('Player Two')
  })

  it('builds teamRoster only from picks belonging to the target roster', async () => {
    mockLeagueFindUnique.mockResolvedValue(BASE_LEAGUE)
    mockDraftSessionFindUnique.mockResolvedValue(BASE_SESSION)
    mockDraftPickFindMany.mockResolvedValue([
      { rosterId: 'roster-1', position: 'QB', team: 'BUF', byeWeek: 12, playerName: 'QB One' },
      { rosterId: 'roster-2', position: 'RB', team: 'KC', byeWeek: null, playerName: 'RB One' },
    ])

    const ctx = await buildDraftDecisionContext({ leagueId: 'league-1', rosterId: 'roster-1' })
    expect(ctx.engineInput.teamRoster).toEqual([{ position: 'QB', team: 'BUF', byeWeek: 12 }])
  })

  it('derives is2QB from the settings-snapshot QB count when no real starters slot data exists (Phase 31 fallback path)', async () => {
    // Phase 31 real finding: this exact fixture shape (settings.rosterSettings.starterSlots.QB=2,
    // no League.starters) is what the PRE-Phase-31 isSF check misclassified as Superflex — a real
    // .env.test query found 0/65 leagues actually have this shape, and real Superflex leagues
    // instead carry a SUPER_FLEX slot key on League.starters (see the dedicated
    // draft-context-assembler-2qb-tep test file). Corrected here: this fixture is real 2QB, not Superflex.
    mockLeagueFindUnique.mockResolvedValue({ ...BASE_LEAGUE, settings: { rosterSettings: { starterSlots: { QB: 2 } } } })
    mockDraftSessionFindUnique.mockResolvedValue(BASE_SESSION)
    const ctx = await buildDraftDecisionContext({ leagueId: 'league-1', rosterId: 'roster-1' })
    expect(ctx.isSF).toBe(false)
    expect(ctx.is2QB).toBe(true)
  })

  it('derives isSF from a real League.starters SUPER_FLEX slot key (Phase 31)', async () => {
    mockLeagueFindUnique.mockResolvedValue({ ...BASE_LEAGUE, starters: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'SUPER_FLEX'] })
    mockDraftSessionFindUnique.mockResolvedValue(BASE_SESSION)
    const ctx = await buildDraftDecisionContext({ leagueId: 'league-1', rosterId: 'roster-1' })
    expect(ctx.isSF).toBe(true)
    expect(ctx.is2QB).toBe(false)
  })

  it('resolves the real roster template format via isIdpLeague, not a hardcoded standard (Phase 32)', async () => {
    // Phase 32 real finding: this call previously hardcoded 'standard' as the formatType
    // argument to getRosterTemplate, meaning even a real IDP league's roster template
    // (lib/multi-sport/RosterTemplateService.ts's own IDP branch, gated on formatType==='IDP')
    // could never be reached. lib/league/getEffectiveLeagueRosterTemplate.ts already
    // establishes isIdpLeague() as the real, reusable IDP-detection function -- reused here.
    mockLeagueFindUnique.mockResolvedValue(BASE_LEAGUE)
    mockDraftSessionFindUnique.mockResolvedValue(BASE_SESSION)
    mockIsIdpLeague.mockResolvedValue(true)

    await buildDraftDecisionContext({ leagueId: 'league-1', rosterId: 'roster-1' })

    expect(mockGetRosterTemplate).toHaveBeenCalledWith('NFL', 'IDP', 'league-1')
  })

  it('resolves standard format when isIdpLeague is false (backward compatible default)', async () => {
    mockLeagueFindUnique.mockResolvedValue(BASE_LEAGUE)
    mockDraftSessionFindUnique.mockResolvedValue(BASE_SESSION)
    mockIsIdpLeague.mockResolvedValue(false)

    await buildDraftDecisionContext({ leagueId: 'league-1', rosterId: 'roster-1' })

    expect(mockGetRosterTemplate).toHaveBeenCalledWith('NFL', 'standard', 'league-1')
  })

  it('reports draftType and isDevy from the real DraftSession row', async () => {
    mockLeagueFindUnique.mockResolvedValue(BASE_LEAGUE)
    mockDraftSessionFindUnique.mockResolvedValue({ ...BASE_SESSION, draftType: 'dynasty_startup', devyConfig: { enabled: true } })
    const ctx = await buildDraftDecisionContext({ leagueId: 'league-1', rosterId: 'roster-1' })
    expect(ctx.draftType).toBe('dynasty_startup')
    expect(ctx.isDevy).toBe(true)
  })
})

describe('assembleEngineInputFromPicks (pure)', () => {
  it('builds rosterSlots and engineInput deterministically from provided picks', () => {
    const result = assembleEngineInputFromPicks({
      picksSoFar: [{ rosterId: 'roster-1', position: 'QB', team: 'BUF', byeWeek: 12, playerName: 'QB One' }],
      targetRosterId: 'roster-1',
      adpEntries: [{ playerName: 'Free Agent', position: 'WR', team: null, adp: 10 }],
      poolByKey: new Map(),
      rosterSlots: ['QB', 'WR'],
      round: 2,
      pick: 20,
      totalTeams: 12,
      sport: 'NFL',
      isDynasty: true,
      isSF: false,
      mode: 'needs',
    })
    expect(result.engineInput.teamRoster).toEqual([{ position: 'QB', team: 'BUF', byeWeek: 12 }])
    expect(result.dataCompleteness.unresolvedPlayerIdCount).toBe(1)
  })
})

describe('playerKey / resolveLeagueScoringFlags (pure)', () => {
  it('normalizes case and whitespace', () => {
    expect(playerKey('  Player One ', 'RB')).toBe('player one|rb')
  })

  it('handles a malformed settings snapshot honestly (defaults to isSF:false, scoringFormat:standard)', () => {
    expect(resolveLeagueScoringFlags(null)).toEqual({ isSF: false, is2QB: false, scoringFormat: 'standard', tePremiumValue: null })
    expect(resolveLeagueScoringFlags('not-an-object')).toEqual({ isSF: false, is2QB: false, scoringFormat: 'standard', tePremiumValue: null })
  })

  it('derives scoringFormat from a real PPR settings value (Phase 29)', () => {
    expect(resolveLeagueScoringFlags({ ppr: 1 })).toEqual({ isSF: false, is2QB: false, scoringFormat: 'ppr', tePremiumValue: null })
    expect(resolveLeagueScoringFlags({ ppr: 0.5 })).toEqual({ isSF: false, is2QB: false, scoringFormat: 'half_ppr', tePremiumValue: null })
    expect(resolveLeagueScoringFlags({ ppr: 0 })).toEqual({ isSF: false, is2QB: false, scoringFormat: 'standard', tePremiumValue: null })
    expect(resolveLeagueScoringFlags({ points_per_reception: 1 })).toEqual({ isSF: false, is2QB: false, scoringFormat: 'ppr', tePremiumValue: null })
  })
})
