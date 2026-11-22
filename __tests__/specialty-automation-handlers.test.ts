import { beforeEach, describe, expect, it, vi } from 'vitest'

import { runGuillotineHandler } from '@/lib/specialty-automation/handlers/guillotineHandler'
import { runTournamentHandler } from '@/lib/specialty-automation/handlers/tournamentHandler'
import { calculateLeagueStandings } from '@/lib/tournament/advancementEngine'
import { loadSpecialtyMetadataSnapshot } from '@/lib/specialty-automation/syncMetadata'
import { runElimination } from '@/lib/guillotine/GuillotineEliminationEngine'
import type { HandlerContext } from '@/lib/specialty-automation/types'

vi.mock('@/lib/tournament/advancementEngine', () => ({
  calculateLeagueStandings: vi.fn(),
}))

vi.mock('@/lib/specialty-automation/syncMetadata', () => ({
  loadSpecialtyMetadataSnapshot: vi.fn(),
}))

vi.mock('@/lib/guillotine/GuillotineEliminationEngine', () => ({
  runElimination: vi.fn(),
}))

// This suite covers a league with no season of its own: the handler's older call. The path a league
// hosted here takes (the score sync's own driver) is in __tests__/guillotine/manual-chop-run.test.ts.
vi.mock('@/lib/prisma', () => ({ prisma: { redraftSeason: { findFirst: vi.fn(async () => null) } } }))
vi.mock('@/lib/guillotine/importedLeagueGuard', () => ({ IMPORTED_CHOP_REASON: 'imported', isImportedLeague: vi.fn(async () => false) }))
vi.mock('@/lib/guillotine/nativeGuillotineWeek', () => ({ runNativeGuillotineWeek: vi.fn() }))
vi.mock('@/lib/redraft/playerWeeklyScoreService', () => ({ syncPlayerWeeklyScoresForRedraftSeason: vi.fn() }))
vi.mock('@/lib/season-week', () => ({ resolveSeasonWeekForRedraftSeason: vi.fn() }))

function baseLeague(): HandlerContext['league'] {
  return {
    id: 'league-1',
    name: 'Test',
    sport: 'NFL',
    season: 2026,
    leagueType: 'tournament',
    leagueVariant: null,
    settings: null,
    guillotineMode: false,
    survivorMode: false,
    status: 'active',
  }
}

describe('runTournamentHandler', () => {
  beforeEach(() => {
    vi.mocked(loadSpecialtyMetadataSnapshot).mockReset()
    vi.mocked(calculateLeagueStandings).mockReset()
  })

  it('syncs standings when a tournament shell row exists and trigger is onWeekFinalized', async () => {
    vi.mocked(loadSpecialtyMetadataSnapshot).mockResolvedValue({
      conceptKey: 'tournament',
      leagueId: 'league-1',
      tournament: {
        id: 'tl-1',
        tournamentId: 'ts-1',
        status: 'active',
        roundId: 'round-1',
        leagueId: 'league-1',
      },
    })
    vi.mocked(calculateLeagueStandings).mockResolvedValue({
      leagueId: 'league-1',
      rows: [
        {
          tournamentLeagueParticipantId: 'p1',
          participantId: 'part-1',
          userId: 'u1',
          wins: 1,
          losses: 0,
          ties: 0,
          pointsFor: 100,
          pointsAgainst: 90,
          leagueRank: 1,
        },
      ],
    })

    const ctx: HandlerContext = {
      leagueId: 'league-1',
      season: 2026,
      week: 5,
      trigger: 'onWeekFinalized',
      conceptKey: 'tournament',
      conceptRules: null,
      league: baseLeague(),
    }

    const out = await runTournamentHandler(ctx)

    expect(calculateLeagueStandings).toHaveBeenCalledWith('tl-1')
    expect(out.actions.some((a) => a.actionType === 'tournament_standings_sync')).toBe(true)
    expect(out.summary).toContain('Standings synchronized')
  })

  it('falls back to metadata-only action when no tournament shell', async () => {
    vi.mocked(loadSpecialtyMetadataSnapshot).mockResolvedValue({
      conceptKey: 'tournament',
      leagueId: 'league-1',
    })

    const ctx: HandlerContext = {
      leagueId: 'league-1',
      season: 2026,
      week: 5,
      trigger: 'onWeekFinalized',
      conceptKey: 'tournament',
      conceptRules: null,
      league: baseLeague(),
    }

    const out = await runTournamentHandler(ctx)
    expect(calculateLeagueStandings).not.toHaveBeenCalled()
    expect(out.actions.some((a) => a.actionType === 'specialty_metadata_sync')).toBe(true)
  })
})

describe('runGuillotineHandler', () => {
  beforeEach(() => {
    vi.mocked(runElimination).mockReset()
  })

  it('uses shared eliminate_roster action shape via planEliminateRoster', async () => {
    vi.mocked(runElimination).mockResolvedValue({
      leagueId: 'league-1',
      weekOrPeriod: 8,
      choppedRosterIds: ['roster-z'],
      tiebreakStepUsed: 'draft_order',
      reason: 'lowest score',
    })

    const ctx: HandlerContext = {
      leagueId: 'league-1',
      season: 2026,
      week: 8,
      trigger: 'onWeekFinalized',
      conceptKey: 'guillotine',
      conceptRules: null,
      league: baseLeague(),
    }

    const out = await runGuillotineHandler(ctx)
    expect(out.actions).toHaveLength(1)
    expect(out.actions[0]).toMatchObject({
      actionType: 'eliminate_roster',
      targetType: 'roster',
      targetId: 'roster-z',
    })
  })
})
