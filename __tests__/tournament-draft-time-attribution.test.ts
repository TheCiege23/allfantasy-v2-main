/**
 * Tournament conference leagues, draft time:
 *  - ATTRIBUTION: a draft time the tournament writes onto a league is authorized as the league's
 *    commissioner (the tournament owner) but RECORDED as whoever set it — a co-commissioner included.
 *  - TWO-WAY: a draft time changed directly on the league is copied back onto the tournament's record
 *    for that conference, except when the write is the tournament's own sync (no loop).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  prisma: {
    league: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    leagueWaiverSettings: { findUnique: vi.fn() },
    leagueSettings: { upsert: vi.fn() },
  },
  requireCommissionerRole: vi.fn(),
  resolveForUser: vi.fn(),
  logAction: vi.fn(),
  publish: vi.fn(),
  copyBack: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/league/permissions', () => ({ requireCommissionerRole: m.requireCommissionerRole }))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.resolveForUser = m.resolveForUser
  }),
}))
vi.mock('@/lib/league/league-settings-draft-sync', () => ({ syncDraftSessionFromLeagueSettings: vi.fn() }))
vi.mock('@/lib/live-draft-engine/RosterFitValidation', () => ({ validateDraftRoundsFitRoster: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/league/commissioner-settings-derived-sync', () => ({ syncCommissionerDerivedLeagueState: vi.fn() }))
vi.mock('@/server/services/commissionerService', () => ({ assertSettingsEditAllowed: vi.fn() }))
vi.mock('@/server/services/auditService', () => ({ logAction: m.logAction }))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordProductEvent: vi.fn() }))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: m.publish }))
vi.mock('@/lib/league/structuralSettingsLock', () => ({ structuralPatchRefusal: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/waiver-wire/settings-service', () => ({ upsertLeagueWaiverSettings: vi.fn() }))
vi.mock('@/lib/waiver-wire/waiver-state-service', () => ({ refreshLeagueWaiverNextRunAt: vi.fn() }))
vi.mock('@/lib/tournament/divisions/leagueDraftTimeToTournament', () => ({ copyLeagueDraftTimeToTournament: m.copyBack }))

import { executeLeagueSettingsPatch } from '@/lib/league/execute-league-settings-patch'

const AT = '2026-11-01T23:00:00.000Z'

beforeEach(() => {
  vi.clearAllMocks()
  m.requireCommissionerRole.mockResolvedValue(undefined)
  m.resolveForUser.mockResolvedValue({ hasAccess: false })
  m.logAction.mockResolvedValue(undefined)
  m.copyBack.mockResolvedValue('copied')
  m.prisma.league.findFirst.mockImplementation(async () => ({
    id: 'L', platform: 'manual', leagueSize: 12, timezone: 'UTC', teams: [], leagueSettings: null, settings: {},
  }))
  m.prisma.league.findUnique.mockResolvedValue({ settings: {} })
  m.prisma.leagueSettings.upsert.mockImplementation(async ({ update }: { update: Record<string, unknown> }) => ({
    ...update, updatedAt: new Date(),
  }))
})

describe('attribution: the acting user is recorded, the authorizing user is checked', () => {
  it('🛑 a tournament write by a co-commissioner names the co-commissioner, not the owner', async () => {
    const res = await executeLeagueSettingsPatch('owner', { leagueId: 'L', draftDateUtc: AT }, { actingUserId: 'co1', source: 'tournament' })
    expect(res.status).toBe(200)
    // Authorization unchanged: still checked as the owner.
    expect(m.requireCommissionerRole).toHaveBeenCalledWith('L', 'owner', ['league'])
    expect(m.resolveForUser).toHaveBeenCalledWith('owner', 'commissioner_ai_tools')
    // Attribution: the row, the league audit entry and the league event name the co-commissioner.
    expect(m.prisma.leagueSettings.upsert.mock.calls[0][0].update.updatedBy).toBe('co1')
    expect(m.prisma.leagueSettings.upsert.mock.calls[0][0].create.updatedBy).toBe('co1')
    expect(m.logAction).toHaveBeenCalledWith(expect.objectContaining({ userId: 'co1', actionType: 'settings_patch' }))
    await vi.waitFor(() => expect(m.publish).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: 'co1' })))
  })

  it('without an acting user the authorizing user is recorded, as before', async () => {
    await executeLeagueSettingsPatch('owner', { leagueId: 'L', draftDateUtc: AT })
    expect(m.prisma.leagueSettings.upsert.mock.calls[0][0].update.updatedBy).toBe('owner')
    expect(m.logAction).toHaveBeenCalledWith(expect.objectContaining({ userId: 'owner' }))
  })

  it('a refused authorization is still a refusal whoever is acting', async () => {
    m.requireCommissionerRole.mockRejectedValueOnce(new Response(JSON.stringify({ error: 'no' }), { status: 403 }))
    const res = await executeLeagueSettingsPatch('stranger', { leagueId: 'L', draftDateUtc: AT }, { actingUserId: 'co1' })
    expect(res.status).toBe(403)
    expect(m.prisma.leagueSettings.upsert).not.toHaveBeenCalled()
  })
})

describe('two-way draft time: league → tournament copy-back', () => {
  it('🛑 a draft time saved directly on the league is copied back, attributed to the saver', async () => {
    await executeLeagueSettingsPatch('co1', { leagueId: 'L', draftDateUtc: AT }, { section: 'draft' })
    expect(m.copyBack).toHaveBeenCalledTimes(1)
    const [leagueId, when, actor] = m.copyBack.mock.calls[0]
    expect(leagueId).toBe('L')
    expect((when as Date).toISOString()).toBe(AT)
    expect(actor).toBe('co1')
  })

  it('a cleared draft time is copied back as cleared', async () => {
    await executeLeagueSettingsPatch('owner', { leagueId: 'L', draftDateUtc: null })
    expect(m.copyBack).toHaveBeenCalledWith('L', null, 'owner')
  })

  it('🛑 the tournament → league sync never triggers the copy-back (no loop)', async () => {
    await executeLeagueSettingsPatch('owner', { leagueId: 'L', draftDateUtc: AT }, { actingUserId: 'co1', source: 'tournament' })
    expect(m.copyBack).not.toHaveBeenCalled()
  })

  it('a save that does not touch the draft time copies nothing', async () => {
    await executeLeagueSettingsPatch('owner', { leagueId: 'L', autostart: true }, { section: 'draft' })
    expect(m.copyBack).not.toHaveBeenCalled()
  })

  it('a failing copy-back never fails the league save', async () => {
    m.copyBack.mockRejectedValueOnce(new Error('db down'))
    const res = await executeLeagueSettingsPatch('owner', { leagueId: 'L', draftDateUtc: AT })
    expect(res.status).toBe(200)
  })
})
