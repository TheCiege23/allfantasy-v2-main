import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The AF Legacy analyzer's counter suggestions: each counter shows THE grade of the deal it leaves,
 * and "Apply & Simulate" shows THE grade of the applied counter (`/api/engine/trade/simulate-counter`
 * → `evaluateTrade`). No "Est. Accept", no "Fairness", no second engine's verdict.
 */

const mockSession = vi.hoisted(() => vi.fn())
const mockMember = vi.hoisted(() => vi.fn())
const mockResolveLeague = vi.hoisted(() => vi.fn())
const mockEvaluate = vi.hoisted(() => vi.fn())
const mockRunTradeAnalysis = vi.hoisted(() => vi.fn())

vi.mock('next-auth', () => ({ getServerSession: mockSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: mockMember }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => ({ success: true })), getClientIp: vi.fn(() => '127.0.0.1') }))
vi.mock('@/lib/decision-os/trade/evaluationLeague', async () => {
  const actual = await vi.importActual<typeof import('@/lib/decision-os/trade/evaluationLeague')>('@/lib/decision-os/trade/evaluationLeague')
  return { ...actual, resolveEvaluationLeagueId: mockResolveLeague }
})
vi.mock('@/lib/decision-os/trade/evaluateTrade', () => ({ evaluateTrade: mockEvaluate }))
vi.mock('@/lib/engine/trade', () => ({ runTradeAnalysis: mockRunTradeAnalysis }))

import { POST } from '@/app/api/engine/trade/simulate-counter/route'
import TradeCounterSuggestions from '@/components/TradeCounterSuggestions'
import { NOT_YOUR_LEAGUE_REASON } from '@/lib/decision-os/trade/evaluationLeague'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import {
  appliedCounterInputs,
  COUNTER_WITHOUT_ASSET_REASON,
  gradeLegacyCounters,
  type LegacyPackageGrade,
} from '@/lib/legacy/legacyPackageGrade'

const GRADED: LegacyPackageGrade = {
  graded: true,
  letter: 'B',
  partnerLetter: 'D',
  label: 'Slightly favors you',
  recommendation: 'Worth sending.',
  giveValue: 5000,
  getValue: 5600,
  basis: 'Dynasty · 12 teams · PPR',
}
const VIEW = { ...GRADED, percentDiff: 11, sideAdvantage: 'you', action: 'accept', giveMarket: 5000, getMarket: 5600, scoringApplied: true, needApplied: false, needGap: null, lines: [], moves: [] } as unknown as TradeGradeView

const BASE = {
  give: { assets: [{ kind: 'player' as const, name: 'Josh Allen' }], unpriceable: [] },
  get: { assets: [{ kind: 'player' as const, name: 'Puka Nacua' }], unpriceable: [] },
}

describe('appliedCounterInputs / gradeLegacyCounters — the counter’s deal, graded once, by the one grader', () => {
  it('the applied deal is the original plus the FIRST add (to what you give) and the FIRST ask (to what you get)', () => {
    expect(appliedCounterInputs(BASE, { addToGive: { id: '1', name: 'Bench RB' }, addToGet: { id: '2', name: 'Their WR' } })).toEqual({
      give: { assets: [{ kind: 'player', name: 'Josh Allen' }, { kind: 'player', name: 'Bench RB' }], unpriceable: [] },
      get: { assets: [{ kind: 'player', name: 'Puka Nacua' }, { kind: 'player', name: 'Their WR' }], unpriceable: [] },
    })
  })

  it('grades each counter’s deal and drops the second engine’s acceptProb and fairnessScore', async () => {
    const gradeOf = vi.fn(async () => GRADED)
    const out = await gradeLegacyCounters(
      [
        { label: 'Accept Boost (Top 3)', changes: [{ addToB: 'x' }], acceptProb: 0.71, fairnessScore: 64, whyTheyAccept: ['a'], whyItHelpsYou: ['b'], options: { addCandidates: [{ id: '1', name: 'Bench RB' }, { id: '9', name: 'Other' }] } },
        { label: 'Partner Rebuild Angle', changes: [], acceptProb: 0.5, fairnessScore: 50, whyTheyAccept: [], whyItHelpsYou: [] },
      ],
      BASE,
      gradeOf,
    )
    expect(gradeOf).toHaveBeenCalledTimes(1)
    expect(gradeOf).toHaveBeenCalledWith(
      { assets: [{ kind: 'player', name: 'Josh Allen' }, { kind: 'player', name: 'Bench RB' }], unpriceable: [] },
      BASE.get,
    )
    expect(out[0]!.grade).toEqual(GRADED)
    expect(out[1]!.grade).toEqual({ graded: false, reason: COUNTER_WITHOUT_ASSET_REASON })
    for (const c of out) {
      expect(c).not.toHaveProperty('acceptProb')
      expect(c).not.toHaveProperty('fairnessScore')
    }
  })

  it('a grader that rejects costs that counter its grade, never the list', async () => {
    const out = await gradeLegacyCounters([{ options: { askCandidates: [{ id: '2', name: 'Their WR' }] } }], BASE, async () => { throw new Error('x') })
    expect(out[0]!.grade.graded).toBe(false)
  })
})

function post(body: unknown) {
  return POST(new NextRequest('http://localhost/api/engine/trade/simulate-counter', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

// Exactly what the counter card posts.
const CARD_BODY = {
  originalRequest: {
    sport: 'NFL',
    leagueId: 'sleeper-league-1',
    numTeams: 12,
    assetsA: [{ type: 'player', player: { id: '9493', name: 'Puka Nacua', pos: 'WR' } }],
    assetsB: [{ type: 'player', player: { id: '4984', name: 'Josh Allen', pos: 'QB' } }, { type: 'pick', pick: { year: 2027, round: 1, pickNumber: 11 } }],
  },
  appliedCounter: { addToGive: { id: '1', name: 'Bench RB', pos: 'RB' } },
}

describe('/api/engine/trade/simulate-counter — the applied counter is graded by the one engine', () => {
  beforeEach(() => {
    for (const m of [mockSession, mockMember, mockResolveLeague, mockEvaluate, mockRunTradeAnalysis]) m.mockReset()
    mockSession.mockResolvedValue({ user: { id: 'af-user-1' } })
    mockMember.mockResolvedValue({ ok: false, status: 404 })
    mockResolveLeague.mockResolvedValue('af-league-1')
    mockEvaluate.mockResolvedValue({ grade: VIEW, receiptId: 'r-1' })
  })

  it('reads the card’s { originalRequest, appliedCounter } body (it 400’d before) and grades the applied deal', async () => {
    const res = await post(CARD_BODY)
    expect(res.status).toBe(200)
    const input = mockEvaluate.mock.calls[0]![0]
    expect(input).toMatchObject({ surface: 'legacy-counter-simulate', leagueId: 'af-league-1', userId: 'af-user-1', viewerSide: false })
    // Team A receives assetsA and sends assetsB, plus the applied sweetener. pickNumber 11 of 12 → "late".
    expect(input.give).toEqual({
      assets: [{ kind: 'player', name: 'Josh Allen' }, { kind: 'pick', year: 2027, round: 1, tier: 'late' }, { kind: 'player', name: 'Bench RB' }],
      unpriceable: [],
    })
    expect(input.get).toEqual({ assets: [{ kind: 'player', name: 'Puka Nacua' }], unpriceable: [] })
    const data = await res.json()
    expect(data).toEqual({ ok: true, grade: GRADED, evaluationReceiptId: 'r-1' })
    expect(mockRunTradeAnalysis).not.toHaveBeenCalled()
  })

  it('a Sleeper league id is proven through resolveEvaluationLeagueId; one that is not theirs is WITHHELD, not refused', async () => {
    mockResolveLeague.mockResolvedValue(null)
    const res = await post(CARD_BODY)
    expect(res.status).toBe(200)
    expect(mockEvaluate.mock.calls[0]![0].leagueId).toBeNull()
    const deps = mockEvaluate.mock.calls[0]![1]
    expect(await deps.grade()).toEqual({ graded: false, reason: NOT_YOUR_LEAGUE_REASON, basis: null })
  })

  it('an AllFantasy league they are not in is still a 403, and nothing is graded', async () => {
    mockMember.mockResolvedValue({ ok: false, status: 403 })
    const res = await post(CARD_BODY)
    expect(res.status).toBe(403)
    expect(mockEvaluate).not.toHaveBeenCalled()
  })

  it('still requires a session', async () => {
    mockSession.mockResolvedValue(null)
    expect((await post(CARD_BODY)).status).toBe(401)
  })
})

describe('TradeCounterSuggestions — the card prints the one grade, never acceptance or fairness', () => {
  const counters = [
    { label: 'Accept Boost (Top 3)', changes: [], acceptProb: 0.71, fairnessScore: 64, options: { addCandidates: [{ id: '1', name: 'Bench RB', pos: 'RB' }] }, grade: GRADED },
    { label: 'Partner Rebuild Angle', changes: [], grade: { graded: false as const, reason: COUNTER_WITHOUT_ASSET_REASON } },
  ] as any

  it('shows each counter’s letter, and no Est. Accept or Fairness', () => {
    render(<TradeCounterSuggestions counters={counters} onAddCandidateToGive={() => {}} onAddCandidateToGet={() => {}} />)
    expect(screen.getByText('B')).toBeTruthy()
    expect(screen.getByText('Slightly favors you')).toBeTruthy()
    expect(screen.queryByText(/Est\. Accept/)).toBeNull()
    expect(screen.queryByText(/Fairness/)).toBeNull()
    expect(screen.queryByText(/71%|64/)).toBeNull()
  })

  it('Apply & Simulate posts the card body and shows the grade the route returns', async () => {
    const fetchMock = vi.fn(async () => ({ json: async () => ({ ok: true, grade: { ...GRADED, letter: 'C', label: 'Even' } }) }))
    vi.stubGlobal('fetch', fetchMock)
    render(<TradeCounterSuggestions counters={counters} engineRequest={CARD_BODY.originalRequest} onAddCandidateToGive={() => {}} onAddCandidateToGet={() => {}} />)
    fireEvent.click(screen.getByText('Apply Sweetener'))
    await waitFor(() => expect(screen.getByText('Trade grade with the counter applied')).toBeTruthy())
    expect(screen.getByText('Even')).toBeTruthy()
    const sent = JSON.parse((fetchMock.mock.calls[0] as any)[1].body)
    expect(sent).toEqual({ originalRequest: CARD_BODY.originalRequest, appliedCounter: { addToGive: { id: '1', name: 'Bench RB', pos: 'RB' } } })
    vi.unstubAllGlobals()
  })
})
