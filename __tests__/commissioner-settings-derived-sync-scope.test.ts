/**
 * The derived sync mirrors `League` playoff/waiver columns into `settings.playoff_structure` and the
 * `LeagueWaiverSettings` row. Those two copies are ALSO written directly — by
 * PUT /api/commissioner/leagues/[id]/playoffs and PUT .../waivers — which never touch the columns.
 *
 * So the sync must only mirror the columns this save changed. Mirroring all of them meant a
 * playoff-only save rewrote the waiver row from stale columns (reverting the waiver type and FAAB
 * budget the waivers panel saved), and a waiver-only save rewrote playoff_structure from stale
 * columns (reverting the playoff team count the playoffs panel saved).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  prisma: {
    league: { findUnique: vi.fn(), update: vi.fn() },
    leagueWaiverSettings: { findUnique: vi.fn() },
  },
  upsertWaiver: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/waiver-wire/settings-service', () => ({ upsertLeagueWaiverSettings: m.upsertWaiver }))

import { syncCommissionerDerivedLeagueState } from '@/lib/league/commissioner-settings-derived-sync'

/** Column defaults (`@default`) the waivers / playoffs panels never update. */
const staleColumns = {
  playoffStartWeek: 14,
  playoffTeams: 4,
  playoffWeeksPerRound: 1,
  playoffSeedingRule: 'default',
  playoffLowerBracket: 'consolation',
  waiverType: 'rolling',
  waiverBudget: 100,
  waiverMinBid: 0,
  waiverClearAfterGames: true,
  waiverHours: 24,
  customDailyWaivers: false,
  waiverProcessTime: '02:00',
  waiverSchedule: null,
}

let settingsInDb: Record<string, unknown>

beforeEach(() => {
  vi.clearAllMocks()
  // What the playoffs panel saved: 6 teams starting week 15.
  settingsInDb = { playoff_structure: { playoff_team_count: 6, playoff_start_week: 15, first_round_byes: 2 } }
  m.prisma.league.findUnique.mockImplementation(async () => ({ ...staleColumns, settings: structuredClone(settingsInDb) }))
  m.prisma.league.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    if ('settings' in data) settingsInDb = structuredClone(data.settings as Record<string, unknown>)
    return {}
  })
  // What the waivers panel saved: FAAB with a 200 budget.
  m.prisma.leagueWaiverSettings.findUnique.mockResolvedValue({ waiverType: 'faab', faabBudget: 200, waiverEngineConfig: { faab_min_bid: 1 } })
})

describe('syncCommissionerDerivedLeagueState scopes the mirror to the columns that changed', () => {
  it('a waiver-only save does not rewrite playoff_structure from stale playoff columns', async () => {
    await syncCommissionerDerivedLeagueState('L', ['waiverHours'])
    expect(settingsInDb.playoff_structure).toEqual({ playoff_team_count: 6, playoff_start_week: 15, first_round_byes: 2 })
  })

  it('a playoff-only save does not rewrite the waiver row from stale waiver columns', async () => {
    await syncCommissionerDerivedLeagueState('L', ['playoffTeams'])
    for (const call of m.upsertWaiver.mock.calls) {
      const input = call[1] as Record<string, unknown>
      expect(input.waiverType).toBeUndefined()
      expect(input.faabBudget).toBeUndefined()
      expect(input.processingTimeUtc).toBeUndefined()
      expect(input.waiverEngineConfig).toBeUndefined()
    }
  })

  it('a playoff team-count save updates the count but keeps the start week the playoffs panel saved', async () => {
    await syncCommissionerDerivedLeagueState('L', ['playoffTeams'])
    expect(settingsInDb.playoff_structure).toMatchObject({ playoff_team_count: 4, playoff_start_week: 15, first_round_byes: 2 })
  })

  it('a waiver save mirrors only the changed waiver column onto an existing row', async () => {
    await syncCommissionerDerivedLeagueState('L', ['waiverHours'])
    expect(m.upsertWaiver).toHaveBeenCalledTimes(1)
    const input = m.upsertWaiver.mock.calls[0][1] as Record<string, unknown>
    expect(input.waiverType).toBeUndefined()
    expect(input.faabBudget).toBeUndefined()
    expect(input.waiverEngineConfig).toEqual({ faab_min_bid: 1, minimum_waiver_time_hours: 24 })
  })

  it('with no changed-key list it still mirrors everything (unchanged default)', async () => {
    await syncCommissionerDerivedLeagueState('L')
    expect(settingsInDb.playoff_structure).toMatchObject({ playoff_team_count: 4, playoff_start_week: 14 })
    expect(m.upsertWaiver.mock.calls[0][1]).toMatchObject({ waiverType: 'rolling', faabBudget: 100 })
  })
})
