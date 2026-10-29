/**
 * A Devy or C2C league's rookie draft rules come from its own config (the one its commissioner panel saves
 * and the Devy draft orchestration reads), not the dynasty config's defaults. And those panels' saves
 * publish a "What changed" card for the rookie draft and the taxi squad.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  db: {
    league: { findUnique: vi.fn() },
    dynastyLeagueConfig: { findUnique: vi.fn() },
    devyLeagueConfig: { findUnique: vi.fn() },
    c2CLeagueConfig: { findUnique: vi.fn() },
  },
  taxi: vi.fn(),
  publish: vi.fn(async () => undefined),
}))
vi.mock('@/lib/prisma', () => ({ prisma: h.db }))
vi.mock('@/lib/taxi/TaxiSettingsService', () => ({ getEffectiveTaxiSettings: h.taxi }))
vi.mock('@/lib/league-rules-explainer/publishRuleChanges', () => ({ publishRuleChangesEvent: h.publish }))

import { loadDynastyRookieRules, rookieConfigFor } from '@/lib/league-rules-explainer/dynastyRookieRules'
import { publishVariantConfigChange, readVariantConfigRules } from '@/lib/league-rules-explainer/variantConfigChange'
import { explainLeagueRules } from '@/lib/league-rules-explainer/explain'
import { renderRuleText } from '@/lib/league-rules-explainer/render'
import { ruleSnapshotFromLeague, type RulesLeagueRow } from '@/lib/league-rules-explainer/snapshot'
import { translations } from '@/lib/i18n/translations'

const DEVY = { rookiePickOrderMethod: 'reverse_standings', rookieDraftRounds: 3, rookieDraftType: 'snake' }

beforeEach(() => {
  vi.clearAllMocks()
  h.db.dynastyLeagueConfig.findUnique.mockResolvedValue(null)
  h.db.devyLeagueConfig.findUnique.mockResolvedValue(DEVY)
  h.db.c2CLeagueConfig.findUnique.mockResolvedValue({ rookiePickOrderMethod: 'custom', rookieDraftRounds: 5, rookieDraftType: 'linear' })
  h.taxi.mockResolvedValue({ taxiSlotCount: 4, taxiEligibilityYears: 2, taxiDeadlineWeek: null })
})

describe('rookieConfigFor', () => {
  it('the variant’s row wins field by field over the dynasty config', () => {
    expect(rookieConfigFor({ rookiePickOrderMethod: 'max_pf', rookieDraftRounds: 4, rookieDraftType: 'linear' }, DEVY)).toEqual(DEVY)
    expect(rookieConfigFor({ rookieDraftRounds: 4 }, { rookieDraftRounds: null, rookiePickOrderMethod: 'custom' })).toEqual({
      rookiePickOrderMethod: 'commissioner', rookieDraftRounds: 4, rookieDraftType: null,
    })
  })
  it('the dynasty config’s weighted lottery still orders it — the lottery engine reads it there', () => {
    expect(rookieConfigFor({ rookiePickOrderMethod: 'weighted_lottery' }, DEVY).rookiePickOrderMethod).toBe('weighted_lottery')
  })
  it('no variant row: the dynasty config as before', () => {
    expect(rookieConfigFor({ rookiePickOrderMethod: 'max_pf' }, null)).toEqual({ rookiePickOrderMethod: 'max_pf' })
  })
})

describe('loadDynastyRookieRules', () => {
  it('a Devy league reads its Devy config — not the dynasty defaults max PF / 4 / linear', async () => {
    const r = await loadDynastyRookieRules(h.db as never, { leagueId: 'L', leagueVariant: 'devy_dynasty', settings: {} })
    expect([r.rookieDraftOrder, r.rookieDraftRounds, r.rookieDraftType]).toEqual(['reverse_standings', 3, 'snake'])
    expect(h.db.c2CLeagueConfig.findUnique).not.toHaveBeenCalled()
  })
  it('a C2C league reads its C2C config, and "custom" reads as set by the commissioner', async () => {
    const r = await loadDynastyRookieRules(h.db as never, { leagueId: 'L', leagueVariant: 'merged_devy_c2c', settings: {} })
    expect([r.rookieDraftOrder, r.rookieDraftRounds, r.rookieDraftType]).toEqual(['commissioner', 5, 'linear'])
  })
  it('a plain dynasty league is unchanged', async () => {
    h.db.dynastyLeagueConfig.findUnique.mockResolvedValue({ rookiePickOrderMethod: 'max_pf', rookieDraftRounds: 4, rookieDraftType: 'linear' })
    const r = await loadDynastyRookieRules(h.db as never, { leagueId: 'L', leagueVariant: 'dynasty', settings: {} })
    expect([r.rookieDraftOrder, r.rookieDraftRounds]).toEqual(['max_pf', 4])
    expect(h.db.devyLeagueConfig.findUnique).not.toHaveBeenCalled()
  })
  it('the automatic order the engine seats from still wins', async () => {
    const r = await loadDynastyRookieRules(h.db as never, {
      leagueId: 'L', leagueVariant: 'devy_dynasty', settings: { rookie_draft_order: { enabled: true, mode: 'reverse_max_pf' } },
    })
    expect(r.rookieDraftOrder).toBe('auto_reverse_max_pf')
  })
})

describe('the popup reads the consolation order in both languages', () => {
  const row: RulesLeagueRow = {
    platform: 'allfantasy', sport: 'NFL', leagueType: 'dynasty', isDynasty: true, leagueSize: 12, scoring: 'ppr',
    playoffTeams: 6, playoffStartWeek: 15, waiverType: 'faab', waiverBudget: 100, settings: { scoring_mode: 'points' },
  }
  for (const lang of ['en', 'es'] as const) {
    it(lang, () => {
      const t = (k: string) => (lang === 'es' ? translations.es[k] ?? translations.en[k] : translations.en[k]) ?? k
      const text = explainLeagueRules({ ...ruleSnapshotFromLeague(row), rookieDraftOrder: 'consolation', rookieDraftRounds: 3, rookieDraftType: 'snake' })
        .filter((s) => s.id === 'dynasty')
        .flatMap((s) => s.lines.map((l) => renderRuleText(l.text, t, lang)))
        .join('\n')
      expect(text).toMatch(lang === 'en' ? /consolation bracket/ : /cuadro de consolación/)
      expect(text).not.toMatch(/leagueRules\.|\{\{/)
      if (lang === 'es') expect(text.toLowerCase()).not.toContain('waiver')
    })
  }
})

describe('a Devy / C2C config save publishes a "What changed" card', () => {
  beforeEach(() => h.db.league.findUnique.mockResolvedValue({ leagueVariant: 'devy_dynasty', settings: {} }))

  it('with exactly the rookie-draft and taxi rules that moved', async () => {
    const before = await readVariantConfigRules('L')
    h.db.devyLeagueConfig.findUnique.mockResolvedValue({ ...DEVY, rookieDraftRounds: 5 })
    h.taxi.mockResolvedValue({ taxiSlotCount: 6, taxiEligibilityYears: 2, taxiDeadlineWeek: null })
    await publishVariantConfigChange({ leagueId: 'L', actorUserId: 'u1', section: 'devy', before })
    expect(h.publish).toHaveBeenCalledWith({
      leagueId: 'L',
      actorUserId: 'u1',
      section: 'devy',
      changes: expect.arrayContaining([
        { key: 'rookieDraftRounds', before: 3, after: 5 },
        { key: 'taxiSlots', before: 4, after: 6 },
      ]),
    })
    expect(h.publish.mock.calls[0][0].changes).toHaveLength(2)
  })
  it('nothing when no rule moved, and never throws', async () => {
    const before = await readVariantConfigRules('L')
    await publishVariantConfigChange({ leagueId: 'L', actorUserId: 'u1', section: 'devy', before })
    // publishRuleChangesEvent itself skips an empty change list; the call carries none
    expect(h.publish.mock.calls.every(([e]) => e.changes.length === 0)).toBe(true)
    // a league that is gone: no card, no throw
    h.db.league.findUnique.mockResolvedValue(null)
    h.publish.mockClear()
    await publishVariantConfigChange({ leagueId: 'L', actorUserId: 'u1', section: 'devy', before })
    expect(h.publish).not.toHaveBeenCalled()
  })
  it('a failed card never fails the save', async () => {
    const before = await readVariantConfigRules('L')
    h.db.devyLeagueConfig.findUnique.mockResolvedValue({ ...DEVY, rookieDraftRounds: 5 })
    h.publish.mockImplementationOnce(async () => { throw new Error('events down') })
    let err: unknown = null
    try { await publishVariantConfigChange({ leagueId: 'L', actorUserId: 'u1', section: 'devy', before }) } catch (e) { err = e }
    expect(err).toBeNull()
    expect(h.publish).toHaveBeenCalledTimes(1)
  })
})
