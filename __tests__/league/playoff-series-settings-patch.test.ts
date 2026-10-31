/**
 * `playoffSeriesLengths` in the commissioner settings PATCH (lib/league/execute-league-settings-patch.ts).
 *
 *  - Any best-of-N above one week is AF Commissioner: refused (403) without the plan, through the same
 *    `hasAfCommissionerPlan` the page reads as `hasAfCommissionerSub`.
 *  - A lapsed plan keeps the series it set: re-saving the stored lengths is not a change, turning series
 *    off is always free, and the scorer never looks at the plan (an in-progress series finishes).
 *  - Native NBA / NHL / MLB redraft leagues only; refused while the playoffs are being played; refused
 *    when the series would end the playoffs after the season's last week; never through settingsMerge.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  hasPlan: { value: true },
  prisma: {
    league: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    leagueWaiverSettings: { findUnique: vi.fn() },
    leagueSettings: { upsert: vi.fn() },
    appUser: { findUnique: vi.fn() },
    redraftSeason: { findFirst: vi.fn(), update: vi.fn() },
    redraftPlayoffRound: { findFirst: vi.fn(), findMany: vi.fn() },
    redraftPlayoffMatchup: { update: vi.fn() },
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/entitlements/afCommissionerPlan', () => ({
  hasAfCommissionerPlan: vi.fn(async () => m.hasPlan.value),
  AF_COMMISSIONER_PLAN_FEATURE: 'commissioner_ai_tools',
}))
vi.mock('@/lib/league/permissions', () => ({ requireCommissionerRole: vi.fn().mockResolvedValue(undefined) }))
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

import { executeLeagueSettingsPatch } from '@/lib/league/execute-league-settings-patch'
import { scoreActivePlayoffRound } from '@/lib/playoff-runtime/playoffRoundScoring'

let settingsInDb: Record<string, unknown>
let inPlayoffs = false

function league(over: Record<string, unknown> = {}) {
  m.prisma.league.findFirst.mockImplementation(async () => ({
    id: 'L', platform: 'manual', leagueType: 'redraft', sport: 'NBA', leagueSize: 8, timezone: 'UTC', teams: [],
    leagueSettings: null, waiverSchedule: null, waiverProcessTime: '02:00',
    playoffTeams: 4, playoffWeeksPerRound: 1, playoffStartWeek: 15,
    settings: structuredClone(settingsInDb),
    ...over,
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  m.hasPlan.value = true
  inPlayoffs = false
  settingsInDb = { inviteCode: 'KEEP-ME' }
  league()
  m.prisma.league.findUnique.mockImplementation(async () => ({ settings: structuredClone(settingsInDb) }))
  m.prisma.league.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    if ('settings' in data) settingsInDb = structuredClone(data.settings as Record<string, unknown>)
    return {}
  })
  m.prisma.appUser.findUnique.mockResolvedValue({ email: 'c@example.com', username: 'c' })
  // A 25-week NBA season, playoffs from week 15, no bracket yet.
  m.prisma.redraftSeason.findFirst.mockImplementation(async (args: { where: { status?: string } }) =>
    args.where.status ? (inPlayoffs ? { id: 's1' } : null) : { id: 's1', totalWeeks: 25, playoffStartWeek: 15 },
  )
  m.prisma.redraftPlayoffRound.findFirst.mockResolvedValue(null)
})

const patch = (body: Record<string, unknown>) => executeLeagueSettingsPatch('u', { leagueId: 'L', ...body })

describe('playoffSeriesLengths — gating', () => {
  it('a subscriber can set per-round series lengths; they are stored in settings.playoff_series', async () => {
    const res = await patch({ playoffSeriesLengths: [3, 5] })
    expect(res.status).toBe(200)
    expect(settingsInDb.playoff_series).toEqual({ mode: 'series', lengths: [3, 5] })
    expect(settingsInDb.inviteCode).toBe('KEEP-ME')
  })

  it('without AF Commissioner any N > 1 is refused (403) and nothing is stored', async () => {
    m.hasPlan.value = false
    const res = await patch({ playoffSeriesLengths: [3, 3] })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('PLAYOFF_SERIES_REQUIRES_AF_COMMISSIONER')
    expect(settingsInDb.playoff_series).toBeUndefined()
  })

  it('without the plan, single weeks (series off) are free', async () => {
    m.hasPlan.value = false
    expect((await patch({ playoffSeriesLengths: [1, 1] })).status).toBe(200)
    expect(settingsInDb.playoff_series).toBeUndefined()
  })

  it('a lapsed plan keeps its series: re-saving is fine, changing it is refused, turning it off is fine', async () => {
    settingsInDb = { playoff_series: { mode: 'series', lengths: [3, 5] } }
    league()
    m.hasPlan.value = false
    expect((await patch({ playoffSeriesLengths: [3, 5] })).status).toBe(200)
    expect(settingsInDb.playoff_series).toEqual({ mode: 'series', lengths: [3, 5] })
    expect((await patch({ playoffSeriesLengths: [3, 7] })).status).toBe(403)
    expect(settingsInDb.playoff_series).toEqual({ mode: 'series', lengths: [3, 5] })
    expect((await patch({ playoffSeriesLengths: null })).status).toBe(200)
    expect(settingsInDb.playoff_series).toBeUndefined()
  })

  it('cannot be written around the gate through settingsMerge', async () => {
    m.hasPlan.value = false
    const res = await patch({ settingsMerge: { playoff_series: { mode: 'series', lengths: [7] } } })
    expect(res.status).toBe(400)
    expect(settingsInDb.playoff_series).toBeUndefined()
  })
})

describe('playoffSeriesLengths — scope, timing and fit', () => {
  it('only native NBA / NHL / MLB redraft leagues', async () => {
    league({ sport: 'NFL' })
    expect((await patch({ playoffSeriesLengths: [3] })).status).toBe(400)
    league({ leagueType: 'dynasty' })
    expect((await patch({ playoffSeriesLengths: [3] })).status).toBe(400)
    league({ platform: 'sleeper' })
    expect((await patch({ playoffSeriesLengths: [3] })).status).toBe(400)
    expect(settingsInDb.playoff_series).toBeUndefined()
  })

  it('rejects a length that is not 1, 3, 5 or 7', async () => {
    expect((await patch({ playoffSeriesLengths: [2] })).status).toBe(400)
  })

  it('refused while the playoffs are being played (the series under way finishes as configured)', async () => {
    settingsInDb = { playoff_series: { mode: 'series', lengths: [3, 5] } }
    league()
    inPlayoffs = true
    expect((await patch({ playoffSeriesLengths: [1, 1] })).status).toBe(409)
    expect(settingsInDb.playoff_series).toEqual({ mode: 'series', lengths: [3, 5] })
  })

  it('refused when the series would end the playoffs after the season (4 teams, 2 rounds, from week 15 of 25)', async () => {
    // [3, 5] → weeks 15-17 and 18-22: fits. [7, 7] → 15-21 and 22-28: past week 25.
    const res = await patch({ playoffSeriesLengths: [7, 7] })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/week 28, past the season's last week \(25\)/)
    expect(settingsInDb.playoff_series).toBeUndefined()
  })
})

describe('an in-progress series survives the plan lapsing', () => {
  it('the scorer reads the stored series whatever the plan says', async () => {
    m.hasPlan.value = false
    const updates: Array<Record<string, any>> = []
    const db = {
      redraftSeason: {
        findFirst: vi.fn(async () => ({ id: 's1', leagueId: 'L', season: 2026, status: 'playoffs', currentWeek: 16, playoffStartWeek: 15 })),
        update: vi.fn(),
      },
      redraftPlayoffRound: {
        findMany: vi.fn(async (args: any) =>
          args.where.roundNumber?.gte != null
            ? []
            : [{
                roundNumber: 1, status: 'active',
                matchups: [{ id: 'm1', homeRosterId: 'A', awayRosterId: 'B', homeSeed: 1, awaySeed: 4, homeScore: null, awayScore: null, winnerRosterId: null, status: 'scheduled', metadata: {} }],
              }],
        ),
      },
      league: { findFirst: vi.fn(async () => ({ playoffWeeksPerRound: 1, settings: { playoff_series: { mode: 'series', lengths: [3] } } })) },
      redraftPlayoffMatchup: { update: vi.fn(async (a: any) => updates.push(a.data)) },
    }
    const res = await scoreActivePlayoffRound(
      { seasonId: 's1', calendarWeek: 16 },
      {
        prisma: db as any,
        finalizeWeek: vi.fn(async () => ({ finalized: true, alreadyFinal: false, refusal: null }) as any),
        scoreRoster: vi.fn(async (a: any) => ({ rosterId: a.rosterId, starterCount: 1, scoredStarterCount: 1, missingPlayerIds: [], allFinal: true, points: a.rosterId === 'A' ? 10 : 5 })),
      },
    )
    expect(res.weeks).toEqual([15, 16, 17])
    expect(updates[0].metadata.series).toMatchObject({ bestOf: 3, homeWins: 2, winnerRosterId: 'A' })
  })
})
