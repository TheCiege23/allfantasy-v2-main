import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Pre-draft edit of an NBA/NHL/MLB dynasty league to another format preset: written through the
 * commissioner roster save, the dynasty config upsert and League.settings — and refused once the
 * draft has started or for another sport.
 */
const m = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  leagueUpdate: vi.fn(),
  getConfig: vi.fn(),
  updateRoster: vi.fn(),
  upsert: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: m.leagueFindUnique, update: m.leagueUpdate } } }))
vi.mock('@/lib/roster-engine', async () => {
  const { resolveNbaRosterTemplate } = await import('@/lib/nba-roster/NbaRosterTemplates')
  const { resolveNhlRosterTemplate } = await import('@/lib/nhl-roster/NhlRosterTemplates')
  const { resolveMlbRosterTemplate } = await import('@/lib/mlb-roster/MlbRosterTemplates')
  const resolvers: Record<string, (t: string) => unknown> = { NBA: resolveNbaRosterTemplate, NHL: resolveNhlRosterTemplate, MLB: resolveMlbRosterTemplate }
  return {
    getRosterEngineRegistry: () => ({ getService: (sport: string) => ({ getConfig: m.getConfig, resolveDefaultTemplate: resolvers[sport] }) }),
    updateLeagueRosterConfig: m.updateRoster,
  }
})
vi.mock('@/lib/dynasty-core/DynastySettingsService', () => ({ upsertDynastyConfig: m.upsert }))

import { applyDynastySportPresetToLeague, isLeagueBeforeDraft } from '@/lib/dynasty-core/applyDynastySportPreset'
import { resolveNbaRosterTemplate } from '@/lib/nba-roster/NbaRosterTemplates'
import { resolveNhlRosterTemplate } from '@/lib/nhl-roster/NhlRosterTemplates'

beforeEach(() => {
  vi.clearAllMocks()
  m.leagueFindUnique.mockResolvedValue({ sport: 'NBA', status: null, lifecycleState: 'setup', settings: { keep: 1 } })
  m.getConfig.mockResolvedValue({ templateKey: 'dynasty', slots: { ...resolveNbaRosterTemplate('dynasty').slots }, isCustom: false })
  m.updateRoster.mockResolvedValue({})
  m.upsert.mockResolvedValue({})
  m.leagueUpdate.mockResolvedValue({})
})

describe('applyDynastySportPresetToLeague', () => {
  it('writes BN / IL / TAXI through the roster save, taxi rules through the dynasty config, and the settings keys', async () => {
    m.leagueFindUnique
      .mockResolvedValueOnce({ sport: 'NBA', status: null, lifecycleState: 'setup', settings: { keep: 1 } })
      .mockResolvedValueOnce({ settings: { keep: 1, roster: { version: 2 } } })
    const res = await applyDynastySportPresetToLeague('L1', 'nba_dynasty_points_deep', 'commish')
    expect(res.ok).toBe(true)

    const [leagueId, cfg, userId] = m.updateRoster.mock.calls[0]!
    expect([leagueId, userId]).toEqual(['L1', 'commish'])
    expect(cfg.templateKey).toBe('custom')
    expect(cfg.slots).toEqual({ ...resolveNbaRosterTemplate('dynasty').slots, BN: 12, IL: 4, TAXI: 6 })

    expect(m.upsert).toHaveBeenCalledWith('L1', { taxiSlots: 6, taxiEligibilityYears: 3 })
    // Built from the RE-READ settings, so the roster save's block survives.
    expect(m.leagueUpdate.mock.calls[0]![0].data.settings).toEqual({
      keep: 1, roster: { version: 2 }, bench_slots: 12, ir_slots: 4, taxi_slots: 6, dynasty_sport_preset_id: 'nba_dynasty_points_deep',
    })
  })

  it('the default preset on an untouched league keeps the dynasty template key', async () => {
    await applyDynastySportPresetToLeague('L1', 'nba_dynasty_points_taxi', 'commish')
    expect(m.updateRoster.mock.calls[0]![1].templateKey).toBe('dynasty')
  })

  it('NHL injured reserve is IR, not IL', async () => {
    m.leagueFindUnique.mockResolvedValue({ sport: 'NHL', status: 'pre_draft', lifecycleState: 'in_season', settings: {} })
    m.getConfig.mockResolvedValue({ templateKey: 'dynasty', slots: { ...resolveNhlRosterTemplate('dynasty').slots }, isCustom: false })
    await applyDynastySportPresetToLeague('L1', 'nhl_dynasty_points_minors', 'commish')
    const slots = m.updateRoster.mock.calls[0]![1].slots
    expect(slots).toMatchObject({ BN: 10, IR: 3, TAXI: 8 })
    expect(slots).not.toHaveProperty('IL')
  })

  it('refuses once the draft has started, writing nothing', async () => {
    for (const league of [
      { status: 'drafting', lifecycleState: 'setup' },
      { status: null, lifecycleState: 'in_season' },
      { status: 'in_season', lifecycleState: 'setup' },
    ]) {
      m.leagueFindUnique.mockResolvedValue({ sport: 'NBA', settings: {}, ...league })
      const res = await applyDynastySportPresetToLeague('L1', 'nba_dynasty_points_deep', 'commish')
      expect(res).toMatchObject({ ok: false, status: 409 })
    }
    expect(m.updateRoster).not.toHaveBeenCalled()
    expect(m.upsert).not.toHaveBeenCalled()
    expect(m.leagueUpdate).not.toHaveBeenCalled()
  })

  it('refuses another sport\'s preset and unknown ids', async () => {
    expect(await applyDynastySportPresetToLeague('L1', 'mlb_dynasty_points_deep', 'c')).toMatchObject({ ok: false, status: 400 })
    expect(await applyDynastySportPresetToLeague('L1', 'dynasty_superflex', 'c')).toMatchObject({ ok: false, status: 400 })
    expect(m.updateRoster).not.toHaveBeenCalled()
  })

  it('reads the platform status before our own lifecycle state', () => {
    expect(isLeagueBeforeDraft({ status: 'pre_draft', lifecycleState: 'in_season' })).toBe(true)
    expect(isLeagueBeforeDraft({ status: null, lifecycleState: 'setup' })).toBe(true)
    expect(isLeagueBeforeDraft({ status: null, lifecycleState: 'drafting' })).toBe(false)
    expect(isLeagueBeforeDraft({})).toBe(false)
  })
})
