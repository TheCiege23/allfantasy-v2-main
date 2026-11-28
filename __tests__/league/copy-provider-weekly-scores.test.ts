import { describe, expect, it, vi } from 'vitest'
import { copyProviderWeeklyScores } from '@/lib/league/copyProviderWeeklyScores'
import { nativeRosterSeat } from '@/lib/redraft/nativePlayerWeeklyScores'

type Weekly = { week: number; game?: number; matchupId: number | null; rosterId: string; pointsFor: number }
type PlayerRow = { week: number; playerId: string; rosterId: number | null; isStarter: boolean; points: number }

function tx(opts: { existing?: number; weekly?: Weekly[]; players?: PlayerRow[]; identities?: Array<Record<string, string>> } = {}) {
  let n = 0
  return {
    redraftMatchup: {
      count: vi.fn().mockResolvedValue(opts.existing ?? 0),
      create: vi.fn().mockImplementation(() => Promise.resolve({ id: `m${++n}` })),
    },
    weeklyMatchup: { findMany: vi.fn().mockResolvedValue((opts.weekly ?? []).map((w) => ({ game: 1, ...w }))) },
    leaguePlayerWeeklyScore: {
      findMany: vi.fn().mockResolvedValue(opts.players ?? []),
      createMany: vi.fn().mockImplementation(({ data }: { data: unknown[] }) => Promise.resolve({ count: data.length })),
    },
    playerIdentityMap: { findMany: vi.fn().mockResolvedValue(opts.identities ?? []) },
    player: { findMany: vi.fn().mockResolvedValue([]) },
  }
}

const base = {
  leagueId: 'L', providerLeagueId: 'sl-1', season: 2026, seasonId: 'S', playoffStartWeek: 15, sport: 'NFL', platform: 'sleeper',
  redraftRosterIdByExternalId: new Map([['1', 'rr1'], ['2', 'rr2'], ['3', 'rr3'], ['0004', 'rr4']]),
  idMap: new Map([['p1', 'p1']]),
}
const created = (t: ReturnType<typeof tx>) => t.redraftMatchup.create.mock.calls.map(([arg]) => (arg as { data: Record<string, unknown> }).data)

describe('copyProviderWeeklyScores: matchups', () => {
  it('pairs sides by matchup, marks playoff weeks, and keeps byes as one-sided', async () => {
    const t = tx({ weekly: [
      { week: 1, matchupId: 1, rosterId: '1', pointsFor: 101 }, { week: 1, matchupId: 1, rosterId: '2', pointsFor: 99 },
      { week: 1, matchupId: null, rosterId: '3', pointsFor: 80 },
      { week: 15, matchupId: 2, rosterId: '1', pointsFor: 120 }, { week: 15, matchupId: 2, rosterId: '3', pointsFor: 110 },
    ] })
    const result = await copyProviderWeeklyScores(t as never, base)
    expect(result).toMatchObject({ matchups: 3, matchupsSkipped: 0, matchupIds: ['m1', 'm2', 'm3'] })
    expect(created(t)).toEqual([
      expect.objectContaining({ week: 1, type: 'regular', homeRosterId: 'rr1', awayRosterId: 'rr2', homeScore: 101, awayScore: 99, status: 'final', seasonId: 'S', leagueId: 'L' }),
      expect.objectContaining({ week: 1, homeRosterId: 'rr3', awayRosterId: null, homeScore: 80, awayScore: 0 }),
      expect.objectContaining({ week: 15, type: 'playoff', homeRosterId: 'rr1', awayRosterId: 'rr3' }),
    ])
  })

  it("matches MFL's zero-padded team id to the unpadded id the weekly row stores", async () => {
    const t = tx({ weekly: [{ week: 2, matchupId: 5, rosterId: '4', pointsFor: 70 }, { week: 2, matchupId: 5, rosterId: '1', pointsFor: 75 }] })
    await copyProviderWeeklyScores(t as never, base)
    const [row] = created(t)
    expect([row!.homeRosterId, row!.awayRosterId].sort()).toEqual(['rr1', 'rr4'])
  })

  it('skips a matchup with a team it cannot match, or more than two sides, instead of guessing', async () => {
    const t = tx({ weekly: [
      { week: 3, matchupId: 1, rosterId: '1', pointsFor: 1 }, { week: 3, matchupId: 1, rosterId: '99', pointsFor: 2 },
      { week: 4, matchupId: 2, rosterId: '1', pointsFor: 1 }, { week: 4, matchupId: 2, rosterId: '2', pointsFor: 2 }, { week: 4, matchupId: 2, rosterId: '3', pointsFor: 3 },
    ] })
    expect(await copyProviderWeeklyScores(t as never, base)).toMatchObject({ matchups: 0, matchupsSkipped: 2 })
  })

  it('writes no matchups into a season that already has some, because nothing else would stop a duplicate', async () => {
    const t = tx({ existing: 4, weekly: [{ week: 1, matchupId: 1, rosterId: '1', pointsFor: 1 }] })
    expect(await copyProviderWeeklyScores(t as never, base)).toMatchObject({ matchups: 0, matchupsNotCopied: 'season_already_has_matchups' })
    expect(t.redraftMatchup.create).not.toHaveBeenCalled()
  })
})

describe('copyProviderWeeklyScores: per-player points', () => {
  it('re-keys rows the native way and resolves players no longer on a roster', async () => {
    const t = tx({
      players: [
        { week: 1, playerId: 'p1', rosterId: 1, isStarter: true, points: 22.5 },
        { week: 1, playerId: 'gone', rosterId: 2, isStarter: false, points: 3 },
        { week: 2, playerId: 'unknown', rosterId: 2, isStarter: true, points: 9 },
      ],
      identities: [{ sleeperId: 'gone', canonicalName: 'Retired Guy', position: 'WR', currentTeam: 'FA' }],
    })
    const result = await copyProviderWeeklyScores(t as never, base)
    expect(result).toMatchObject({ playerScores: 2, playerScoresUnmapped: 1 })
    const [[{ data, skipDuplicates }]] = t.leaguePlayerWeeklyScore.createMany.mock.calls as unknown as [[{ data: Array<Record<string, unknown>>; skipDuplicates: boolean }]]
    expect(skipDuplicates).toBe(true)
    expect(data).toEqual([
      { leagueId: 'L', seasonYear: 2026, week: 1, playerId: 'p1', rosterId: nativeRosterSeat('rr1'), isStarter: true, points: 22.5, isFinalized: true, source: 'allfantasy' },
      { leagueId: 'L', seasonYear: 2026, week: 1, playerId: 'gone', rosterId: nativeRosterSeat('rr2'), isStarter: false, points: 3, isFinalized: true, source: 'allfantasy' },
    ])
    // Only the provider's own rows are read: never this copy's earlier output.
    expect(t.leaguePlayerWeeklyScore.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: 'sl-1', seasonYear: 2026, source: { not: 'allfantasy' } } }))
  })
})
