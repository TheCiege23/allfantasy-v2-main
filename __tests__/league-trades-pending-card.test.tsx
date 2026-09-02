/**
 * The league Trades tab's pending-trade card (design-refs/trade-center-handoff,
 * League) — reads like the provider's own proposal card, proposer first, with
 * the AllFantasy read layered on top.
 *
 * Two things are load-bearing enough to pin:
 *   1. Display labels go back into the analyzer's vocabulary by PARSING, and a
 *      label that does not parse is dropped and named, never guessed.
 *   2. The card never shows a value or a grade it does not have — the offer
 *      renders exactly as proposed while the read is loading, failed or short.
 */
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import React from 'react'
import { PendingTradeCard, toAnalyzeAssets } from '@/app/league/[leagueId]/tabs/TradesTab'
import type { LeagueTradeHistoryItem } from '@/components/league/types'

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'user-a' } } }) }))
vi.mock('@/lib/dashboard/open-chimmy-with-prompt', () => ({ openChimmyWithPrompt: vi.fn() }))

describe('toAnalyzeAssets — display labels back into the analyzer vocabulary', () => {
  it('reads picks off their labels in the shapes the panel actually emits', () => {
    const { assets, dropped } = toAnalyzeAssets([
      { label: '2027 round 3', sublabel: 'Draft pick' },
      { label: '2026 1st', sublabel: null },
      { label: '2028 R2 (Thunderbolts)', sublabel: 'Draft pick' },
    ])
    expect(assets).toEqual([
      { kind: 'pick', year: 2027, round: 3, label: '2027 round 3' },
      { kind: 'pick', year: 2026, round: 1, label: '2026 1st' },
      { kind: 'pick', year: 2028, round: 2, label: '2028 R2 (Thunderbolts)' },
    ])
    expect(dropped).toEqual([])
  })

  it('reads FAAB off a dollar amount', () => {
    expect(toAnalyzeAssets([{ label: '$40 FAAB', sublabel: null }]).assets).toEqual([{ kind: 'faab', amount: 40 }])
  })

  it('⚠ drops a pick it cannot read rather than guessing a round', () => {
    const { assets, dropped } = toAnalyzeAssets([{ label: 'Future pick', sublabel: 'Draft pick' }])
    expect(assets).toEqual([])
    expect(dropped).toEqual(['Future pick'])
  })

  it('sends a player by name — the search path returns no id either', () => {
    expect(toAnalyzeAssets([{ label: 'CeeDee Lamb', sublabel: 'WR' }]).assets).toEqual([{ kind: 'player', name: 'CeeDee Lamb' }])
  })
})

const INCOMING: LeagueTradeHistoryItem = {
  id: 'af-1',
  direction: 'incoming',
  partnerName: 'Cold Takes FC',
  timestamp: new Date().toISOString(),
  sent: [{ id: 's1', label: 'CeeDee Lamb', sublabel: 'WR', headshotUrl: null, accent: 'blue' }],
  received: [
    { id: 'r1', label: 'Bijan Robinson', sublabel: 'RB', headshotUrl: null, accent: 'teal' },
    { id: 'r2', label: '2027 round 3', sublabel: 'Draft pick', headshotUrl: null, accent: 'teal' },
  ],
  status: 'pending',
  viewerIsReceiver: true,
  viewerIsProposer: false,
  viewerIsCommissioner: false,
}

function card(trade: LeagueTradeHistoryItem, extra: Partial<React.ComponentProps<typeof PendingTradeCard>> = {}) {
  return render(
    <PendingTradeCard
      trade={trade}
      offer={null}
      verdict={undefined}
      sport="NFL"
      tradeCenterHref="/core/trades?league=l1"
      providerUrl={null}
      canAct
      busy={false}
      onAccept={() => {}}
      onReject={() => {}}
      onCancel={() => {}}
      onApprove={() => {}}
      onVeto={() => {}}
      {...extra}
    />,
  )
}

describe('PendingTradeCard — the provider card shape with the AF read on top', () => {
  it('puts the proposer first, like the provider does', () => {
    const t = card(INCOMING).container.textContent ?? ''
    expect(t).toContain('Cold Takes FC has proposed a trade')
    expect(t.indexOf('Cold Takes FC')).toBeLessThan(t.indexOf('You'))
    expect(t.indexOf('Bijan Robinson')).toBeLessThan(t.indexOf('CeeDee Lamb'))
  })

  it('⚠ shows the offer without any value while the read is missing', () => {
    const { container } = card(INCOMING)
    const t = container.textContent ?? ''
    expect(t).toContain('Pricing this deal')
    expect(t).not.toMatch(/\d,\d{3}/)
  })

  it('shows the values, the label and both grades once the read is in', () => {
    const t =
      card(INCOMING, {
        verdict: {
          kind: 'ok',
          fairnessScore: 41,
          fairnessLabel: 'Tilts toward Cold Takes FC',
          confidenceLabel: 'Moderate',
          degraded: false,
          giveGrade: 'C',
          getGrade: 'B',
          giveTotal: 8200,
          getTotal: 7900,
          values: { 'ceedee lamb': 8200, 'bijan robinson': 7900 },
          dropped: [],
        },
      }).container.textContent ?? ''
    expect(t).toContain('Tilts toward Cold Takes FC')
    expect(t).toContain('41/100')
    expect(t).toContain('8,200')
    expect(t).toContain('7,900')
  })

  it('⚠ names what the read is short when a label could not be parsed', () => {
    const t =
      card(INCOMING, {
        verdict: {
          kind: 'ok',
          fairnessScore: 50,
          fairnessLabel: 'Even',
          confidenceLabel: null,
          degraded: false,
          giveGrade: 'C',
          getGrade: 'C',
          giveTotal: null,
          getTotal: null,
          values: {},
          dropped: ['Future pick'],
        },
      }).container.textContent ?? ''
    expect(t).toContain('Priced without Future pick')
  })

  it('⚠ a degraded read says no signal rather than fair', () => {
    const t =
      card(INCOMING, {
        verdict: {
          kind: 'ok',
          fairnessScore: 50,
          fairnessLabel: 'We cannot price this deal',
          confidenceLabel: null,
          degraded: true,
          giveGrade: null,
          getGrade: null,
          giveTotal: null,
          getTotal: null,
          values: { 'ceedee lamb': null },
          dropped: [],
        },
      }).container.textContent ?? ''
    expect(t).toContain('no signal, not a fair trade')
  })

  it('offers Accept and Reject to the receiver in a league where actions are wired', () => {
    const { getByTestId } = card(INCOMING)
    expect(getByTestId('trade-action-accept')).toBeInTheDocument()
    expect(getByTestId('trade-action-reject')).toBeInTheDocument()
  })

  it('⚠ never offers Accept on a provider offer — only the way to where it lives', () => {
    const { queryByTestId, getByText } = card(
      { ...INCOMING, id: 'sleeper:tx1', status: 'pending_on_sleeper' },
      { providerUrl: 'https://sleeper.com/leagues/1' },
    )
    expect(queryByTestId('trade-action-accept')).not.toBeInTheDocument()
    expect(getByText('Act on it in Sleeper')).toBeInTheDocument()
  })
})
