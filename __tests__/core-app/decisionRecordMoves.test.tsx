/**
 * The decision record's "your moves" section (2026-10-02): your trades as net points since each one
 * and your waiver adds as what they scored while yours — from the Receipts resolvers, beside (never
 * inside) the Chimmy and AutoCoach advice totals.
 */
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/components/core-app/career/CareerAskChimmy', () => ({ askChimmyAboutCareer: vi.fn() }))

import { DecisionRecordCard } from '@/components/core-app/career/DecisionRecordCard'
import { buildDecisionRecord } from '@/lib/core-app/decisionRecordModel'
import type { StartCallReceipt, TradeReceipt, WaiverReceipt } from '@/lib/core-app/decisionReceipts'

const trade = (net: number, outcome: TradeReceipt['outcome'], over: Partial<TradeReceipt> = {}): TradeReceipt => ({
  id: `t${net}`,
  leagueId: 'L1',
  leagueName: 'Alpha',
  season: '2026',
  week: 2,
  createdIso: '2026-09-10T00:00:00Z',
  counterparty: 'Rival',
  got: ['Puka Nacua', 'a 2027 2nd', 'Jaylen Warren'],
  gave: ['Davante Adams'],
  gotPoints: 50 + net,
  gavePoints: 50,
  netPoints: net,
  outcome,
  ongoing: true,
  unsettledPicks: 0,
  href: '/core/trades?league=L1',
  ...over,
})
const waiver = (points: number, starts: number, over: Partial<WaiverReceipt> = {}): WaiverReceipt => ({
  id: `w${points}`,
  leagueId: 'L1',
  leagueName: 'Alpha',
  season: 2026,
  week: 2,
  playerId: '9221',
  playerName: 'Waiver Hero',
  position: 'WR',
  via: 'waiver',
  faab: 7,
  points,
  starts,
  weeksScored: 3,
  leftWeek: null,
  href: '/core/waivers?league=L1',
  ...over,
})
const call: StartCallReceipt = {
  id: 'L1:2026:2:a:b',
  leagueId: 'L1',
  leagueName: 'Alpha',
  season: 2026,
  week: 2,
  slot: 'FLEX',
  recommended: { name: 'Rec', points: 20 },
  instead: { name: 'Alt', points: 10 },
  followed: 'yes',
  call: 'right',
  href: '#',
}

describe('buildDecisionRecord — your moves', () => {
  it('sums called trades by outcome and net points, and names the one that paid most', () => {
    const r = buildDecisionRecord({
      chimmy: [],
      autocoach: [],
      adds: [],
      trades: { receipts: [trade(30.4, 'ahead'), trade(-12.1, 'behind'), trade(1.2, 'even'), trade(8, 'ahead')], tooEarly: 2 },
    })!
    expect(r.trades).toEqual({
      called: 4,
      ahead: 2,
      behind: 1,
      even: 1,
      netPoints: 27.5,
      tooEarly: 2,
      best: expect.objectContaining({ netPoints: 30.4 }),
    })
  })

  it('🛑 moves never enter the advice totals — a trade is not a call Chimmy made', () => {
    const r = buildDecisionRecord({
      chimmy: [call],
      autocoach: [],
      adds: [],
      trades: { receipts: [trade(30, 'ahead')], tooEarly: 0 },
      waivers: { receipts: [waiver(40, 3)], tooEarly: 0, unscored: 0 },
    })!
    expect(r.calls.total).toBe(1)
    expect(r.followed).toEqual({ count: 1, netPoints: 10 })
    expect(r.adds).toEqual({ advised: 0, added: 0, points: 0 })
  })

  it('sums waiver points and starts; a 0-point add is never the best one', () => {
    const r = buildDecisionRecord({
      chimmy: [],
      autocoach: [],
      adds: [],
      waivers: { receipts: [waiver(0, 0), waiver(41.25, 2), waiver(12, 1)], tooEarly: 1, unscored: 2 },
    })!
    expect(r.waivers).toEqual({
      scored: 3,
      points: 53.3,
      starts: 3,
      tooEarly: 1,
      unscored: 2,
      best: expect.objectContaining({ points: 41.25 }),
    })
  })

  it('a record with ONLY moves exists — and one with nothing at all is still null', () => {
    expect(buildDecisionRecord({ chimmy: [], autocoach: [], adds: [], trades: { receipts: [], tooEarly: 1 } })).not.toBeNull()
    expect(
      buildDecisionRecord({
        chimmy: [],
        autocoach: [],
        adds: [],
        trades: { receipts: [], tooEarly: 0 },
        waivers: { receipts: [], tooEarly: 0, unscored: 0 },
      }),
    ).toBeNull()
  })

  it('a section that was not read is null, not zero', () => {
    const r = buildDecisionRecord({ chimmy: [call], autocoach: [], adds: [] })!
    expect(r.trades).toBeNull()
    expect(r.waivers).toBeNull()
  })
})

describe('DecisionRecordCard — your moves', () => {
  it('renders both rows, the best of each, and says the coverage', () => {
    const r = buildDecisionRecord({
      chimmy: [call],
      autocoach: [],
      adds: [],
      trades: { receipts: [trade(30.4, 'ahead'), trade(-12.1, 'behind')], tooEarly: 1 },
      waivers: { receipts: [waiver(41.25, 2)], tooEarly: 0, unscored: 1 },
    })!
    render(<DecisionRecordCard record={{ ...r, season: 2026 }} />)
    expect(screen.getByText('Your moves')).toBeTruthy()
    const text = document.body.textContent ?? ''
    expect(text).toContain('2 trades · 1 ahead, 1 behind, 0 even · +18.3 pts net')
    expect(text).toContain('1 trade too early to call')
    expect(text).toContain('got Puka Nacua, a 2027 2nd +1 · Alpha · +30.4')
    expect(text).toContain('1 add · 41.3 pts on your roster · 2 starts')
    expect(text).toContain('1 not scored yet')
    expect(text).toContain('Waiver Hero · Alpha, week 2 · 41.3 pts')
    expect(text).toContain('Sleeper leagues only for now')
  })

  it('no moves read → no section, and the footer stays as it was', () => {
    const r = buildDecisionRecord({ chimmy: [call], autocoach: [], adds: [] })!
    render(<DecisionRecordCard record={{ ...r, season: 2026 }} />)
    expect(screen.queryByText('Your moves')).toBeNull()
    expect(document.body.textContent).not.toContain('Sleeper leagues only')
  })
})
