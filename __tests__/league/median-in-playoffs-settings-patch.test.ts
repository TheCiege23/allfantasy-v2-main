/**
 * "League median in playoffs" is a commissioner setting stored in `settings.median_game_in_playoffs`
 * (no column, no migration). The PATCH takes it as `medianGameInPlayoffs`, accepts only a boolean,
 * merges it onto the stored settings, and the commissioner form reads it back — off when absent.
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
import { buildLeagueSettingsRows } from '@/lib/league/league-dashboard-view'

let settingsInDb: Record<string, unknown>

beforeEach(() => {
  vi.clearAllMocks()
  settingsInDb = { inviteCode: 'KEEP-ME', playoff_structure: { playoff_team_count: 6 } }
  m.prisma.league.findFirst.mockImplementation(async () => ({
    id: 'L', platform: 'manual', leagueSize: 12, timezone: 'UTC', teams: [], leagueSettings: null,
    waiverSchedule: null, waiverProcessTime: '02:00', medianGame: true,
    settings: structuredClone(settingsInDb),
  }))
  m.prisma.league.findUnique.mockImplementation(async () => ({ settings: structuredClone(settingsInDb) }))
  m.prisma.league.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    if ('settings' in data) settingsInDb = structuredClone(data.settings as Record<string, unknown>)
    return {}
  })
  m.prisma.redraftSeason.findFirst.mockResolvedValue(null)
  m.prisma.redraftPlayoffRound.findFirst.mockResolvedValue(null)
})

describe('medianGameInPlayoffs in the commissioner settings PATCH', () => {
  it('turning it on writes settings.median_game_in_playoffs and keeps every other key', async () => {
    const res = await executeLeagueSettingsPatch('u', { leagueId: 'L', medianGameInPlayoffs: true })
    expect(res.status).toBe(200)
    expect(settingsInDb.median_game_in_playoffs).toBe(true)
    expect(settingsInDb.inviteCode).toBe('KEEP-ME')
    expect(settingsInDb.playoff_structure).toEqual({ playoff_team_count: 6 })
  })

  it('turning it off stores false', async () => {
    settingsInDb.median_game_in_playoffs = true
    const res = await executeLeagueSettingsPatch('u', { leagueId: 'L', medianGameInPlayoffs: false })
    expect(res.status).toBe(200)
    expect(settingsInDb.median_game_in_playoffs).toBe(false)
  })

  it('refuses anything but a boolean, and writes nothing', async () => {
    for (const bad of ['true', 1, null, 'on', {}]) {
      const res = await executeLeagueSettingsPatch('u', { leagueId: 'L', medianGameInPlayoffs: bad })
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/medianGameInPlayoffs/)
    }
    expect('median_game_in_playoffs' in settingsInDb).toBe(false)
    expect(m.prisma.league.update).not.toHaveBeenCalled()
  })

  it('is never written as a League column', async () => {
    await executeLeagueSettingsPatch('u', { leagueId: 'L', medianGameInPlayoffs: true })
    for (const [arg] of m.prisma.league.update.mock.calls as Array<[{ data: Record<string, unknown> }]>) {
      expect(Object.keys(arg.data)).toEqual(['settings'])
    }
  })

  it('is read back into the commissioner form — off when the league never stored one', () => {
    const base = { medianGame: true } as Parameters<typeof commissionerLeagueFieldsFromRow>[0]
    expect(commissionerLeagueFieldsFromRow({ ...base, settings: {} }).medianGameInPlayoffs).toBe(false)
    expect(commissionerLeagueFieldsFromRow({ ...base, settings: null }).medianGameInPlayoffs).toBe(false)
    expect(commissionerLeagueFieldsFromRow({ ...base, settings: { median_game_in_playoffs: true } }).medianGameInPlayoffs).toBe(true)
  })
})

describe('league settings summary', () => {
  const rows = (league: Record<string, unknown>) =>
    buildLeagueSettingsRows({ leagueSize: 12, scoring: 'PPR', ...league } as never).map((r) => [r.label, r.value])

  it('says playoff weeks are win or go home by default', () => {
    expect(rows({ medianGame: true, settings: {} })).toContainEqual(['Median in Playoffs', 'Off — win or go home'])
    expect(rows({ medianGame: true, settings: { median_game_in_playoffs: true } })).toContainEqual(['Median in Playoffs', 'Counts in playoff weeks'])
  })

  it('says nothing about it when the league plays no median game', () => {
    expect(rows({ medianGame: false, settings: { median_game_in_playoffs: true } }).map(([l]) => l)).not.toContain('Median in Playoffs')
  })
})
