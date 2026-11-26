/**
 * Draft-room pick trades grade with THE one grader (2026-11-26).
 *
 * 1. Exact slots: a live draft trades 1.04 for 1.09, so each pick carries `roundPick` and is priced from
 *    the market's own "2026 Pick 1.04" row when the league's chart has it — and EXACTLY as before when it
 *    does not, or when the caller does not set it (every pre-existing caller).
 * 2. The verdict: accept / counter / reject / even come from the grade's own `action`; a withheld grade is
 *    `not_graded`. Never from overall-pick distance — the cases below are chosen so the retired distance
 *    rule would have answered the OPPOSITE way.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

const graderMock = vi.hoisted(() => ({
  create: vi.fn(),
  grade: vi.fn(),
}))
vi.mock('@/lib/decision-os/trade/leagueTradeGrader', () => ({
  createLeagueTradeGrader: (...a: unknown[]) => graderMock.create(...a),
  gradeDeal: async (grader: { grade: (x: unknown) => unknown } | null, args: { give: { assets: unknown[] }; get: { assets: unknown[] }; viewerSide: boolean }) =>
    grader
      ? grader.grade({ give: args.give.assets, get: args.get.assets, viewerSide: args.viewerSide })
      : { graded: false, reason: 'This league’s values could not be loaded just now.', basis: null },
}))

import type { FantasyCalcPlayer } from '@/lib/fantasycalc'
import { livePickValue, priceLeagueTradePick } from '@/lib/trade-value-console/leagueTradePricing'
import { draftPickGradeAsset, pickInRound } from '@/lib/live-draft-engine/draftPickTradeGrade'
import {
  draftPickTradeGraderSource,
  gradeDraftPickSwap,
  reviewDraftPickSwap,
  type DraftPickSwapSession,
} from '@/lib/live-draft-engine/draftPickTradeCanonicalReview'

const row = (name: string, value: number) => ({ player: { name, position: 'PICK' }, value }) as FantasyCalcPlayer
/** A rookie-draft board for the draft being run: slot rows for round 1, round averages for rounds 1–3. */
const SLOTS = [8200, 7100, 6400, 6000, 5300, 4700, 4300, 4000, 3600, 3300, 3100, 2900]
const CHART: FantasyCalcPlayer[] = [
  ...SLOTS.map((v, i) => row(`2026 Pick 1.${String(i + 1).padStart(2, '0')}`, v)),
  row('2026 1st', 4900),
  row('2026 2nd', 1800),
  row('2026 3rd', 900),
]
const ctx = (extra: Record<string, unknown> = {}) => ({
  fcPlayers: CHART,
  nflCtx: { asOfDate: '2026-05-01', isSuperFlex: false, numTeams: 12, fantasyCalcPlayers: CHART, ...extra },
})

describe('priceLeagueTradePick: an exact in-draft slot', () => {
  it('prices 1.04 and 1.09 from their own slot rows', async () => {
    const a = await priceLeagueTradePick({ year: 2026, round: 1, tier: 'early', roundPick: 4 }, ctx() as never)
    const b = await priceLeagueTradePick({ year: 2026, round: 1, tier: 'late', roundPick: 9 }, ctx() as never)
    expect(a.priced.value).toBe(6000)
    expect(b.priced.value).toBe(3600)
    expect(a.dataSource).toBe('fantasycalc_pick_slot')
    expect(a.priced.name).toBe('2026 Pick 1.04')
    expect(a.priced.unpriced).toBeFalsy()
  })

  it('🛑 behaviour-preserving: without roundPick the tier band prices it exactly as before', async () => {
    const before = await priceLeagueTradePick({ year: 2026, round: 1, tier: 'early' }, ctx() as never)
    expect(before.priced.value).toBe(livePickValue(CHART, 2026, 1, 'early'))
    expect(before.priced.value).toBe(Math.round((8200 + 7100 + 6400 + 6000) / 4))
    expect(before.dataSource).toBe('fantasycalc_pick')
  })

  it('a slot the chart has no row for (round 3) falls back to the market round price, never a curve', async () => {
    const withSlot = await priceLeagueTradePick({ year: 2026, round: 3, tier: 'early', roundPick: 2 }, ctx() as never)
    const without = await priceLeagueTradePick({ year: 2026, round: 3, tier: 'early' }, ctx() as never)
    expect(withSlot.priced.value).toBe(900)
    expect(withSlot.priced.value).toBe(without.priced.value)
    expect(withSlot.dataSource).toBe('fantasycalc_pick')
  })

  it('a large league keeps its overall-on-the-12-team-board path; roundPick changes nothing there', async () => {
    const large = ctx({ numTeams: 40, largeLeagueRookiePicks: true })
    const a = await priceLeagueTradePick({ year: 2026, round: 1, tier: 'early', overall: 4, roundPick: 4 }, large as never)
    const b = await priceLeagueTradePick({ year: 2026, round: 1, tier: 'early', overall: 4 }, large as never)
    expect(a.priced.value).toBe(b.priced.value)
    expect(a.dataSource).toBe('fantasycalc_pick_overall_estimate')
  })

  it('no market row for the season: unpriced with a reason (the deal is withheld)', async () => {
    const r = await priceLeagueTradePick({ year: 2031, round: 1, tier: 'early', roundPick: 4 }, ctx() as never)
    expect(r.priced.unpriced).toBe(true)
    expect(r.dataSource).toBe('no_pick_market')
  })
})

describe('draftPickGradeAsset: the exact slot rides along', () => {
  it('round 1 slot 4 is 1.04; in a snake, round 2 slot 1 picks 12th — 2.12', () => {
    expect(pickInRound({ round: 1, overall: 4, teamCount: 12 })).toBe(4)
    expect(pickInRound({ round: 2, overall: 24, teamCount: 12 })).toBe(12)
    expect(pickInRound({ round: 2, overall: 40, teamCount: 12 })).toBeNull()
    expect(draftPickGradeAsset({ season: 2026, round: 2, overall: 24, slot: 1, teamCount: 12 })).toMatchObject({ roundPick: 12, tier: 'late' })
    // A combined draft is priced by its own quote, not a slot row.
    expect(draftPickGradeAsset({ season: 2026, round: 1, overall: 4, slot: 4, teamCount: 12, combined: true })).not.toHaveProperty('roundPick')
  })
})

const ROOKIE: DraftPickSwapSession = {
  teamCount: 12,
  draftType: 'snake',
  thirdRoundReversal: false,
  draftModeLabel: 'rookie',
  playerPool: 'rookies_only',
  startedAt: '2026-05-01T00:00:00.000Z',
}
const view = (action: 'accept' | 'review' | 'counter' | 'decline', letter: string, partner: string, give: number, get: number) => ({
  graded: true,
  letter,
  partnerLetter: partner,
  label: 'label',
  action,
  giveValue: give,
  getValue: get,
  recommendation: `rec-${action}`,
})

beforeEach(() => {
  graderMock.create.mockReset()
  graderMock.grade.mockReset()
  graderMock.create.mockResolvedValue({ grade: graderMock.grade })
})

describe('reviewDraftPickSwap: the verdict is the grade', () => {
  it('hands the grader BOTH picks at their exact slots (1.04 for 1.09)', async () => {
    graderMock.grade.mockResolvedValue(view('accept', 'B', 'D', 3600, 6000))
    await reviewDraftPickSwap(draftPickTradeGraderSource({ leagueId: 'L' }), ROOKIE, { give: { round: 1, slot: 9 }, get: { round: 1, slot: 4 } })
    const arg = graderMock.grade.mock.calls[0][0]
    expect(arg.viewerSide).toBe(false)
    expect(arg.give[0]).toMatchObject({ kind: 'pick', year: 2026, round: 1, roundPick: 9 })
    expect(arg.get[0]).toMatchObject({ kind: 'pick', year: 2026, round: 1, roundPick: 4 })
    // 3.02 in a 12-team snake is overall 26 — the 2nd pick of round 3.
    graderMock.grade.mockClear()
    await reviewDraftPickSwap(draftPickTradeGraderSource({ leagueId: 'L' }), ROOKIE, { give: { round: 3, slot: 2 }, get: { round: 1, slot: 4 } })
    expect(graderMock.grade.mock.calls[0][0].give[0]).toMatchObject({ round: 3, roundPick: 2 })
  })

  it('moving BACK a full round still reads ACCEPT when the grade says accept (the distance rule said reject)', async () => {
    graderMock.grade.mockResolvedValue(view('accept', 'A', 'F', 2000, 4000))
    const { review, tradeGrade } = await reviewDraftPickSwap(draftPickTradeGraderSource({ leagueId: 'L' }), ROOKIE, {
      give: { round: 1, slot: 1 },
      get: { round: 2, slot: 12 },
    })
    expect(review.verdict).toBe('accept')
    expect(review.summary).toBe('rec-accept')
    expect(review.reasons[1]).toBe('League value: you send 2,000 and get 4,000.')
    expect(tradeGrade).toMatchObject({ graded: true, letter: 'A', action: 'accept' })
  })

  it('moving UP reads REJECT when the grade says decline (the distance rule said accept)', async () => {
    graderMock.grade.mockResolvedValue(view('decline', 'F', 'A', 9000, 3000))
    const { review } = await reviewDraftPickSwap(draftPickTradeGraderSource({ leagueId: 'L' }), ROOKIE, {
      give: { round: 1, slot: 9 },
      get: { round: 1, slot: 4 },
    })
    expect(review.verdict).toBe('reject')
    expect(review.declineReasons).toEqual(['rec-decline'])
  })

  it('counter and even (C) map from the grade, with its own recommendation as the counter reason', async () => {
    graderMock.grade.mockResolvedValueOnce(view('counter', 'D', 'B', 5000, 4200))
    graderMock.grade.mockResolvedValueOnce(view('review', 'C', 'C', 5000, 4900))
    const src = draftPickTradeGraderSource({ leagueId: 'L' })
    const a = await reviewDraftPickSwap(src, ROOKIE, { give: { round: 1, slot: 4 }, get: { round: 1, slot: 6 } })
    const b = await reviewDraftPickSwap(src, ROOKIE, { give: { round: 1, slot: 4 }, get: { round: 1, slot: 5 } })
    expect(a.review.verdict).toBe('counter')
    expect(a.review.counterReasons).toEqual(['rec-counter'])
    expect(a.review.suggestedCounterPackage).toBeNull()
    expect(b.review.verdict).toBe('even')
    // One grader for both — the source is lazy and memoised.
    expect(graderMock.create).toHaveBeenCalledTimes(1)
  })

  it('a startup/redraft draft is NOT graded, says why, and never loads the grader', async () => {
    const { review, tradeGrade } = await reviewDraftPickSwap(
      draftPickTradeGraderSource({ leagueId: 'L' }),
      { ...ROOKIE, draftModeLabel: 'startup', playerPool: 'all' },
      { give: { round: 1, slot: 1 }, get: { round: 3, slot: 12 } },
    )
    expect(tradeGrade.graded).toBe(false)
    expect(review.verdict).toBe('not_graded')
    expect(review.summary).toMatch(/Only rookie-draft picks are graded/)
    expect(review.reasons[1]).toBe('You send 1.01 (#1) and get 3.12 (#36) — back 35 picks.')
    expect(graderMock.create).not.toHaveBeenCalled()
  })

  it('a withheld grade (no market row) is not graded, with the grader’s reason', async () => {
    graderMock.grade.mockResolvedValue({ graded: false, reason: 'No market price for a 2026 5th.', basis: null })
    const { review } = await reviewDraftPickSwap(draftPickTradeGraderSource({ leagueId: 'L' }), ROOKIE, {
      give: { round: 5, slot: 1 },
      get: { round: 4, slot: 1 },
    })
    expect(review.verdict).toBe('not_graded')
    expect(review.summary).toBe('No market price for a 2026 5th.')
  })

  it('an unreadable league or a throwing grader is withheld, never a verdict', async () => {
    graderMock.create.mockRejectedValueOnce(new Error('db down'))
    expect(await gradeDraftPickSwap(draftPickTradeGraderSource({ leagueId: 'L' }), ROOKIE, { give: { round: 1, slot: 1 }, get: { round: 1, slot: 2 } }))
      .toEqual({ graded: false, reason: 'This league’s values could not be loaded just now.' })
    graderMock.grade.mockRejectedValueOnce(new Error('boom'))
    expect(await gradeDraftPickSwap(draftPickTradeGraderSource({ leagueId: 'L' }), ROOKIE, { give: { round: 1, slot: 1 }, get: { round: 1, slot: 2 } }))
      .toEqual({ graded: false, reason: 'This trade could not be graded just now.' })
  })
})
