/**
 * League Settings, part 2: the stores BEHIND each sub-page's save path write every copy.
 *
 * - Roster positions → PUT roster-settings → the sport service's saveConfig:
 *   `League.settings.<sport>_roster_config.slots` (authoritative) AND
 *   `LeagueRosterConfig.overrides.customSlots` (the copy draft validation / lineup checks read).
 * - Waivers → executeLeagueSettingsPatch → syncCommissionerDerivedLeagueState → the
 *   `LeagueWaiverSettings` row (which wins over the JSON / column copy).
 * - Draft rounds → PATCH draft/settings → updateDraftVariantSettings: `settings.draft_rounds` and
 *   the pre-draft `DraftSession.rounds` (the route itself writes `LeagueSettings.rounds`; see
 *   league-settings-save-paths-draft-route.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  prisma: {
    league: { findUnique: vi.fn(), update: vi.fn() },
    leagueRosterConfig: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    leagueWaiverSettings: { findUnique: vi.fn() },
    draftSession: { findFirst: vi.fn(), update: vi.fn() },
  },
  upsertWaiver: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/waiver-wire/settings-service', () => ({ upsertLeagueWaiverSettings: m.upsertWaiver }))
vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', () => ({
  getDraftUISettingsForLeague: vi.fn().mockResolvedValue({ timerMode: 'per_pick' }),
  updateDraftUISettings: vi.fn(),
}))
vi.mock('@/lib/draft-defaults/DraftRoomConfigResolver', () => ({
  getDraftConfigForLeague: vi.fn().mockResolvedValue({ rounds: 12, draft_type: 'snake' }),
}))

import { saveLeagueNbaRosterConfig } from '@/lib/nba-roster/NbaRosterConfigService'
import { saveLeagueNflRosterConfig } from '@/lib/nfl-roster/NflRosterConfigService'
import { syncCommissionerDerivedLeagueState } from '@/lib/league/commissioner-settings-derived-sync'
import { updateDraftVariantSettings } from '@/lib/draft-defaults/DraftVariantSettingsHub'

let settingsInDb: Record<string, unknown>
let leagueColumns: Record<string, unknown>

beforeEach(() => {
  vi.clearAllMocks()
  settingsInDb = { inviteCode: 'KEEP-ME' }
  leagueColumns = {}
  m.prisma.league.findUnique.mockImplementation(async () => ({ ...leagueColumns, settings: structuredClone(settingsInDb), leagueSize: 12 }))
  m.prisma.league.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    if ('settings' in data) settingsInDb = structuredClone(data.settings as Record<string, unknown>)
    return {}
  })
  m.prisma.leagueRosterConfig.findUnique.mockResolvedValue({ leagueId: 'L' })
  m.prisma.leagueWaiverSettings.findUnique.mockResolvedValue({ leagueId: 'L', waiverType: 'rolling', faabBudget: 100, waiverEngineConfig: null })
})

describe('roster positions write both copies', () => {
  const slots = { PG: 1, SG: 1, UTIL: 3, BN: 4, IL: 1 }

  it('NBA: settings.nba_roster_config.slots AND LeagueRosterConfig.overrides.customSlots', async () => {
    await saveLeagueNbaRosterConfig('L', { templateKey: 'custom', slots, isCustom: true, userId: 'u' })
    expect((settingsInDb.nba_roster_config as { slots: unknown }).slots).toEqual(slots)
    expect(settingsInDb.inviteCode).toBe('KEEP-ME')
    expect(m.prisma.leagueRosterConfig.update).toHaveBeenCalledTimes(1)
    expect(m.prisma.leagueRosterConfig.update.mock.calls[0][0].data.overrides).toMatchObject({ customSlots: slots, isCustom: true })
  })

  it('NFL: the same two copies; a league with no LeagueRosterConfig row gets one', async () => {
    m.prisma.leagueRosterConfig.findUnique.mockResolvedValue(null)
    const nfl = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, BN: 6 }
    await saveLeagueNflRosterConfig('L', { templateKey: 'custom', slots: nfl, isCustom: true })
    expect((settingsInDb.nfl_roster_config as { slots: unknown }).slots).toEqual(nfl)
    expect(m.prisma.leagueRosterConfig.create).toHaveBeenCalledTimes(1)
    expect(m.prisma.leagueRosterConfig.create.mock.calls[0][0].data.overrides).toMatchObject({ customSlots: nfl })
  })
})

describe('waivers: the LeagueWaiverSettings row follows the column the save changed', () => {
  it('a waiver type + FAAB save reaches the row, and nothing the save did not touch', async () => {
    leagueColumns = { waiverType: 'faab', waiverBudget: 500, waiverMinBid: 1, waiverHours: 24, customDailyWaivers: false, waiverProcessTime: '09:00', waiverSchedule: null }
    await syncCommissionerDerivedLeagueState('L', ['waiverType', 'waiverBudget'])
    expect(m.upsertWaiver).toHaveBeenCalledTimes(1)
    const [, input] = m.upsertWaiver.mock.calls[0]
    expect(input).toMatchObject({ waiverType: 'faab', faabBudget: 500 })
    expect(input.processingTimeUtc).toBeUndefined()
    expect(input.waiverEngineConfig).toBeUndefined()
  })
})

describe('draft rounds: settings.draft_rounds and the pre-draft DraftSession', () => {
  it('updateDraftVariantSettings({ config: { rounds } }) writes both', async () => {
    m.prisma.draftSession.findFirst.mockResolvedValue({ id: 'ds1', status: 'pre_draft' })
    await updateDraftVariantSettings('L', { config: { rounds: 14 } })
    expect(settingsInDb.draft_rounds).toBe(14)
    expect(settingsInDb.inviteCode).toBe('KEEP-ME')
    expect(m.prisma.draftSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ds1' }, data: expect.objectContaining({ rounds: 14 }) }),
    )
  })

  it('a draft that has started keeps its session rounds (settings still updated)', async () => {
    m.prisma.draftSession.findFirst.mockResolvedValue({ id: 'ds1', status: 'in_progress' })
    await updateDraftVariantSettings('L', { config: { rounds: 10 } })
    expect(settingsInDb.draft_rounds).toBe(10)
    expect(m.prisma.draftSession.update).not.toHaveBeenCalled()
  })
})
