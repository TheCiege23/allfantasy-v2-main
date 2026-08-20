import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  mergeNormalizedStatMaps,
  classifyRollupRowAction,
  evaluateScoringDeviationsFromSignals,
} from '@/lib/scoring/player-weekly-score-rollup'

describe('mergeNormalizedStatMaps', () => {
  it('sums numeric keys across maps', () => {
    expect(
      mergeNormalizedStatMaps([
        { pass_yds: 100, rush_yds: 10 },
        { pass_yds: 50, rec: 3 },
        null,
        undefined,
      ]),
    ).toEqual({ pass_yds: 150, rush_yds: 10, rec: 3 })
  })
})

describe('classifyRollupRowAction', () => {
  it('creates when no existing row', () => {
    expect(classifyRollupRowAction(null, null, 12.3)).toMatchObject({ action: 'create', delta: 12.3 })
  })

  it('skips when within epsilon', () => {
    expect(classifyRollupRowAction(10, 'id', 10.005)).toMatchObject({ action: 'skip', delta: 0 })
  })

  it('updates when outside epsilon', () => {
    expect(classifyRollupRowAction(10, 'id', 10.5)).toMatchObject({ action: 'update', delta: 0.5 })
  })
})

describe('evaluateScoringDeviationsFromSignals', () => {
  it('flags overrides only', () => {
    expect(
      evaluateScoringDeviationsFromSignals({
        leagueScoringOverrideCount: 2,
        effectiveFormat: 'standard',
        defaultFormat: 'standard',
      }),
    ).toEqual({ risky: true, reasons: ['league_scoring_overrides'] })
  })

  it('flags non-default format only', () => {
    expect(
      evaluateScoringDeviationsFromSignals({
        leagueScoringOverrideCount: 0,
        effectiveFormat: 'half_ppr',
        defaultFormat: 'standard',
      }),
    ).toEqual({ risky: true, reasons: ['non_default_scoring_format'] })
  })

  it('treats case-insensitive format match as default', () => {
    expect(
      evaluateScoringDeviationsFromSignals({
        leagueScoringOverrideCount: 0,
        effectiveFormat: 'Standard',
        defaultFormat: 'standard',
      }),
    ).toEqual({ risky: false, reasons: [] })
  })

  it('not risky when vanilla default template path', () => {
    expect(
      evaluateScoringDeviationsFromSignals({
        leagueScoringOverrideCount: 0,
        effectiveFormat: 'standard',
        defaultFormat: 'standard',
      }),
    ).toEqual({ risky: false, reasons: [] })
  })
})

const m = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  redraftSeasonFindFirst: vi.fn(),
  redraftMatchupFindMany: vi.fn(),
  rosterPlayerFindMany: vi.fn(),
  playerGameStatFindMany: vi.fn(),
  playerWeeklyScoreFindUnique: vi.fn(),
  leagueScoringOverrideCount: vi.fn(),
  idpLeagueConfigFindUnique: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: m.leagueFindUnique },
    redraftSeason: { findFirst: m.redraftSeasonFindFirst },
    redraftMatchup: { findMany: m.redraftMatchupFindMany },
    redraftRosterPlayer: { findMany: m.rosterPlayerFindMany },
    playerGameStat: { findMany: m.playerGameStatFindMany },
    playerWeeklyScore: { findUnique: m.playerWeeklyScoreFindUnique },
    leagueScoringOverride: { count: m.leagueScoringOverrideCount },
    idpLeagueConfig: { findUnique: m.idpLeagueConfigFindUnique },
    $transaction: m.transaction,
  },
}))

vi.mock('@/lib/multi-sport/MultiSportMatchupScoringService', () => ({
  computePlayerFantasyPoints: vi.fn(async () => 20),
}))

import { runPlayerWeeklyScoreRollup } from '@/lib/scoring/player-weekly-score-rollup'

const baseLeague = {
  id: 'L1',
  sport: 'NFL',
  leagueVariant: null,
  settings: {},
}

describe('runPlayerWeeklyScoreRollup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.leagueScoringOverrideCount.mockResolvedValue(0)
    m.idpLeagueConfigFindUnique.mockResolvedValue(null)
    m.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      const tx = {
        playerWeeklyScore: {
          upsert: vi.fn(async () => {}),
        },
      }
      await fn(tx)
    })
  })

  it('dry-run does not require allowGlobalOverwrite and does not invoke $transaction', async () => {
    m.leagueFindUnique.mockResolvedValue(baseLeague)
    m.redraftSeasonFindFirst.mockResolvedValue({ id: 'S1' })
    m.redraftMatchupFindMany.mockResolvedValue([{ homeRosterId: 'R1', awayRosterId: null }])
    m.rosterPlayerFindMany.mockResolvedValue([{ playerId: 'P1', sport: 'NFL' }])
    m.playerGameStatFindMany.mockResolvedValue([{ normalizedStatMap: { pass_yds: 300 }, fantasyPoints: null }])
    m.playerWeeklyScoreFindUnique.mockResolvedValue(null)

    const res = await runPlayerWeeklyScoreRollup({
      leagueId: 'L1',
      season: 2025,
      week: 3,
      write: false,
      jobName: 'test',
    })
    expect(res.write).toBe(false)
    expect(res.allowGlobalOverwrite).toBe(false)
    expect(res.writeApplied).toBe(false)
    expect(m.transaction).not.toHaveBeenCalled()
    expect(m.leagueScoringOverrideCount).not.toHaveBeenCalled()
    expect(res.wouldCreate).toBe(1)
    expect(res.writtenCreate).toBe(0)
  })

  it('write without allowGlobalOverwrite is blocked (no transaction)', async () => {
    m.leagueFindUnique.mockResolvedValue(baseLeague)
    m.redraftSeasonFindFirst.mockResolvedValue({ id: 'S1' })
    m.redraftMatchupFindMany.mockResolvedValue([{ homeRosterId: 'R1', awayRosterId: null }])
    m.rosterPlayerFindMany.mockResolvedValue([{ playerId: 'P1', sport: 'NFL' }])
    m.playerGameStatFindMany.mockResolvedValue([{ normalizedStatMap: { pass_yds: 300 }, fantasyPoints: null }])
    m.playerWeeklyScoreFindUnique.mockResolvedValue(null)

    const res = await runPlayerWeeklyScoreRollup({
      leagueId: 'L1',
      season: 2025,
      week: 3,
      write: true,
      allowGlobalOverwrite: false,
      jobName: 'test',
    })
    expect(res.write).toBe(true)
    expect(res.writeApplied).toBe(false)
    expect(res.notes).toContain('write_blocked_missing_allowGlobalOverwrite')
    expect(m.transaction).not.toHaveBeenCalled()
    expect(res.writtenCreate).toBe(0)
  })

  it('write with allowGlobalOverwrite and vanilla scoring proceeds', async () => {
    m.leagueFindUnique.mockResolvedValue(baseLeague)
    m.redraftSeasonFindFirst.mockResolvedValue({ id: 'S1' })
    m.redraftMatchupFindMany.mockResolvedValue([{ homeRosterId: 'R1', awayRosterId: null }])
    m.rosterPlayerFindMany.mockResolvedValue([{ playerId: 'P1', sport: 'NFL' }])
    m.playerGameStatFindMany.mockResolvedValue([{ normalizedStatMap: { pass_yds: 300 }, fantasyPoints: null }])
    m.playerWeeklyScoreFindUnique.mockResolvedValue(null)

    const upsert = vi.fn(async () => {})
    m.transaction.mockImplementationOnce(async (fn: (tx: { playerWeeklyScore: { upsert: typeof upsert } }) => Promise<void>) => {
      await fn({ playerWeeklyScore: { upsert } })
    })

    const res = await runPlayerWeeklyScoreRollup({
      leagueId: 'L1',
      season: 2025,
      week: 3,
      write: true,
      allowGlobalOverwrite: true,
      jobName: 'test',
    })
    expect(res.writeApplied).toBe(true)
    expect(res.scoringRisk).toEqual({ risky: false, reasons: [] })
    expect(m.transaction).toHaveBeenCalledTimes(1)
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(res.writtenCreate).toBe(1)
  })

  it('write with allowGlobalOverwrite but scoring overrides blocks without allowCustomScoringWrite', async () => {
    m.leagueScoringOverrideCount.mockResolvedValue(1)
    m.leagueFindUnique.mockResolvedValue(baseLeague)
    m.redraftSeasonFindFirst.mockResolvedValue({ id: 'S1' })
    m.redraftMatchupFindMany.mockResolvedValue([{ homeRosterId: 'R1', awayRosterId: null }])
    m.rosterPlayerFindMany.mockResolvedValue([{ playerId: 'P1', sport: 'NFL' }])
    m.playerGameStatFindMany.mockResolvedValue([{ normalizedStatMap: { pass_yds: 300 }, fantasyPoints: null }])
    m.playerWeeklyScoreFindUnique.mockResolvedValue(null)

    const res = await runPlayerWeeklyScoreRollup({
      leagueId: 'L1',
      season: 2025,
      week: 3,
      write: true,
      allowGlobalOverwrite: true,
      jobName: 'test',
    })
    expect(res.writeApplied).toBe(false)
    expect(res.scoringRisk?.risky).toBe(true)
    expect(res.notes).toContain('write_blocked_scoring_risk_missing_allowCustomScoringWrite')
    expect(m.transaction).not.toHaveBeenCalled()
  })

  it('write with allowGlobalOverwrite blocks when non-default scoring_format without allowCustomScoringWrite', async () => {
    m.leagueFindUnique.mockResolvedValue({
      ...baseLeague,
      settings: { scoring_format: 'half_ppr' },
    })
    m.redraftSeasonFindFirst.mockResolvedValue({ id: 'S1' })
    m.redraftMatchupFindMany.mockResolvedValue([{ homeRosterId: 'R1', awayRosterId: null }])
    m.rosterPlayerFindMany.mockResolvedValue([{ playerId: 'P1', sport: 'NFL' }])
    m.playerGameStatFindMany.mockResolvedValue([{ normalizedStatMap: { pass_yds: 300 }, fantasyPoints: null }])
    m.playerWeeklyScoreFindUnique.mockResolvedValue(null)

    const res = await runPlayerWeeklyScoreRollup({
      leagueId: 'L1',
      season: 2025,
      week: 3,
      write: true,
      allowGlobalOverwrite: true,
      jobName: 'test',
    })
    expect(res.writeApplied).toBe(false)
    expect(res.scoringRisk?.reasons).toContain('non_default_scoring_format')
    expect(res.notes).toContain('write_blocked_scoring_risk_missing_allowCustomScoringWrite')
    expect(m.transaction).not.toHaveBeenCalled()
  })

  it('write with allowGlobalOverwrite and allowCustomScoringWrite proceeds when overrides exist', async () => {
    m.leagueScoringOverrideCount.mockResolvedValue(1)
    m.leagueFindUnique.mockResolvedValue(baseLeague)
    m.redraftSeasonFindFirst.mockResolvedValue({ id: 'S1' })
    m.redraftMatchupFindMany.mockResolvedValue([{ homeRosterId: 'R1', awayRosterId: null }])
    m.rosterPlayerFindMany.mockResolvedValue([{ playerId: 'P1', sport: 'NFL' }])
    m.playerGameStatFindMany.mockResolvedValue([{ normalizedStatMap: { pass_yds: 300 }, fantasyPoints: null }])
    m.playerWeeklyScoreFindUnique.mockResolvedValue(null)

    const upsert = vi.fn(async () => {})
    m.transaction.mockImplementationOnce(async (fn: (tx: { playerWeeklyScore: { upsert: typeof upsert } }) => Promise<void>) => {
      await fn({ playerWeeklyScore: { upsert } })
    })

    const res = await runPlayerWeeklyScoreRollup({
      leagueId: 'L1',
      season: 2025,
      week: 3,
      write: true,
      allowGlobalOverwrite: true,
      allowCustomScoringWrite: true,
      jobName: 'test',
    })
    expect(res.writeApplied).toBe(true)
    expect(res.scoringRisk?.risky).toBe(true)
    expect(m.transaction).toHaveBeenCalledTimes(1)
    expect(upsert).toHaveBeenCalledTimes(1)
  })
})
