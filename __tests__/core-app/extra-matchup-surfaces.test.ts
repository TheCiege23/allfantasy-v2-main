// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The extra matchup an odd-team league plays instead of the bye reaches every surface that draws a
 * weekly matchup: the week board and the matchup screen loaders (their call sites, end to end), the
 * rails, the dashboard's week rows, the live strip, notifications, the recap, the schedule and the
 * war room context — each naming the chosen team with both scores.
 */

const h = vi.hoisted(() => ({
  rows: vi.fn(), teams: vi.fn(), facts: vi.fn(), metadata: vi.fn(), seasons: vi.fn(), seasonFirst: vi.fn(),
  rosters: vi.fn(), rosterFirst: vi.fn(), games: vi.fn(), leagues: vi.fn(), cache: vi.fn(), upsert: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  weeklyMatchup: { findMany: h.rows, groupBy: vi.fn(async () => []) }, leagueTeam: { findMany: h.teams }, matchupFact: { findMany: h.facts },
  league: { findMany: h.leagues },
  redraftSeason: { findMany: h.seasons, findFirst: h.seasonFirst },
  redraftRoster: { findMany: h.rosters, findFirst: h.rosterFirst },
  redraftMatchup: { findMany: h.games },
  sportsDataCache: { findMany: h.cache, upsert: h.upsert },
} }))
vi.mock('@/lib/core-app/leagueWeekMetadata', () => ({ readLeagueWeekMetadata: h.metadata }))
vi.mock('@/lib/core-app/seasonPhase', () => ({ getFirstStatedKickoff: async () => null }))

import { getWeekBoard } from '@/lib/core-app/weekBoard'
import { getMatchupData } from '@/lib/core-app/matchup'
import type { LeagueContext } from '@/lib/core-app/leagueContext'
import { buildMatchupStrip } from '@/lib/live/matchupStrip'
import { extraMatchupForRoster } from '@/lib/redraft/oddTeamExtraMatchupRules'
import { nativeExtraResultMessages } from '@/lib/redraft/nativeResultNotify'
import { buildNativeWeeklyRecap } from '@/lib/league-chat/nativeWeeklyRecap'
import { buildCanonicalScheduleRuntimeState } from '@/lib/schedule-runtime/canonicalScheduleRuntime'

const PICK = { extraMatchup: { opponentRosterId: 'r2', rule: 'top_scorer', reason: 'top_scorer', scoring: 'leftover_only', basisWeek: 3, decidedAt: 'x' } }
// Week 4 of a 3-team native league: r2 plays r3, r1 (the user) is the leftover team and plays r2.
const WEEK4 = [
  { id: 'g', leagueId: 'N', seasonId: 's', week: 4, homeRosterId: 'r2', awayRosterId: 'r3', homeScore: 101.5, awayScore: 90, status: 'final', lineupSnapshots: null, season: { season: 2026 } },
  { id: 'bye', leagueId: 'N', seasonId: 's', week: 4, homeRosterId: 'r1', awayRosterId: null, homeScore: 120.25, awayScore: 0, status: 'final', lineupSnapshots: PICK, season: { season: 2026 } },
]
const ROSTERS = [
  { id: 'r1', leagueId: 'N', ownerId: 'u', ownerName: 'User', teamName: 'My team', avatarUrl: null, season: { season: 2026 } },
  { id: 'r2', leagueId: 'N', ownerId: 'v', ownerName: 'Rival', teamName: 'Top Dogs', avatarUrl: null, season: { season: 2026 } },
  { id: 'r3', leagueId: 'N', ownerId: 'w', ownerName: 'Third', teamName: 'Third team', avatarUrl: null, season: { season: 2026 } },
]
const LINE = "Extra matchup vs Top Dogs (last week's top scorer) · 120.3–101.5"

beforeEach(() => {
  vi.resetAllMocks()
  for (const fn of Object.values(h)) fn.mockResolvedValue([])
  h.seasonFirst.mockResolvedValue({ id: 's', currentWeek: 4 })
  h.rosterFirst.mockResolvedValue({ id: 'r1' })
  h.seasons.mockResolvedValue([{ id: 's', leagueId: 'N', season: 2026, currentWeek: 4, playoffStartWeek: 15, medianGame: false }])
  h.rosters.mockResolvedValue(ROSTERS)
  h.games.mockResolvedValue(WEEK4)
})

describe('the pick, from the rows any surface already holds', () => {
  const names = (id: string) => ROSTERS.find((r) => r.id === id)?.teamName
  it('both scores, from each side', () => {
    expect(extraMatchupForRoster(WEEK4, 4, 'r1', names)).toMatchObject({ role: 'leftover', teamName: 'Top Dogs', yourScore: 120.25, theirScore: 101.5, final: true, line: LINE })
    expect(extraMatchupForRoster(WEEK4, 4, 'r2', names)).toMatchObject({ role: 'opponent', teamName: 'My team', yourScore: 101.5, theirScore: 120.25, countsForYou: false })
    expect(extraMatchupForRoster(WEEK4, 4, 'r3', names)).toBeNull()
    expect(extraMatchupForRoster(WEEK4, 5, 'r1', names)).toBeNull()
  })
  it('an unplayed week has no scores, and the line says only who and why', () => {
    const unplayed = WEEK4.map((r) => ({ ...r, homeScore: 0, awayScore: 0, status: 'scheduled' }))
    expect(extraMatchupForRoster(unplayed, 4, 'r1', names)).toMatchObject({ yourScore: null, theirScore: null, line: "Extra matchup vs Top Dogs (last week's top scorer)" })
  })
})

describe('the week board loader', () => {
  it('carries the extra matchup for the leftover team, from the native season', async () => {
    const board = await getWeekBoard('u', [{ id: 'N', name: 'Odd League', platform: 'allfantasy', sport: 'NFL' }], 'N')
    expect(board.leagueBoard?.yourRosterId).toBe('r1')
    expect(board.leagueBoard?.extraMatchup).toMatchObject({ role: 'leftover', line: LINE })
  })
  it('an imported league never reads it', async () => {
    const board = await getWeekBoard('u', [{ id: 'X', name: 'Sleeper', platform: 'sleeper', platformLeagueId: 'p1' }], 'X')
    expect(board.leagueBoard?.extraMatchup ?? null).toBeNull()
    expect(h.seasonFirst).not.toHaveBeenCalled()
  })
})

function ctxFor(platform: string): LeagueContext {
  const league = { id: 'N', name: 'Odd League', platform, platformLeagueId: null, sport: 'NFL', season: 2026, settings: {} }
  return {
    leagueId: 'N', userId: 'u',
    league: async () => league as never,
    claimedTeam: async () => null,
    claimedTeams: async () => [],
  }
}

describe('the matchup screen loader', () => {
  it('a native league\'s leftover team gets its extra matchup — read from the native season, not the WeeklyMatchup week', async () => {
    const data = await getMatchupData('N', 'u', null, ctxFor('allfantasy'))
    expect(data?.week.available).toBe(false) // natives have no WeeklyMatchup rows
    expect(data?.extraMatchup).toMatchObject({ role: 'leftover', teamName: 'Top Dogs', line: LINE })
    expect(h.games.mock.calls.at(-1)?.[0].where).toMatchObject({ seasonId: 's', week: 4 })
  })
  it('an explicit week is the one read', async () => {
    await getMatchupData('N', 'u', 3, ctxFor('allfantasy'))
    expect(h.games.mock.calls.at(-1)?.[0].where).toMatchObject({ week: 3 })
  })
  it('an imported league never reads it', async () => {
    const data = await getMatchupData('N', 'u', null, ctxFor('sleeper'))
    expect(data?.extraMatchup ?? null).toBeNull()
    expect(h.seasonFirst).not.toHaveBeenCalled()
  })
  it('the live strip says it, with both scores, instead of "no matchup"', async () => {
    const data = await getMatchupData('N', 'u', null, ctxFor('allfantasy'))
    expect(buildMatchupStrip(data)).toEqual({ kind: 'unavailable', reason: LINE })
  })
})

describe('results, recap and schedule', () => {
  it('the leftover team is told its extra result; the chosen team only when it counts', () => {
    const game = { leftoverOwnerId: 'u', leftoverTeam: 'My team', leftoverScore: 120.25, opponentOwnerId: 'v', opponentTeam: 'Top Dogs', opponentScore: 101.5, reason: "last week's top scorer", countsForOpponent: false }
    const msgs = nativeExtraResultMessages({ games: [game], people: new Set(['u', 'v']), leagueName: 'Odd', week: 4 })
    expect(msgs).toEqual([{ userId: 'u', extra: true, title: 'Week 4 extra matchup final — you won', body: "Odd: extra matchup vs Top Dogs (last week's top scorer) — you won 120.3–101.5." }])
    const both = nativeExtraResultMessages({ games: [{ ...game, countsForOpponent: true }], people: new Set(['u', 'v']), leagueName: 'Odd', week: 4 })
    expect(both.map((m) => [m.userId, m.title])).toEqual([['u', 'Week 4 extra matchup final — you won'], ['v', 'Week 4 extra matchup final — you lost']])
  })
  it('the recap lists the extra game', () => {
    const text = buildNativeWeeklyRecap({
      leagueName: 'Odd', season: 2026, week: 4, leaders: [],
      games: [
        { home: 'Top Dogs', away: 'Third team', homeScore: 101.5, awayScore: 90 },
        { home: 'My team', away: 'Top Dogs', homeScore: 120.25, awayScore: 101.5, extraReason: "last week's top scorer" },
      ],
    })
    expect(text).toContain("My team 120.3 def. Top Dogs 101.5 — extra matchup (Top Dogs: last week's top scorer)")
    expect(text).toContain('🏆 Top score: My team, 120.3')
  })
  it('the schedule labels the bye row as the extra matchup, with the line', () => {
    const state = buildCanonicalScheduleRuntimeState({
      rules: { general: { sport: 'NFL', status: 'active' }, playoffs: { startWeek: 15 }, schedule: { regularSeasonLength: 14 } } as never,
      teams: ROSTERS.map((r) => ({ rosterId: r.id, displayName: r.teamName })),
      persistedMatchups: WEEK4.map(({ season: _s, leagueId: _l, seasonId: _x, ...r }) => r),
      currentWeek: 4,
    } as never)
    const bye = state.weeks.find((w) => w.week === 4)!.matchups.find((m) => m.bye)!
    expect(bye.extraMatchup).toEqual({ opponentRosterId: 'r2', opponentName: 'Top Dogs', line: LINE })
  })
})
