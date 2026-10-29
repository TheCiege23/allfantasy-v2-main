/**
 * The payout calculator (lib/payouts): the pot, the weekly-prize set-aside, the place split and each
 * team's take; the league view a member and a commissioner each get; the save; and the card on the
 * standings screen in English and Spanish.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const m = vi.hoisted(() => ({
  membership: vi.fn(),
  role: vi.fn(),
  sides: vi.fn(),
  patch: vi.fn(),
  prisma: {
    league: { findUnique: vi.fn() },
    leagueFinance: { findUnique: vi.fn() },
    redraftSeason: { findFirst: vi.fn() },
    redraftRoster: { findMany: vi.fn(), count: vi.fn() },
    redraftPlayoffBracket: { findUnique: vi.fn() },
    leagueDues: { findMany: vi.fn() },
  },
}))
const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueMembership: m.membership }))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: m.role }))
vi.mock('@/lib/side-contests/sideContestsService', () => ({ readSideContestsView: m.sides }))
vi.mock('@/lib/league/execute-league-settings-patch', () => ({ executeLeagueSettingsPatch: m.patch }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn().mockResolvedValue({ user: { id: 'u1' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))

import {
  EMPTY_PAYOUT_PLAN,
  calculatePayouts,
  parsePayoutPlanInput,
  readPayoutPlan,
  splitByPercent,
  type PayoutInput,
} from '@/lib/payouts/payoutCalculator'
import { currentOrder, readFinalOrder, readPayoutOvercommitment, readPayoutsView } from '@/lib/payouts/payoutService'
import { PUT } from '@/app/api/leagues/[leagueId]/payouts/handler'
import { PayoutsCard } from '@/components/league/native/screens/PayoutsCard'

const input = (over: Partial<PayoutInput> = {}): PayoutInput => ({
  plan: { buyInCents: 10_000, placePercents: [60, 30, 10] },
  entryFeeCents: 0,
  teamCount: 10,
  weeklyPrizeCentsPerWeek: 2_000,
  regularSeasonWeeks: 14,
  weeklyPrizesWon: [{ rosterId: 'A', prizeCents: 6_000 }, { rosterId: 'D', prizeCents: 2_000 }],
  order: [{ rosterId: 'A', place: 1 }, { rosterId: 'B', place: 2 }, { rosterId: 'C', place: 3 }, { rosterId: 'D', place: 4 }],
  final: true,
  ...over,
})

describe('the arithmetic', () => {
  it('pot, weekly prizes set aside first, then the places split what is left', () => {
    const r = calculatePayouts(input())
    expect(r.potCents).toBe(100_000)
    expect(r.weeklyReserveCents).toBe(28_000)
    expect(r.placePoolCents).toBe(72_000)
    expect(r.places.map((p) => [p.place, p.cents, p.rosterId])).toEqual([[1, 43_200, 'A'], [2, 21_600, 'B'], [3, 7_200, 'C']])
    expect(r.unassignedPercent).toBe(0)
    expect(r.overCommittedCents).toBe(0)
  })

  it('each team: its place money plus the weekly prizes it has won, richest first', () => {
    const r = calculatePayouts(input())
    expect(r.teams.map((t) => [t.rosterId, t.placeCents, t.weeklyCents, t.totalCents])).toEqual([
      ['A', 43_200, 6_000, 49_200],
      ['B', 21_600, 0, 21_600],
      ['C', 7_200, 0, 7_200],
      ['D', 0, 2_000, 2_000],
    ])
  })

  it('the places always add up to the pool exactly; a rounding cent goes to first', () => {
    expect(splitByPercent(1_001, [50, 30, 20])).toEqual([501, 300, 200])
    expect(splitByPercent(1_001, [50, 30, 20]).reduce((a, b) => a + b, 0)).toBe(1_001)
    expect(splitByPercent(999, [34, 33, 33])).toEqual([341, 329, 329])
    // Less than 100% assigned: only that share is split, the rest is reported as unassigned.
    const r = calculatePayouts(input({ plan: { buyInCents: 10_000, placePercents: [50, 30] }, weeklyPrizeCentsPerWeek: 0 }))
    expect(r.unassignedPercent).toBe(20)
    expect(r.unassignedCents).toBe(20_000)
  })

  it('without a buy-in in the plan, the league entry fee is used', () => {
    expect(calculatePayouts(input({ plan: { buyInCents: null, placePercents: [100] }, entryFeeCents: 2_500 })).potCents).toBe(25_000)
  })

  it('weekly prizes bigger than the pot: the places get nothing and the shortfall is reported', () => {
    const r = calculatePayouts(input({ plan: { buyInCents: 1_000, placePercents: [100] }, weeklyPrizeCentsPerWeek: 2_000 }))
    expect(r.potCents).toBe(10_000)
    expect(r.weeklyReserveCents).toBe(10_000)
    expect(r.placePoolCents).toBe(0)
    expect(r.overCommittedCents).toBe(18_000)
  })

  it('a place nobody holds yet pays nobody', () => {
    const r = calculatePayouts(input({ order: [{ rosterId: 'A', place: 1 }] }))
    expect(r.places[1].rosterId).toBeNull()
  })
})

describe('the plan', () => {
  it('a save is validated and refused with the reason, never trimmed', () => {
    expect(parsePayoutPlanInput({ buyIn: '100', placePercents: [60, 30, 10] })).toEqual({ ok: true, value: { buyInCents: 10_000, placePercents: [60, 30, 10] } })
    expect(parsePayoutPlanInput({ buyIn: '$12.50', placePercents: ['70', '30'] })).toEqual({ ok: true, value: { buyInCents: 1_250, placePercents: [70, 30] } })
    expect(parsePayoutPlanInput({ buyIn: '', placePercents: [] })).toEqual({ ok: true, value: { buyInCents: null, placePercents: [] } })
    expect(parsePayoutPlanInput({ placePercents: [60, 50] })).toEqual({ ok: false, error: 'The places add up to 110%; they can add up to 100% at most.' })
    expect(parsePayoutPlanInput({ placePercents: [50.5] }).ok).toBe(false)
    expect(parsePayoutPlanInput({ buyIn: 'ten' }).ok).toBe(false)
    expect(parsePayoutPlanInput({ buyIn: '20000' }).ok).toBe(false)
    expect(parsePayoutPlanInput({ placePercents: Array(11).fill(1) }).ok).toBe(false)
    expect(parsePayoutPlanInput({ secretKey: 1 })).toEqual({ ok: false, error: 'Unknown field: secretKey.' })
  })

  it('a stored plan that is malformed reads as no split', () => {
    expect(readPayoutPlan({ payout_plan: { buyInCents: 5_000, placePercents: [80, 30] } })).toEqual({ buyInCents: 5_000, placePercents: [] })
    expect(readPayoutPlan({ payout_plan: 'x' })).toEqual(EMPTY_PAYOUT_PLAN)
    expect(readPayoutPlan(null)).toEqual(EMPTY_PAYOUT_PLAN)
  })

  it('saves through the settings patch, under the money scope key', async () => {
    m.patch.mockResolvedValue(new Response('{}'))
    const req = new Request('http://x', { method: 'PUT', body: JSON.stringify({ buyIn: '50', placePercents: [100] }) }) as never
    await PUT(req, { params: { leagueId: 'L' } })
    expect(m.patch).toHaveBeenCalledWith('u1', { leagueId: 'L', settingsMerge: { payout_plan: { buyInCents: 5_000, placePercents: [100] } } })
    m.patch.mockClear()
    const bad = await PUT(new Request('http://x', { method: 'PUT', body: JSON.stringify({ placePercents: [101] }) }) as never, { params: { leagueId: 'L' } })
    expect(bad.status).toBe(400)
    expect(m.patch).not.toHaveBeenCalled()
  })
})

describe('the finishing order', () => {
  it('final once the bracket is complete; a rotisserie league reads its stored result', () => {
    expect(readFinalOrder({ bracket: { status: 'complete', structure: { finalStandings: [{ finish: 2, rosterId: 'B' }, { finish: 1, rosterId: 'A' }] } }, settings: {}, season: 2026 }))
      .toEqual([{ rosterId: 'B', place: 2 }, { rosterId: 'A', place: 1 }])
    expect(readFinalOrder({ bracket: { status: 'active', structure: { finalStandings: [{ finish: 1, rosterId: 'A' }] } }, settings: {}, season: 2026 })).toBeNull()
    expect(readFinalOrder({ bracket: null, settings: { roto_season_results: { 2026: { finalStandings: [{ rosterId: 'R', rank: 1 }] } } }, season: 2026 }))
      .toEqual([{ rosterId: 'R', place: 1 }])
    expect(readFinalOrder({ bracket: null, settings: {}, season: 2026 })).toBeNull()
  })

  it('before that, the standings order', () => {
    expect(currentOrder([{ id: 'C', playoffSeed: 3 }, { id: 'A', playoffSeed: 1 }, { id: 'X', playoffSeed: null }, { id: 'B', playoffSeed: 2 }]))
      .toEqual([{ rosterId: 'A', place: 1 }, { rosterId: 'B', place: 2 }, { rosterId: 'C', place: 3 }])
  })
})

describe('the league view', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.membership.mockResolvedValue({ ok: true })
    m.role.mockResolvedValue('member')
    m.prisma.league.findUnique.mockResolvedValue({
      platform: 'allfantasy',
      settings: { payout_plan: { buyInCents: null, placePercents: [70, 30] }, weekly_prize_contests: { high_score: { enabled: true, prizeCents: 1_000 } } },
    })
    m.prisma.leagueFinance.findUnique.mockResolvedValue({ entryFeeCents: 5_000 })
    m.prisma.redraftSeason.findFirst.mockResolvedValue({ id: 's1', season: 2026, playoffStartWeek: 15, totalWeeks: 17 })
    m.prisma.redraftRoster.findMany.mockResolvedValue([
      { id: 'A', teamName: 'Aces', ownerName: 'a', playoffSeed: 2 },
      { id: 'B', teamName: null, ownerName: 'Bea', playoffSeed: 1 },
      { id: 'C', teamName: 'Cats', ownerName: 'c', playoffSeed: 3 },
      { id: 'D', teamName: 'Dogs', ownerName: 'd', playoffSeed: 4 },
    ])
    m.prisma.redraftPlayoffBracket.findUnique.mockResolvedValue(null)
    m.prisma.leagueDues.findMany.mockResolvedValue([{ amountPaidCents: 5_000, status: 'paid' }, { amountPaidCents: 0, status: 'pending' }])
    m.sides.mockResolvedValue({ ok: true, native: true, totals: [{ rosterId: 'C', prizeCents: 2_000 }] })
  })

  it('a member: pot from the entry fee, 14 weeks of prizes set aside, places by current standings — no dues', async () => {
    const v = await readPayoutsView('L', 'u1')
    if (!v.ok) throw new Error('expected ok')
    expect(v.result!.potCents).toBe(20_000)
    expect(v.result!.weeklyReserveCents).toBe(14_000)
    expect(v.result!.places.map((p) => [p.cents, p.rosterId])).toEqual([[4_200, 'B'], [1_800, 'A']])
    expect(v.result!.final).toBe(false)
    expect(v.result!.names.B).toBe('Bea')
    expect(v.collected).toBeNull()
    expect(m.prisma.leagueDues.findMany).not.toHaveBeenCalled()
  })

  it('a commissioner also sees how much of the buy-in is collected', async () => {
    m.role.mockResolvedValue('commissioner')
    const v = await readPayoutsView('L', 'u1')
    expect(v.ok && v.collected).toEqual({ cents: 5_000, paidTeams: 1 })
  })

  it('the final standings decide once the season is complete', async () => {
    m.prisma.redraftPlayoffBracket.findUnique.mockResolvedValue({ status: 'complete', structure: { finalStandings: [{ finish: 1, rosterId: 'D' }, { finish: 2, rosterId: 'C' }] } })
    const v = await readPayoutsView('L', 'u1')
    if (!v.ok) throw new Error('expected ok')
    expect(v.result!.final).toBe(true)
    expect(v.result!.places.map((p) => p.rosterId)).toEqual(['D', 'C'])
    expect(v.result!.teams.find((t) => t.rosterId === 'C')!.totalCents).toBe(1_800 + 2_000)
  })

  it('not a member: refused; not a league AllFantasy runs: nothing to calculate', async () => {
    m.membership.mockResolvedValueOnce({ ok: false, status: 403 })
    expect(await readPayoutsView('L', 'u1')).toEqual({ ok: false, status: 403 })
    m.prisma.league.findUnique.mockResolvedValueOnce({ platform: 'sleeper', settings: {} })
    const v = await readPayoutsView('L', 'u1')
    expect(v.ok && v.native).toBe(false)
    expect(m.prisma.redraftSeason.findFirst).not.toHaveBeenCalled()
  })

  it('the workspace check: weekly prizes past the pot', async () => {
    m.prisma.redraftRoster.count.mockResolvedValue(4)
    m.prisma.league.findUnique.mockResolvedValue({
      platform: 'allfantasy',
      settings: { payout_plan: { buyInCents: 2_000, placePercents: [100] }, weekly_prize_contests: { high_score: { enabled: true, prizeCents: 1_000 } } },
    })
    expect(await readPayoutOvercommitment('L')).toEqual({ potCents: 8_000, overCommittedCents: 6_000, season: 2026 })
    m.prisma.league.findUnique.mockResolvedValue({ platform: 'allfantasy', settings: { weekly_prize_contests: { high_score: { enabled: true, prizeCents: 1_000 } } } })
    expect(await readPayoutOvercommitment('L')).toBeNull()
  })
})

describe('the card', () => {
  const VIEW = {
    native: true,
    canEdit: false,
    plan: { buyInCents: 10_000, placePercents: [70, 30] },
    entryFeeCents: 0,
    suggestedPercents: [70, 30],
    season: 2026,
    teamCount: 4,
    collected: null,
    result: {
      buyInCents: 10_000, potCents: 40_000, weeklyReserveCents: 10_000, placePoolCents: 30_000, unassignedPercent: 0, unassignedCents: 0,
      places: [{ place: 1, percent: 70, cents: 21_000, rosterId: 'A' }, { place: 2, percent: 30, cents: 9_000, rosterId: 'B' }],
      teams: [
        { rosterId: 'A', place: 1, placeCents: 21_000, weeklyCents: 2_000, totalCents: 23_000 },
        { rosterId: 'B', place: 2, placeCents: 9_000, weeklyCents: 0, totalCents: 9_000 },
      ],
      final: false, overCommittedCents: 0, names: { A: 'Aces', B: 'Bees' },
    },
  }
  const stub = (v: unknown) => {
    const f = vi.fn(async () => ({ ok: true, json: async () => v }))
    vi.stubGlobal('fetch', f)
    return f
  }
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    lang.language = 'en'
  })

  it('shows the pot, the places and each team', async () => {
    stub(VIEW)
    render(<PayoutsCard leagueId="L" />)
    expect((await screen.findByTestId('payouts-summary')).textContent).toContain('$100 × 4 = $400')
    expect(screen.getByTestId('payouts-place-1').textContent).toBe('1st · 70% · $210 · Aces')
    expect(screen.getByText('If the season ended today')).toBeTruthy()
    expect(screen.getByTestId('payouts-teams').textContent).toContain('$230 ($210 place + $20 weekly)')
    expect(screen.getByText(/does not collect or pay it/)).toBeTruthy()
  })

  it('hidden from members until the commissioner sets a split', async () => {
    stub({ ...VIEW, plan: { buyInCents: null, placePercents: [] }, result: null })
    const { container } = render(<PayoutsCard leagueId="L" />)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('the commissioner sets it up, starting from a common split', async () => {
    const f = stub({ ...VIEW, canEdit: true, plan: { buyInCents: null, placePercents: [] }, result: null, suggestedPercents: [60, 30, 10] })
    render(<PayoutsCard leagueId="L" />)
    fireEvent.click(await screen.findByText('Set up'))
    expect((screen.getByTestId('payouts-percent-3') as HTMLInputElement).value).toBe('10')
    fireEvent.change(screen.getByTestId('payouts-buy-in'), { target: { value: '25' } })
    fireEvent.change(screen.getByTestId('payouts-percent-1'), { target: { value: '70' } })
    expect(screen.getByTestId('payouts-draft-total').textContent).toBe('Total 110% of the place pool — more than 100%')
    fireEvent.click(screen.getByTestId('payouts-remove-3'))
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(f).toHaveBeenCalledWith('/api/leagues/L/payouts', expect.objectContaining({ method: 'PUT' })))
    const put = f.mock.calls.find((c) => (c as unknown[])[1] && ((c as unknown[])[1] as { method?: string }).method === 'PUT') as unknown as [string, { body: string }]
    expect(JSON.parse(put[1].body)).toEqual({ buyIn: '25', placePercents: [70, 30] })
  })

  it('a commissioner is warned when the weekly prizes outrun the pot, and sees collected dues', async () => {
    stub({ ...VIEW, canEdit: true, collected: { cents: 20_000, paidTeams: 2 }, result: { ...VIEW.result, overCommittedCents: 5_000 } })
    render(<PayoutsCard leagueId="L" />)
    expect((await screen.findByTestId('payouts-overcommitted')).textContent).toBe('The weekly prizes promise $50 more than the pot holds.')
    expect(screen.getByTestId('payouts-collected').textContent).toContain('$200 · 2 of 4 paid')
  })

  it('in Spanish, with no English left', async () => {
    lang.language = 'es'
    stub({ ...VIEW, result: { ...VIEW.result, final: true } })
    const { container } = render(<PayoutsCard leagueId="L" />)
    expect((await screen.findByTestId('payouts-place-1')).textContent).toBe('1.º · 70% · $210 · Aces')
    expect(screen.getByText('Pagos')).toBeTruthy()
    expect(screen.getByText('Final')).toBeTruthy()
    expect(screen.getByTestId('payouts-teams').textContent).toContain('($210 puesto + $20 semanal)')
    expect(container.textContent).not.toMatch(/\b(Pot|Payouts|place|weekly|tracks|collect)\b/)
  })
})
