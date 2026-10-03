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
import { PendingTradeCard, pendingVerdictFromGrade, toAnalyzeAssets } from '@/app/league/[leagueId]/tabs/TradesTab'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'

describe('pendingVerdictFromGrade — per-asset values', () => {
  const grade = {
    graded: true, letter: 'B', partnerLetter: 'D', percentDiff: 12, label: 'x', basis: 'b', giveValue: 4100, getValue: 4600,
    lines: [
      { side: 'give', name: 'Kenneth Walker III', marketValue: 4100, leagueValue: 4100 },
      { side: 'get', name: '2027 1st', marketValue: 3034, leagueValue: 3034 },
      { side: 'get', name: '2027 2nd', marketValue: 1559, leagueValue: 1559 },
    ],
  } as unknown as TradeGradeView

  it('matches a pick by its year and round, not by its place in the list', () => {
    const v = pendingVerdictFromGrade(grade, ['Kenneth Walker'], ['2027 round 2', '2027 round 1'])
    expect(v && v.kind === 'ok' ? v.values : null).toEqual({ 'kenneth walker': 4100, '2027 round 2': 1559, '2027 round 1': 3034 })
  })
})
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
    // Each block lists what that manager GETS: Cold Takes gets CeeDee (yours), you get Bijan (theirs).
    expect(t.indexOf('CeeDee Lamb')).toBeLessThan(t.indexOf('Bijan Robinson'))
    expect(t).not.toContain('sends')
  })

  it('puts each manager’s letter and total over what that manager GETS', () => {
    const { container } = card(INCOMING, {
      verdict: {
        kind: 'ok', fairnessScore: 41, fairnessLabel: 'Tilts toward Cold Takes FC', confidenceLabel: 'Moderate', degraded: false,
        giveGrade: 'C', getGrade: 'B', giveTotal: 8200, getTotal: 7900,
        values: { 'ceedee lamb': 8200, 'bijan robinson': 7900 }, dropped: [],
      },
    })
    const t = container.textContent ?? ''
    // You (graded side, C) get Bijan at 7,900; Cold Takes (B) gets CeeDee at 8,200.
    const you = t.slice(t.indexOf('YOU'))
    expect(you).toMatch(/^YOU.*gets.*C.*7,900.*Bijan Robinson/)
    const them = t.slice(t.indexOf('Cold Takes FCgets'), t.indexOf('YOU'))
    expect(them).toMatch(/gets.*B.*8,200.*CeeDee Lamb/)
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

  it('renders every manager and that manager’s assets in a multi-team proposal', () => {
    const t = card({
      ...INCOMING,
      direction: 'complete',
      proposerName: 'Alpha',
      participantSides: [
        { rosterId: 'r1', name: 'Alpha', avatarUrl: '/alpha.png', isViewer: false, assets: [{ id: 'a1', label: 'Josh Allen', sublabel: 'QB · BUF', headshotUrl: null, accent: 'blue' }], grade: 'A', reason: 'Improves survival odds.' },
        { rosterId: 'r2', name: 'Beta', avatarUrl: '/beta.png', isViewer: true, assets: [{ id: 'b1', label: '2027 1st', sublabel: 'Draft pick', headshotUrl: null, accent: 'teal' }], grade: 'B', reason: 'Adds future value.' },
        { rosterId: 'r3', name: 'Gamma', avatarUrl: '/gamma.png', isViewer: false, assets: [{ id: 'c1', label: '$25 FAAB', sublabel: 'FAAB', headshotUrl: null, accent: 'teal' }], grade: 'C', reason: 'Adds waiver flexibility.' },
      ],
    }).container.textContent ?? ''
    expect(t).toContain('Alpha')
    expect(t).toContain('Beta')
    expect(t).toContain('Gamma')
    expect(t).toContain('Josh Allen')
    expect(t).toContain('2027 1st')
    expect(t).toContain('$25 FAAB')
    expect(t).toContain('Improves survival odds.')
    expect(t).toContain('Adds waiver flexibility.')
    // No `received` on a three-team row: who got what is unknown, so it keeps "sends" rather than "gets: Nothing".
    expect(t).not.toContain('Nothing')
    expect(t).toContain('sends')
  })

  it('a three-team proposal with `received` lists what each manager gets', () => {
    const asset = (id: string, label: string) => ({ id, label, sublabel: null, headshotUrl: null, accent: 'teal' as const })
    const { container } = card({
      ...INCOMING,
      direction: 'complete',
      proposerName: 'Alpha',
      participantSides: [
        { rosterId: 'r1', name: 'Alpha', avatarUrl: null, isViewer: false, assets: [asset('a1', 'Josh Allen')], received: [asset('c1', '$25 FAAB')], grade: 'A', reason: null },
        { rosterId: 'r2', name: 'Beta', avatarUrl: null, isViewer: true, assets: [asset('b1', '2027 1st')], received: [asset('a1', 'Josh Allen')], grade: 'B', reason: null },
        { rosterId: 'r3', name: 'Gamma', avatarUrl: null, isViewer: false, assets: [asset('c1', '$25 FAAB')], received: [asset('b1', '2027 1st')], grade: 'C', reason: null },
      ],
    })
    const t = container.textContent ?? ''
    expect(t).not.toContain('sends')
    expect(t.indexOf('Alpha')).toBeLessThan(t.indexOf('$25 FAAB'))
    expect(t.indexOf('$25 FAAB')).toBeLessThan(t.indexOf('Beta'))
    expect(t.indexOf('Beta')).toBeLessThan(t.indexOf('Josh Allen'))
    expect(t.indexOf('Gamma')).toBeLessThan(t.indexOf('2027 1st'))
  })
})
