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
  taxi: vi.fn(),
  publish: vi.fn(async () => undefined),
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
vi.mock('@/lib/taxi/TaxiSettingsService', () => ({ getEffectiveTaxiSettings: m.taxi }))
vi.mock('@/lib/league-rules-explainer/publishRuleChanges', () => ({ publishRuleChangesEvent: m.publish }))

import { applyDynastySportPresetToLeague, isLeagueBeforeDraft } from '@/lib/dynasty-core/applyDynastySportPreset'
import { resolveNbaRosterTemplate } from '@/lib/nba-roster/NbaRosterTemplates'
import { resolveNhlRosterTemplate, NHL_ROSTER_SLOTS, NHL_SLOT_MAP } from '@/lib/nhl-roster/NhlRosterTemplates'
import { resolveMlbRosterTemplate, MLB_ROSTER_SLOTS, MLB_SLOT_MAP } from '@/lib/mlb-roster/MlbRosterTemplates'
import { validateRosterConfig } from '@/lib/roster-engine/RosterValidationEngine'
import { groupSettingsChanges } from '@/lib/league-rules-explainer/explain'
import { renderChangeLine } from '@/lib/league-rules-explainer/render'
import { translations } from '@/lib/i18n/translations'
import type { RuleChange } from '@/lib/league-rules-explainer/types'

const taxiRow = (taxiSlotCount: number, taxiEligibilityYears: number) => ({
  taxiSlotCount, taxiEligibilityYears, taxiDeadlineWeek: null,
  taxiLockBehavior: 'once_promoted_no_return', taxiInSeasonMoves: true, taxiPostseasonMoves: false, taxiScoringOn: false, taxiPromotionDeadlineWeek: null,
})
const published = (): RuleChange[] => (m.publish.mock.calls.at(-1) as unknown as [{ changes: RuleChange[] }])[0].changes
const card = (changes: RuleChange[], lang: 'en' | 'es') => {
  const [group] = groupSettingsChanges([{ id: 'e1', createdAt: '2026-10-29T12:00:00.000Z', actorUserId: 'commish', changes }], { sport: 'NBA' })
  return (group?.lines ?? []).map((l) => renderChangeLine(l, (k) => translations[lang][k] ?? k, lang))
}

beforeEach(() => {
  vi.clearAllMocks()
  m.leagueFindUnique.mockResolvedValue({ sport: 'NBA', status: null, lifecycleState: 'setup', settings: { keep: 1 } })
  m.getConfig.mockResolvedValue({ templateKey: 'dynasty', slots: { ...resolveNbaRosterTemplate('dynasty').slots }, isCustom: false })
  m.updateRoster.mockResolvedValue({})
  m.upsert.mockResolvedValue({})
  m.leagueUpdate.mockResolvedValue({})
  m.taxi.mockResolvedValue(null)
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
    expect(slots).toMatchObject({ BN: 18, IR: 3 })
    expect(slots).not.toHaveProperty('IL')
  })

  // NHL / MLB have no prospect pool (lib/league-creation/prospectStashPolicy.ts): no preset adds taxi.
  it.each([
    ['NHL', 'nhl_dynasty_points_taxi'],
    ['NHL', 'nhl_dynasty_points_minors'],
    ['MLB', 'mlb_dynasty_points_minors'],
    ['MLB', 'mlb_dynasty_points_deep'],
  ])('%s %s writes no TAXI anywhere', async (sport, presetId) => {
    m.leagueFindUnique.mockResolvedValue({ sport, status: null, lifecycleState: 'setup', settings: {} })
    // A league created after the policy has no TAXI key in its stored roster.
    m.getConfig.mockResolvedValue({ templateKey: 'custom', slots: { BN: 5, [sport === 'NHL' ? 'IR' : 'IL']: 2 }, isCustom: true })
    const res = await applyDynastySportPresetToLeague('L1', presetId, 'commish')
    expect(res.ok).toBe(true)
    expect(m.updateRoster.mock.calls[0]![1].slots).not.toHaveProperty('TAXI')
    expect(m.upsert.mock.calls[0]![1].taxiSlots).toBe(0)
    expect(m.leagueUpdate.mock.calls[0]![0].data.settings.taxi_slots).toBe(0)
  })

  // The old taxi depth is on the bench, in the roster save and in League.settings.
  it.each([
    ['NHL', 'nhl_dynasty_points_taxi', 13],
    ['NHL', 'nhl_dynasty_points_minors', 18],
    ['MLB', 'mlb_dynasty_points_minors', 18],
    ['MLB', 'mlb_dynasty_points_deep', 26],
  ])('%s %s writes BN %i, and the roster engine accepts it', async (sport, presetId, bench) => {
    m.leagueFindUnique.mockResolvedValue({ sport, status: null, lifecycleState: 'setup', settings: {} })
    m.getConfig.mockResolvedValue({ templateKey: 'custom', slots: { BN: 5, [sport === 'NHL' ? 'IR' : 'IL']: 2 }, isCustom: true })
    await applyDynastySportPresetToLeague('L1', presetId, 'commish')
    const slots = m.updateRoster.mock.calls[0]![1].slots
    expect(slots.BN).toBe(bench)
    expect(m.leagueUpdate.mock.calls[0]![0].data.settings.bench_slots).toBe(bench)
    // updateLeagueRosterConfig refuses a slot over its catalog maximum, so the bench must fit it.
    const slotMap = sport === 'NHL' ? NHL_SLOT_MAP : MLB_SLOT_MAP
    expect(bench).toBeLessThanOrEqual(slotMap.get('BN')!.maxCount)
    const full = { ...(sport === 'NHL' ? resolveNhlRosterTemplate('dynasty').slots : resolveMlbRosterTemplate('dynasty').slots), ...slots }
    delete (full as Record<string, number>).TAXI
    expect(validateRosterConfig(sport as 'NHL' | 'MLB', 'dynasty', full, sport === 'NHL' ? NHL_ROSTER_SLOTS : MLB_ROSTER_SLOTS).errors).toEqual([])
  })

  it('NHL / MLB: a TAXI slot the league already stores is lowered to 0, never raised', async () => {
    m.leagueFindUnique.mockResolvedValue({ sport: 'MLB', status: null, lifecycleState: 'setup', settings: {} })
    m.getConfig.mockResolvedValue({ templateKey: 'custom', slots: { BN: 5, IL: 2, TAXI: 3 }, isCustom: true })
    await applyDynastySportPresetToLeague('L1', 'mlb_dynasty_points_deep', 'commish')
    expect(m.updateRoster.mock.calls[0]![1].slots.TAXI).toBe(0)
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

describe('the "What changed" card', () => {
  it('a deeper preset publishes the bench, reserve and taxi squad it changed, in English and Spanish', async () => {
    m.taxi.mockResolvedValueOnce(taxiRow(4, 2)).mockResolvedValueOnce(taxiRow(6, 3))
    await applyDynastySportPresetToLeague('L1', 'nba_dynasty_points_deep', 'commish')
    expect(m.publish).toHaveBeenCalledTimes(1)
    expect(m.publish.mock.calls[0]![0]).toMatchObject({ leagueId: 'L1', actorUserId: 'commish', section: 'dynasty' })
    const changes = published()
    expect(changes.map((c) => c.key).sort()).toEqual(['rosterSlots', 'taxiEligibilityYears', 'taxiSlots'])
    expect(changes.find((c) => c.key === 'taxiSlots')).toEqual({ key: 'taxiSlots', before: 4, after: 6 })
    const en = card(changes, 'en').join(' ')
    expect(en).toContain('the taxi squad holds 2 more players.')
    expect(card(changes, 'es').join(' ')).toContain('la escuadra taxi guarda 2 jugadores más.')
  })

  it('a preset that only takes the taxi squad away reads as one taxi line, not an unchanged roster line', async () => {
    m.leagueFindUnique.mockResolvedValue({ sport: 'MLB', status: null, lifecycleState: 'setup', settings: {} })
    m.getConfig.mockResolvedValue({ templateKey: 'custom', slots: { C: 1, SP: 5, BN: 26, IL: 6, TAXI: 3 }, isCustom: true })
    m.taxi.mockResolvedValueOnce(taxiRow(3, 3)).mockResolvedValueOnce(taxiRow(0, 3))
    await applyDynastySportPresetToLeague('L1', 'mlb_dynasty_points_deep', 'commish')
    const lines = card(published(), 'en')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('the taxi squad holds 3 players fewer.')
  })

  it('the preset a league already has publishes nothing', async () => {
    m.taxi.mockResolvedValue(taxiRow(4, 2))
    await applyDynastySportPresetToLeague('L1', 'nba_dynasty_points_taxi', 'commish')
    expect(published()).toEqual([])
  })

  it('a failed taxi read still publishes the roster change, and never fails the apply', async () => {
    m.taxi.mockRejectedValue(new Error('db down'))
    const res = await applyDynastySportPresetToLeague('L1', 'nba_dynasty_points_deep', 'commish')
    expect(res.ok).toBe(true)
    expect(published().map((c) => c.key)).toEqual(['rosterSlots'])
  })

  it('a refused apply publishes nothing', async () => {
    m.leagueFindUnique.mockResolvedValue({ sport: 'NBA', status: 'drafting', lifecycleState: 'setup', settings: {} })
    await applyDynastySportPresetToLeague('L1', 'nba_dynasty_points_deep', 'commish')
    expect(m.publish).not.toHaveBeenCalled()
  })
})
