/**
 * Block G — integration test proving `persistPlayoffBracket` writes bracket
 * structure into `leagues.settings.importedPlayoffBrackets`, keyed by season,
 * and that re-import replaces (never duplicates) the season's entry.
 *
 * Design note (see ImportedLeagueCommitService.ts inline comment): the audit
 * named `redraft_playoff_brackets` as the target, but that table is keyed
 * through `RedraftSeason`, which imported leagues don't have — creating one
 * would pull the imported league into the live redraft runtime, which is out
 * of Block G's scope. Storing on `leagues.settings` (existing JSONB column,
 * zero schema change) keeps this entirely within the import domain.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  leagueUpdate: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: mocks.leagueFindUnique,
      update: mocks.leagueUpdate,
    },
  },
}))

async function invokePersist(
  ...args: Parameters<typeof import('@/lib/league-import/ImportedLeagueCommitService').persistPlayoffBracket>
) {
  const { persistPlayoffBracket } = await import('@/lib/league-import/ImportedLeagueCommitService')
  return persistPlayoffBracket(...args)
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.leagueUpdate.mockResolvedValue({ id: 'lea-abc' })
})

describe('persistPlayoffBracket — field mapping (fresh write, empty settings)', () => {
  it('writes settings.importedPlayoffBrackets["2025"] with season + matchups', async () => {
    mocks.leagueFindUnique.mockResolvedValue({ settings: null })

    const result = await invokePersist('lea-abc', {
      season: 2025,
      matchups: [
        {
          bracket_type: 'winners',
          round: 1,
          matchup_id: 1,
          team1_roster_id: '1',
          team2_roster_id: '3',
          winner_roster_id: '3',
          loser_roster_id: '1',
          placement: null,
        },
        {
          bracket_type: 'winners',
          round: 3,
          matchup_id: 6,
          team1_roster_id: '8',
          team2_roster_id: '10',
          winner_roster_id: '10',
          loser_roster_id: '8',
          placement: 1,
        },
      ],
    })

    expect(result).toEqual({ written: 2, skipped: 0 })
    expect(mocks.leagueUpdate).toHaveBeenCalledOnce()

    const call = mocks.leagueUpdate.mock.calls[0][0]
    expect(call.where).toEqual({ id: 'lea-abc' })

    const brackets = call.data.settings.importedPlayoffBrackets
    expect(brackets['2025'].season).toBe(2025)
    expect(brackets['2025'].matchups).toHaveLength(2)
    expect(brackets['2025'].matchups[0]).toMatchObject({
      bracket_type: 'winners',
      round: 1,
      matchup_id: 1,
      team1_roster_id: '1',
      team2_roster_id: '3',
      winner_roster_id: '3',
      loser_roster_id: '1',
    })
    expect(brackets['2025'].matchups[1]).toMatchObject({
      round: 3,
      matchup_id: 6,
      placement: 1,
    })
    expect(typeof brackets['2025'].persistedAt).toBe('string')
  })

  it('validates round + matchup_id + bracket_type; skips malformed matchups', async () => {
    mocks.leagueFindUnique.mockResolvedValue({ settings: null })

    const result = await invokePersist('lea-abc', {
      season: 2026,
      matchups: [
        { bracket_type: 'winners', round: 1, matchup_id: 1, team1_roster_id: '1', team2_roster_id: '2', winner_roster_id: null, loser_roster_id: null, placement: null },
        { bracket_type: 'invalid', round: 1, matchup_id: 2 } as never, // bad bracket_type
        { bracket_type: 'losers', matchup_id: 3 } as never, // missing round
        { bracket_type: 'losers', round: 1 } as never, // missing matchup_id
        null as never,
      ],
    })

    expect(result).toEqual({ written: 1, skipped: 4 })
  })
})

describe('persistPlayoffBracket — preserves other settings keys', () => {
  it('merges into existing settings without dropping unrelated keys', async () => {
    mocks.leagueFindUnique.mockResolvedValue({
      settings: {
        roster_positions: ['QB', 'RB'],
        scoring_settings: { rec: 1 },
        waiverSettings: { waiverType: 'faab' },
      },
    })

    await invokePersist('lea-abc', {
      season: 2025,
      matchups: [
        { bracket_type: 'winners', round: 1, matchup_id: 1, team1_roster_id: '1', team2_roster_id: '2', winner_roster_id: null, loser_roster_id: null, placement: null },
      ],
    })

    const call = mocks.leagueUpdate.mock.calls[0][0]
    expect(call.data.settings.roster_positions).toEqual(['QB', 'RB'])
    expect(call.data.settings.scoring_settings).toEqual({ rec: 1 })
    expect(call.data.settings.waiverSettings).toEqual({ waiverType: 'faab' })
    expect(call.data.settings.importedPlayoffBrackets['2025']).toBeDefined()
  })
})

describe('persistPlayoffBracket — re-import dedup (season-key replacement)', () => {
  it('re-importing the same season REPLACES the entry, never appends a duplicate', async () => {
    // First import: 2025 bracket with 2 matchups.
    mocks.leagueFindUnique.mockResolvedValueOnce({ settings: null })
    await invokePersist('lea-abc', {
      season: 2025,
      matchups: [
        { bracket_type: 'winners', round: 1, matchup_id: 1, team1_roster_id: '1', team2_roster_id: '3', winner_roster_id: '3', loser_roster_id: '1', placement: null },
        { bracket_type: 'winners', round: 3, matchup_id: 6, team1_roster_id: '8', team2_roster_id: '10', winner_roster_id: '8', loser_roster_id: '10', placement: 1 },
      ],
    })
    const firstWritten = mocks.leagueUpdate.mock.calls[0][0].data.settings

    // Re-import: same league, same season 2025, but the championship result
    // flipped (winner is now 10, not 8) — simulates a re-import after Sleeper
    // corrected data, or simply re-running the same import.
    mocks.leagueFindUnique.mockResolvedValueOnce({ settings: firstWritten })
    await invokePersist('lea-abc', {
      season: 2025,
      matchups: [
        { bracket_type: 'winners', round: 1, matchup_id: 1, team1_roster_id: '1', team2_roster_id: '3', winner_roster_id: '3', loser_roster_id: '1', placement: null },
        { bracket_type: 'winners', round: 3, matchup_id: 6, team1_roster_id: '8', team2_roster_id: '10', winner_roster_id: '10', loser_roster_id: '8', placement: 1 },
      ],
    })

    expect(mocks.leagueUpdate).toHaveBeenCalledTimes(2)
    const secondWritten = mocks.leagueUpdate.mock.calls[1][0].data.settings

    // Exactly ONE key for season 2025 in both writes — no array growth, no
    // duplicate season entries possible by construction (object key, not array push).
    expect(Object.keys(firstWritten.importedPlayoffBrackets)).toEqual(['2025'])
    expect(Object.keys(secondWritten.importedPlayoffBrackets)).toEqual(['2025'])

    // The second write's content reflects the corrected winner — proving it's a
    // real replace, not a no-op or an append.
    const champMatchup = secondWritten.importedPlayoffBrackets['2025'].matchups.find(
      (m: { matchup_id: number }) => m.matchup_id === 6,
    )
    expect(champMatchup.winner_roster_id).toBe('10')
  })

  it('two different seasons for the same league coexist as separate keys (not overwritten)', async () => {
    mocks.leagueFindUnique.mockResolvedValueOnce({ settings: null })
    await invokePersist('lea-abc', {
      season: 2024,
      matchups: [{ bracket_type: 'winners', round: 1, matchup_id: 1, team1_roster_id: '1', team2_roster_id: '2', winner_roster_id: '1', loser_roster_id: '2', placement: null }],
    })
    const afterFirst = mocks.leagueUpdate.mock.calls[0][0].data.settings

    mocks.leagueFindUnique.mockResolvedValueOnce({ settings: afterFirst })
    await invokePersist('lea-abc', {
      season: 2025,
      matchups: [{ bracket_type: 'winners', round: 1, matchup_id: 1, team1_roster_id: '3', team2_roster_id: '4', winner_roster_id: '3', loser_roster_id: '4', placement: null }],
    })
    const afterSecond = mocks.leagueUpdate.mock.calls[1][0].data.settings

    expect(Object.keys(afterSecond.importedPlayoffBrackets).sort()).toEqual(['2024', '2025'])
  })
})

describe('persistPlayoffBracket — defensive behavior', () => {
  it('returns { written: 0, skipped: 0 } and skips DB entirely for an invalid bracket shape', async () => {
    const result = await invokePersist('lea-abc', { season: 'not-a-number' as unknown as number, matchups: [] })
    expect(result).toEqual({ written: 0, skipped: 0 })
    expect(mocks.leagueFindUnique).not.toHaveBeenCalled()
    expect(mocks.leagueUpdate).not.toHaveBeenCalled()
  })

  it('handles matchups: [] (brackets fetched but playoffs not started) — still writes the season key', async () => {
    mocks.leagueFindUnique.mockResolvedValue({ settings: null })
    const result = await invokePersist('lea-abc', { season: 2026, matchups: [] })
    expect(result).toEqual({ written: 0, skipped: 0 })
    expect(mocks.leagueUpdate).toHaveBeenCalledOnce()
    const call = mocks.leagueUpdate.mock.calls[0][0]
    expect(call.data.settings.importedPlayoffBrackets['2026'].matchups).toEqual([])
  })
})
