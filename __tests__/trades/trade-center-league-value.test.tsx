// @vitest-environment jsdom
/**
 * The Trade Center shows the LEAGUE value the grade is taken on, and says why it moved
 * (Guap, 2026-09-24). Before this, rows showed market value while the grade was computed from a
 * hidden composite, so a manager could never make the verdict add up.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'

const rosterData = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('@/components/core-app/screens/useLeagueRosters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/core-app/screens/useLeagueRosters')>()
  return { ...actual, useLeagueRosters: () => ({ data: rosterData.current, state: 'idle' }) }
})

import { TradeCenter } from '@/components/core-app/screens/TradeCenter'
import { gradeTrade } from '@/lib/decision-os/trade/tradeGrade'
import { COMMS_OPEN_EVENT } from '@/components/core-app/comms/commsEvents'

const player = (id: string, name: string, position: string, value: number) => ({
  id, name, position, team: 'X', value, imageUrl: null, byeWeek: null, injuryStatus: null, stock: null, stockDelta: null,
})
const roster = (rosterId: string, ownerName: string, players: unknown[]) => ({
  rosterId, platformUserId: `u-${rosterId}`, players, picks: [], teamExternalId: `t-${rosterId}`,
  ownerName, avatarUrl: null, wins: 0, losses: 0, ties: 0, faabRemaining: null,
})

const fetchMock = vi.fn()

/* The engine's answer for Walker (RB 5,000) for McBride (TE 4,500) in a TE-premium league. */
const ANALYSIS = {
  percentDiff: 16,
  fairnessScore: 62,
  labels: { fairnessLabel: 'Slightly favors you', confidenceLabel: 'MEDIUM' },
  giveTotal: 5000,
  getTotal: 5928,
  valueBasis: {
    graded: 'league',
    label: 'Dynasty · 1QB · 12 teams · PPR · TE premium +0.5',
    scoringAdjusted: true,
    needAdjusted: true,
    needGap: null,
  },
  players: {
    give: [{ name: 'Kenneth Walker', position: 'RB', marketValue: 5000, leagueValue: 5000, valueAdjustments: [], pricedSource: 'fantasycalc' }],
    get: [
      {
        name: 'Trey McBride',
        position: 'TE',
        marketValue: 4500,
        leagueValue: 5928,
        pricedSource: 'fantasycalc',
        valueAdjustments: [
          { kind: 'scoring', factor: 1.145, reason: 'TE receptions are worth 1.5 here vs 1 on the chart' },
          { kind: 'need', factor: 1.15, reason: 'you cannot fill 1 TE slot and there is no TE available on waivers' },
        ],
      },
    ],
  },
}

beforeEach(() => {
  rosterData.current = {
    rosters: [
      roster('r1', 'You', [player('p1', 'Kenneth Walker', 'RB', 5000)]),
      roster('r2', 'Matt Jones', [player('p9', 'Trey McBride', 'TE', 4500)]),
    ],
    viewerRosterId: 'r1',
    viewerTeamRosterId: 'r1',
  }
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false }),
  })
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: string) =>
    String(url).includes('/api/trade-value/analyze')
      ? { ok: true, status: 200, json: async () => ANALYSIS }
      : { ok: false, status: 500, json: async () => ({}) },
  )
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

async function analyze(container: HTMLElement) {
  fireEvent.click(screen.getByLabelText('Add Kenneth Walker'))
  fireEvent.click([...document.querySelectorAll<HTMLButtonElement>('.af-tc-partner-chip')].find((b) => b.textContent === 'Matt Jones')!)
  fireEvent.click(screen.getByLabelText('Add Trey McBride'))
  await act(async () => {
    fireEvent.click(container.querySelector<HTMLButtonElement>('.af-tc-stepbar-primary')!)
  })
}

describe('🛑 the page shows the numbers the grade is taken on', () => {
  it('a withheld shared grade suppresses legacy scores, confidence, meters and balancing advice', async () => {
    fetchMock.mockImplementation(async (url: string) => String(url).includes('/api/trade-value/analyze')
      ? { ok: true, status: 200, json: async () => ({ ...ANALYSIS, fairnessScore: 100,
        labels: { fairnessLabel: 'Even', confidenceLabel: 'MEDIUM' },
        grade: { graded: false, reason: 'One asset has no recorded value.', basis: null },
        tradeIntelligence: { why: 'Even · Confidence 72%.', whoWinsLongTerm: 'even', rebalanceSuggestions: ['Ask for a star to balance it.'] },
      }) } : { ok: false, status: 500, json: async () => ({}) })
    const { container } = render(<TradeCenter league={{ id: `l-${Math.random()}`, name: 'L', format: 'Dynasty', teamCount: 12 }} />)
    await analyze(container)
    const verdict = container.querySelector('.af-tc-verdict:not(.af-tc-verdict--pending)')!
    expect(verdict.textContent).toContain('Grade unavailable')
    expect(verdict.textContent).toContain('One asset has no recorded value.')
    expect(verdict.querySelector('.af-tc-score-num')).toBeNull()
    expect(verdict.querySelector('.af-tc-conf')).toBeNull()
    expect(verdict.querySelector('.af-tc-track-wrap')).toBeNull()
    expect(verdict.querySelector('.af-tc-grade')).toBeNull()
    expect(container.querySelector('.af-tc-dos')!.textContent).not.toMatch(/Confidence 72|Ask for a star/)
    const listener = vi.fn()
    window.addEventListener(COMMS_OPEN_EVENT, listener)
    fireEvent.click(screen.getByRole('button', { name: 'Ask Chimmy to explain' }))
    window.removeEventListener(COMMS_OPEN_EVENT, listener)
    expect(listener).toHaveBeenCalledOnce()
    expect((listener.mock.calls[0][0] as CustomEvent).detail.prefill).toContain('The proposal grade is unavailable.')
    expect((listener.mock.calls[0][0] as CustomEvent).detail.prefill).not.toContain('The analyzer says: Even')
  })
  it('shows future cap failure beside a value grade with stored contract terms', async () => {
    fetchMock.mockImplementation(async (url: string) => String(url).includes('/api/trade-value/analyze')
      ? { ok: true, status: 200, json: async () => ({ ...ANALYSIS, salaryCap: {
        status: 'evaluated', legal: false, contracts: [{ side: 'get', name: 'Trey McBride', salary: 30, expires: 2027 }],
        impact: { years: [{ capYear: 2027, fromCapHit: 110, fromCap: 100, toCapHit: 60, toCap: 100, fromLegal: false, toLegal: true }] },
      } }) } : { ok: false, status: 500, json: async () => ({}) })
    const { container } = render(<TradeCenter league={{ id: `l-${Math.random()}`, name: 'L', format: 'Dynasty', teamCount: 12 }} />)
    await analyze(container)
    const verdict = container.querySelector('.af-tc-verdict:not(.af-tc-verdict--pending)')!.textContent!
    expect(verdict).toContain('Salary-cap affordability')
    expect(verdict).toContain('salary 30 through 2027')
    expect(verdict).toContain('Your post-trade cap room -10')
    expect(verdict).toContain('Fails cap or floor rules')
  })
  it('discloses unavailable cap inputs instead of implying an affordable trade', async () => {
    fetchMock.mockImplementation(async (url: string) => String(url).includes('/api/trade-value/analyze')
      ? { ok: true, status: 200, json: async () => ({ ...ANALYSIS, salaryCap: { status: 'unavailable', reason: 'Missing owned contract.' } }) }
      : { ok: false, status: 500, json: async () => ({}) })
    const { container } = render(<TradeCenter league={{ id: `l-${Math.random()}`, name: 'L', format: 'Dynasty', teamCount: 12 }} />)
    await analyze(container)
    expect(screen.getByText(/Missing owned contract/).textContent).toContain('value grade does not establish cap legality')
  })
  it('adds a re-evaluated counter to the right side and clears the previous verdict', async () => {
    const counterGrade = gradeTrade({ giveValue: 5000, getValue: 5000, giveMarket: 5000, getMarket: 5000,
      unpriced: 0, giveCount: 1, getCount: 2, basis: 'League', scoringApplied: false, needApplied: false,
      needGap: null, lines: [], moves: [] })
    fetchMock.mockImplementation(async (url: string) => String(url).includes('/api/trade-value/analyze')
      ? { ok: true, status: 200, json: async () => ({ ...ANALYSIS, counterOffers: [{
        addTo: 'get', name: 'Depth Receiver', rosterPlayerId: 'sleeper-depth', position: 'WR', marketValue: 300,
        asset: { kind: 'player', name: 'Depth Receiver' }, grade: counterGrade, remainingGap: 0, balanced: true,
      }] }) } : { ok: false, status: 500, json: async () => ({}) })
    const { container } = render(<TradeCenter league={{ id: `l-${Math.random()}`, name: 'L', format: 'Dynasty', teamCount: 12 }} />)
    await analyze(container)
    expect(screen.getByText('Re-evaluated counteroffers')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add to proposal' }))
    expect(container.querySelector('.af-tc-review')!.textContent).toContain('Depth Receiver')
    expect(container.querySelector('.af-tc-verdict')).toBeNull()
  })
  it('before analysis every row is its market value; after, the league value — with the market beside it', async () => {
    const { container } = render(<TradeCenter league={{ id: `l-${Math.random()}`, name: 'L', format: 'Dynasty', teamCount: 12 }} />)
    fireEvent.click(screen.getByLabelText('Add Kenneth Walker'))
    expect(container.querySelector('.af-tc-stepbar-totals')!.textContent).toContain('Send 5,000')

    fireEvent.click([...document.querySelectorAll<HTMLButtonElement>('.af-tc-partner-chip')].find((b) => b.textContent === 'Matt Jones')!)
    fireEvent.click(screen.getByLabelText('Add Trey McBride'))
    await act(async () => {
      fireEvent.click(container.querySelector<HTMLButtonElement>('.af-tc-stepbar-primary')!)
    })

    const review = container.querySelector('.af-tc-review')!.textContent ?? ''
    expect(review).toContain('5,928')
    expect(review).toContain('mkt 4,500')
    // The totals add up to the grade's totals, not to the market prices.
    expect(container.querySelector('.af-tc-stepbar-totals')!.textContent).toContain('Get 5,928')
  })

  it('the verdict names what it is graded on, and lists every move with its reason', async () => {
    const { container } = render(<TradeCenter league={{ id: `l-${Math.random()}`, name: 'L', format: 'Dynasty', teamCount: 12 }} />)
    await analyze(container)
    const verdict = container.querySelector('.af-tc-verdict:not(.af-tc-verdict--pending)')!.textContent ?? ''
    expect(verdict).toContain('Graded on league value')
    expect(verdict).toContain('Dynasty · 1QB · 12 teams · PPR · TE premium +0.5')
    expect(verdict).toContain('Why the values moved')
    expect(verdict).toContain('+15% you cannot fill 1 TE slot and there is no TE available on waivers')
    expect(verdict).toContain('TE receptions are worth 1.5 here vs 1 on the chart')
    // A player nothing moved is not listed as moved.
    expect(container.querySelector('.af-tc-moves')!.textContent).not.toContain('Kenneth Walker')
  })

  it('when roster need could not be read, the verdict says so rather than implying it was priced', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/api/trade-value/analyze')
        ? {
            ok: true,
            status: 200,
            json: async () => ({
              ...ANALYSIS,
              valueBasis: { ...ANALYSIS.valueBasis, needAdjusted: false, needGap: 'which of these teams is yours — claim your team' },
            }),
          }
        : { ok: false, status: 500, json: async () => ({}) },
    )
    const { container } = render(<TradeCenter league={{ id: `l-${Math.random()}`, name: 'L', format: 'Dynasty', teamCount: 12 }} />)
    await analyze(container)
    expect(container.querySelector('.af-tc-moves')!.textContent).toContain(
      'Roster need was not priced: we could not see which of these teams is yours',
    )
  })
})
