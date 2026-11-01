/**
 * The league median game (`League.medianGame`) can be switched from the settings PATCH only until the
 * season's first week is final (lib/redraft/medianGameSwitch.ts). After that a change would add or
 * remove a median result in every played week, so it is refused with 409 and nothing is written. A
 * permitted change also moves the running season's copy (`RedraftSeason.medianGame`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  prisma: {
    league: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    leagueWaiverSettings: { findUnique: vi.fn() },
    leagueSettings: { upsert: vi.fn() },
    redraftSeason: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
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
import { medianGameTimingRefusal, seasonHasFinalWeek } from '@/lib/redraft/medianGameSwitch'

type Matchup = { week: number; status: string; awayRosterId: string | null }
const game = (week: number, status: string, awayRosterId: string | null = 'b'): Matchup => ({ week, status, awayRosterId })
let seasons: Array<{ season: number; status: string; schedule: Matchup[] }>

beforeEach(() => {
  vi.clearAllMocks()
  seasons = []
  m.prisma.league.findFirst.mockImplementation(async () => ({
    id: 'L', platform: 'manual', leagueSize: 12, timezone: 'UTC', teams: [], leagueSettings: null,
    waiverSchedule: null, waiverProcessTime: '02:00', medianGame: false, settings: {},
  }))
  m.prisma.league.findUnique.mockResolvedValue({ settings: {} })
  m.prisma.league.update.mockResolvedValue({})
  m.prisma.redraftSeason.findFirst.mockResolvedValue(null)
  m.prisma.redraftSeason.findMany.mockImplementation(async () => seasons)
  m.prisma.redraftSeason.updateMany.mockResolvedValue({ count: 1 })
  m.prisma.redraftPlayoffRound.findFirst.mockResolvedValue(null)
})

const patch = (body: Record<string, unknown>) => executeLeagueSettingsPatch('u', { leagueId: 'L', ...body })
const leagueColumnWrites = () =>
  (m.prisma.league.update.mock.calls as Array<[{ data: Record<string, unknown> }]>).filter(([a]) => 'medianGame' in a.data)

describe('seasonHasFinalWeek', () => {
  it('a sealed first week (byes never go final) locks it; a half-final first week does not', () => {
    expect(seasonHasFinalWeek([])).toBe(false)
    expect(seasonHasFinalWeek([game(1, 'scheduled'), game(1, 'scheduled')])).toBe(false)
    expect(seasonHasFinalWeek([game(1, 'final'), game(1, 'active')])).toBe(false)
    expect(seasonHasFinalWeek([game(1, 'final'), game(1, 'final'), game(1, 'scheduled', null)])).toBe(true)
  })

  it('the first week is the lowest scheduled one, and a final result after it also locks', () => {
    expect(seasonHasFinalWeek([game(3, 'final'), game(4, 'scheduled')])).toBe(true)
    expect(seasonHasFinalWeek([game(1, 'active'), game(2, 'final')])).toBe(true)
  })

  it('a completed season never blocks', () => {
    expect(medianGameTimingRefusal([{ season: 2025, status: 'complete', schedule: [game(1, 'final')] }])).toBeNull()
    expect(medianGameTimingRefusal([{ season: 2026, status: 'in_season', schedule: [game(1, 'final')] }])?.code).toBe(
      'median_game_season_in_progress',
    )
  })
})

describe('medianGame in the commissioner settings PATCH', () => {
  it('before any week is final: saves the column and the running season copy', async () => {
    seasons = [{ season: 2026, status: 'active', schedule: [game(1, 'scheduled')] }]
    const res = await patch({ medianGame: true })
    expect(res.status).toBe(200)
    expect(leagueColumnWrites().map(([a]) => a.data.medianGame)).toEqual([true])
    expect(m.prisma.redraftSeason.updateMany).toHaveBeenCalledWith({
      where: { leagueId: 'L', status: { not: 'complete' } },
      data: { medianGame: true },
    })
  })

  it('no season yet (before the draft): saves', async () => {
    const res = await patch({ medianGame: true })
    expect(res.status).toBe(200)
    expect(leagueColumnWrites()).toHaveLength(1)
  })

  it('once week 1 is final: refused with 409, nothing written', async () => {
    seasons = [{ season: 2026, status: 'active', schedule: [game(1, 'final'), game(1, 'final'), game(2, 'scheduled')] }]
    const res = await patch({ medianGame: true })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('median_game_season_in_progress')
    expect(body.error).toMatch(/first week is final/)
    expect(m.prisma.league.update).not.toHaveBeenCalled()
    expect(m.prisma.redraftSeason.updateMany).not.toHaveBeenCalled()
  })

  it('re-saving the stored value is never refused, and moves no season copy', async () => {
    seasons = [{ season: 2026, status: 'active', schedule: [game(1, 'final')] }]
    const res = await patch({ medianGame: false })
    expect(res.status).toBe(200)
    expect(m.prisma.redraftSeason.findMany).not.toHaveBeenCalled()
    expect(m.prisma.redraftSeason.updateMany).not.toHaveBeenCalled()
  })

  it('after the season is complete it can change again (for the next season)', async () => {
    seasons = [{ season: 2025, status: 'complete', schedule: [game(1, 'final')] }]
    const res = await patch({ medianGame: true })
    expect(res.status).toBe(200)
  })

  it('refuses anything but a boolean', async () => {
    for (const bad of ['true', 1, null, 'on']) {
      const res = await patch({ medianGame: bad })
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/medianGame must be true or false/)
    }
    expect(m.prisma.league.update).not.toHaveBeenCalled()
  })
})
