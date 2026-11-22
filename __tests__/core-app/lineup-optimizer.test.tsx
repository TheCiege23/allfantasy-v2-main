/**
 * The whole-lineup optimizer (lib/core-app/lineupOptimizer.ts). The case that justifies it: the bench
 * check would offer one bench WR at two slots and the gains would add up to more than the week holds.
 */
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core/my-team',
  useSearchParams: () => new URLSearchParams(),
}))

import { optimizeLineup } from '@/lib/decision-os/lineup/bestLineup'
import { MyTeam } from '@/components/core-app/screens/MyTeam'
import type { LineupPlayer, LineupSlot, MyTeamData } from '@/lib/core-app/myTeam'

const NOW = new Date('2026-11-08T17:00:00Z')
const LATER = new Date('2026-11-08T21:25:00Z')
const EARLIER = new Date('2026-11-08T13:00:00Z')

function player(id: string, position: string, proj: number | null, extra: Partial<LineupPlayer> = {}): LineupPlayer {
  return {
    sleeperId: id,
    name: id,
    position,
    team: null,
    sport: 'NFL',
    imageUrl: null,
    gameContext: null,
    kickoff: LATER,
    preseason: false,
    venue: null,
    injuryStatus: null,
    ruledOut: false,
    afProjectedPoints: proj,
    indoors: null,
    market: null,
    weather: null,
    onBye: false,
    projectedPoints: proj,
    ...extra,
  }
}

function slot(label: string, p: LineupPlayer | null): LineupSlot {
  return { slotLabel: label, benchCheck: null, player: p, empty: p == null, unresolvedId: null }
}

describe('optimizeLineup', () => {
  it('counts a bench player once, where pairwise bench checks would count him twice', () => {
    const starters = [slot('WR', player('wr-start', 'WR', 10)), slot('FLEX', player('rb-flex', 'RB', 9))]
    const bench = [player('wr-bench', 'WR', 20), player('rb-bench', 'RB', 12)]
    const r = optimizeLineup({ starters, bench, sport: 'NFL', now: NOW })
    expect(r?.state).toBe('improve')
    if (r?.state !== 'improve') return
    // Best is WR 20 + RB 12 = 32 against 19 now: +13, not the +21 two independent swaps would claim.
    expect(r.currentTotal).toBe(19)
    expect(r.bestTotal).toBe(32)
    expect(r.gain).toBe(13)
    const ins = r.changes.map((c) => c.inName)
    expect(new Set(ins).size).toBe(ins.length)
    expect(ins.sort()).toEqual(['rb-bench', 'wr-bench'])
    expect(r.verdict).toBe('swap')
  })

  it('keeps a starter who stays in his own seat instead of shuffling him', () => {
    const starters = [slot('RB', player('rb1', 'RB', 15)), slot('FLEX', player('wr-flex', 'WR', 6))]
    const bench = [player('rb2', 'RB', 11)]
    const r = optimizeLineup({ starters, bench, sport: 'NFL', now: NOW })
    expect(r?.state).toBe('improve')
    if (r?.state !== 'improve') return
    expect(r.changes).toEqual([
      expect.objectContaining({ slotIndex: 1, slotLabel: 'FLEX', outName: 'wr-flex', inName: 'rb2' }),
    ])
  })

  it('leaves a starter whose game has kicked off exactly where he is', () => {
    const starters = [slot('WR', player('wr-locked', 'WR', 3, { kickoff: EARLIER })), slot('FLEX', player('rb', 'RB', 8))]
    const bench = [player('wr-bench', 'WR', 14)]
    const r = optimizeLineup({ starters, bench, sport: 'NFL', now: NOW })
    expect(r?.state).toBe('improve')
    if (r?.state !== 'improve') return
    expect(r.lockedSeats).toBe(1)
    expect(r.changes.map((c) => c.slotLabel)).toEqual(['FLEX'])
    expect(r.changes[0].outName).toBe('rb')
  })

  it('refuses when an open starter has no projection — null is not zero', () => {
    const starters = [slot('WR', player('wr-unpriced', 'WR', null)), slot('RB', player('rb', 'RB', 8))]
    expect(optimizeLineup({ starters, bench: [player('wr-bench', 'WR', 14)], sport: 'NFL', now: NOW })).toBeNull()
  })

  it('scores a starter on bye at zero and fills his seat', () => {
    const starters = [slot('WR', player('wr-bye', 'WR', 12, { onBye: true }))]
    const r = optimizeLineup({ starters, bench: [player('wr-bench', 'WR', 7)], sport: 'NFL', now: NOW })
    expect(r?.state).toBe('improve')
    if (r?.state !== 'improve') return
    expect(r.gain).toBe(7)
    expect(r.verdict).toBe('swap')
  })

  it('fills an empty seat and says so', () => {
    const r = optimizeLineup({ starters: [slot('TE', null)], bench: [player('te', 'TE', 4)], sport: 'NFL', now: NOW })
    expect(r?.state).toBe('improve')
    if (r?.state !== 'improve') return
    expect(r.changes[0]).toEqual(expect.objectContaining({ outName: null, inName: 'te' }))
  })

  it('reports an already-best lineup, and a sub-2-point gain as close', () => {
    const optimal = optimizeLineup({ starters: [slot('QB', player('qb', 'QB', 20))], bench: [player('qb2', 'QB', 15)], sport: 'NFL', now: NOW })
    expect(optimal).toEqual({ state: 'optimal', currentTotal: 20, lockedSeats: 0 })
    const close = optimizeLineup({ starters: [slot('QB', player('qb', 'QB', 20))], bench: [player('qb2', 'QB', 21)], sport: 'NFL', now: NOW })
    expect(close?.state === 'improve' && close.verdict).toBe('close')
  })

  it('never answers for best ball, where the platform sets the lineup', () => {
    expect(optimizeLineup({ starters: [slot('WR', player('a', 'WR', 1))], bench: [player('b', 'WR', 9)], bestBall: true, now: NOW })).toBeNull()
  })
})

function screen(starters: LineupSlot[], optimizer: MyTeamData['lineupOptimizer'], over: Partial<MyTeamData> = {}): MyTeamData {
  return {
    league: { id: 'l1', name: 'Its gonna be Maye 26', platform: 'sleeper', format: 'redraft', sourceLink: { href: 'https://example.test/lineup', label: 'Sleeper' } },
    team: { available: false, reason: 'n/a' },
    starters: { available: true, data: starters },
    lineupOptimizer: optimizer,
    bench: { available: false, reason: 'none' },
    ir: { available: false, reason: 'none' },
    taxi: { available: false, reason: 'none' },
    lock: { available: false, reason: 'n/a' },
    projections: { available: false, reason: 'n/a' },
    projectionBasis: { notes: [], scoringKnown: false },
    nextMatchup: { available: false, reason: 'n/a' },
    upcomingByes: [],
    rosterGrade: { available: false, reason: 'n/a' },
    liveScore: { available: false, reason: 'n/a' },
    ...over,
  } as unknown as MyTeamData
}

describe('the Best lineup card', () => {
  const starters = [slot('WR', player('wr-start', 'WR', 10)), slot('FLEX', player('rb-flex', 'RB', 9))]
  const bench = [player('wr-bench', 'WR', 20), player('rb-bench', 'RB', 12)]

  it('shows the gain once and one row per changed seat, with the platform link', () => {
    const result = optimizeLineup({ starters, bench, sport: 'NFL', now: NOW })
    const { container } = render(<MyTeam data={screen(starters, result)} />)
    const card = container.querySelector('[data-testid="mt-optimizer"]')!
    expect(card.textContent).toContain('+13.0 projected')
    expect(card.textContent).toContain('19.0 now → 32.0 with these changes')
    // Two seats change: two players start and the two they replace go to the bench.
    expect(card.querySelectorAll('[data-kind="start"]')).toHaveLength(2)
    expect(card.querySelectorAll('[data-kind="bench"]')).toHaveLength(2)
    expect(card.querySelector('a.af-mt-check-fix')?.getAttribute('href')).toBe('https://example.test/lineup')
  })

  it('is absent in best ball', () => {
    const { container } = render(<MyTeam data={screen(starters, optimizeLineup({ starters, bench, now: NOW }), { bestBall: true })} />)
    expect(container.querySelector('[data-testid="mt-optimizer"]')).toBeNull()
  })
})
