/**
 * Redraft leagues run a complete, correctly sized season at every even team count from 4 to 20, in
 * NFL, NBA, NHL and MLB (lib/league-defaults/redraftPlayoffFit.ts, lib/playoff-runtime/playoffFit.ts).
 *
 * For each sport and league size, creation must store a field no larger than the league or 16, byes
 * that match the field, a start week that puts the final in the season's LAST week (not one early, not
 * past the end), and the same shape in the `League` columns and every JSON copy. A settings change that
 * would push the final past the season is refused with the largest field that fits.
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
}))

vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
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

import { createCanonicalLeagueInTransaction } from '@/lib/league-creation/canonical/createCanonicalLeagueInTransaction'
import { runPresetEngine } from '@/lib/league-creation/preset-engine/runPresetEngine'
import { executeLeagueSettingsPatch } from '@/lib/league/execute-league-settings-patch'
import { tryGetSportConfig } from '@/lib/sportConfig'
import { resolveCreatedSeasonWeeks } from '@/lib/redraft/createdSeasonLength'
import { lastWeekOfPlayoffRound, readChampionshipLength } from '@/lib/playoff-runtime/playoffRoundWeeks'
import { playoffFitOverflow, playoffFitOverflowMessage } from '@/lib/playoff-runtime/championshipLengthFit'
import { fittedPlayoffStartWeek, maxPlayoffTeamsThatFit } from '@/lib/playoff-runtime/playoffFit'
import { resizedPlayoffColumns } from '@/lib/league-defaults/redraftPlayoffFit'
import { readPlayoffFormat } from '@/lib/core-app/outlookFormat'
import { readStandingsRules } from '@/lib/core-app/standingsModel'
import { getBracketConfigForLeague } from '@/lib/playoff-defaults/PlayoffBracketConfigResolver'
import { bootstrapLeaguePlayoffConfig } from '@/lib/playoff-defaults/LeaguePlayoffBootstrapService'

type Obj = Record<string, any>

const SPORTS = ['NFL', 'NBA', 'NHL', 'MLB'] as const
const TEAM_COUNTS = [4, 6, 8, 10, 12, 14, 16, 18, 20] as const
const PRESET: Record<(typeof SPORTS)[number], string> = {
  NFL: 'fb_half_ppr',
  NBA: 'nba_points',
  NHL: 'nhl_points',
  MLB: 'mlb_points',
}

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

async function createRedraft(sport: (typeof SPORTS)[number], teamCount: number, concept = 'redraft') {
  const tx = buildTx()
  const body = {
    concept, sport, teamCount, draftType: 'snake', scoringPreset: PRESET[sport],
    leagueName: 'Fit League', language: 'en', tradeReviewMode: 'commissioner',
  } as any
  const engine = runPresetEngine({ ...body, commissionerId: 'u1' })
  await createCanonicalLeagueInTransaction(tx as any, 'u1', body, engine)
  return tx.league.create.mock.calls[0][0].data as Obj
}

const rounds = (teams: number) => Math.ceil(Math.log2(teams))
const gap = (teams: number) => 2 ** rounds(teams) - teams

describe.each(SPORTS)('%s redraft creation — the bracket fits the season at every team count', (sport) => {
  const seasonWeeks = tryGetSportConfig(sport)!.defaultSeasonWeeks

  it.each(TEAM_COUNTS)('%i teams', async (teamCount) => {
    const data = await createRedraft(sport, teamCount)
    const s = data.settings as Obj
    const teams = data.playoffTeams as number
    const start = data.playoffStartWeek as number

    // The field: at least a final, never more than the league or the engine's 16.
    expect(teams).toBeGreaterThanOrEqual(2)
    expect(teams).toBeLessThanOrEqual(Math.min(teamCount, 16))
    // Not everyone makes it from six teams up (a 6-team daily league used to send all six).
    if (teamCount >= 6) expect(teams).toBeLessThan(teamCount)
    // The size-aware rule, unchanged from ten teams up.
    expect(teams).toBe(teamCount >= 10 ? 6 : 4)

    // Byes and rounds agree with the field in every copy that states them.
    for (const block of [s.playoff_structure, s.playoffSettings]) {
      expect(block.first_round_byes).toBe(gap(teams))
      expect(block.total_rounds).toBe(rounds(teams))
    }
    expect(s.playoffSettings.firstRoundByes).toBe(gap(teams))

    // The final lands in exactly the season's last week — and the season creation sizes is that one.
    const createdWeeks = resolveCreatedSeasonWeeks(
      { settings: s, dynastyConfig: null, playoffTeams: teams, playoffWeeksPerRound: data.playoffWeeksPerRound },
      seasonWeeks,
    )
    expect(createdWeeks).toBe(seasonWeeks)
    expect(start).toBeGreaterThanOrEqual(2)
    expect(start).toBeLessThanOrEqual(createdWeeks) // so ensureRedraftSeason keeps it
    const finalWeek = lastWeekOfPlayoffRound({
      playoffStartWeek: start,
      roundNumber: rounds(teams),
      weeksPerRound: data.playoffWeeksPerRound,
      finalRoundNumber: rounds(teams),
      championshipLength: readChampionshipLength(s),
    })
    expect(finalWeek).toBe(seasonWeeks)

    // Every JSON copy says what the columns say.
    expect(s.playoff_team_count).toBe(teams)
    expect(s.playoff_structure.playoff_team_count).toBe(teams)
    expect(s.playoff_structure.playoff_start_week).toBe(start)
    expect(s.playoffSettings.playoffTeams).toBe(teams)
    expect(s.playoffSettings.playoff_team_count).toBe(teams)
    expect(s.playoffSettings.playoffStartWeek).toBe(start)
    expect(s.playoffSettings.playoff_start_week).toBe(start)
    expect(s.foundation_defaults.playoff.playoffTeams).toBe(teams)
    expect(s.foundation_defaults.playoff.playoffStartWeek).toBe(start)
    expect(s.foundation_defaults.playoff.championshipWeek).toBe(seasonWeeks)
    expect(s.foundation_defaults.schedule.playoff_transition_point).toBe(start)

    // …so the standings / Season Outlook reader shows the bracket the runtime plays.
    const format = readPlayoffFormat(s, teamCount)
    expect(format).toMatchObject({ playoffTeams: teams, playoffTeamsSource: 'league', byeTeams: gap(teams) })
  })
})

describe('readers prefer the native column over stale JSON (existing leagues are not rewritten)', () => {
  // What creation stored before: the column clamped to 4, the registry's 6 / 2 byes / 3 rounds beside it.
  const stale = {
    playoff_team_count: 6,
    playoffSettings: { playoff_team_count: 6, first_round_byes: 2, total_rounds: 3, playoff_start_week: 15 },
    playoff_structure: { playoff_team_count: 6, first_round_byes: 2, total_rounds: 3, playoff_start_week: 15 },
  }

  it('Season Outlook / standings: a native column wins; an import keeps reading its JSON', () => {
    expect(readPlayoffFormat(stale, 6, 4)).toMatchObject({ playoffTeams: 4, playoffTeamsSource: 'league', byeTeams: 0 })
    expect(readPlayoffFormat(stale, 6)).toMatchObject({ playoffTeams: 6, byeTeams: 2 })
    expect(readStandingsRules(stale, 6, 'manual', '', 4)).toMatchObject({ playoffTeams: 4, playoffTeamsSource: 'league', byes: 0 })
    expect(readStandingsRules(stale, 6, 'sleeper', '', 4)).toMatchObject({ playoffTeams: 6, byes: 2 })
    // A 4-team league whose stale JSON says 6 now reads as the league's own (Chimmy's trade outlook needs that).
    expect(readPlayoffFormat(stale, 4, 4)).toMatchObject({ playoffTeams: 4, playoffTeamsSource: 'league' })
  })

  it('the bracket config derives byes and rounds from the field', async () => {
    m.prisma.league.findUnique.mockResolvedValueOnce({
      sport: 'NFL', leagueVariant: null, settings: stale, playoffStartWeek: 15, playoffTeams: 4,
      playoffWeeksPerRound: 1, playoffSeedingRule: null, playoffLowerBracket: null,
    })
    expect(await getBracketConfigForLeague('L')).toMatchObject({ playoff_team_count: 4, first_round_byes: 0, total_rounds: 2 })
  })

  it('the playoff bootstrap backfills a native league from its column, an import from the registry', async () => {
    const run = async (platform: string) => {
      m.prisma.league.findUnique.mockResolvedValueOnce({
        id: 'L', sport: 'NBA', leagueVariant: null, settings: { inviteCode: 'x' }, playoffSeedingRule: null,
        playoffTeams: 4, playoffStartWeek: 24, platform,
      })
      m.prisma.league.update.mockClear()
      await bootstrapLeaguePlayoffConfig('L')
      return m.prisma.league.update.mock.calls[0][0].data.settings as Obj
    }
    const native = await run('manual')
    expect(native.playoff_team_count).toBe(4)
    expect(native.playoff_structure).toMatchObject({ playoff_team_count: 4, first_round_byes: 0, total_rounds: 2, playoff_start_week: 24 })
    const imported = await run('sleeper')
    expect(imported.playoff_team_count).toBe(6)
  })
})

describe('playoffFit — the largest field that fits, and the start week that fills the season', () => {
  it('NFL 17 weeks', () => {
    expect(fittedPlayoffStartWeek({ teams: 4, seasonWeeks: 17 })).toBe(16)
    expect(fittedPlayoffStartWeek({ teams: 6, seasonWeeks: 17 })).toBe(15)
    expect(fittedPlayoffStartWeek({ teams: 12, seasonWeeks: 17 })).toBe(14)
    expect(maxPlayoffTeamsThatFit({ seasonWeeks: 17, playoffStartWeek: 15, leagueSize: 20 })).toBe(8)
    expect(maxPlayoffTeamsThatFit({ seasonWeeks: 17, playoffStartWeek: 14, leagueSize: 20 })).toBe(16)
    expect(maxPlayoffTeamsThatFit({ seasonWeeks: 17, playoffStartWeek: 14, leagueSize: 12 })).toBe(12)
    expect(maxPlayoffTeamsThatFit({ seasonWeeks: 17, playoffStartWeek: 17, leagueSize: 12 })).toBe(2)
  })

  it('NHL 28 weeks with a two-week final', () => {
    expect(fittedPlayoffStartWeek({ teams: 4, seasonWeeks: 28, championshipLength: 2 })).toBe(26)
    expect(fittedPlayoffStartWeek({ teams: 6, seasonWeeks: 28, championshipLength: 2 })).toBe(25)
    expect(maxPlayoffTeamsThatFit({ seasonWeeks: 28, playoffStartWeek: 25, championshipLength: 2, leagueSize: 20 })).toBe(8)
  })
})

describe('playoffFitOverflow — every setting that moves the final', () => {
  function db(season: { totalWeeks: number; playoffStartWeek: number } | null, finalRound?: number) {
    return {
      redraftSeason: { findFirst: vi.fn().mockResolvedValue(season ? { id: 's', ...season } : null) },
      redraftPlayoffRound: { findFirst: vi.fn().mockResolvedValue(finalRound ? { roundNumber: finalRound } : null) },
      league: { findUnique: vi.fn().mockResolvedValue({ dynastyConfig: null }) },
    } as any
  }
  const nfl = { id: 'L', sport: 'NFL', settings: {}, leagueSize: 12, playoffTeams: 6, playoffStartWeek: 15, playoffWeeksPerRound: 1, dynastyConfig: null }

  it('a 12-team NFL field from week 15 needs a week 18: refused, naming the 8 that fit', async () => {
    const o = await playoffFitOverflow({ league: nfl, change: { playoffTeams: 12 } }, { prisma: db(null) })
    expect(o).toMatchObject({ lastPlayoffWeek: 18, seasonWeeks: 17, maxPlayoffTeams: 8 })
    expect(playoffFitOverflowMessage(o!)).toMatch(/week 18, past the season's last week \(17\).*at most 8 playoff teams fit/)
    expect(await playoffFitOverflow({ league: nfl, change: { playoffTeams: 8 } }, { prisma: db(null) })).toBeNull()
  })

  it('the start week and weeks per round move the final too — against the season once it exists', async () => {
    const season = { totalWeeks: 17, playoffStartWeek: 15 }
    expect(await playoffFitOverflow({ league: nfl, change: { playoffStartWeek: 16 } }, { prisma: db(season) })).toMatchObject({ lastPlayoffWeek: 18 })
    expect(await playoffFitOverflow({ league: nfl, change: { playoffWeeksPerRound: 2 } }, { prisma: db(season) })).toMatchObject({ lastPlayoffWeek: 20 })
    expect(await playoffFitOverflow({ league: nfl, change: { playoffStartWeek: 14 } }, { prisma: db(season) })).toBeNull()
  })

  it('once a bracket is generated the team count no longer moves the final', async () => {
    const season = { totalWeeks: 17, playoffStartWeek: 15 }
    expect(await playoffFitOverflow({ league: nfl, change: { playoffTeams: 12 } }, { prisma: db(season, 3) })).toBeNull()
  })

  it('NHL, playoffs from 25 with a two-week final: 8 fit, 10 do not', async () => {
    const nhl = { ...nfl, sport: 'NHL', playoffStartWeek: 25, settings: { playoff_structure: { championship_length: 2 } } }
    expect(await playoffFitOverflow({ league: nhl, change: { playoffTeams: 8 } }, { prisma: db(null) })).toBeNull()
    expect(await playoffFitOverflow({ league: nhl, change: { playoffTeams: 10 } }, { prisma: db(null) })).toMatchObject({ lastPlayoffWeek: 29, seasonWeeks: 28, maxPlayoffTeams: 8 })
  })
})

describe('the settings PATCH refuses a bracket that outlasts the season', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.prisma.league.findFirst.mockImplementation(async () => ({
      id: 'L', platform: 'manual', sport: 'NFL', leagueSize: 20, timezone: 'UTC', teams: [], leagueSettings: null,
      waiverSchedule: null, waiverProcessTime: '02:00', playoffTeams: 6, playoffStartWeek: 15, playoffWeeksPerRound: 1,
      settings: {},
    }))
    m.prisma.league.findUnique.mockResolvedValue({ settings: {}, dynastyConfig: null })
    m.prisma.league.update.mockResolvedValue({})
    m.prisma.redraftSeason.findFirst.mockResolvedValue(null)
    m.prisma.redraftPlayoffRound.findFirst.mockResolvedValue(null)
  })
  const wrotePlayoffTeams = () => m.prisma.league.update.mock.calls.some(([a]: [Obj]) => 'playoffTeams' in a.data)

  it('12 playoff teams from week 15 on a 17-week NFL season: 400, saying at most 8', async () => {
    const res = await executeLeagueSettingsPatch('u', { leagueId: 'L', playoffTeams: 12 })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/week 18.*at most 8 playoff teams fit/)
    expect(wrotePlayoffTeams()).toBe(false)
  })

  it('the same field saved with an earlier start week fits', async () => {
    const res = await executeLeagueSettingsPatch('u', { leagueId: 'L', playoffTeams: 12, playoffStartWeek: 14 })
    expect(res.status).toBe(200)
    expect(wrotePlayoffTeams()).toBe(true)
  })

  it('more than 16 is refused outright, even where the league is bigger', async () => {
    const res = await executeLeagueSettingsPatch('u', { leagueId: 'L', playoffTeams: 18, playoffStartWeek: 10 })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/at most 16/)
  })
})

describe('a pre-draft resize re-derives untouched playoff defaults and keeps a commissioner\'s', () => {
  const base = { leagueType: 'redraft', settings: {}, weeksPerRound: 1 }

  it('NFL created today at 10 (6 from 15) resized to 8 → 4 from 16', () => {
    expect(resizedPlayoffColumns({ ...base, sport: 'NFL', oldSize: 10, newSize: 8, playoffTeams: 6, playoffStartWeek: 15 }))
      .toEqual({ playoffTeams: 4, playoffStartWeek: 16 })
  })

  it('NFL created before this change at 8 (4 from 15) resized to 12 → 6 from 15', () => {
    expect(resizedPlayoffColumns({ ...base, sport: 'NFL', oldSize: 8, newSize: 12, playoffTeams: 4, playoffStartWeek: 15 }))
      .toEqual({ playoffTeams: 6, playoffStartWeek: 15 })
  })

  it('NBA created before this change at 12 (flat 6 from 23) resized to 6 → 4 from 24', () => {
    expect(resizedPlayoffColumns({ ...base, sport: 'NBA', oldSize: 12, newSize: 6, playoffTeams: 6, playoffStartWeek: 23 }))
      .toEqual({ playoffTeams: 4, playoffStartWeek: 24 })
  })

  it('a commissioner\'s own bracket is kept, and only clamped to the new size', () => {
    expect(resizedPlayoffColumns({ ...base, sport: 'NFL', oldSize: 12, newSize: 10, playoffTeams: 8, playoffStartWeek: 14 })).toBeNull()
    expect(resizedPlayoffColumns({ ...base, sport: 'NFL', oldSize: 12, newSize: 6, playoffTeams: 8, playoffStartWeek: 14 }))
      .toEqual({ playoffTeams: 6 })
  })
})

/*
 * Keeper leagues play the same season (no dynasty config, so the sport's default length) and had the
 * same unplayed last week: a 4-team NFL keeper bracket started in week 15 and finished in 16 of 17,
 * while its JSON said 6 teams / 2 byes beside a column of 4. They now take the same start week and the
 * one shape, but keep the field they were always created with — the registry's 6, clamped to the league.
 */
const ALL_TEAM_COUNTS = Array.from({ length: 17 }, (_, i) => i + 4)

describe.each(SPORTS)('%s keeper creation — the bracket fits the season at every team count', (sport) => {
  const seasonWeeks = tryGetSportConfig(sport)!.defaultSeasonWeeks

  it.each(ALL_TEAM_COUNTS)('%i teams', async (teamCount) => {
    const data = await createRedraft(sport, teamCount, 'keeper')
    expect(data.leagueType).toBe('keeper')
    const s = data.settings as Obj
    const teams = data.playoffTeams as number
    const start = data.playoffStartWeek as number

    // The keeper field is unchanged: the registry's 6, clamped (even) to the league.
    expect(teams).toBe(teamCount >= 6 ? 6 : 4)

    const createdWeeks = resolveCreatedSeasonWeeks(
      { settings: s, dynastyConfig: null, playoffTeams: teams, playoffWeeksPerRound: data.playoffWeeksPerRound },
      seasonWeeks,
    )
    expect(createdWeeks).toBe(seasonWeeks)
    expect(start).toBe(fittedPlayoffStartWeek({ teams, weeksPerRound: data.playoffWeeksPerRound, championshipLength: readChampionshipLength(s) ?? undefined, seasonWeeks }))
    const finalWeek = lastWeekOfPlayoffRound({
      playoffStartWeek: start,
      roundNumber: rounds(teams),
      weeksPerRound: data.playoffWeeksPerRound,
      finalRoundNumber: rounds(teams),
      championshipLength: readChampionshipLength(s),
    })
    expect(finalWeek).toBe(seasonWeeks)

    for (const block of [s.playoff_structure, s.playoffSettings]) {
      expect(block.playoff_team_count).toBe(teams)
      expect(block.first_round_byes).toBe(gap(teams))
      expect(block.total_rounds).toBe(rounds(teams))
      expect(block.playoff_start_week).toBe(start)
    }
    expect(s.playoff_team_count).toBe(teams)
    expect(s.playoffSettings.playoffTeams).toBe(teams)
    expect(s.playoffSettings.playoffStartWeek).toBe(start)
    expect(s.foundation_defaults.playoff.playoffTeams).toBe(teams)
    expect(s.foundation_defaults.playoff.playoffStartWeek).toBe(start)
    expect(s.foundation_defaults.schedule.playoff_transition_point).toBe(start)
    expect(readPlayoffFormat(s, teamCount, teams)).toMatchObject({ playoffTeams: teams, byeTeams: gap(teams) })
  })
})

describe('a keeper settings change is checked against the season too', () => {
  it('a 12-team NFL keeper field from week 15 is refused, naming the 8 that fit', async () => {
    const keeper = { id: 'K', sport: 'NFL', leagueType: 'keeper', settings: {}, leagueSize: 12, playoffTeams: 6, playoffStartWeek: 15, playoffWeeksPerRound: 1, dynastyConfig: null }
    const prisma = {
      redraftSeason: { findFirst: vi.fn().mockResolvedValue(null) },
      redraftPlayoffRound: { findFirst: vi.fn().mockResolvedValue(null) },
      league: { findUnique: vi.fn().mockResolvedValue({ dynastyConfig: null }) },
    } as any
    expect(await playoffFitOverflow({ league: keeper, change: { playoffTeams: 12 } }, { prisma })).toMatchObject({ lastPlayoffWeek: 18, maxPlayoffTeams: 8 })
  })
})

describe('a keeper pre-draft resize re-derives the untouched default start week', () => {
  const base = { leagueType: 'keeper', settings: {}, weeksPerRound: 1 }

  it('NFL keeper created before this change at 8 (6 from 15) cut to 4 → 4 from 16', () => {
    expect(resizedPlayoffColumns({ ...base, sport: 'NFL', oldSize: 8, newSize: 4, playoffTeams: 6, playoffStartWeek: 15 }))
      .toEqual({ playoffTeams: 4, playoffStartWeek: 16 })
  })

  it('NHL keeper created today at 4 (4 from 26) grown to 12 → 6 from 25; the field stays the registry\'s', () => {
    expect(resizedPlayoffColumns({ ...base, sport: 'NHL', oldSize: 4, newSize: 12, playoffTeams: 4, playoffStartWeek: 26, championshipLength: 2 }))
      .toEqual({ playoffTeams: 6, playoffStartWeek: 25 })
  })

  it('a keeper commissioner\'s own bracket is kept', () => {
    expect(resizedPlayoffColumns({ ...base, sport: 'NFL', oldSize: 12, newSize: 10, playoffTeams: 8, playoffStartWeek: 14 })).toBeNull()
  })
})
