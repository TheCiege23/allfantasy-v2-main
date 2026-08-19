import { describe, expect, it } from 'vitest'
import type { CanonicalLeagueRules } from '@/lib/league-runtime'
import type { UnifiedPlayerWireDto } from '@/lib/player-data/serializeUnifiedPlayerForApi'
import {
  buildNflRedraftLiveScoringContext,
  normalizeNflRedraftProviderLiveScoringContext,
  toCanonicalNflRedraftLiveScoringContextRecord,
  type NflRedraftLiveScoringContext,
} from '@/lib/player-data/nflRedraftLiveScoringContext'
import {
  applyCanonicalNflRedraftStatCorrection,
  buildNflRedraftLiveScoringRuntimeState,
  scoreRowsFromCanonicalLiveScoringContexts,
  type NflRedraftRuntimeMatchupInput,
  type NflRedraftRuntimeTeamInput,
} from '@/lib/scoring-runtime/canonicalNflRedraftScoringRuntime'
import { matchupContextFromUnifiedWire } from '@/lib/player-data/adapters/matchupPlayerAdapter'
import { mergeUnifiedIntoRosterState, type RosterStateMergeable } from '@/lib/player-data/adapters/rosterPlayerAdapter'
import { displayPlayerFromUnifiedRow } from '@/lib/player-data/adapters/redraftDisplayPlayers'
import { getDraftRoomDisplayLiveScoringContext } from '@/lib/player-data/adapters/draftRoomDisplayFields'

const NOW = new Date('2026-09-13T18:15:00.000Z')

const rules = {
  version: 1,
  leagueId: 'league-g47b',
  generatedAtIso: '2026-07-03T12:00:00.000Z',
  source: {
    commissionerSettings: 'League',
    draftSettings: 'LeagueSettings',
    effectiveResolvers: ['scoring'],
    settingsSnapshotVersion: 6,
    presetKey: 'af:v2|concept=redraft|sport=NFL',
  },
  general: {
    name: 'G47B NFL Redraft',
    sport: 'NFL',
    season: 2026,
    format: 'redraft',
    variant: null,
    teamCount: 2,
    rosterSize: 2,
    lifecycleState: 'active',
    status: 'active',
    locked: false,
    emergencyPaused: false,
    timezone: 'America/New_York',
    language: 'en',
  },
  draft: {} as CanonicalLeagueRules['draft'],
  scoring: {
    templateId: 'nfl_half_ppr',
    presetId: 'nfl_half_ppr',
    formatType: 'redraft',
    sport: 'NFL',
    activeRuleCount: 0,
    overriddenRuleCount: 0,
    activeRules: [],
  },
  roster: {
    size: 2,
    starters: ['QB', 'RB'],
    irSlots: 0,
    eligibleReserveStatuses: [],
    allowPreDraftMoves: true,
    preventBenchDrops: false,
    lockAllMoves: false,
  },
  waivers: {} as CanonicalLeagueRules['waivers'],
  trades: {} as CanonicalLeagueRules['trades'],
  playoffs: {} as CanonicalLeagueRules['playoffs'],
  schedule: {} as CanonicalLeagueRules['schedule'],
  permissions: {} as CanonicalLeagueRules['permissions'],
  intelligence: {} as CanonicalLeagueRules['intelligence'],
} as CanonicalLeagueRules

function liveContext(overrides: Partial<NflRedraftLiveScoringContext> = {}): NflRedraftLiveScoringContext {
  return {
    ...buildNflRedraftLiveScoringContext({
      playerId: 'af-qb-1',
      gameId: 'nfl-game-1',
      season: 2026,
      week: 1,
      gameStatus: 'live',
      quarter: 3,
      clock: '07:12',
      stats: { pass_yds: 250, pass_td: 2, pass_int: 1, rush_yds: 20 },
      statsSource: 'sportsdataio',
      statsUpdatedAtIso: '2026-09-13T18:10:00.000Z',
      projectedFantasyPoints: 21.3,
      fantasyPoints: 99,
      actualFantasyPoints: 99,
      scoringRefreshTimestamp: '2026-09-13T18:10:00.000Z',
      matchupRefreshTimestamp: '2026-09-13T18:10:00.000Z',
      providerFreshness: {
        status: 'available',
        updatedAtIso: '2026-09-13T18:10:00.000Z',
        ageMinutes: 5,
        maxAgeMinutes: 5,
        stale: false,
        warnings: [],
      },
    }),
    ...overrides,
  }
}

function wire(context: NflRedraftLiveScoringContext): UnifiedPlayerWireDto {
  return {
    id: 'af-qb-1',
    name: 'Live Quarterback',
    position: 'QB',
    team: 'KC',
    sport: 'NFL',
    headshotUrl: null,
    imageUrl: null,
    teamLogoUrl: null,
    injuryStatus: null,
    fantasyPointsPerGame: null,
    projectedPoints: 20,
    adp: null,
    aiAdp: null,
    aiAdpSampleSize: null,
    collegeClass: 'unknown',
    collegeClassLabel: null,
    soccerLeague: null,
    nflRookieIsRookie: null,
    nflRookieSource: null,
    lowConfidence: false,
    profileSource: 'sportsdataio',
    statsSource: 'sportsdataio',
    projectionsSource: 'sportsdataio',
    normalizedStats: {
      providerPayload: { secret: true },
      liveScoring: {
        gameStatus: 'scheduled',
        fantasyPoints: 1,
      },
    },
    normalizedProjections: {},
    nflRedraftLiveScoringContext: context,
    product: {
      unified: {} as UnifiedPlayerWireDto['product']['unified'],
      yearsExp: null,
      byeWeek: null,
    },
  }
}

describe('G47B NFL redraft live stats, scoring refresh, and stat corrections', () => {
  it('normalizes provider live stat context through mapped AllFantasy player identity only', () => {
    const normalized = normalizeNflRedraftProviderLiveScoringContext(
      'sportsdataio',
      {
        PlayerID: 'sportsdataio-player-42',
        GameID: 'sdio-game-99',
        Season: 2026,
        Week: 1,
        Status: 'InProgress',
        Quarter: 3,
        TimeRemaining: '07:12',
        Stats: { pass_yds: 250, pass_td: 2 },
        FantasyPoints: 22.4,
        ProjectedFantasyPoints: 20.1,
        Updated: '2026-09-13T18:10:00.000Z',
        StatCorrections: [
          {
            CorrectionID: 'corr-pass-yds-1',
            PlayerID: 'sportsdataio-player-42',
            GameID: 'sdio-game-99',
            StatCategory: 'pass_yds',
            OldValue: 240,
            NewValue: 250,
            FantasyPointDelta: 0.4,
          },
        ],
        providerPayload: { secret: true },
      },
      { now: NOW, allFantasyPlayerId: 'af-qb-1' },
    )

    expect(normalized).toMatchObject({
      modelVersion: 'nfl-redraft-live-scoring-context-v1',
      playerId: 'af-qb-1',
      gameId: 'sdio-game-99',
      season: 2026,
      week: 1,
      gameStatus: 'live',
      gameClock: { quarter: 3, clock: '07:12', display: '07:12' },
      stats: { stats: { pass_yds: 250, pass_td: 2 }, source: 'sportsdataio' },
      fantasyPoints: 22.4,
      projectedFantasyPoints: 20.1,
      actualFantasyPoints: 22.4,
      refresh: {
        scoringRefreshTimestamp: '2026-09-13T18:10:00.000Z',
        matchupRefreshTimestamp: '2026-09-13T18:10:00.000Z',
        standingsRefreshRequired: true,
        standingsRefreshReason: 'stat_correction',
      },
    })
    expect(normalized.statCorrections[0]).toMatchObject({
      correctionId: 'corr-pass-yds-1',
      playerId: 'af-qb-1',
      gameId: 'sdio-game-99',
      statCategory: 'pass_yds',
      oldValue: 240,
      newValue: 250,
      fantasyPointDelta: 0.4,
      providerSource: 'sportsdataio',
      applied: true,
    })
    expect(JSON.stringify(normalized)).not.toContain('sportsdataio-player-42')
    expect(JSON.stringify(normalized)).not.toContain('providerPayload')
    expect(JSON.stringify(normalized)).not.toContain('secret')
  })

  it('marks stale, missing, and fallback live stat records honestly', () => {
    const record = toCanonicalNflRedraftLiveScoringContextRecord({
      providerId: 'sportsdataio',
      providerRecordId: 'live-empty',
      payload: {
        GameID: 'sdio-game-empty',
        Season: 2026,
        Week: 1,
        Updated: '2026-09-13T17:30:00.000Z',
      },
      sourceUpdatedAtIso: '2026-09-13T17:30:00.000Z',
      now: NOW,
      fallback: true,
      maxAgeMinutes: 5,
      allFantasyPlayerId: 'af-missing-live',
    })

    expect(record.freshness.status).toBe('stale')
    expect(record.fallback).toBe(true)
    expect(record.data.providerFreshness.stale).toBe(true)
    expect(record.data.providerFallback.fallback).toBe(true)
    expect(record.data.providerFallback.fields).toEqual(
      expect.arrayContaining(['liveScoring', 'gameStatus', 'stats', 'fantasyPoints']),
    )
    expect(record.data.stats.unavailable).toBe(true)
  })

  it('hands canonical live stats to the scoring runtime while league scoring remains source of truth', () => {
    const alpha = liveContext({
      final: true,
      gameStatus: 'final',
      refresh: {
        scoringRefreshTimestamp: '2026-09-13T21:15:00.000Z',
        matchupRefreshTimestamp: '2026-09-13T21:15:00.000Z',
        standingsRefreshRequired: true,
        standingsRefreshReason: 'final_game_state',
      },
    })
    const bravo = buildNflRedraftLiveScoringContext({
      playerId: 'af-rb-1',
      gameId: 'nfl-game-2',
      season: 2026,
      week: 1,
      gameStatus: 'final',
      final: true,
      stats: { rush_yds: 80, rush_td: 1, rec: 2, rec_yds: 10 },
      statsSource: 'sportsdataio',
      statsUpdatedAtIso: '2026-09-13T21:10:00.000Z',
      projectedFantasyPoints: 15,
      fantasyPoints: 999,
      providerFreshness: { status: 'available', updatedAtIso: '2026-09-13T21:10:00.000Z' },
    })
    const teams: NflRedraftRuntimeTeamInput[] = [
      {
        rosterId: 'alpha',
        displayName: 'Alpha',
        players: [{ rosterId: 'alpha', playerId: 'af-qb-1', playerName: 'Live Quarterback', position: 'QB', slotType: 'QB' }],
      },
      {
        rosterId: 'bravo',
        displayName: 'Bravo',
        players: [{ rosterId: 'bravo', playerId: 'af-rb-1', playerName: 'Live Runner', position: 'RB', slotType: 'RB' }],
      },
    ]
    const matchups: NflRedraftRuntimeMatchupInput[] = [
      { matchupId: 'matchup-g47b', week: 1, homeRosterId: 'alpha', awayRosterId: 'bravo' },
    ]

    const state = buildNflRedraftLiveScoringRuntimeState({
      leagueId: rules.leagueId,
      seasonId: 'season-g47b',
      season: 2026,
      week: 1,
      rules,
      teams,
      matchups,
      scoreRows: scoreRowsFromCanonicalLiveScoringContexts([alpha, bravo]),
      now: NOW,
    })

    expect(state.matchups[0]).toMatchObject({
      status: 'final',
      homeScore: 18,
      awayScore: 16,
      winnerRosterId: 'alpha',
      complete: true,
    })
    expect(state.teams[0].starters[0]).toMatchObject({
      playerId: 'af-qb-1',
      fantasyPoints: 18,
      actualFantasyPoints: 18,
      projectedFantasyPoints: 21.3,
      liveGameStatus: 'final',
      scoringRefreshTimestamp: '2026-09-13T21:15:00.000Z',
    })
    expect(state.standings.map((row) => [row.rosterId, row.wins, row.losses, row.pointsFor])).toEqual([
      ['alpha', 1, 0, 18],
      ['bravo', 0, 1, 16],
    ])
    expect(state.refresh).toMatchObject({
      standingsRefreshRequired: true,
      standingsRefreshReason: 'final_game_state',
      scoringRefreshTimestamp: '2026-09-13T21:15:00.000Z',
    })
  })

  it('applies canonical stat corrections idempotently', () => {
    const correction = {
      correctionId: 'rush-yds-week1-1',
      playerId: 'af-rb-1',
      gameId: 'nfl-game-2',
      statCategory: 'rush_yds',
      oldValue: 80,
      newValue: 90,
      fantasyPointDelta: 1,
      providerSource: 'sportsdataio',
      timestampIso: '2026-09-16T12:00:00.000Z',
      applied: true,
    }
    const first = applyCanonicalNflRedraftStatCorrection({
      playerId: 'af-rb-1',
      position: 'RB',
      previousStats: { rush_yds: 80 },
      correction,
    })
    const replay = applyCanonicalNflRedraftStatCorrection({
      playerId: 'af-rb-1',
      position: 'RB',
      previousStats: first.normalizedStats,
      correction,
    })

    expect(first).toMatchObject({ applied: true, correctionVersion: 1, normalizedStats: { rush_yds: 90, __af_correction_version: 1 } })
    expect(Object.keys(first.normalizedStats).some((key) => key.startsWith('__af_correction_applied_'))).toBe(true)
    expect(replay).toMatchObject({
      applied: false,
      correctionVersion: 1,
      skippedReason: 'correction_already_applied',
      normalizedStats: first.normalizedStats,
    })
  })

  it('makes matchup, roster, team display, player-card, and draft helpers consume canonical live objects only', () => {
    const context = liveContext({
      gameStatus: 'overtime',
      actualFantasyPoints: 24.6,
      fantasyPoints: 24.6,
      projectedFantasyPoints: 21.3,
    })
    const row = wire(context)
    const matchup = matchupContextFromUnifiedWire(row)
    const display = displayPlayerFromUnifiedRow(row)
    const rosterState: RosterStateMergeable = {
      starters: [{ id: row.id, name: 'Old', team: 'KC', position: 'QB', opponent: 'LV', gameTime: 'legacy', projection: 0, actual: null, status: 'healthy', slot: 'starters' }],
      bench: [],
      ir: [],
      taxi: [],
      devy: [],
    }
    const roster = mergeUnifiedIntoRosterState(rosterState, [row])

    expect(matchup).toMatchObject({
      canonicalLiveScoringContext: context,
      actualFantasyPoints: 24.6,
      projectedPoints: 21.3,
      liveGameStatus: 'overtime',
      gameClock: '07:12',
      liveStatsAvailable: true,
    })
    expect(display).toMatchObject({
      canonicalLiveScoringContext: context,
      actualFantasyPoints: 24.6,
      projectedPoints: 21.3,
      liveGameStatus: 'overtime',
    })
    expect(roster.starters[0]).toMatchObject({
      canonicalLiveScoringContext: context,
      actual: 24.6,
      unifiedProjectedPoints: 21.3,
      providerGameStatus: 'overtime',
      providerActualFantasyPoints: 24.6,
      providerStandingsRefreshRequired: false,
    })
    expect(getDraftRoomDisplayLiveScoringContext({ canonicalLiveScoringContext: context })).toBe(context)
    expect(JSON.stringify(matchup)).not.toContain('providerPayload')
    expect(JSON.stringify(display)).not.toContain('providerPayload')
    expect(JSON.stringify(roster)).not.toContain('providerPayload')
  })
})
