import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/league-import/refreshHistoricalDerivedData', () => ({ refreshHistoricalDerivedData: vi.fn() }))
vi.mock('@/lib/dynasty-import/normalize-historical', () => ({
  persistDynastySeason: vi.fn(),
  persistStandings: vi.fn(),
}))
vi.mock('@/lib/league-import/persistProviderTransactionFacts', () => ({ persistProviderTransactionFacts: vi.fn() }))
vi.mock('@/lib/league-import/bulkWarehouseFactPersistence', () => ({ persistSeasonStandingFacts: vi.fn() }))
vi.mock('@/lib/league-import/fantrax/FantraxLeagueFetchService', () => ({ fetchFantraxLeagueForImport: vi.fn() }))

import {
  resolveFantraxChampionTeamId,
  scoredFantraxMatchups,
} from '@/lib/league-import/fantrax/FantraxHistoricalBackfillService'
import type { FantraxImportPayload } from '@/lib/league-import/adapters/fantrax/types'

type Matchup = FantraxImportPayload['schedule'][number]['matchups'][number]

function game(teamId1: string, points1: number | undefined, teamId2: string, points2: number | undefined, isPlayoff = false): Matchup {
  return { teamId1, teamId2, points1, points2, isPlayoff } as Matchup
}

function payloadWith(args: {
  isFinished?: boolean
  ranks: Record<string, number | null>
  weeks: Array<{ week: number; matchups: Matchup[] }>
}): FantraxImportPayload {
  return {
    league: { isFinished: args.isFinished ?? true },
    teams: Object.entries(args.ranks).map(([teamId, rank]) => ({ teamId, rank })),
    schedule: args.weeks.map((w) => ({ ...w, season: 2025 })),
  } as unknown as FantraxImportPayload
}

/* Seeds 1-4 make the playoffs; 5 and 6 play a consolation bracket in the same weeks. */
const RANKS = { s1: 1, s2: 2, s3: 3, s4: 4, s5: 5, s6: 6 }

describe('the champion is the playoff winner, not the top of the table', () => {
  /**
   * 🛑 THE BUG. Rank 1 lost its semi-final; the old rule crowned it anyway.
   */
  it('crowns the team that won the final, even when rank 1 lost earlier', () => {
    const payload = payloadWith({
      ranks: RANKS,
      weeks: [
        { week: 13, matchups: [game('s1', 120, 's2', 100)] },
        { week: 14, matchups: [game('s1', 90, 's4', 110, true), game('s2', 105, 's3', 95, true)] },
        { week: 15, matchups: [game('s4', 99, 's2', 130, true), game('s1', 140, 's3', 80, true)] },
      ],
    })
    /* s1 won the third-place game in week 15, but lost in week 14. */
    expect(resolveFantraxChampionTeamId(payload)).toBe('s2')
  })

  it('is not fooled by an unbeaten consolation-bracket winner', () => {
    const payload = payloadWith({
      ranks: RANKS,
      weeks: [
        { week: 14, matchups: [game('s1', 90, 's4', 110, true), game('s2', 105, 's3', 95, true)] },
        {
          week: 15,
          matchups: [game('s4', 99, 's2', 130, true), game('s5', 150, 's6', 60, true)],
        },
      ],
    })
    expect(resolveFantraxChampionTeamId(payload)).toBe('s2')
  })

  it('crowns nobody when two unbeaten winners cannot be separated by rank', () => {
    const payload = payloadWith({
      ranks: { ...RANKS, s2: null },
      weeks: [{ week: 15, matchups: [game('s4', 99, 's2', 130, true), game('s5', 150, 's6', 60, true)] }],
    })
    expect(resolveFantraxChampionTeamId(payload)).toBeNull()
  })

  it('falls back to rank 1 when the league ran no playoffs', () => {
    const payload = payloadWith({
      ranks: RANKS,
      weeks: [{ week: 13, matchups: [game('s1', 120, 's2', 100)] }],
    })
    expect(resolveFantraxChampionTeamId(payload)).toBe('s1')
  })

  it('falls back to rank 1 when no playoff week has a score on file', () => {
    const payload = payloadWith({
      ranks: RANKS,
      weeks: [{ week: 15, matchups: [game('s4', undefined, 's2', undefined, true)] }],
    })
    expect(resolveFantraxChampionTeamId(payload)).toBe('s1')
  })

  it('crowns nobody while the season is still running', () => {
    const payload = payloadWith({
      isFinished: false,
      ranks: RANKS,
      weeks: [{ week: 15, matchups: [game('s4', 99, 's2', 130, true)] }],
    })
    expect(resolveFantraxChampionTeamId(payload)).toBeNull()
  })
})

describe('an unplayed matchup is not a 0-0 result', () => {
  /**
   * 🛑 THE BUG. A missing score was written to the warehouse as 0, so every week
   * Fantrax had not scored became a scoreless tie.
   */
  it('keeps only matchups with both scores on file', () => {
    const payload = payloadWith({
      ranks: RANKS,
      weeks: [
        { week: 1, matchups: [game('s1', 120, 's2', 100), game('s3', 0, 's4', 0)] },
        { week: 2, matchups: [game('s1', undefined, 's3', undefined), game('s2', 88, 's4', undefined)] },
      ],
    })
    const scored = scoredFantraxMatchups(payload)

    expect(scored.map((s) => [s.week, s.matchup.teamId1, s.matchup.points1, s.matchup.points2])).toEqual([
      [1, 's1', 120, 100],
      /* A real 0-0 has real zeros and IS a result. */
      [1, 's3', 0, 0],
    ])
  })
})
