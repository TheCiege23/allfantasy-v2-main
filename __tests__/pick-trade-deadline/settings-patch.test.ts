/**
 * A separate pick trade deadline (lib/trade-deadline/pickTradeDeadline.ts) saved through settingsMerge:
 * free, dynasty-family leagues only, and only in the shape the trade gates read.
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
let leagueType = 'dynasty'

beforeEach(() => {
  vi.clearAllMocks()
  settingsInDb = { inviteCode: 'KEEP-ME' }
  // A snapshot, as Prisma returns: later writes do not mutate an object already read.
  m.prisma.league.findFirst.mockImplementation(async () => ({
    id: 'L', platform: 'manual', leagueType, isDynasty: false, leagueSize: 12, timezone: 'UTC', teams: [], leagueSettings: null,
    waiverSchedule: null, waiverProcessTime: '02:00',
    settings: structuredClone(settingsInDb),
  }))
  m.prisma.league.findUnique.mockImplementation(async () => ({ settings: structuredClone(settingsInDb) }))
  m.prisma.league.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    if ('settings' in data) settingsInDb = structuredClone(data.settings as Record<string, unknown>)
    return {}
  })
})

describe('executeLeagueSettingsPatch: settingsMerge.pick_trade_deadline', () => {
  beforeEach(() => {
    leagueType = 'dynasty'
  })

  it('stores the rule in the shape the trade gates read, with no plan needed', async () => {
    const res = await executeLeagueSettingsPatch('u', { leagueId: 'L', settingsMerge: { pick_trade_deadline: { mode: 'week', week: 16, extra: 1 } } })
    expect(res.status).toBe(200)
    expect(settingsInDb.pick_trade_deadline).toEqual({ mode: 'week', week: 16 })
    expect(settingsInDb.inviteCode).toBe('KEEP-ME')
    expect((await executeLeagueSettingsPatch('u', { leagueId: 'L', settingsMerge: { pick_trade_deadline: { mode: 'same' } } })).status).toBe(200)
    expect(settingsInDb.pick_trade_deadline).toEqual({ mode: 'same' })
  })

  it('refuses a value the gates would not read', async () => {
    for (const bad of [{ mode: 'week', week: 0 }, { mode: 'week' }, { mode: 'forever' }, 'open']) {
      expect((await executeLeagueSettingsPatch('u', { leagueId: 'L', settingsMerge: { pick_trade_deadline: bad } })).status).toBe(400)
    }
    expect(m.prisma.league.update).not.toHaveBeenCalled()
  })

  it('🛑 refuses it on a league that is not dynasty, where nothing would read it', async () => {
    leagueType = 'redraft'
    expect((await executeLeagueSettingsPatch('u', { leagueId: 'L', settingsMerge: { pick_trade_deadline: { mode: 'open' } } })).status).toBe(400)
    expect(m.prisma.league.update).not.toHaveBeenCalled()
  })
})
