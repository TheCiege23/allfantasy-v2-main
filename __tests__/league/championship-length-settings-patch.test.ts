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
  m.prisma.redraftPlayoffRound.findFirst.mockResolvedValue(null)
})

/** A league with a playoff shape, and (optionally) a latest season; nothing is in its playoffs. */
function shape(opts: {
  sport?: string
  playoffTeams: number
  playoffStartWeek?: number
  season?: { totalWeeks: number; playoffStartWeek: number } | null
  bracketFinalRound?: number
  storedLength?: number
}) {
  settingsInDb = { playoff_structure: opts.storedLength != null ? { championship_length: opts.storedLength } : {} }
  m.prisma.league.findFirst.mockImplementation(async () => ({
    id: 'L', platform: 'manual', leagueSize: 12, timezone: 'UTC', teams: [], leagueSettings: null,
    waiverSchedule: null, waiverProcessTime: '02:00', sport: opts.sport ?? 'NFL',
    playoffTeams: opts.playoffTeams, playoffWeeksPerRound: 1, playoffStartWeek: opts.playoffStartWeek ?? null,
    settings: structuredClone(settingsInDb),
  }))
  m.prisma.redraftSeason.findFirst.mockImplementation(async (args: { where: { status?: string } }) =>
    args.where.status ? null : opts.season ? { id: 's1', ...opts.season } : null,
  )
  m.prisma.redraftPlayoffRound.findFirst.mockResolvedValue(
    opts.bracketFinalRound ? { roundNumber: opts.bracketFinalRound } : null,
  )
}

describe('championshipLength is refused when the final would end after the season', () => {
  it('NFL, playoffs from week 16, four teams: a two-week final needs a week 18 a 17-week season lacks', async () => {
    shape({ playoffTeams: 4, season: { totalWeeks: 17, playoffStartWeek: 16 } })
    const res = await executeLeagueSettingsPatch('u', { leagueId: 'L', championshipLength: 2 })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/week 18, past the season's last week \(17\)/)
    expect((settingsInDb.playoff_structure as Record<string, unknown>).championship_length).toBeUndefined()
  })

  it('the same final fits when the playoffs start a week earlier', async () => {
    shape({ playoffTeams: 4, season: { totalWeeks: 17, playoffStartWeek: 15 } })
    const res = await executeLeagueSettingsPatch('u', { leagueId: 'L', championshipLength: 2 })
    expect(res.status).toBe(200)
    expect((settingsInDb.playoff_structure as Record<string, unknown>).championship_length).toBe(2)
  })

  it('reads the generated bracket\'s final round, not only the playoff team count', async () => {
    // Four teams would be two rounds (15, 16-17: fits); the bracket actually has three (15, 16, 17-18).
    shape({ playoffTeams: 4, season: { totalWeeks: 17, playoffStartWeek: 15 }, bracketFinalRound: 3 })
    const res = await executeLeagueSettingsPatch('u', { leagueId: 'L', championshipLength: 2 })
    expect(res.status).toBe(400)
  })

  it('NHL shape (28 weeks, playoffs from 25, six teams) takes its two-week final', async () => {
    shape({ sport: 'NHL', playoffTeams: 6, season: { totalWeeks: 28, playoffStartWeek: 25 }, storedLength: 1 })
    const res = await executeLeagueSettingsPatch('u', { leagueId: 'L', championshipLength: 2 })
    expect(res.status).toBe(200)
  })

  it('without a season, checks the season league creation would make (NFL: 17 weeks)', async () => {
    shape({ playoffTeams: 4, playoffStartWeek: 16, season: null })
    expect((await executeLeagueSettingsPatch('u', { leagueId: 'L', championshipLength: 2 })).status).toBe(400)
    shape({ playoffTeams: 4, playoffStartWeek: 15, season: null })
    expect((await executeLeagueSettingsPatch('u', { leagueId: 'L', championshipLength: 2 })).status).toBe(200)
  })

  it('shortening is always allowed, even on a league that already overruns', async () => {
    // Stored 3 (final 17-19) on a 17-week season; 2 (17-18) still overruns but is no worse — allowed.
    shape({ playoffTeams: 4, season: { totalWeeks: 17, playoffStartWeek: 16 }, storedLength: 3 })
    const res = await executeLeagueSettingsPatch('u', { leagueId: 'L', championshipLength: 2 })
    expect(res.status).toBe(200)
    expect((settingsInDb.playoff_structure as Record<string, unknown>).championship_length).toBe(2)
  })
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
