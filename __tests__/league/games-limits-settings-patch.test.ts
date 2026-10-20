/**
 * Games limits through the commissioner settings PATCH (lib/league/execute-league-settings-patch.ts):
 * stored in `settings.games_limits`, sport-gated, range-checked, and refused for a league that is not on
 * daily lineups — the only league whose scoring can apply them.
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

import { executeLeagueSettingsPatch } from '@/lib/league/execute-league-settings-patch'
import { commissionerLeagueFieldsFromRow } from '@/lib/league/commissioner-league-patch'

const DAILY_ON = { lineupLockType: 'daily', dailyLineupsEnabled: true }
let settingsInDb: Record<string, unknown>
let sport = 'NBA'

function league(sp: string, settings: Record<string, unknown>) {
  sport = sp
  settingsInDb = structuredClone(settings)
}

beforeEach(() => {
  vi.clearAllMocks()
  league('NBA', { inviteCode: 'KEEP-ME', sportConfig: DAILY_ON })
  m.prisma.league.findFirst.mockImplementation(async () => ({
    id: 'L', platform: 'manual', leagueSize: 12, timezone: 'UTC', teams: [], leagueSettings: null,
    waiverSchedule: null, waiverProcessTime: '02:00', sport, settings: structuredClone(settingsInDb),
  }))
  m.prisma.league.findUnique.mockImplementation(async () => ({ settings: structuredClone(settingsInDb) }))
  m.prisma.league.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    if ('settings' in data) settingsInDb = structuredClone(data.settings as Record<string, unknown>)
    return {}
  })
  m.prisma.redraftSeason.findFirst.mockResolvedValue(null)
})

const patch = (body: Record<string, unknown>) => executeLeagueSettingsPatch('u', { leagueId: 'L', ...body })

describe('saving games limits', () => {
  it('stores valid NBA caps (normalized) and keeps every other setting', async () => {
    const res = await patch({ gamesLimits: { gamesPlayedCaps: { pg: 82, UTIL: 82 } } })
    expect(res.status).toBe(200)
    expect(settingsInDb.games_limits).toEqual({ gamesPlayedCaps: { PG: 82, UTIL: 82 } })
    expect(settingsInDb.inviteCode).toBe('KEEP-ME')
  })

  it('null turns them off', async () => {
    league('NBA', { sportConfig: DAILY_ON, games_limits: { gamesPlayedCaps: { PG: 82 } } })
    expect((await patch({ gamesLimits: null })).status).toBe(200)
    expect(settingsInDb.games_limits).toBeNull()
  })

  it('NHL goalie minimum and MLB innings are accepted for their sports', async () => {
    league('NHL', { sportConfig: DAILY_ON })
    expect((await patch({ gamesLimits: { goalieMinStarts: 3 } })).status).toBe(200)
    expect(settingsInDb.games_limits).toEqual({ goalieMinStarts: 3 })
    league('MLB', { sportConfig: DAILY_ON })
    expect((await patch({ gamesLimits: { inningsMin: 20, inningsMax: 60 } })).status).toBe(200)
    expect(settingsInDb.games_limits).toEqual({ inningsMin: 20, inningsMax: 60 })
  })

  it.each([
    ['NBA', { goalieMinStarts: 3 }, /NHL leagues only/],
    ['NHL', { inningsMin: 20 }, /MLB leagues only/],
    ['NFL', { gamesPlayedCaps: { QB: 17 } }, /NBA, NHL and MLB/],
    ['NBA', { gamesPlayedCaps: { PG: 500 } }, /1 to 200/],
    ['MLB', { inningsMin: 60, inningsMax: 20 }, /cannot be greater/],
  ])('400 for %s %j, and nothing is stored', async (sp, value, error) => {
    league(sp, { sportConfig: DAILY_ON })
    const res = await patch({ gamesLimits: value })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(error)
    expect(settingsInDb).not.toHaveProperty('games_limits')
    expect(m.prisma.league.update).not.toHaveBeenCalled()
  })

  it('400 for a league that is not on daily lineups — but turning them off is always allowed', async () => {
    league('NBA', { sportConfig: { lineupLockType: 'daily' } })
    const res = await patch({ gamesLimits: { gamesPlayedCaps: { PG: 82 } } })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/daily lineups/)
    expect(settingsInDb).not.toHaveProperty('games_limits')
    expect((await patch({ gamesLimits: null })).status).toBe(200)
  })

  it('settingsMerge cannot write an invalid games_limits around the check', async () => {
    const res = await patch({ settingsMerge: { games_limits: { goalieMinStarts: 3 } } })
    expect(res.status).toBe(400)
    expect(settingsInDb).not.toHaveProperty('games_limits')
  })

  it('the commissioner form reads them back with the daily-lineup flag and the slots a cap may name', () => {
    const form = commissionerLeagueFieldsFromRow({
      sport: 'NBA',
      settings: { sportConfig: DAILY_ON, games_limits: { gamesPlayedCaps: { PG: 82 } } },
    } as never)
    expect(form.gamesLimits).toEqual({ gamesPlayedCaps: { PG: 82 } })
    expect(form.dailyLineupsActive).toBe(true)
    expect(form.gamesLimitsCapSlots).toEqual(expect.arrayContaining(['PG', 'SG', 'G', 'UTIL']))
  })
})
