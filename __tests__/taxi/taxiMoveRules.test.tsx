/**
 * The taxi squad's move rules (lib/taxi/taxiMoveRules.ts) and where they are enforced
 * (lib/taxi/taxiRulesService.ts): the lock week, the promotion deadline, "once promoted cannot
 * return", the in-season / playoff switches, the opt-in switch and the AF Commissioner gate, the
 * promotion log, Chimmy's line, and the settings panel in English and Spanish.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const m = vi.hoisted(() => ({
  taxi: vi.fn(),
  owner: vi.fn(),
  plan: vi.fn(),
  patch: vi.fn(),
  upsert: vi.fn(),
  prisma: {
    league: { findUnique: vi.fn() },
    redraftSeason: { findFirst: vi.fn() },
    redraftRoster: { findUnique: vi.fn() },
    redraftRosterMoveHistory: { findMany: vi.fn(), create: vi.fn() },
    // Max seasons on taxi (taxiMaxYears.test.tsx) counts finished seasons; nobody has used any here.
    redraftRosterPlayer: { findMany: vi.fn(async () => []) },
    appUser: { findUnique: vi.fn() },
  },
}))
const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))

vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/taxi/TaxiSettingsService', () => ({ getEffectiveTaxiSettings: m.taxi }))
vi.mock('@/lib/stat-corrections/applyStatCorrections', () => ({ ownerHasAfCommissionerPlan: m.owner }))
vi.mock('@/lib/entitlements/afCommissionerPlan', () => ({ hasAfCommissionerPlan: m.plan }))
vi.mock('@/lib/league/execute-league-settings-patch', () => ({ executeLeagueSettingsPatch: m.patch }))
vi.mock('@/lib/dynasty-core/DynastySettingsService', () => ({ upsertDynastyConfig: m.upsert }))
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations } = await import('@/lib/i18n/translations')
  return { useOptionalLanguage: () => ({ language: lang.language, t: (k: string) => translations[lang.language][k] ?? translations.en[k] ?? k }) }
})

import {
  describeTaxiMoveRules,
  diffTaxiSquad,
  taxiMoveIssues,
  taxiSeasonPhase,
  type TaxiMoveRules,
} from '@/lib/taxi/taxiMoveRules'
import { checkTaxiSave, logTaxiPromotions, readTaxiRulesView, saveTaxiRules } from '@/lib/taxi/taxiRulesService'
import { TaxiRulesPanel } from '@/components/league-settings/TaxiRulesPanel'

const RULES: TaxiMoveRules = { lockAfterWeek: 6, promotionDeadlineWeek: 10, lockBehavior: 'once_promoted_no_return', inSeasonMoves: true, postseasonMoves: false }
const names: Record<string, string> = { a: 'Ace Rookie', b: 'Bo Prospect' }
const nameOf = (id: string) => names[id] ?? id
const issues = (over: Partial<Parameters<typeof taxiMoveIssues>[0]>) =>
  taxiMoveIssues({ rules: RULES, phase: 'regular', week: 4, arrivals: [], promotions: [], promotedBefore: new Set(), nameOf, ...over }).map((i) => i.code)

describe('the rules', () => {
  it('who a save moves onto and off the taxi squad; a dropped taxi player is not a promotion', () => {
    expect(diffTaxiSquad({ beforeTaxi: ['a', 'b', 'x'], afterTaxi: ['b', 'c'], afterRoster: ['a', 'b', 'c'] })).toEqual({ arrivals: ['c'], promotions: ['a'] })
  })

  it('the phase comes from the season being played', () => {
    expect(taxiSeasonPhase(null, 3)).toBe('offseason')
    expect(taxiSeasonPhase({ status: 'setup', playoffStartWeek: 15 }, 1)).toBe('offseason')
    expect(taxiSeasonPhase({ status: 'active', playoffStartWeek: 15 }, 14)).toBe('regular')
    expect(taxiSeasonPhase({ status: 'active', playoffStartWeek: 15 }, 15)).toBe('playoffs')
  })

  it('the lock week: onto the taxi squad through week N, not after', () => {
    expect(issues({ week: 6, arrivals: ['a'] })).toEqual([])
    expect(issues({ week: 7, arrivals: ['a'] })).toEqual(['TAXI_DEADLINE_PASSED'])
    expect(taxiMoveIssues({ rules: RULES, phase: 'regular', week: 7, arrivals: ['a'], promotions: [], promotedBefore: new Set(), nameOf })[0].message).toBe(
      "Ace Rookie can't go onto the taxi squad: it locked after week 6.",
    )
  })

  it('the promotion deadline: off the taxi squad through week N, not after', () => {
    expect(issues({ week: 10, promotions: ['a'] })).toEqual([])
    expect(issues({ week: 11, promotions: ['a'] })).toEqual(['TAXI_PROMOTION_CLOSED'])
  })

  it('once promoted, a player cannot go back — in season or out; "free move" allows it', () => {
    expect(issues({ week: 2, arrivals: ['a'], promotedBefore: new Set(['a']) })).toEqual(['TAXI_NO_RETURN'])
    expect(issues({ phase: 'offseason', arrivals: ['a'], promotedBefore: new Set(['a']) })).toEqual(['TAXI_NO_RETURN'])
    expect(taxiMoveIssues({ rules: { ...RULES, lockBehavior: 'free_move' }, phase: 'regular', week: 2, arrivals: ['a'], promotions: [], promotedBefore: new Set(['a']), nameOf })).toEqual([])
  })

  it('the in-season and playoff switches stop every taxi move in that phase', () => {
    expect(issues({ week: 16, phase: 'playoffs', arrivals: ['a'], promotions: ['b'] })).toEqual(['TAXI_POSTSEASON_LOCKED', 'TAXI_POSTSEASON_LOCKED'])
    expect(taxiMoveIssues({ rules: { ...RULES, inSeasonMoves: false }, phase: 'regular', week: 2, arrivals: [], promotions: ['b'], promotedBefore: new Set(), nameOf }).map((i) => i.code)).toEqual(['TAXI_IN_SEASON_LOCKED'])
    expect(taxiMoveIssues({ rules: { ...RULES, postseasonMoves: true }, phase: 'playoffs', week: 16, arrivals: [], promotions: ['b'], promotedBefore: new Set(), nameOf }).map((i) => i.code)).toEqual(['TAXI_PROMOTION_CLOSED'])
  })

  it('the offseason is always open to the calendar rules', () => {
    expect(issues({ phase: 'offseason', week: 20, arrivals: ['a'], promotions: ['b'] })).toEqual([])
  })

  it('Chimmy is told what is enforced', () => {
    expect(describeTaxiMoveRules(RULES)).toBe(
      'Taxi squad rules (enforced on every lineup save): no player goes onto the taxi squad after week 6; no player comes off it after week 10; a player promoted off it cannot go back; no taxi moves in the playoffs. The offseason is always open.',
    )
  })
})

const LEAGUE = { userId: 'owner', platform: 'allfantasy', leagueType: 'dynasty', isDynasty: true, settings: { taxi_rules_enforced: true } }
const TAXI = { taxiDeadlineWeek: 6, taxiPromotionDeadlineWeek: 10, taxiLockBehavior: 'once_promoted_no_return', taxiInSeasonMoves: true, taxiPostseasonMoves: false }

describe('the save check', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.prisma.league.findUnique.mockResolvedValue(LEAGUE)
    m.prisma.redraftSeason.findFirst.mockResolvedValue({ id: 's1', season: 2026, status: 'active', currentWeek: 8, playoffStartWeek: 15 })
    m.prisma.redraftRoster.findUnique.mockResolvedValue({ ownerId: 'u1' })
    m.prisma.redraftRosterMoveHistory.findMany.mockResolvedValue([{ metadata: { playerIds: ['b'] } }])
    m.taxi.mockResolvedValue(TAXI)
    m.owner.mockResolvedValue(true)
  })
  const save = (over: Partial<Parameters<typeof checkTaxiSave>[0]> = {}) =>
    checkTaxiSave({ leagueId: 'L', redraftRosterId: 'r1', week: 8, beforeTaxi: ['a'], afterTaxi: ['b'], afterRoster: ['a', 'b'], nameOf, ...over })

  it('refuses what the rules refuse, and returns the promotion to log', async () => {
    const check = await save()
    // b was promoted before (cannot return); a's promotion is within the deadline.
    expect(check.issues.map((i) => i.code)).toEqual(['TAXI_NO_RETURN'])
    expect(check.promotions).toEqual(['a'])
    expect(m.prisma.redraftRosterMoveHistory.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: 'L', moveSummary: 'taxi_promotion', roster: { ownerId: 'u1' } } }))
  })

  it('nothing is enforced unless the commissioner switched it on and the owner holds AF Commissioner', async () => {
    m.prisma.league.findUnique.mockResolvedValue({ ...LEAGUE, settings: {} })
    expect((await save({ week: 12 })).issues).toEqual([])
    m.prisma.league.findUnique.mockResolvedValue(LEAGUE)
    m.owner.mockResolvedValue(false)
    expect((await save({ week: 12 })).issues).toEqual([])
    m.owner.mockResolvedValue(true)
    expect((await save({ week: 12 })).issues.map((i) => i.code)).toEqual(['TAXI_NO_RETURN', 'TAXI_PROMOTION_CLOSED'])
  })

  it('never outside native dynasty leagues; a save that moves nobody reads nothing', async () => {
    m.prisma.league.findUnique.mockResolvedValue({ ...LEAGUE, platform: 'sleeper' })
    expect((await save({ week: 12 })).issues).toEqual([])
    m.prisma.league.findUnique.mockResolvedValue({ ...LEAGUE, isDynasty: false, leagueType: 'redraft' })
    expect((await save({ week: 12 })).issues).toEqual([])
    m.prisma.league.findUnique.mockClear()
    expect(await save({ beforeTaxi: ['a'], afterTaxi: ['a'] })).toMatchObject({ issues: [], promotions: [] })
    expect(m.prisma.league.findUnique).not.toHaveBeenCalled()
  })

  it('a promotion that answers a taxi steal claim skips the promotion windows, and is still logged', async () => {
    // Week 12 is past the promotion deadline: a's promotion is refused unless it protects a claim.
    expect((await save({ week: 12 })).issues.map((i) => i.code)).toEqual(['TAXI_NO_RETURN', 'TAXI_PROMOTION_CLOSED'])
    const check = await save({ week: 12, protectedPromotions: ['a'] })
    expect(check.issues.map((i) => i.code)).toEqual(['TAXI_NO_RETURN'])
    expect(check.promotions).toEqual(['a'])
    // It only covers promotions: naming the arriving player does not lift "cannot return".
    expect((await save({ week: 12, protectedPromotions: ['a', 'b'] })).issues.map((i) => i.code)).toEqual(['TAXI_NO_RETURN'])
  })

  it('the promotion log is one move-history row, inside the save', async () => {
    const tx = { redraftRosterMoveHistory: { create: vi.fn() } }
    await logTaxiPromotions(tx as never, { leagueId: 'L', redraftRosterId: 'r1', week: 8, actorUserId: 'u1', check: await save({ afterTaxi: [] }) })
    expect(tx.redraftRosterMoveHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ leagueId: 'L', rosterId: 'r1', seasonId: 's1', season: 2026, week: 8, moveSummary: 'taxi_promotion', metadata: { playerIds: ['a'] } }),
    })
    const none = { redraftRosterMoveHistory: { create: vi.fn() } }
    await logTaxiPromotions(none as never, { leagueId: 'L', redraftRosterId: 'r1', week: 8, actorUserId: 'u1', check: { issues: [], promotions: [], seasonId: null, season: null } })
    expect(none.redraftRosterMoveHistory.create).not.toHaveBeenCalled()
  })
})

describe('the settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.prisma.league.findUnique.mockResolvedValue({ ...LEAGUE, settings: {} })
    m.prisma.redraftSeason.findFirst.mockResolvedValue({ id: 's1', season: 2026, status: 'active', currentWeek: 8, playoffStartWeek: 15 })
    m.prisma.appUser.findUnique.mockResolvedValue({ id: 'boss' })
    m.taxi.mockResolvedValue(TAXI)
    m.owner.mockResolvedValue(true)
    m.plan.mockReturnValue(true)
    m.patch.mockResolvedValue(new Response('{}', { status: 200 }))
  })

  it('the read: rules, the switch, the phase and who may edit', async () => {
    expect(await readTaxiRulesView('L', { userId: 'boss', isCommissioner: true })).toEqual({
      applies: true, rules: RULES, enforced: false, ownerEntitled: true, canEdit: true, isCommissioner: true, maxYears: 2, phase: 'regular', week: 8,
    })
    expect(await readTaxiRulesView('L', { userId: 'm', isCommissioner: false })).toMatchObject({ canEdit: false })
    m.prisma.league.findUnique.mockResolvedValue({ ...LEAGUE, isDynasty: false, leagueType: 'redraft' })
    expect(await readTaxiRulesView('L', { userId: 'boss', isCommissioner: true })).toEqual({ applies: false })
  })

  it('the save: rules to the dynasty config, the switch through the settings patch', async () => {
    expect(await saveTaxiRules('L', 'boss', { enforced: true, lockAfterWeek: '7', promotionDeadlineWeek: null, lockBehavior: 'free_move', postseasonMoves: true })).toEqual({ ok: true })
    expect(m.upsert).toHaveBeenCalledWith('L', { taxiDeadlineWeek: 7, taxiPromotionDeadlineWeek: null, taxiLockBehavior: 'free_move', taxiPostseasonMoves: true })
    expect(m.patch).toHaveBeenCalledWith('boss', { leagueId: 'L', settingsMerge: { taxi_rules_enforced: true } })
  })

  it('refused without AF Commissioner, and refuses a week that is not a week', async () => {
    m.plan.mockReturnValue(false)
    expect(await saveTaxiRules('L', 'boss', { enforced: true })).toMatchObject({ ok: false, status: 402 })
    m.plan.mockReturnValue(true)
    expect(await saveTaxiRules('L', 'boss', { lockAfterWeek: 0 })).toMatchObject({ ok: false, status: 400 })
    expect(await saveTaxiRules('L', 'boss', { lockAfterWeek: 2.5 })).toMatchObject({ ok: false, status: 400 })
    expect(await saveTaxiRules('L', 'boss', { lockBehavior: 'whatever' })).toMatchObject({ ok: false, status: 400 })
    expect(m.upsert).not.toHaveBeenCalled()
    expect(m.patch).not.toHaveBeenCalled()
  })
})

describe('the settings panel', () => {
  const VIEW = { applies: true, rules: RULES, enforced: false, ownerEntitled: true, canEdit: true, isCommissioner: true, maxYears: 2, phase: 'regular', week: 8 }
  const stub = (view: unknown) => {
    const f = vi.fn(async (_u: string, init?: { method?: string }) => ({ ok: true, json: async () => (init?.method === 'PUT' ? { ok: true } : view) }))
    vi.stubGlobal('fetch', f)
    return f
  }
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    lang.language = 'en'
  })

  it('shows the rules and saves them', async () => {
    const f = stub(VIEW)
    render(<TaxiRulesPanel leagueId="L" />)
    expect((await screen.findByTestId('taxi-rules-status')).textContent).toBe('Not enforced')
    expect((screen.getByTestId('taxi-rules-lockAfterWeek') as HTMLInputElement).value).toBe('6')
    fireEvent.change(screen.getByTestId('taxi-rules-lockAfterWeek'), { target: { value: '9' } })
    fireEvent.click(screen.getByRole('switch', { name: /^Enforce these rules/ }))
    fireEvent.click(screen.getByTestId('taxi-rules-save'))
    await waitFor(() => expect(f).toHaveBeenCalledWith('/api/leagues/L/taxi-rules', expect.objectContaining({ method: 'PUT' })))
    const body = JSON.parse((f.mock.calls.find((c) => c[1]?.method === 'PUT')![1] as { body: string }).body)
    expect(body).toEqual({ maxYears: 2, enforced: true, lockAfterWeek: '9', promotionDeadlineWeek: '10', lockBehavior: 'once_promoted_no_return', inSeasonMoves: true, postseasonMoves: false })
  })

  it('a member reads the rules; a commissioner without the plan is offered it', async () => {
    stub({ ...VIEW, canEdit: false, isCommissioner: false, enforced: true })
    render(<TaxiRulesPanel leagueId="L" />)
    expect((await screen.findByTestId('taxi-rules-status')).textContent).toBe('Enforced')
    expect(screen.queryByTestId('taxi-rules-save')).toBeNull()
    expect((screen.getByTestId('taxi-rules-lockAfterWeek') as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByTestId('taxi-rules-upgrade')).toBeNull()
    cleanup()
    stub({ ...VIEW, canEdit: false })
    render(<TaxiRulesPanel leagueId="L" />)
    expect(await screen.findByTestId('taxi-rules-upgrade')).toBeTruthy()
  })

  it('nothing outside the leagues it applies to; in Spanish', async () => {
    stub({ applies: false })
    const { container } = render(<TaxiRulesPanel leagueId="L" />)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
    cleanup()
    lang.language = 'es'
    stub({ ...VIEW, enforced: true, ownerEntitled: false })
    render(<TaxiRulesPanel leagueId="L" />)
    expect((await screen.findByTestId('taxi-rules-status')).textContent).toBe('En pausa: AF Commissioner venció')
    expect(screen.getByText('Reglas de la escuadra taxi')).toBeTruthy()
  })
})
