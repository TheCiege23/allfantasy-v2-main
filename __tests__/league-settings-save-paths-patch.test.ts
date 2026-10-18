/**
 * League Settings, part 2: every sub-page saves through ONE canonical path, and that path writes
 * every copy of the value. This file covers PATCH /api/leagues/:id/settings
 * (executeLeagueSettingsPatch) — the save of the General, Waivers, Trades and Playoffs sub-pages
 * and the only other writer of draft rounds.
 *
 * Prisma is mocked with a store that persists `League.settings`, so the test reads what the DB holds.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  prisma: {
    league: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    leagueWaiverSettings: { findUnique: vi.fn() },
    leagueSettings: { upsert: vi.fn() },
  },
  syncDraft: vi.fn(),
  syncDerived: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/league/permissions', () => ({ requireCommissionerRole: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.resolveForUser = vi.fn().mockResolvedValue({ hasAccess: false })
  }),
}))
vi.mock('@/lib/league/league-settings-draft-sync', () => ({ syncDraftSessionFromLeagueSettings: m.syncDraft }))
vi.mock('@/lib/live-draft-engine/RosterFitValidation', () => ({ validateDraftRoundsFitRoster: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/league/commissioner-settings-derived-sync', () => ({ syncCommissionerDerivedLeagueState: m.syncDerived }))
vi.mock('@/server/services/commissionerService', () => ({ assertSettingsEditAllowed: vi.fn() }))
vi.mock('@/server/services/auditService', () => ({ logAction: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordProductEvent: vi.fn() }))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: vi.fn() }))
vi.mock('@/lib/league/structuralSettingsLock', () => ({ structuralPatchRefusal: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/waiver-wire/settings-service', () => ({ upsertLeagueWaiverSettings: vi.fn() }))
vi.mock('@/lib/waiver-wire/waiver-state-service', () => ({ refreshLeagueWaiverNextRunAt: vi.fn() }))

import { executeLeagueSettingsPatch } from '@/lib/league/execute-league-settings-patch'

let settingsInDb: Record<string, unknown>
let columnWrites: Record<string, unknown>[]

beforeEach(() => {
  vi.clearAllMocks()
  settingsInDb = { inviteCode: 'KEEP-ME', draft_rounds: 15 }
  columnWrites = []
  m.prisma.league.findFirst.mockImplementation(async () => ({
    id: 'L', platform: 'manual', leagueSize: 12, timezone: 'UTC', teams: [], leagueSettings: null,
    waiverSchedule: null, waiverProcessTime: '02:00',
    settings: structuredClone(settingsInDb),
  }))
  m.prisma.league.findUnique.mockImplementation(async () => ({ settings: structuredClone(settingsInDb) }))
  m.prisma.league.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    if ('settings' in data) settingsInDb = structuredClone(data.settings as Record<string, unknown>)
    else columnWrites.push(data)
    return {}
  })
  m.prisma.leagueSettings.upsert.mockImplementation(async ({ update }: { update: Record<string, unknown> }) => ({
    ...update,
    updatedAt: new Date(),
  }))
})

describe('draft rounds: LeagueSettings.rounds + DraftSession.rounds + settings.draft_rounds', () => {
  it('🛑 a rounds save writes all three copies (settings.draft_rounds was missing)', async () => {
    const res = await executeLeagueSettingsPatch('u', { leagueId: 'L', rounds: 12 }, { section: 'draft' })
    expect(res.status).toBe(200)

    // 1. the LeagueSettings row
    expect(m.prisma.leagueSettings.upsert).toHaveBeenCalledTimes(1)
    expect(m.prisma.leagueSettings.upsert.mock.calls[0][0].update).toMatchObject({ rounds: 12 })
    // 2. the pre-draft DraftSession, scoped to the rounds key
    expect(m.syncDraft).toHaveBeenCalledTimes(1)
    expect([...(m.syncDraft.mock.calls[0][3] as Set<string>)]).toEqual(['rounds'])
    // 3. League.settings.draft_rounds — what the draft-room config resolver reads
    expect(settingsInDb.draft_rounds).toBe(12)
    expect(settingsInDb.inviteCode).toBe('KEEP-ME')
  })

  it('a save without rounds leaves settings.draft_rounds alone', async () => {
    await executeLeagueSettingsPatch('u', { leagueId: 'L', autostart: true }, { section: 'draft' })
    expect(settingsInDb.draft_rounds).toBe(15)
  })
})

describe('waivers: League columns + the LeagueWaiverSettings row (the row wins)', () => {
  it('a Waivers sub-page save writes the columns and mirrors exactly those into the row', async () => {
    const res = await executeLeagueSettingsPatch('u', { leagueId: 'L', waiverType: 'faab', waiverBudget: 500 }, { section: 'waivers' })
    expect(res.status).toBe(200)
    expect(columnWrites).toContainEqual(expect.objectContaining({ waiverType: 'faab', waiverBudget: 500 }))
    expect(m.syncDerived).toHaveBeenCalledTimes(1)
    const keys = [...(m.syncDerived.mock.calls[0][1] as Iterable<string>)]
    expect(keys).toEqual(expect.arrayContaining(['waiverType', 'waiverBudget']))
    expect(keys).not.toContain('playoffTeams')
  })
})

describe('playoffs: League columns + settings.playoff_structure / playoffSettings', () => {
  it('a Playoffs sub-page save writes the columns and runs the derived sync for them', async () => {
    await executeLeagueSettingsPatch('u', { leagueId: 'L', playoffTeams: 6, playoffStartWeek: 15 }, { section: 'playoffs' })
    expect(columnWrites).toContainEqual(expect.objectContaining({ playoffTeams: 6, playoffStartWeek: 15 }))
    const keys = [...(m.syncDerived.mock.calls[0][1] as Iterable<string>)]
    expect(keys).toEqual(expect.arrayContaining(['playoffTeams', 'playoffStartWeek']))
    expect(keys).not.toContain('waiverType')
  })
})
