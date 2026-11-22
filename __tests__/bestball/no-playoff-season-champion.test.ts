/**
 * A Best Ball league with no playoffs ends on its regular season and crowns its leader — the points
 * leader for season-long scoring, the record leader (points as tiebreak) for head-to-head — through
 * the same cumulative finalize roto uses, never a bracket (lib/bestball/noPlayoffSeason.ts).
 *
 * Before: nothing in the season engine knew a best ball league could have no playoffs. The season ran
 * the sport's default length, `ensureRedraftSeason` opened playoffs at the sport's default week, and
 * the bracket runtime clamps a 0-team bracket up to 2 — a fabricated two-team final.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  season: vi.fn(),
  rosters: vi.fn(),
  leagueUpdate: vi.fn(),
  seasonUpdate: vi.fn(),
  transition: vi.fn(),
  emit: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftSeason: { findUnique: (...a: unknown[]) => m.season(...a) },
    roster: { findMany: vi.fn().mockResolvedValue([{ id: 'g1' }, { id: 'g2' }, { id: 'g3' }]) },
    teamWeekResult: { findMany: vi.fn().mockResolvedValue([{ rosterId: 'g1' }, { rosterId: 'g2' }, { rosterId: 'g3' }]) },
    redraftRoster: { findMany: (...a: unknown[]) => m.rosters(...a) },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        league: { findUnique: vi.fn().mockResolvedValue({ settings: {} }), update: (...a: unknown[]) => m.leagueUpdate(...a) },
        redraftSeason: { update: (...a: unknown[]) => m.seasonUpdate(...a) },
      }),
  },
}))
vi.mock('@/lib/redraft/standingsEngine', () => ({ updateStandings: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/server/services/leagueLifecycleService', () => ({ transitionLeagueStateInTransaction: (...a: unknown[]) => m.transition(...a) }))
vi.mock('@/lib/events', () => ({ getPlatformEvents: () => ({ emit: m.emit }), EVENT: { CHAMPION_CROWNED: 'c', SEASON_COMPLETED: 's' } }))

import { finalizeRotoSeason } from '@/lib/redraft/offseason/finalizeRotoSeason'
import { resolveCreatedSeasonWeeks } from '@/lib/redraft/createdSeasonLength'
import { isBestBallNoPlayoffLeague, noPlayoffChampionRule } from '@/lib/bestball/noPlayoffSeason'

type Row = { id: string; teamName: string; pointsFor: number; wins: number }
const TEAMS: Row[] = [
  // The points leader has the worse record, so the two rules must crown different teams.
  { id: 'points-king', teamName: 'Points King', pointsFor: 2100, wins: 6 },
  { id: 'record-king', teamName: 'Record King', pointsFor: 1900, wins: 11 },
  { id: 'third', teamName: 'Third', pointsFor: 1500, wins: 8 },
]

/** The mock honours the orderBy the finalize asks for, so the test reads the rule, not the fixture order. */
function rostersInRequestedOrder(args: { orderBy: Array<Record<string, 'asc' | 'desc'>> }) {
  const rows = [...TEAMS]
  rows.sort((a, b) => {
    for (const clause of args.orderBy) {
      const [key, dir] = Object.entries(clause)[0] as [keyof Row, 'asc' | 'desc']
      if (a[key] !== b[key]) return (a[key] < b[key] ? -1 : 1) * (dir === 'desc' ? -1 : 1)
    }
    return 0
  })
  return Promise.resolve(rows)
}

function bestBallLeague(bestBall: Record<string, unknown>) {
  return { leagueType: 'best_ball', bestBallMode: true, settings: { league_type: 'best_ball', scoring_mode: 'points', best_ball_settings: bestBall } }
}

function seasonRow(id: string, league: unknown) {
  return { id, leagueId: 'L', season: 2026, totalWeeks: 17, status: 'active', league }
}

beforeEach(() => {
  vi.clearAllMocks()
  m.rosters.mockImplementation(rostersInRequestedOrder)
})

describe('no-playoff best ball: champion', () => {
  it('season-long points: the points leader is crowned, and the result is saved under its own key', async () => {
    m.season.mockResolvedValue(seasonRow('s1', bestBallLeague({ playoffFormat: 'none', playoffTeams: 0, matchupFormat: 'cumulative', cumulativeScoring: true })))
    const result = await finalizeRotoSeason('s1', 'system')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.championRosterId).toBe('points-king')
    expect(result.runnerUpRosterId).toBe('record-king')
    const saved = m.leagueUpdate.mock.calls[0][0].data.settings
    expect(saved.season_total_results['2026'].championRosterId).toBe('points-king')
    expect(saved.roto_season_results).toBeUndefined()
    expect(m.seasonUpdate).toHaveBeenCalledWith({ where: { id: 's1' }, data: { status: 'complete' } })
  })

  it('head-to-head with no playoffs: the best record is crowned, points break a tie', async () => {
    m.season.mockResolvedValue(seasonRow('s2', bestBallLeague({ playoffFormat: 'none', playoffTeams: 0, matchupFormat: 'h2h', cumulativeScoring: false })))
    const result = await finalizeRotoSeason('s2', 'system')
    expect(result.ok && result.championRosterId).toBe('record-king')
  })

  it('[control] a best ball league WITH playoffs is refused here — its bracket crowns the champion', async () => {
    m.season.mockResolvedValue(seasonRow('s3', bestBallLeague({ playoffFormat: 'bracket', playoffTeams: 6, matchupFormat: 'h2h' })))
    await expect(finalizeRotoSeason('s3', 'system')).rejects.toThrow('not_roto')
  })

  it('[control] roto still finalizes as roto, under its own key', async () => {
    m.season.mockResolvedValue(seasonRow('s4', { leagueType: 'redraft', bestBallMode: false, settings: { scoring_mode: 'roto' } }))
    const result = await finalizeRotoSeason('s4', 'system')
    expect(result.ok && result.championRosterId).toBe('points-king')
    expect(m.leagueUpdate.mock.calls[0][0].data.settings.roto_season_results['2026'].championRosterId).toBe('points-king')
  })
})

describe('no-playoff best ball: season shape', () => {
  it('the season is the regular season the league saved, not the sport default', () => {
    const league = { ...bestBallLeague({ playoffFormat: 'none', playoffTeams: 0, regularSeasonLength: 17 }), sport: 'NFL' }
    expect(resolveCreatedSeasonWeeks(league, 18)).toBe(17)
  })

  it('[control] a best ball league with playoffs keeps the sport default season length', () => {
    const league = { ...bestBallLeague({ playoffFormat: 'bracket', playoffTeams: 6, regularSeasonLength: 14 }), sport: 'NFL' }
    expect(resolveCreatedSeasonWeeks(league, 17)).toBe(17)
  })

  it('the predicate: format none or 0 teams; never a tournament, never a non-best-ball league', () => {
    expect(isBestBallNoPlayoffLeague(bestBallLeague({ playoffFormat: 'none', playoffTeams: 6 }))).toBe(true)
    expect(isBestBallNoPlayoffLeague(bestBallLeague({ playoffFormat: 'bracket', playoffTeams: 0 }))).toBe(true)
    expect(isBestBallNoPlayoffLeague(bestBallLeague({ playoffFormat: 'advancement', playoffTeams: 0, contestStructure: 'tournament' }))).toBe(false)
    expect(isBestBallNoPlayoffLeague({ leagueType: 'redraft', settings: { best_ball_settings: { playoffFormat: 'none' } } })).toBe(false)
    expect(noPlayoffChampionRule({ best_ball_settings: { matchupFormat: 'cumulative' } })).toBe('points_leader')
    expect(noPlayoffChampionRule({ best_ball_settings: { matchupFormat: 'h2h' } })).toBe('record_leader')
  })
})
