/**
 * A settings save writes before/after values for the rules it changed onto its `settings_changed`
 * league event (meta.ruleChanges), so the league home can show "What changed" — and nothing else
 * from the request body.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  prisma: {
    league: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    leagueWaiverSettings: { findUnique: vi.fn() },
    leagueSettings: { upsert: vi.fn() },
    appUser: { findUnique: vi.fn().mockResolvedValue(null) },
  },
  publish: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/league/permissions', () => ({ requireCommissionerRole: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/entitlements/afCommissionerPlan', () => ({ hasAfCommissionerPlan: vi.fn().mockResolvedValue(false) }))
vi.mock('@/lib/league/league-settings-draft-sync', () => ({ syncDraftSessionFromLeagueSettings: vi.fn() }))
vi.mock('@/lib/live-draft-engine/RosterFitValidation', () => ({ validateDraftRoundsFitRoster: vi.fn() }))
vi.mock('@/lib/league/commissioner-settings-derived-sync', () => ({ syncCommissionerDerivedLeagueState: vi.fn() }))
vi.mock('@/server/services/commissionerService', () => ({ assertSettingsEditAllowed: vi.fn() }))
vi.mock('@/server/services/auditService', () => ({ logAction: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordProductEvent: vi.fn() }))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: m.publish }))
vi.mock('@/lib/league/structuralSettingsLock', () => ({ structuralPatchRefusal: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/waiver-wire/settings-service', () => ({ upsertLeagueWaiverSettings: vi.fn() }))
vi.mock('@/lib/waiver-wire/waiver-state-service', () => ({ refreshLeagueWaiverNextRunAt: vi.fn() }))
vi.mock('@/lib/league/settingsLifecycleGate', () => ({
  decideSettingsEdit: vi.fn().mockResolvedValue({ ok: true, midSeason: false }),
  lifecycleSectionsTouchedByPatch: vi.fn(() => []),
  recordMidSeasonSettingsChange: vi.fn(),
}))

import { executeLeagueSettingsPatch } from '@/lib/league/execute-league-settings-patch'

let row: Record<string, unknown>

beforeEach(() => {
  vi.clearAllMocks()
  row = {
    id: 'L',
    platform: 'allfantasy',
    sport: 'NFL',
    leagueType: 'redraft',
    leagueSize: 12,
    timezone: 'UTC',
    tradeDeadlineWeek: 12,
    waiverType: 'faab',
    waiverBudget: 100,
    teams: [],
    leagueSettings: null,
    waiverSchedule: null,
    waiverProcessTime: '02:00',
    settings: { inviteCode: 'KEEP-ME' },
  }
  m.prisma.league.findFirst.mockImplementation(async () => structuredClone(row))
  m.prisma.league.findUnique.mockImplementation(async () => ({ settings: structuredClone(row.settings) }))
  m.prisma.league.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    row = { ...row, ...structuredClone(data) }
    return {}
  })
})

async function publishedMeta(): Promise<Record<string, unknown>> {
  await vi.waitFor(() => expect(m.publish).toHaveBeenCalled())
  return (m.publish.mock.calls[0]![0] as { meta: Record<string, unknown> }).meta
}

describe('executeLeagueSettingsPatch → settings_changed.meta.ruleChanges', () => {
  it('carries before/after for the trade deadline, and who made the change', async () => {
    const res = await executeLeagueSettingsPatch('commish', { leagueId: 'L', tradeDeadlineWeek: 13 })
    expect(res.status).toBe(200)
    const meta = await publishedMeta()
    expect(meta.ruleChanges).toEqual([{ key: 'tradeDeadlineWeek', before: 12, after: 13 }])
    expect(meta.actorUserId).toBe('commish')
  })

  it('a save that changes no explained rule adds no ruleChanges', async () => {
    const res = await executeLeagueSettingsPatch('commish', { leagueId: 'L', timezone: 'America/New_York' })
    expect(res.status).toBe(200)
    const meta = await publishedMeta()
    expect(meta).not.toHaveProperty('ruleChanges')
  })
})
