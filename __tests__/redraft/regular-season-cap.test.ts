/**
 * A redraft or keeper league's regular season is at most 24 weeks (lib/redraft/regularSeasonCap.ts),
 * everywhere it can be set: creation's fitted bracket, the settings PATCH (playoff start week and the
 * settings-JSON copies a `settingsMerge` can write), the commissioner schedule route, the redraft
 * season POST, and the season builder. NFL's defaults are unchanged; each sport's real calendar fits.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  prisma: {
    league: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    leagueWaiverSettings: { findUnique: vi.fn() },
    leagueSettings: { upsert: vi.fn() },
    redraftSeason: { findFirst: vi.fn() },
    redraftPlayoffRound: { findFirst: vi.fn() },
  },
  scheduleConfig: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn().mockResolvedValue({ user: { id: 'u' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/commissioner/permissions', () => ({ assertCommissioner: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/schedule-defaults/ScheduleConfigResolver', () => ({ getScheduleConfigForLeague: m.scheduleConfig }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock('@/lib/redraft/fantraxNativePresentation', () => ({ loadFantraxNativePresentation: vi.fn() }))
vi.mock('@/lib/post-draft', () => ({ ensurePostDraftFinalized: vi.fn() }))
vi.mock('@/lib/season-week', () => ({ resolveEffectiveRedraftWeek: vi.fn() }))
vi.mock('@/lib/league/permissions', () => ({ requireCommissionerRole: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.resolveForUser = vi.fn().mockResolvedValue({ hasAccess: false })
  }),
}))
vi.mock('@/lib/league/league-settings-draft-sync', () => ({ syncDraftSessionFromLeagueSettings: vi.fn() }))
vi.mock('@/lib/live-draft-engine/RosterFitValidation', () => ({ validateDraftRoundsFitRoster: vi.fn() }))
vi.mock('@/lib/league/commissioner-settings-derived-sync', () => ({ syncCommissionerDerivedLeagueState: vi.fn() }))
vi.mock('@/server/services/commissionerService', () => ({ assertSettingsEditAllowed: vi.fn() }))
vi.mock('@/server/services/auditService', () => ({ logAction: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordProductEvent: vi.fn() }))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: vi.fn() }))
vi.mock('@/lib/league/structuralSettingsLock', () => ({ structuralPatchRefusal: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/waiver-wire/settings-service', () => ({ upsertLeagueWaiverSettings: vi.fn() }))
vi.mock('@/lib/waiver-wire/waiver-state-service', () => ({ refreshLeagueWaiverNextRunAt: vi.fn() }))

import {
  MAX_PLAYOFF_START_WEEK,
  MAX_REGULAR_SEASON_WEEKS,
  SOCCER_MAX_REGULAR_SEASON_WEEKS,
  cappedSeasonWeeks,
  maxPlayoffStartWeekFor,
  maxRegularSeasonWeeksForSport,
  regularSeasonCapApplies,
  settingsMergeCapRefusal,
} from '@/lib/redraft/regularSeasonCap'
import { createCanonicalLeagueInTransaction } from '@/lib/league-creation/canonical/createCanonicalLeagueInTransaction'
import { runPresetEngine } from '@/lib/league-creation/preset-engine/runPresetEngine'
import { executeLeagueSettingsPatch } from '@/lib/league/execute-league-settings-patch'
import { resolveCreatedSeasonWeeks } from '@/lib/redraft/createdSeasonLength'
import { tryGetSportConfig } from '@/lib/sportConfig'
import { REDRAFT_SPORT_CONFIGS } from '@/lib/redraft/sportConfig'
import { DAILY_SPORT_SEASON_SHAPE, regularSeasonWeeksFor } from '@/lib/sportConfig/dailySportSeasonShape'
import { lastWeekOfPlayoffRound, readChampionshipLength } from '@/lib/playoff-runtime/playoffRoundWeeks'
import { playoffBracketWeeks, playoffRoundsForTeams } from '@/lib/playoff-runtime/playoffFit'
import { PUT as schedulePut } from '@/app/api/commissioner/leagues/[leagueId]/schedule/route'
import { POST as redraftSeasonPost } from '@/app/api/redraft/season/route'

type Obj = Record<string, any>

describe('every sport\'s real calendar fits the cap, and NFL is unchanged', () => {
  it('the daily-sport seasons: NBA 22, MLB 23, NHL 24 regular weeks', () => {
    expect(regularSeasonWeeksFor('NBA')).toBe(22)
    expect(regularSeasonWeeksFor('MLB')).toBe(23)
    expect(regularSeasonWeeksFor('NHL')).toBe(MAX_REGULAR_SEASON_WEEKS)
    for (const sport of ['NBA', 'MLB', 'NHL'] as const) {
      expect(regularSeasonWeeksFor(sport)).toBeLessThanOrEqual(MAX_REGULAR_SEASON_WEEKS)
      // Every week of the sport's calendar is still played: regular season + bracket = the season.
      expect(cappedSeasonWeeks(DAILY_SPORT_SEASON_SHAPE[sport].totalWeeks, DAILY_SPORT_SEASON_SHAPE[sport].playoffWeeks))
        .toBe(DAILY_SPORT_SEASON_SHAPE[sport].totalWeeks)
    }
  })

  it('NFL keeps its defaults: 14 regular weeks, playoffs from 15, a 17-week season', () => {
    expect(REDRAFT_SPORT_CONFIGS.nfl.regularSeasonWeeks).toBe(14)
    expect(REDRAFT_SPORT_CONFIGS.nfl.defaultPlayoffStartWeek).toBe(15)
    expect(tryGetSportConfig('NFL')!.defaultSeasonWeeks).toBe(17)
    expect(tryGetSportConfig('NFL')!.defaultPlayoffStartWeek).toBe(15)
  })

  it('every capped sport\'s default playoff start is at most week 25', () => {
    for (const sport of ['NFL', 'NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB']) {
      expect(tryGetSportConfig(sport)!.defaultPlayoffStartWeek).toBeLessThanOrEqual(MAX_PLAYOFF_START_WEEK)
    }
  })

  it('applies to redraft and keeper (null reads as redraft), soccer included; not dynasty', () => {
    expect(regularSeasonCapApplies({ leagueType: 'redraft', sport: 'NHL' })).toBe(true)
    expect(regularSeasonCapApplies({ leagueType: 'keeper', sport: 'mlb' })).toBe(true)
    expect(regularSeasonCapApplies({ leagueType: null, sport: 'NBA' })).toBe(true)
    expect(regularSeasonCapApplies({ leagueType: 'dynasty', sport: 'NHL' })).toBe(false)
    expect(regularSeasonCapApplies({ leagueType: 'redraft', sport: 'SOCCER' })).toBe(true)
    expect(regularSeasonCapApplies({ leagueType: 'dynasty', sport: 'SOCCER' })).toBe(false)
  })
})

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

const PRESET: Record<string, string> = { NFL: 'fb_half_ppr', NBA: 'nba_points', NHL: 'nhl_points', MLB: 'mlb_points' }

describe.each(['redraft', 'keeper'])('%s creation: never more than 24 regular weeks, and the season ends with the final', (concept) => {
  it.each(['NFL', 'NBA', 'NHL', 'MLB'])('%s, every league size 2–20', async (sport) => {
    const sportWeeks = tryGetSportConfig(sport)!.defaultSeasonWeeks
    for (let teamCount = 2; teamCount <= 20; teamCount++) {
      const tx = buildTx()
      const body = { concept, sport, teamCount, draftType: 'snake', scoringPreset: PRESET[sport], leagueName: 'Cap', language: 'en', tradeReviewMode: 'commissioner' } as any
      await createCanonicalLeagueInTransaction(tx as any, 'u1', body, runPresetEngine({ ...body, commissionerId: 'u1' }))
      const data = tx.league.create.mock.calls[0][0].data as Obj
      const start = data.playoffStartWeek as number
      expect(start - 1, `${sport} ${teamCount} teams`).toBeLessThanOrEqual(MAX_REGULAR_SEASON_WEEKS)
      const createdWeeks = resolveCreatedSeasonWeeks({ ...data, dynastyConfig: null }, sportWeeks)
      const rounds = playoffRoundsForTeams(data.playoffTeams)
      const final = lastWeekOfPlayoffRound({
        playoffStartWeek: start, roundNumber: rounds, weeksPerRound: data.playoffWeeksPerRound,
        finalRoundNumber: rounds, championshipLength: readChampionshipLength(data.settings),
      })
      // The final is the season's last week — the sport's, or the league's own when the cap shortens it.
      expect(final, `${sport} ${teamCount} teams`).toBe(createdWeeks)
      expect(createdWeeks).toBeLessThanOrEqual(sportWeeks)
      // Only a bracket whose fitted start passes week 25 shortens the season: NHL under six teams, and
      // MLB's two-team final (two weeks, fitted to start in week 26).
      if (sport === 'NFL' || sport === 'NBA' || (sport === 'MLB' && data.playoffTeams > 2) || (sport === 'NHL' && data.playoffTeams >= 6)) {
        expect(createdWeeks).toBe(sportWeeks)
      }
    }
  })

  it('NHL under six playoff teams: the 4-team bracket starts in week 25 (not 26) and the season is 27 weeks', async () => {
    const tx = buildTx()
    const body = { concept, sport: 'NHL', teamCount: 8, draftType: 'snake', scoringPreset: 'nhl_points', leagueName: 'Cap', language: 'en', tradeReviewMode: 'commissioner' } as any
    await createCanonicalLeagueInTransaction(tx as any, 'u1', body, runPresetEngine({ ...body, commissionerId: 'u1' }))
    const data = tx.league.create.mock.calls[0][0].data as Obj
    expect(data.playoffTeams).toBe(4)
    expect(data.playoffStartWeek).toBe(25)
    expect(data.settings.playoff_structure.playoff_start_week).toBe(25)
    expect(data.settings.playoffSettings.regularSeasonEndWeek).toBe(24)
    expect(data.settings.playoffSettings.championshipWeek).toBe(27)
    expect(resolveCreatedSeasonWeeks({ ...data, dynastyConfig: null }, 28)).toBe(27)
  })
})

describe('the season builder\'s length: capped only for redraft and keeper', () => {
  const nhl4 = { settings: { playoff_structure: { championship_length: 2 } }, dynastyConfig: null, playoffTeams: 4, playoffWeeksPerRound: 1, sport: 'NHL' }
  it('redraft/keeper NHL 4-team: 24 + 3 = 27; 6-team: 28', () => {
    expect(resolveCreatedSeasonWeeks({ ...nhl4, leagueType: 'redraft' }, 28)).toBe(27)
    expect(resolveCreatedSeasonWeeks({ ...nhl4, leagueType: 'keeper', playoffTeams: 6 }, 28)).toBe(28)
    expect(playoffBracketWeeks({ teams: 4, championshipLength: 2 })).toBe(3)
  })
  it('dynasty, roto, and a caller that does not say the league type keep the sport\'s season', () => {
    expect(resolveCreatedSeasonWeeks({ ...nhl4, leagueType: 'dynasty' }, 28)).toBe(28)
    expect(resolveCreatedSeasonWeeks({ ...nhl4, leagueType: 'redraft', settings: { scoring_mode: 'roto' } }, 28)).toBe(28)
    expect(resolveCreatedSeasonWeeks(nhl4, 28)).toBe(28)
  })
})

describe('settingsMerge copies: refused only when they change past the cap', () => {
  it('start-week copies past 25 and length copies past 24 are refused', () => {
    expect(settingsMergeCapRefusal({ playoff_structure: { playoff_start_week: 26 } }, {})).toMatch(/no later than week 25/)
    expect(settingsMergeCapRefusal({ playoffSettings: { playoffStartWeek: 27 } }, {})).toMatch(/no later than week 25/)
    expect(settingsMergeCapRefusal({ regular_season_length: 25 }, {})).toMatch(/at most 24 weeks/)
    expect(settingsMergeCapRefusal({ scheduleSettings: { regularSeasonWeeks: 30 } }, {})).toMatch(/at most 24 weeks/)
  })
  it('at the cap, unrelated keys, and an unchanged stored value pass', () => {
    expect(settingsMergeCapRefusal({ playoff_structure: { playoff_start_week: 25 }, regular_season_weeks: 24 }, {})).toBeNull()
    expect(settingsMergeCapRefusal({ league_log_visibility: 'all' }, {})).toBeNull()
    // Native NHL leagues store the whole 28-week season in regular_season_length; re-saving it is fine.
    expect(settingsMergeCapRefusal({ regular_season_length: 28 }, { regular_season_length: 28 })).toBeNull()
  })
})

describe('the settings PATCH', () => {
  const league = (over: Obj = {}) => ({
    id: 'L', platform: 'manual', sport: 'NHL', leagueType: 'redraft', leagueSize: 12, timezone: 'UTC', teams: [], leagueSettings: null,
    waiverSchedule: null, waiverProcessTime: '02:00', playoffTeams: 4, playoffStartWeek: 22, playoffWeeksPerRound: 1,
    settings: { playoff_structure: { championship_length: 2 } }, ...over,
  })
  beforeEach(() => {
    vi.clearAllMocks()
    m.prisma.league.findFirst.mockImplementation(async () => league())
    m.prisma.league.findUnique.mockResolvedValue({ settings: {}, dynastyConfig: null })
    m.prisma.league.update.mockResolvedValue({})
    m.prisma.redraftSeason.findFirst.mockResolvedValue(null)
    m.prisma.redraftPlayoffRound.findFirst.mockResolvedValue(null)
  })
  const wroteStart = () => m.prisma.league.update.mock.calls.some(([a]: [Obj]) => 'playoffStartWeek' in a.data)

  it('NHL redraft, playoffs from week 26 (a 25-week regular season): 400, nothing written', async () => {
    const res = await executeLeagueSettingsPatch('u', { leagueId: 'L', playoffStartWeek: 26 })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Playoffs can start no later than week 25 — the regular season can be at most 24 weeks.')
    expect(wroteStart()).toBe(false)
  })

  it('week 25 is allowed', async () => {
    const res = await executeLeagueSettingsPatch('u', { leagueId: 'L', playoffStartWeek: 25 })
    expect(res.status).toBe(200)
    expect(wroteStart()).toBe(true)
  })

  it('keeper is capped too', async () => {
    m.prisma.league.findFirst.mockImplementation(async () => league({ leagueType: 'keeper', sport: 'MLB' }))
    expect((await executeLeagueSettingsPatch('u', { leagueId: 'L', playoffStartWeek: 26 })).status).toBe(400)
  })

  it('a settingsMerge that moves a JSON copy past the cap: 400', async () => {
    const res = await executeLeagueSettingsPatch('u', { leagueId: 'L', settingsMerge: { playoff_structure: { playoff_start_week: 27 } } })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/no later than week 25/)
  })

  it('a legacy league already past the cap can re-save its week unchanged', async () => {
    m.prisma.league.findFirst.mockImplementation(async () => league({ playoffStartWeek: 26 }))
    const res = await executeLeagueSettingsPatch('u', { leagueId: 'L', playoffStartWeek: 26 })
    expect(res.status).toBe(200)
  })

  it('dynasty is not capped by this rule', async () => {
    m.prisma.league.findFirst.mockImplementation(async () => league({ leagueType: 'dynasty', isDynasty: true }))
    const res = await executeLeagueSettingsPatch('u', { leagueId: 'L', playoffStartWeek: 26 })
    expect(res.status).not.toBe(400)
  })
})

const jsonReq = (body: unknown) => ({ json: async () => body, nextUrl: { searchParams: new URLSearchParams() } }) as any
const params = { params: Promise.resolve({ leagueId: 'L' }) }

describe('the commissioner schedule route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.prisma.league.findUnique.mockResolvedValue({ settings: {}, leagueType: 'redraft', sport: 'NHL' })
    m.prisma.league.update.mockResolvedValue({})
    // What GET shows a native NHL league that never stored a length: the sport's 28-week season.
    m.scheduleConfig.mockResolvedValue({ regular_season_length: 28, playoff_transition_point: 25 })
  })

  it('a regular-season length of 25: 400, nothing written', async () => {
    const res = await schedulePut(jsonReq({ regularSeasonLength: 25 }), params)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('The regular season can be at most 24 weeks.')
    expect(m.prisma.league.update).not.toHaveBeenCalled()
  })

  it('a playoff transition point of 26: 400', async () => {
    expect((await schedulePut(jsonReq({ playoffTransitionPoint: 26 }), params)).status).toBe(400)
  })

  it('the panel re-sending what GET showed (28, 25) is saved', async () => {
    const res = await schedulePut(jsonReq({ regularSeasonLength: 28, playoffTransitionPoint: 25, matchupFrequency: 'weekly' }), params)
    expect(res.status).toBe(200)
    expect(m.prisma.league.update).toHaveBeenCalled()
  })

  it('24 weeks is saved; a dynasty league is not capped', async () => {
    expect((await schedulePut(jsonReq({ regularSeasonLength: 24 }), params)).status).toBe(200)
    m.prisma.league.findUnique.mockResolvedValue({ settings: {}, leagueType: 'dynasty', sport: 'NHL' })
    expect((await schedulePut(jsonReq({ regularSeasonLength: 26 }), params)).status).toBe(200)
  })
})

describe('the redraft season POST', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.prisma.league.findFirst.mockResolvedValue({ id: 'L', sport: 'NHL', leagueType: 'redraft', season: 2026, teams: [], medianGame: false })
  })

  it('a 28-week NHL season with playoffs from week 27: 400', async () => {
    const res = await redraftSeasonPost(jsonReq({ leagueId: 'L', totalWeeks: 28, playoffStartWeek: 27 }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('The regular season can be at most 24 weeks.')
  })

  it('a 26-week season without a playoff start uses the sport default (25): allowed past the check', async () => {
    ;(m.prisma as Obj).$transaction = vi.fn().mockRejectedValue(new Error('reached the write'))
    await expect(redraftSeasonPost(jsonReq({ leagueId: 'L', totalWeeks: 26 }))).rejects.toThrow('reached the write')
  })
})

describe('soccer: the same cap at 34 regular weeks (playoffs from week 35 at the latest)', () => {
  it('the limits: 34 / 35 for soccer, 24 / 25 for everyone else; dynasty soccer uncapped', () => {
    expect(SOCCER_MAX_REGULAR_SEASON_WEEKS).toBe(34)
    expect(maxRegularSeasonWeeksForSport('SOCCER')).toBe(34)
    expect(maxRegularSeasonWeeksForSport('soccer')).toBe(34)
    expect(maxRegularSeasonWeeksForSport('NHL')).toBe(MAX_REGULAR_SEASON_WEEKS)
    expect(maxPlayoffStartWeekFor({ leagueType: 'redraft', sport: 'SOCCER' })).toBe(35)
    expect(maxPlayoffStartWeekFor({ leagueType: 'keeper', sport: 'SOCCER' })).toBe(35)
    expect(maxPlayoffStartWeekFor({ leagueType: 'redraft', sport: 'NBA' })).toBe(MAX_PLAYOFF_START_WEEK)
    expect(maxPlayoffStartWeekFor({ leagueType: 'dynasty', sport: 'SOCCER' })).toBeNull()
  })

  it('soccer\'s own default fits exactly: a 38-week season with playoffs from week 35', () => {
    expect(tryGetSportConfig('SOCCER')!.defaultSeasonWeeks).toBe(38)
    expect(tryGetSportConfig('SOCCER')!.defaultPlayoffStartWeek).toBe(35)
    expect(cappedSeasonWeeks(38, 3, maxRegularSeasonWeeksForSport('SOCCER'))).toBe(37)
    expect(cappedSeasonWeeks(38, 4, maxRegularSeasonWeeksForSport('SOCCER'))).toBe(38)
  })

  it('settingsMerge copies: 35 / 34 pass for soccer, 36 / 35 are refused with the soccer numbers', () => {
    expect(settingsMergeCapRefusal({ playoff_structure: { playoff_start_week: 35 }, regular_season_length: 34 }, {}, 'SOCCER')).toBeNull()
    expect(settingsMergeCapRefusal({ playoff_structure: { playoff_start_week: 36 } }, {}, 'SOCCER')).toBe(
      'Playoffs can start no later than week 35 — the regular season can be at most 34 weeks.',
    )
    expect(settingsMergeCapRefusal({ regular_season_length: 35 }, {}, 'SOCCER')).toBe('The regular season can be at most 34 weeks.')
    // A soccer league stores its whole 38-week season in regular_season_length; re-saving it is fine.
    expect(settingsMergeCapRefusal({ regular_season_length: 38 }, { regular_season_length: 38 }, 'SOCCER')).toBeNull()
    // The same week 30 that is fine for soccer is past the cap for NHL.
    expect(settingsMergeCapRefusal({ playoff_structure: { playoff_start_week: 30 } }, {}, 'SOCCER')).toBeNull()
    expect(settingsMergeCapRefusal({ playoff_structure: { playoff_start_week: 30 } }, {}, 'NHL')).toMatch(/no later than week 25/)
  })

  it('the season builder\'s length: a capped soccer bracket that would leave weeks unplayed ends with its final', () => {
    const soccer = { settings: {}, dynastyConfig: null, playoffWeeksPerRound: 1, sport: 'SOCCER', leagueType: 'redraft' }
    // 4 teams: two bracket weeks after a 34-week regular season — the season is 36 weeks, not 38.
    expect(resolveCreatedSeasonWeeks({ ...soccer, playoffTeams: 4 }, 38)).toBe(36)
    // 16 teams: four bracket weeks, the full 38.
    expect(resolveCreatedSeasonWeeks({ ...soccer, playoffTeams: 16 }, 38)).toBe(38)
    expect(resolveCreatedSeasonWeeks({ ...soccer, playoffTeams: 4, leagueType: 'dynasty' }, 38)).toBe(38)
  })

  describe('the settings PATCH', () => {
    const league = (over: Obj = {}) => ({
      id: 'L', platform: 'manual', sport: 'SOCCER', leagueType: 'redraft', leagueSize: 12, timezone: 'UTC', teams: [], leagueSettings: null,
      waiverSchedule: null, waiverProcessTime: '02:00', playoffTeams: 4, playoffStartWeek: 30, playoffWeeksPerRound: 1,
      settings: {}, ...over,
    })
    beforeEach(() => {
      vi.clearAllMocks()
      m.prisma.league.findFirst.mockImplementation(async () => league())
      m.prisma.league.findUnique.mockResolvedValue({ settings: {}, dynastyConfig: null })
      m.prisma.league.update.mockResolvedValue({})
      m.prisma.redraftSeason.findFirst.mockResolvedValue(null)
      m.prisma.redraftPlayoffRound.findFirst.mockResolvedValue(null)
    })

    it('playoffs from week 36 (a 35-week regular season): 400 with the soccer numbers', async () => {
      const res = await executeLeagueSettingsPatch('u', { leagueId: 'L', playoffStartWeek: 36 })
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('Playoffs can start no later than week 35 — the regular season can be at most 34 weeks.')
    })

    it('week 35 is allowed, and so is week 26 (past the 24-week cap of the other sports)', async () => {
      expect((await executeLeagueSettingsPatch('u', { leagueId: 'L', playoffStartWeek: 35 })).status).toBe(200)
      expect((await executeLeagueSettingsPatch('u', { leagueId: 'L', playoffStartWeek: 26 })).status).toBe(200)
    })

    it('keeper soccer is capped; dynasty soccer is not', async () => {
      m.prisma.league.findFirst.mockImplementation(async () => league({ leagueType: 'keeper' }))
      expect((await executeLeagueSettingsPatch('u', { leagueId: 'L', playoffStartWeek: 36 })).status).toBe(400)
      m.prisma.league.findFirst.mockImplementation(async () => league({ leagueType: 'dynasty', isDynasty: true }))
      expect((await executeLeagueSettingsPatch('u', { leagueId: 'L', playoffStartWeek: 36 })).status).not.toBe(400)
    })
  })

  describe('the commissioner schedule route', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      m.prisma.league.findUnique.mockResolvedValue({ settings: {}, leagueType: 'redraft', sport: 'SOCCER' })
      m.prisma.league.update.mockResolvedValue({})
      m.scheduleConfig.mockResolvedValue({ regular_season_length: 38, playoff_transition_point: 35 })
    })

    it('35 regular weeks: 400; 34 is saved; the panel re-sending GET (38, 35) is saved', async () => {
      const res = await schedulePut(jsonReq({ regularSeasonLength: 35 }), params)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('The regular season can be at most 34 weeks.')
      expect((await schedulePut(jsonReq({ playoffTransitionPoint: 36 }), params)).status).toBe(400)
      expect((await schedulePut(jsonReq({ regularSeasonLength: 34 }), params)).status).toBe(200)
      expect((await schedulePut(jsonReq({ regularSeasonLength: 38, playoffTransitionPoint: 35 }), params)).status).toBe(200)
    })
  })

  describe('the redraft season POST', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      m.prisma.league.findFirst.mockResolvedValue({ id: 'L', sport: 'SOCCER', leagueType: 'redraft', season: 2026, teams: [], medianGame: false })
    })

    it('a 38-week soccer season with playoffs from week 36: 400; from week 35: past the check', async () => {
      const res = await redraftSeasonPost(jsonReq({ leagueId: 'L', totalWeeks: 38, playoffStartWeek: 36 }))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('The regular season can be at most 34 weeks.')
      ;(m.prisma as Obj).$transaction = vi.fn().mockRejectedValue(new Error('reached the write'))
      await expect(redraftSeasonPost(jsonReq({ leagueId: 'L', totalWeeks: 38, playoffStartWeek: 35 }))).rejects.toThrow('reached the write')
    })
  })

  it.each(['redraft', 'keeper'])('%s soccer creation: the playoffs start no later than week 35', async (concept) => {
    for (const teamCount of [4, 8, 10, 12, 16, 20]) {
      const tx = buildTx()
      const body = { concept, sport: 'SOCCER', teamCount, draftType: 'snake', leagueName: 'Cap', language: 'en', tradeReviewMode: 'commissioner' } as any
      await createCanonicalLeagueInTransaction(tx as any, 'u1', body, runPresetEngine({ ...body, commissionerId: 'u1' }))
      const data = tx.league.create.mock.calls[0][0].data as Obj
      expect(data.playoffStartWeek, `${concept} ${teamCount} teams`).toBeLessThanOrEqual(35)
      expect(data.settings.playoff_structure?.playoff_start_week ?? data.playoffStartWeek).toBe(data.playoffStartWeek)
    }
  })
})
