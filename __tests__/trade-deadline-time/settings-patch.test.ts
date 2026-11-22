/**
 * A trade close time is validated and normalised when a commissioner saves it: an unreadable value
 * would read as "no close time" at every trade gate, so it is refused at the save instead.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  prisma: {
    league: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    leagueWaiverSettings: { findUnique: vi.fn() },
    leagueSettings: { upsert: vi.fn() },
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

let settingsInDb: Record<string, unknown>

beforeEach(() => {
  vi.clearAllMocks()
  settingsInDb = { inviteCode: 'KEEP-ME' }
  // A snapshot, as Prisma returns: later writes do not mutate an object already read.
  m.prisma.league.findFirst.mockImplementation(async () => ({
    id: 'L', platform: 'manual', leagueSize: 12, timezone: 'UTC', teams: [], leagueSettings: null,
    waiverSchedule: null, waiverProcessTime: '02:00',
    settings: structuredClone(settingsInDb),
  }))
  m.prisma.league.findUnique.mockImplementation(async () => ({ settings: structuredClone(settingsInDb) }))
  m.prisma.league.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    if ('settings' in data) settingsInDb = structuredClone(data.settings as Record<string, unknown>)
    return {}
  })
})

describe('executeLeagueSettingsPatch: settingsMerge.trade_deadline_at', () => {
  it('stores a valid close time as one ISO instant', async () => {
    const res = await executeLeagueSettingsPatch('u', { leagueId: 'L', settingsMerge: { trade_deadline_at: '2026-11-22T04:59:00-00:00' } })
    expect(res.status).toBe(200)
    expect(settingsInDb.trade_deadline_at).toBe('2026-11-22T04:59:00.000Z')
    expect(settingsInDb.inviteCode).toBe('KEEP-ME')
  })

  it('clears it with null or an empty string', async () => {
    settingsInDb.trade_deadline_at = '2026-11-22T04:59:00.000Z'
    for (const clear of [null, '']) {
      const res = await executeLeagueSettingsPatch('u', { leagueId: 'L', settingsMerge: { trade_deadline_at: clear } })
      expect(res.status).toBe(200)
      expect(settingsInDb.trade_deadline_at).toBeNull()
    }
  })

  it('refuses an unreadable value and writes nothing', async () => {
    for (const bad of ['next saturday', 42, { at: 'x' }]) {
      const res = await executeLeagueSettingsPatch('u', { leagueId: 'L', settingsMerge: { trade_deadline_at: bad } })
      expect(res.status).toBe(400)
    }
    expect(m.prisma.league.update).not.toHaveBeenCalled()
    expect(settingsInDb).toEqual({ inviteCode: 'KEEP-ME' })
  })
})
