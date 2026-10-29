/**
 * League creation writes ONE playoff start week: the `League.playoffStartWeek` column and every
 * settings-JSON copy of it agree, for every league type × sport (lib/playoff-settings/playoffStartWeekCopies.ts).
 *
 * `resolvePlayoffStartWeek` reads the column first and the JSON only when it is null, so a disagreement
 * was silent. Before this: best ball NBA/NHL/MLB wrote the column 21/22/23 beside 23/25/24 in the JSON;
 * survivor wrote NULL beside 26 (playoffSettings) and 22 (playoff_structure), so the resolver read 22
 * inside a season that runs to week 25; guillotine, zombie and roto wrote NULL beside the sport default.
 */
import { describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  prisma: {
    league: { findUnique: vi.fn(), create: vi.fn() },
    survivorExileLeague: { findUnique: vi.fn(), create: vi.fn() },
  },
  survivorConfig: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/survivor/SurvivorLeagueConfig', () => ({ getSurvivorConfig: m.survivorConfig }))
vi.mock('@/lib/survivor/SurvivorAuditLog', () => ({ appendSurvivorAudit: vi.fn() }))

import { createCanonicalLeagueInTransaction } from '@/lib/league-creation/canonical/createCanonicalLeagueInTransaction'
import { runPresetEngine } from '@/lib/league-creation/preset-engine/runPresetEngine'
import { readPlayoffStartWeekCopies } from '@/lib/playoff-settings/playoffStartWeekCopies'
import { resolvePlayoffStartWeek } from '@/lib/playoff-settings/resolvePlayoffStartWeek'
import { getOrCreateExileLeague } from '@/lib/survivor/SurvivorExileEngine'

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

const SPORTS = ['NFL', 'NBA', 'NHL', 'MLB'] as const
const PRESET: Record<string, string> = { NFL: 'fb_half_ppr', NBA: 'nba_points', NHL: 'nhl_points', MLB: 'mlb_points' }
const CONCEPTS = ['redraft', 'keeper', 'dynasty', 'best_ball', 'guillotine', 'survivor', 'zombie', 'big_brother', 'devy', 'c2c'] as const

async function create(concept: string, sport: string, extra: Obj = {}) {
  const tx = buildTx()
  const body = {
    concept, sport, teamCount: 12, draftType: 'snake', scoringPreset: PRESET[sport],
    leagueName: 'Copies', language: 'en', tradeReviewMode: 'commissioner', ...extra,
  } as any
  await createCanonicalLeagueInTransaction(tx as any, 'u1', body, runPresetEngine({ ...body, commissionerId: 'u1' }))
  const data = tx.league.create.mock.calls[0][0].data as Obj
  const update = tx.league.update.mock.calls.find(([a]: [Obj]) => 'playoffStartWeek' in (a.data ?? {}))
  return { data, column: (update ? update[0].data.playoffStartWeek : data.playoffStartWeek) as number | null }
}

/** Every copy that is present equals the column (a copy may be absent, never different). */
function expectCopiesAgree(settings: unknown, column: number | null) {
  const copies = readPlayoffStartWeekCopies(settings)
  // playoff_structure is what the resolver reads first; it is always written.
  expect(copies['playoff_structure.playoff_start_week']).toBe(column)
  for (const [key, value] of Object.entries(copies)) {
    if (value !== undefined) expect(value, key).toBe(column)
  }
}

describe.each(CONCEPTS)('%s: the column and every JSON copy agree', (concept) => {
  it.each(SPORTS)('%s', async (sport) => {
    if (concept === 'survivor' && sport === 'MLB') return // MLB survivor is not offered (survivorCreationAvailability.ts)
    const { data, column } = await create(concept, sport)
    expectCopiesAgree(data.settings, column)
    // …so the resolver reads the column's week whether or not a reader looks at the column.
    if (column != null) {
      expect(resolvePlayoffStartWeek({ playoffStartWeek: null, settings: data.settings, sport }).week).toBe(column)
    }
  })
})

describe('the right week per league type', () => {
  it('best ball: the week after its own regular season, fitted to the sport\'s calendar', async () => {
    const expected = { NFL: 15, NBA: 23, NHL: 25, MLB: 24 }
    for (const sport of SPORTS) {
      const { data, column } = await create('best_ball', sport)
      expect(column, sport).toBe(expected[sport])
      expect(data.settings.best_ball_settings.regularSeasonLength + 1).toBe(column)
    }
  })

  it('best ball: a commissioner\'s own regular season moves the column and the JSON together', async () => {
    const { data, column } = await create('best_ball', 'NBA', { conceptSetup: { regularSeasonLength: 18 } })
    expect(column).toBe(19)
    expectCopiesAgree(data.settings, 19)
  })

  it('best ball tournament: the week after its last round, in the create and the follow-up update', async () => {
    const { data, column } = await create('best_ball', 'NFL', { conceptSetup: { tournamentEnabled: true } })
    expect(data.playoffStartWeek).toBe(column)
    expectCopiesAgree(data.settings, column)
  })

  it('survivor has no playoffs: the week after its full-season plan, as the season builder writes', async () => {
    for (const sport of ['NFL', 'NBA', 'NHL'] as const) {
      const { data, column } = await create('survivor', sport)
      const plan = data.settings.survivor_full_season_plan
      expect(data.playoffTeams).toBe(0)
      expect(column, sport).toBe(plan.endWeek + 1)
    }
  })

  it('guillotine, zombie and roto have no bracket: null everywhere', async () => {
    for (const concept of ['guillotine', 'zombie']) {
      const { data, column } = await create(concept, 'NHL')
      expect(column).toBeNull()
      expectCopiesAgree(data.settings, null)
    }
    const roto = await create('redraft', 'MLB', { scoringPreset: 'mlb_5x5_roto' })
    expect(roto.column).toBeNull()
    expectCopiesAgree(roto.data.settings, null)
  })

  it('redraft and keeper keep their fitted week (NFL 15, NBA 23, NHL 25, MLB 24 at 12 teams)', async () => {
    const expected = { NFL: 15, NBA: 23, NHL: 25, MLB: 24 }
    for (const concept of ['redraft', 'keeper']) {
      for (const sport of SPORTS) expect((await create(concept, sport)).column, `${concept} ${sport}`).toBe(expected[sport])
    }
  })
})

describe('Exile Island: no bracket, and the main league\'s season end', () => {
  it('a main league with a plan ending week 25: exile column 26, every copy 26, no playoff teams', async () => {
    m.survivorConfig.mockResolvedValue({ configId: 'cfg' })
    m.prisma.survivorExileLeague.findUnique.mockResolvedValue(null)
    m.prisma.league.findUnique.mockResolvedValue({
      userId: 'u', sport: 'NBA', name: 'Main', scoring: null, season: 2026, leagueSize: 16, playoffStartWeek: null,
      settings: { survivor_full_season_plan: (await create('survivor', 'NBA')).data.settings.survivor_full_season_plan },
    })
    m.prisma.league.create.mockResolvedValue({ id: 'exile-1' })
    m.prisma.survivorExileLeague.create.mockResolvedValue({})
    await getOrCreateExileLeague('main-1')
    const data = m.prisma.league.create.mock.calls[0][0].data as Obj
    expect(data.playoffTeams).toBe(0)
    expect(data.playoffStartWeek).toBe(26)
    expectCopiesAgree(data.settings, 26)
  })
})
