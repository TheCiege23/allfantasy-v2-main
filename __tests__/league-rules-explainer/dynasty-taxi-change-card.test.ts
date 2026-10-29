/**
 * The taxi squad's "What changed" card from the dynasty settings save
 * (app/api/leagues/[leagueId]/dynasty-settings/handler.ts): slot count, eligibility years and the
 * taxi deadline, read from the effective settings so the Devy / C2C override is respected.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  leagueUpdate: vi.fn(),
  dynastyFindUnique: vi.fn(),
  upsert: vi.fn(),
  taxi: vi.fn(),
  publish: vi.fn(async () => undefined),
}))
vi.mock('@/lib/league-rules-explainer/publishRuleChanges', () => ({ publishRuleChangesEvent: m.publish }))
vi.mock('@/lib/taxi/TaxiSettingsService', () => ({ getEffectiveTaxiSettings: m.taxi }))
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
import { groupSettingsChanges } from '@/lib/league-rules-explainer/explain'
import { renderChangeLine } from '@/lib/league-rules-explainer/render'
import { translations } from '@/lib/i18n/translations'
import type { RuleChange } from '@/lib/league-rules-explainer/types'

const ctx = { params: Promise.resolve({ leagueId: 'L1' }) }
const put = (body: unknown) =>
  PUT(new Request('http://x/api/leagues/L1/dynasty-settings', { method: 'PUT', body: JSON.stringify(body) }) as any, ctx)
const taxi = (taxiSlotCount: number, taxiEligibilityYears = 2, taxiDeadlineWeek: number | null = 6) => ({
  taxiSlotCount, taxiEligibilityYears, taxiDeadlineWeek,
  taxiLockBehavior: 'once_promoted_no_return', taxiInSeasonMoves: true, taxiPostseasonMoves: false, taxiScoringOn: false, taxiPromotionDeadlineWeek: null,
})
const published = (): RuleChange[] => (m.publish.mock.calls.at(-1) as unknown as [{ changes: RuleChange[] }])[0].changes
const card = (changes: RuleChange[], lang: 'en' | 'es') => {
  const [group] = groupSettingsChanges([{ id: 'e1', createdAt: '2026-10-29T12:00:00.000Z', actorUserId: 'commish', changes }], { sport: 'NFL' })
  return group!.lines.map((l) => renderChangeLine(l, (k) => translations[lang][k] ?? k, lang)).join(' ')
}

beforeEach(() => {
  vi.clearAllMocks()
  m.leagueFindUnique.mockResolvedValue({ id: 'L1', sport: 'NFL', isDynasty: true, leagueVariant: null, settings: {} })
  m.leagueUpdate.mockResolvedValue({})
  m.dynastyFindUnique.mockResolvedValue({ taxiSlots: 4 })
  m.upsert.mockResolvedValue({ leagueId: 'L1' })
})

describe('the dynasty settings save publishes taxi squad changes', () => {
  it('a bigger taxi squad gets a card, in English and Spanish', async () => {
    m.taxi.mockResolvedValueOnce(taxi(4)).mockResolvedValueOnce(taxi(6))
    expect((await put({ taxiSlots: 6 })).status).toBe(200)
    expect(m.upsert).toHaveBeenCalledWith('L1', { taxiSlots: 6 })
    const changes = published()
    expect(changes).toEqual([{ key: 'taxiSlots', before: 4, after: 6 }])
    expect(card(changes, 'en')).toContain('the taxi squad holds 2 more players.')
    expect(card(changes, 'es')).toContain('la escuadra taxi guarda 2 jugadores más.')
  })

  it('eligibility years and the deadline week are on the same card', async () => {
    m.taxi.mockResolvedValueOnce(taxi(4, 2, 6)).mockResolvedValueOnce(taxi(3, 3, 9))
    await put({ taxiSlots: 3, taxiEligibilityYears: 3, taxiDeadlineWeek: 9 })
    expect(published()).toHaveLength(3)
    expect(published()).toEqual(expect.arrayContaining([
      { key: 'taxiSlots', before: 4, after: 3 },
      { key: 'taxiEligibilityYears', before: 2, after: 3 },
      { key: 'taxiDeadlineWeek', before: 6, after: 9 },
    ]))
  })

  it('no card when the effective squad did not move (a Devy league keeps its own slot count)', async () => {
    m.taxi.mockResolvedValue(taxi(6))
    await put({ taxiSlots: 8 })
    expect(published()).toEqual([])
  })

  it('a save without a taxi field reads nothing extra', async () => {
    await put({ rookieDraftRounds: 5 })
    expect(m.taxi).not.toHaveBeenCalled()
    expect(published().some((c) => c.key.startsWith('taxi'))).toBe(false)
  })

  it('a failed taxi read never fails the save, and publishes no taxi line', async () => {
    m.taxi.mockRejectedValue(new Error('db down'))
    expect((await put({ taxiSlots: 6 })).status).toBe(200)
    expect(published()).toEqual([])
  })
})
