/**
 * How many seasons ahead a dynasty league's picks can be traded (`DynastyLeagueConfig.futurePicksYearsOut`),
 * set on the commissioner settings Draft Pick Settings tab. The trade engine already offered native picks
 * over it (lib/league-trade-engine/nativeFuturePicks.ts); it had no control, no popup line and no card.
 *
 *   - the popup states it, beside pick trading, only for a dynasty league playing on AllFantasy
 *   - the dynasty settings save publishes a "What changed" card for it, in English and Spanish
 *   - the save refuses anything the engine would clamp (outside 1-5, or not a whole number)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  leagueUpdate: vi.fn(),
  dynastyFindUnique: vi.fn(),
  upsert: vi.fn(),
  publish: vi.fn(async () => undefined),
}))
vi.mock('@/lib/league-rules-explainer/publishRuleChanges', () => ({ publishRuleChangesEvent: m.publish }))
vi.mock('@/lib/taxi/TaxiSettingsService', () => ({ getEffectiveTaxiSettings: vi.fn(async () => null) }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'commish' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: vi.fn(async () => true) }))
vi.mock('@/lib/commissioner/permissions', () => ({ isCommissioner: vi.fn(async () => true) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: m.leagueFindUnique, update: m.leagueUpdate },
    dynastyLeagueConfig: { findUnique: m.dynastyFindUnique },
  },
}))
vi.mock('@/lib/dynasty-core/DynastySettingsService', () => ({
  getEffectiveDynastySettings: vi.fn(),
  getDynastyRosterPresets: vi.fn(() => []),
  getDynastyScoringPresets: vi.fn(() => []),
  getDynastyPlayoffPresets: vi.fn(() => []),
  upsertDynastyConfig: m.upsert,
  getDraftOrderAuditLog: vi.fn(async () => []),
  ROOKIE_PICK_ORDER_METHODS: [],
}))
vi.mock('@/lib/draft-lottery/dynastyYearGuard', () => ({ checkDynastyLotteryEligibility: vi.fn() }))
vi.mock('@/lib/draft-lottery/lotteryConfigStorage', () => ({
  getDraftOrderModeAndLotteryConfig: vi.fn(),
  setDraftOrderModeAndLotteryConfig: vi.fn(),
}))

import { PUT } from '@/app/api/leagues/[leagueId]/dynasty-settings/handler'
import { explainLeagueRules, explainRuleChange, groupSettingsChanges } from '@/lib/league-rules-explainer/explain'
import { renderChangeLine, renderRuleText } from '@/lib/league-rules-explainer/render'
import { dynastyRulesFromConfig, ruleSnapshotFromLeague, type RulesLeagueRow } from '@/lib/league-rules-explainer/snapshot'
import { translations } from '@/lib/i18n/translations'
import type { RuleChange } from '@/lib/league-rules-explainer/types'

const t = (lang: 'en' | 'es') => (k: string) => (lang === 'es' ? translations.es[k] ?? translations.en[k] : translations.en[k]) ?? k
const ctx = { params: Promise.resolve({ leagueId: 'L1' }) }
const put = (body: unknown) =>
  PUT(new Request('http://x/api/leagues/L1/dynasty-settings', { method: 'PUT', body: JSON.stringify(body) }) as any, ctx)
const published = (): RuleChange[] => (m.publish.mock.calls.at(-1) as unknown as [{ changes: RuleChange[] }])[0].changes
const card = (changes: RuleChange[], lang: 'en' | 'es') => {
  const [group] = groupSettingsChanges([{ id: 'e1', createdAt: '2026-10-31T12:00:00.000Z', actorUserId: 'commish', changes }], { sport: 'NFL' })
  return group!.lines.map((l) => renderChangeLine(l, (k) => translations[lang][k] ?? k, lang)).join(' ')
}

const dynasty: RulesLeagueRow = {
  platform: 'allfantasy',
  sport: 'NFL',
  leagueType: 'dynasty',
  isDynasty: true,
  leagueSize: 12,
  draftPickTrading: true,
  settings: {},
}
const tradeLines = (snapshot: ReturnType<typeof ruleSnapshotFromLeague>, lang: 'en' | 'es') =>
  explainLeagueRules(snapshot).flatMap((s) => s.lines).map((l) => renderRuleText(l.text, t(lang), lang))

beforeEach(() => {
  vi.clearAllMocks()
  m.leagueFindUnique.mockResolvedValue({ id: 'L1', sport: 'NFL', isDynasty: true, leagueVariant: null, settings: {} })
  m.leagueUpdate.mockResolvedValue({})
  m.dynastyFindUnique.mockResolvedValue({ futurePicksYearsOut: 3 })
  m.upsert.mockImplementation(async (_id: string, p: Record<string, unknown>) => ({ leagueId: 'L1', futurePicksYearsOut: 3, ...p }))
})

describe('the rules popup states the pick-trade horizon', () => {
  it('reads the dynasty config the trade engine reads, clamped the same way', () => {
    expect(dynastyRulesFromConfig({ futurePicksYearsOut: 5 }).pickTradeYears).toBe(5)
    expect(dynastyRulesFromConfig({ futurePicksYearsOut: 9 }).pickTradeYears).toBe(5)
    expect(dynastyRulesFromConfig(null).pickTradeYears).toBe(3)
  })

  it('beside pick trading, in English and Spanish', () => {
    const snap = { ...ruleSnapshotFromLeague(dynasty), pickTradeYears: 4 }
    expect(tradeLines(snap, 'en')).toContain('Picks can be traded up to 4 seasons ahead.')
    expect(tradeLines(snap, 'es')).toContain('Las selecciones se pueden intercambiar hasta con 4 temporadas de antelación.')
    expect(tradeLines({ ...snap, pickTradeYears: 1 }, 'en')).toContain('Picks can be traded 1 season ahead.')
  })

  it('says nothing when pick trading is off, or the horizon is unknown (an import)', () => {
    const off = { ...ruleSnapshotFromLeague({ ...dynasty, draftPickTrading: false }), pickTradeYears: 4 }
    expect(tradeLines(off, 'en').join(' ')).not.toContain('seasons ahead')
    expect(tradeLines(ruleSnapshotFromLeague(dynasty), 'en').join(' ')).not.toContain('seasons ahead')
  })

  it('a change reads as the new horizon', () => {
    const c = explainRuleChange({ key: 'pickTradeYears', before: 3, after: 5 })!
    expect(renderChangeLine(c, t('en'), 'en')).toBe('Seasons of tradeable picks: 3 seasons → 5 seasons — Picks can be traded up to 5 seasons ahead.')
    expect(renderChangeLine(c, t('es'), 'es').toLowerCase()).not.toContain('waiver')
  })
})

describe('the dynasty settings save', () => {
  it('stores the horizon and publishes a card', async () => {
    expect((await put({ futurePicksYearsOut: 5 })).status).toBe(200)
    expect(m.upsert).toHaveBeenCalledWith('L1', { futurePicksYearsOut: 5 })
    const changes = published()
    expect(changes).toEqual([{ key: 'pickTradeYears', before: 3, after: 5 }])
    expect(card(changes, 'en')).toContain('Picks can be traded up to 5 seasons ahead.')
    expect(card(changes, 'es')).toContain('hasta con 5 temporadas de antelación')
  })

  it('an unchanged horizon publishes nothing about it', async () => {
    expect((await put({ futurePicksYearsOut: 3 })).status).toBe(200)
    expect(published()).toEqual([])
  })

  it.each([0, 6, 2.5, '4', true, -1])('refuses %j without saving', async (v) => {
    const res = await put({ futurePicksYearsOut: v })
    expect(res.status).toBe(400)
    expect(m.upsert).not.toHaveBeenCalled()
    expect(m.publish).not.toHaveBeenCalled()
  })
})
