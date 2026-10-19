/**
 * Championship length is a commissioner playoff setting next to weeks per round.
 *
 * It lives in `settings.playoff_structure.championship_length` (where creation writes the sport
 * default), is read back into the commissioner form, and — because the playoff scorer reads it live —
 * cannot be changed while a season is in its playoffs: shortening a half-played two-week final would
 * crown a champion on one week.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  prisma: {
    league: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    leagueWaiverSettings: { findUnique: vi.fn() },
    leagueSettings: { upsert: vi.fn() },
    redraftSeason: { findFirst: vi.fn() },
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

let settingsInDb: Record<string, unknown>

beforeEach(() => {
  vi.clearAllMocks()
  settingsInDb = { inviteCode: 'KEEP-ME', playoff_structure: { playoff_team_count: 6, championship_length: 2 } }
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
  m.prisma.redraftSeason.findFirst.mockResolvedValue(null)
})

describe('championshipLength in the commissioner settings PATCH', () => {
  it('writes playoff_structure.championship_length and keeps the rest of the structure', async () => {
    const res = await executeLeagueSettingsPatch('u', { leagueId: 'L', championshipLength: 1 })
    expect(res.status).toBe(200)
    expect(settingsInDb.playoff_structure).toEqual({ playoff_team_count: 6, championship_length: 1 })
    expect(settingsInDb.inviteCode).toBe('KEEP-ME')
  })

  it('is refused while a season is in its playoffs', async () => {
    m.prisma.redraftSeason.findFirst.mockResolvedValue({ id: 's1' })
    const res = await executeLeagueSettingsPatch('u', { leagueId: 'L', championshipLength: 1 })
    expect(res.status).toBe(409)
    expect((settingsInDb.playoff_structure as Record<string, unknown>).championship_length).toBe(2)
    expect(m.prisma.redraftSeason.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { leagueId: 'L', status: 'playoffs' } }),
    )
  })

  it('re-saving the stored value is not a change, so an autosave mid-playoffs does not fail', async () => {
    m.prisma.redraftSeason.findFirst.mockResolvedValue({ id: 's1' })
    const res = await executeLeagueSettingsPatch('u', { leagueId: 'L', championshipLength: 2 })
    expect(res.status).toBe(200)
  })

  it('rejects an out-of-range value', async () => {
    for (const bad of [0, 5, 1.5, 'two']) {
      const res = await executeLeagueSettingsPatch('u', { leagueId: 'L', championshipLength: bad })
      expect(res.status).toBe(400)
    }
    expect((settingsInDb.playoff_structure as Record<string, unknown>).championship_length).toBe(2)
  })

  it('is read back into the commissioner form, null when the league never stored one', () => {
    const base = { playoffWeeksPerRound: 1 } as Parameters<typeof commissionerLeagueFieldsFromRow>[0]
    expect(commissionerLeagueFieldsFromRow({ ...base, settings: settingsInDb }).championshipLength).toBe(2)
    expect(commissionerLeagueFieldsFromRow({ ...base, settings: {} }).championshipLength).toBeNull()
  })
})
