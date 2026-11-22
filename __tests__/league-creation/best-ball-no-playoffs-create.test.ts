/**
 * A Best Ball league with NO playoffs saves no playoffs: 0 playoff teams on the column and in every
 * JSON copy, no playoff start week anywhere, and `best_ball_settings` saying so — so the season
 * engine crowns the regular-season leader instead of building a bracket (lib/bestball/noPlayoffSeason.ts).
 *
 * Before: `playoffFormat: 'none'` was saved beside `playoffTeams: 6` — the League column was written 6
 * and the playoff start week was the week after the regular season — and `playoffTeams: 0` still got
 * the sport's default playoff start week in the column and every JSON copy.
 */
import { describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  prisma: { league: { findUnique: vi.fn(), create: vi.fn() } },
}))
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))

import { createCanonicalLeagueInTransaction } from '@/lib/league-creation/canonical/createCanonicalLeagueInTransaction'
import { runPresetEngine } from '@/lib/league-creation/preset-engine/runPresetEngine'
import { readPlayoffStartWeekCopies } from '@/lib/playoff-settings/playoffStartWeekCopies'
import { isBestBallNoPlayoffLeague } from '@/lib/bestball/noPlayoffSeason'

type Obj = Record<string, any>

function buildTx() {
  let n = 0
  const ok = (id: string) => vi.fn().mockResolvedValue({ id })
  return {
    userProfile: { findUnique: vi.fn().mockResolvedValue({ displayName: 'C', xpLevel: 1, legacyCareerLevel: null }) },
    appUser: { findUnique: vi.fn().mockResolvedValue({ username: 'c', email: 'c@test.local' }) },
    league: { findFirst: vi.fn().mockResolvedValue(null), create: ok('league-1'), update: ok('league-1') },
    leagueSettings: { create: ok('ls') },
    leagueWaiverSettings: { create: ok('lws') },
    scoringSettingsSnapshot: { create: ok('ss') },
    guillotineLeagueConfig: { upsert: ok('g') },
    idpLeagueConfig: { upsert: ok('i') },
    dynastyLeagueConfig: { upsert: ok('d') },
    devyLeagueConfig: { upsert: ok('dv') },
    c2CLeagueConfig: { upsert: ok('c') },
    redraftLeagueExtendedSettings: { create: ok('e') },
    redraftLeagueDraftProfile: { create: ok('dp') },
    redraftLeagueHomepageState: { create: ok('h') },
    redraftLeagueSportIntegration: { create: ok('si') },
    redraftLeagueChatRoom: { create: ok('chat') },
    bestBallContest: { create: ok('bbc') },
    roster: {
      create: vi.fn().mockImplementation(async (args?: Obj) => {
        n += 1
        return { id: `roster-${n}`, platformUserId: args?.data?.platformUserId ?? `p-${n}` }
      }),
    },
    leagueTeam: { create: vi.fn().mockImplementation(async () => ({ id: `team-${++n}` })) },
    redraftLeagueMember: { create: ok('m') },
    leagueEntrySlot: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    draftSession: { create: ok('ds') },
    leagueInvite: { create: vi.fn().mockResolvedValue({ id: 'inv', token: 'T' }) },
    findLeagueListing: { upsert: ok('fl') },
  }
}

const PRESET: Record<string, string> = { NFL: 'fb_half_ppr', NBA: 'nba_points', NHL: 'nhl_points', MLB: 'mlb_points', NCAAF: 'ncaaf_half_ppr' }

async function create(sport: string, bestBall: Obj | null) {
  const tx = buildTx()
  const body = {
    concept: 'best_ball', sport, teamCount: 12, draftType: 'snake', scoringPreset: PRESET[sport],
    leagueName: 'No playoffs', language: 'en', tradeReviewMode: 'commissioner',
    ...(bestBall ? { conceptSetup: { bestBall } } : {}),
  } as any
  await createCanonicalLeagueInTransaction(tx as any, 'u1', body, runPresetEngine({ ...body, commissionerId: 'u1' }))
  const data = tx.league.create.mock.calls[0][0].data as Obj
  const update = tx.league.update.mock.calls.find(([a]: [Obj]) => 'playoffStartWeek' in (a.data ?? {}))
  return { data, column: (update ? update[0].data.playoffStartWeek : data.playoffStartWeek) as number | null }
}

function expectNoPlayoffs(data: Obj, column: number | null) {
  expect(data.playoffTeams).toBe(0)
  expect(column).toBeNull()
  for (const [key, value] of Object.entries(readPlayoffStartWeekCopies(data.settings))) {
    if (value !== undefined) expect(value, key).toBeNull()
  }
  const s = data.settings
  expect(s.best_ball_settings.playoffTeams).toBe(0)
  expect(s.best_ball_settings.playoffFormat).toBe('none')
  expect(s.playoff_team_count).toBe(0)
  expect(s.playoffSettings.playoffTeams).toBe(0)
  expect(s.playoffSettings.playoff_team_count).toBe(0)
  expect(isBestBallNoPlayoffLeague({ leagueType: 'best_ball', settings: s })).toBe(true)
}

describe('best ball with no playoffs', () => {
  for (const sport of ['NFL', 'NBA', 'NHL', 'MLB', 'NCAAF']) {
    it(`${sport}: playoffFormat "none" saves 0 teams and no start week, even beside a stale team count`, async () => {
      const { data, column } = await create(sport, { matchupFormat: 'cumulative', cumulativeScoring: true, playoffFormat: 'none', playoffTeams: 6 })
      expectNoPlayoffs(data, column)
      // Season-long points: the champion is the points leader, so seeding is by points.
      expect(data.playoffSeedingRule).toBe('points_only')
    })

    it(`${sport}: 0 playoff teams is no playoffs, whatever the bracket format says`, async () => {
      const { data, column } = await create(sport, { matchupFormat: 'h2h', cumulativeScoring: false, playoffFormat: 'bracket', playoffTeams: 0 })
      expectNoPlayoffs(data, column)
    })
  }

  it("the season runs the commissioner's full regular season (no weeks held back for a bracket)", async () => {
    const { data } = await create('NFL', { matchupFormat: 'cumulative', cumulativeScoring: true, playoffFormat: 'none', playoffTeams: 0, regularSeasonLength: 17 })
    expect(data.settings.best_ball_settings.regularSeasonLength).toBe(17)
  })

  it('[control] a best ball league with playoffs keeps its bracket (NFL: 6 teams, starting week 15)', async () => {
    const { data, column } = await create('NFL', null)
    expect(data.playoffTeams).toBe(6)
    expect(column).toBe(15)
    expect(isBestBallNoPlayoffLeague({ leagueType: 'best_ball', settings: data.settings })).toBe(false)
  })

  it('[control] a tournament is not a no-playoff season league (its rounds are the post-season)', async () => {
    const { data } = await create('NFL', { tournamentEnabled: true })
    expect(isBestBallNoPlayoffLeague({ leagueType: 'best_ball', settings: data.settings })).toBe(false)
  })
})
