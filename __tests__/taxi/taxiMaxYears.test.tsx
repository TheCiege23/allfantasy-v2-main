/**
 * Max seasons on the taxi squad (lib/taxi/taxiMaxYears.ts): the setting and its default of 2, the
 * count over finished seasons, the season start moving a player whose seasons are used, a lineup
 * save refusing to put one back, the commissioner's setting (any plan), the panel, and Chimmy.
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
    redraftRosterPlayer: { findMany: vi.fn() },
    redraftRosterMoveHistory: { findMany: vi.fn() },
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

import { hasUsedTaxiSeasons, loadTaxiSeasonsUsed, readTaxiMaxYears, storedTaxiMaxYears } from '@/lib/taxi/taxiMaxYears'
import { planRolloverHousekeeping, type HousekeepingPlayer } from '@/lib/redraft/offseason/dynastyRolloverHousekeeping'
import { checkTaxiSave, readTaxiRulesView, saveTaxiRules } from '@/lib/taxi/taxiRulesService'
import { TaxiRulesPanel } from '@/components/league-settings/TaxiRulesPanel'

describe('the setting', () => {
  it('2 seasons unless the commissioner chose otherwise; 0 is no limit', () => {
    expect(readTaxiMaxYears({})).toBe(2)
    expect(readTaxiMaxYears(null)).toBe(2)
    expect(readTaxiMaxYears({ taxi_max_years: 3 })).toBe(3)
    expect(readTaxiMaxYears({ taxi_max_years: 0 })).toBeNull()
    expect(readTaxiMaxYears({ taxi_max_years: 'lots' })).toBe(2)
    expect(storedTaxiMaxYears(null)).toBe(0)
    expect(hasUsedTaxiSeasons(2, 2)).toBe(true)
    expect(hasUsedTaxiSeasons(1, 2)).toBe(false)
    expect(hasUsedTaxiSeasons(9, null)).toBe(false)
  })

  it('counts distinct finished seasons on any team’s taxi squad in this league', async () => {
    const db = { redraftRosterPlayer: { findMany: vi.fn(async () => [
      { playerId: 'a', roster: { seasonId: 's24' } },
      { playerId: 'a', roster: { seasonId: 's25' } },
      { playerId: 'a', roster: { seasonId: 's25' } }, // two rows in one season count once
      { playerId: 'b', roster: { seasonId: 's25' } },
    ]) } }
    expect(await loadTaxiSeasonsUsed(db as never, 'L', ['a', 'b', 'c'])).toEqual(new Map([['a', 2], ['b', 1]]))
    expect(db.redraftRosterPlayer.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { playerId: { in: ['a', 'b', 'c'] }, droppedAt: null, slotType: { in: ['TAXI', 'taxi', 'Taxi'] }, roster: { leagueId: 'L', season: { status: 'complete' } } },
    }))
    expect(await loadTaxiSeasonsUsed(db as never, 'L', [])).toEqual(new Map())
  })
})

describe('the season start', () => {
  const league = { taxiSlots: 3, taxiAllowNonRookies: true, taxiYearsLimit: null } as never
  const p = (id: string): HousekeepingPlayer => ({ id: `row-${id}`, playerId: id, playerName: id, slotType: 'TAXI', injuryStatus: null })
  const roster = { rosterId: 'r1', ownerId: 'u1', teamName: 'Aces', players: [p('used'), p('fresh')] }
  it('moves a player whose seasons are used to the bench, and keeps the rest', () => {
    const plan = planRolloverHousekeeping({ league, rosters: [roster], yearsExpByPlayerId: new Map(), maxRosterSize: 0, taxiMaxYears: 2, taxiSeasonsUsed: new Map([['used', 2], ['fresh', 1]]) })
    expect(plan.moves).toEqual([expect.objectContaining({ playerId: 'used', to: 'bench', reason: 'taxi_max_years' })])
  })
  it('no limit, or no count, moves nobody', () => {
    expect(planRolloverHousekeeping({ league, rosters: [roster], yearsExpByPlayerId: new Map(), maxRosterSize: 0, taxiMaxYears: null, taxiSeasonsUsed: new Map([['used', 9]]) }).moves).toEqual([])
    expect(planRolloverHousekeeping({ league, rosters: [roster], yearsExpByPlayerId: new Map(), maxRosterSize: 0 }).moves).toEqual([])
  })
})

const LEAGUE = { userId: 'owner', platform: 'allfantasy', leagueType: 'dynasty', isDynasty: true, settings: {} }
const TAXI = { taxiDeadlineWeek: null, taxiPromotionDeadlineWeek: null, taxiLockBehavior: 'free_move', taxiInSeasonMoves: true, taxiPostseasonMoves: true }

describe('a lineup save', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.prisma.league.findUnique.mockResolvedValue(LEAGUE)
    m.prisma.redraftRosterPlayer.findMany.mockResolvedValue([
      { playerId: 'used', roster: { seasonId: 's24' } },
      { playerId: 'used', roster: { seasonId: 's25' } },
    ])
    m.taxi.mockResolvedValue(TAXI)
    m.owner.mockResolvedValue(false)
  })
  const save = (afterTaxi: string[]) =>
    checkTaxiSave({ leagueId: 'L', redraftRosterId: 'r1', week: 3, beforeTaxi: [], afterTaxi, afterRoster: afterTaxi, nameOf: (id) => `Player ${id}` })

  it('refuses to put a player whose seasons are used back on taxi — with the move rules off', async () => {
    const check = await save(['used'])
    expect(check.issues).toEqual([{ code: 'TAXI_MAX_YEARS', playerId: 'used', message: "Player used can't go onto the taxi squad: 2 seasons on it is this league's limit, and they are used." }])
  })
  it('a player with seasons left goes on; no limit lets anyone on', async () => {
    m.prisma.redraftRosterPlayer.findMany.mockResolvedValue([{ playerId: 'fresh', roster: { seasonId: 's25' } }])
    expect((await save(['fresh'])).issues).toEqual([])
    m.prisma.league.findUnique.mockResolvedValue({ ...LEAGUE, settings: { taxi_max_years: 0 } })
    m.prisma.redraftRosterPlayer.findMany.mockClear()
    expect((await save(['used'])).issues).toEqual([])
    expect(m.prisma.redraftRosterPlayer.findMany).not.toHaveBeenCalled()
  })
  it('never outside native dynasty leagues', async () => {
    m.prisma.league.findUnique.mockResolvedValue({ ...LEAGUE, platform: 'sleeper' })
    expect((await save(['used'])).issues).toEqual([])
  })
})

describe('the commissioner’s setting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.prisma.league.findUnique.mockResolvedValue(LEAGUE)
    m.prisma.redraftSeason.findFirst.mockResolvedValue(null)
    m.prisma.appUser.findUnique.mockResolvedValue({ id: 'boss' })
    m.taxi.mockResolvedValue(TAXI)
    m.owner.mockResolvedValue(false)
    m.plan.mockReturnValue(false)
    m.patch.mockResolvedValue(new Response('{}', { status: 200 }))
  })
  it('the read carries it, 2 by default', async () => {
    expect(await readTaxiRulesView('L', { userId: 'boss', isCommissioner: true })).toMatchObject({ maxYears: 2, canEdit: false, isCommissioner: true })
  })
  it('any commissioner sets it, on any plan; no limit is stored as 0', async () => {
    expect(await saveTaxiRules('L', 'boss', { maxYears: 3 })).toEqual({ ok: true })
    expect(m.patch).toHaveBeenLastCalledWith('boss', { leagueId: 'L', settingsMerge: { taxi_max_years: 3 } })
    expect(await saveTaxiRules('L', 'boss', { maxYears: null })).toEqual({ ok: true })
    expect(m.patch).toHaveBeenLastCalledWith('boss', { leagueId: 'L', settingsMerge: { taxi_max_years: 0 } })
    m.patch.mockClear()
    expect(await saveTaxiRules('L', 'boss', { maxYears: 2 })).toEqual({ ok: true })
    expect(m.patch).not.toHaveBeenCalled() // already the default
  })
  it('refuses a choice that is not one, and the move rules still need the plan', async () => {
    expect(await saveTaxiRules('L', 'boss', { maxYears: 9 })).toMatchObject({ ok: false, status: 400 })
    expect(await saveTaxiRules('L', 'boss', { maxYears: 3, enforced: true })).toMatchObject({ ok: false, status: 402 })
    expect(m.patch).not.toHaveBeenCalled()
  })
})

describe('the panel', () => {
  const VIEW = {
    applies: true, rules: { lockAfterWeek: null, promotionDeadlineWeek: null, lockBehavior: 'free_move', inSeasonMoves: true, postseasonMoves: true },
    enforced: false, ownerEntitled: false, canEdit: false, isCommissioner: true, maxYears: 2, phase: 'offseason', week: 1,
  }
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
  it('a commissioner without AF Commissioner changes the seasons, and sends only that', async () => {
    const f = stub(VIEW)
    render(<TaxiRulesPanel leagueId="L" />)
    const select = (await screen.findByTestId('taxi-rules-maxYears')) as HTMLSelectElement
    expect(select.value).toBe('2')
    expect(select.disabled).toBe(false)
    fireEvent.change(select, { target: { value: 'none' } })
    fireEvent.click(screen.getByTestId('taxi-rules-save'))
    await waitFor(() => expect(f.mock.calls.some((c) => c[1]?.method === 'PUT')).toBe(true))
    expect(JSON.parse((f.mock.calls.find((c) => c[1]?.method === 'PUT')![1] as { body: string }).body)).toEqual({ maxYears: null })
  })
  it('a member reads it; in Spanish', async () => {
    lang.language = 'es'
    stub({ ...VIEW, isCommissioner: false, maxYears: 3 })
    render(<TaxiRulesPanel leagueId="L" />)
    const select = (await screen.findByTestId('taxi-rules-maxYears')) as HTMLSelectElement
    expect(select.disabled).toBe(true)
    expect(select.selectedOptions[0].textContent).toBe('3 temporadas')
    expect(screen.getByText('Temporadas que un jugador puede pasar en la escuadra taxi')).toBeTruthy()
    expect(screen.queryByTestId('taxi-rules-save')).toBeNull()
  })
})
