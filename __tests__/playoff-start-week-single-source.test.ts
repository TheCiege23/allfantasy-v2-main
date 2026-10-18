/**
 * Playoff start week has ONE source of truth on a native league: the quick "Playoffs start (week)"
 * field (League.playoffStartWeek). The playoff stage/bracket editor used to compute the week from the
 * sport default and write it over the chosen week (`settings.playoffStartWeek`), so the two disagreed.
 *
 * - the quick-field save writes the column, the JSON copies AND the stage config's start week
 *   (keeping the stage lengths, so the bracket shifts with it);
 * - the stage save never writes a sport-default week over a chosen week;
 * - the stage editor's GET / preview seed from the chosen week.
 *
 * Prisma is mocked with a store that persists both the League columns and `League.settings`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  prisma: {
    league: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    leagueWaiverSettings: { findUnique: vi.fn() },
    leagueSettings: { upsert: vi.fn() },
  },
  session: { user: { id: 'u' } } as { user: { id: string } } | null,
}))

vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/league/permissions', () => ({ requireCommissionerRole: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.resolveForUser = vi.fn().mockResolvedValue({ hasAccess: false })
  }),
}))
vi.mock('@/lib/league/league-settings-draft-sync', () => ({ syncDraftSessionFromLeagueSettings: vi.fn() }))
vi.mock('@/lib/live-draft-engine/RosterFitValidation', () => ({ validateDraftRoundsFitRoster: vi.fn().mockResolvedValue(null) }))
vi.mock('@/server/services/commissionerService', () => ({ assertSettingsEditAllowed: vi.fn() }))
vi.mock('@/server/services/auditService', () => ({ logAction: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordProductEvent: vi.fn() }))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: vi.fn() }))
vi.mock('@/lib/league/structuralSettingsLock', () => ({ structuralPatchRefusal: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/waiver-wire/settings-service', () => ({ upsertLeagueWaiverSettings: vi.fn() }))
vi.mock('@/lib/waiver-wire/waiver-state-service', () => ({ refreshLeagueWaiverNextRunAt: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => m.session) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/subscription/FeatureGateService', () => ({
  FeatureGateService: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.evaluateUserFeatureAccess = vi.fn().mockResolvedValue({ allowed: true })
  }),
}))

import { executeLeagueSettingsPatch } from '@/lib/league/execute-league-settings-patch'
import { getPlayoffConfig, savePlayoffConfig } from '@/lib/playoff-settings'
import { resolvePlayoffStartWeek } from '@/lib/playoff-settings/resolvePlayoffStartWeek'
import { GET, PUT } from '@/app/api/commissioner/leagues/[leagueId]/playoff-settings/route'

let columns: Record<string, unknown>
let settingsInDb: Record<string, unknown>
let columnWrites: Record<string, unknown>[]

/** A stage config saved by the OLD editor: a sport-default start week (NFL 15 - week 18 exclusion = 14). */
const STALE_STAGE_CONFIG = {
  sport: 'NFL',
  includedStages: ['week_18_exclusion', 'wild_card'],
  startMode: 'default',
  regularSeasonShiftApplied: true,
  adjustedRegularSeasonEndWeek: 13,
  adjustedPlayoffStartWeek: 14,
  adjustedPlayoffWeeks: 4,
  premiumFeaturesUsed: true,
  lastUpdatedAt: '2026-10-01T00:00:00.000Z',
}

function league() {
  return { id: 'L', userId: 'u', ...columns, settings: structuredClone(settingsInDb) }
}

beforeEach(() => {
  vi.clearAllMocks()
  m.session = { user: { id: 'u' } }
  columns = {
    platform: 'manual', sport: 'NFL', leagueVariant: null, leagueSize: 12, timezone: 'UTC',
    playoffStartWeek: 13, playoffTeams: 6, playoffWeeksPerRound: 1, playoffSeedingRule: null, playoffLowerBracket: null,
    waiverSchedule: null, waiverProcessTime: '02:00',
  }
  settingsInDb = { inviteCode: 'KEEP-ME', playoffStartWeek: 14, playoff_config_data: structuredClone(STALE_STAGE_CONFIG) }
  columnWrites = []
  m.prisma.league.findFirst.mockImplementation(async () => ({ ...league(), teams: [], leagueSettings: null }))
  m.prisma.league.findUnique.mockImplementation(async () => league())
  m.prisma.league.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    const { settings, ...rest } = data
    if (settings !== undefined) settingsInDb = structuredClone(settings as Record<string, unknown>)
    if (Object.keys(rest).length) {
      columnWrites.push(rest)
      Object.assign(columns, rest)
    }
    return {}
  })
  m.prisma.leagueSettings.upsert.mockImplementation(async ({ update }: { update: Record<string, unknown> }) => ({ ...update, updatedAt: new Date() }))
})

function req(body?: unknown) {
  return new Request('http://x/api/commissioner/leagues/L/playoff-settings', {
    method: body === undefined ? 'GET' : 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never
}
const params = { params: Promise.resolve({ leagueId: 'L' }) }

describe('the quick field is the source of truth, and its save reaches every copy', () => {
  it('🛑 a quick-field save writes the column, the JSON copies and the stage config start week', async () => {
    const res = await executeLeagueSettingsPatch('u', { leagueId: 'L', playoffStartWeek: 12 }, { section: 'playoffs' })
    expect(res.status).toBe(200)

    expect(columnWrites).toContainEqual(expect.objectContaining({ playoffStartWeek: 12 }))
    expect((settingsInDb.playoff_structure as Record<string, unknown>).playoff_start_week).toBe(12)
    expect((settingsInDb.playoffSettings as Record<string, unknown>).playoffStartWeek).toBe(12)
    expect(settingsInDb.playoffStartWeek).toBe(12)

    // The stage config shifts with it and keeps its stage lengths.
    const stage = settingsInDb.playoff_config_data as Record<string, unknown>
    expect(stage.adjustedPlayoffStartWeek).toBe(12)
    expect(stage.adjustedRegularSeasonEndWeek).toBe(11)
    expect(stage.adjustedPlayoffWeeks).toBe(4)
    expect(stage.includedStages).toEqual(['week_18_exclusion', 'wild_card'])
    expect(settingsInDb.inviteCode).toBe('KEEP-ME')
  })

  it('a save that does not touch the start week leaves the stage config alone', async () => {
    await executeLeagueSettingsPatch('u', { leagueId: 'L', playoffTeams: 4 }, { section: 'playoffs' })
    expect((settingsInDb.playoff_config_data as Record<string, unknown>).adjustedPlayoffStartWeek).toBe(14)
  })

  it('imported leagues are unchanged: the quick-field sync does not touch the stage copies', async () => {
    columns.platform = 'sleeper'
    await executeLeagueSettingsPatch('u', { leagueId: 'L', playoffStartWeek: 12 }, { section: 'playoffs' })
    expect((settingsInDb.playoff_structure as Record<string, unknown>).playoff_start_week).toBe(12)
    expect(settingsInDb.playoffStartWeek).toBe(14)
    expect((settingsInDb.playoff_config_data as Record<string, unknown>).adjustedPlayoffStartWeek).toBe(14)
  })
})

describe('the stage editor never writes a sport-default week over the chosen week', () => {
  it('🛑 a stage save keeps the chosen week (13), not the sport default (15) or its shortened form (14)', async () => {
    const result = await savePlayoffConfig('L', { includedStages: ['week_18_exclusion', 'wild_card'] }, { isPremium: true })
    expect(result.ok).toBe(true)
    expect(settingsInDb.playoffStartWeek).toBe(13)
    const stage = settingsInDb.playoff_config_data as Record<string, unknown>
    expect(stage.adjustedPlayoffStartWeek).toBe(13)
    expect(stage.adjustedRegularSeasonEndWeek).toBe(12)
    // Stage lengths still apply: NFL 3 playoff weeks + wild card.
    expect(stage.adjustedPlayoffWeeks).toBe(4)
    expect(result.adjustment?.newChampionshipWeek).toBe(16)
    // The stage save never writes the column.
    expect(columnWrites).toEqual([])
  })

  it('a league with no chosen week anywhere keeps settings.playoffStartWeek unset', async () => {
    columns.playoffStartWeek = null
    settingsInDb = { inviteCode: 'KEEP-ME' }
    const result = await savePlayoffConfig('L', { includedStages: [] }, { isPremium: true })
    expect(result.ok).toBe(true)
    expect('playoffStartWeek' in settingsInDb).toBe(false)
    expect((settingsInDb.playoff_config_data as Record<string, unknown>).adjustedPlayoffStartWeek).toBe(15)
  })

  it('imported leagues keep the original sport-default computation', async () => {
    columns.platform = 'sleeper'
    await savePlayoffConfig('L', { includedStages: ['week_18_exclusion'] }, { isPremium: true })
    expect(settingsInDb.playoffStartWeek).toBe(14)
  })

  it('PUT through the route: the save keeps the chosen week', async () => {
    const res = await PUT(req({ includedStages: ['wild_card'] }), params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.adjustment.newPlayoffStartWeek).toBe(13)
    expect(body.config.adjustedPlayoffStartWeek).toBe(13)
    expect(settingsInDb.playoffStartWeek).toBe(13)
  })
})

describe('the stage editor seeds from the chosen week', () => {
  it('🛑 GET returns the chosen week even when the stored stage config holds an old default', async () => {
    const res = await GET(req(), params)
    const body = await res.json()
    expect(body.config.adjustedPlayoffStartWeek).toBe(13)
    expect(body.config.adjustedRegularSeasonEndWeek).toBe(12)
  })

  it('the preview keeps the chosen week', async () => {
    const res = await PUT(req({ includedStages: ['week_18_exclusion', 'super_bowl'], preview: true }), params)
    const body = await res.json()
    expect(body.adjustment.newPlayoffStartWeek).toBe(13)
    expect(body.adjustment.newPlayoffWeeks).toBe(4)
    expect(settingsInDb.playoffStartWeek).toBe(14) // preview saves nothing
  })

  it('getPlayoffConfig with no stored stage config still reports the chosen week', async () => {
    settingsInDb = {}
    expect((await getPlayoffConfig('L')).adjustedPlayoffStartWeek).toBe(13)
  })
})

describe('resolvePlayoffStartWeek', () => {
  it('column, then the JSON copies, then the sport default', () => {
    expect(resolvePlayoffStartWeek({ playoffStartWeek: 12, settings: { playoffStartWeek: 15 }, sport: 'NFL' })).toEqual({ week: 12, source: 'column' })
    expect(
      resolvePlayoffStartWeek({ playoffStartWeek: null, settings: { playoff_structure: { playoff_start_week: 11 }, playoffStartWeek: 15 }, sport: 'NFL' }),
    ).toEqual({ week: 11, source: 'settings' })
    expect(resolvePlayoffStartWeek({ playoffStartWeek: null, settings: null, sport: 'NFL' })).toEqual({ week: 15, source: 'sport_default' })
  })
})
