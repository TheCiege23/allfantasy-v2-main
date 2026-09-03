/**
 * Phase 6 — the panel that makes the engine visible.
 *
 * The assertions that matter here are about HONESTY, not layout. A value surface can be wrong in
 * two directions and only one of them looks wrong: showing a number that is not there, and
 * showing a zero that means "we could not price him" as though it meant "he is worth nothing".
 */

import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { TradeValueBreakdown } from '@/components/trade-value/TradeValueBreakdown'
import type { AssetValueSnapshot, TradeValueSnapshot } from '@/lib/trade-value/types'

const NO_SOURCES = {
  projectionValue: null, rankingValue: null, adpValue: null, fantasyCalcValue: null, idpValue: null,
}

const player = (over: Partial<AssetValueSnapshot> = {}): AssetValueSnapshot => ({
  kind: 'player',
  fromRosterId: 'r1',
  toRosterId: 'r2',
  playerName: 'Test Receiver',
  position: 'WR',
  sources: { ...NO_SOURCES, projectionValue: 240 },
  internalValue: 6552,
  valuationBasis: 'projection',
  ...over,
})

const snap = (a: AssetValueSnapshot[], b: AssetValueSnapshot[] = []): TradeValueSnapshot =>
  ({
    version: '1.0',
    context: {
      sport: 'NFL', leagueType: 'redraft', scoring: 'ppr',
      rosterFormat: 'standard', capturedAt: '2026-09-02T00:00:00.000Z',
    },
    sides: [
      { rosterId: 'r1', total: a.reduce((s, x) => s + x.internalValue, 0), assets: a },
      { rosterId: 'r2', total: b.reduce((s, x) => s + x.internalValue, 0), assets: b },
    ],
    grade: { grade: 'B', fairnessScore: 70, confidenceScore: 60, valueDifference: 100, bullets: [] },
  }) as unknown as TradeValueSnapshot

describe('the base value and its basis', () => {
  it('shows the number and says which input produced it', () => {
    render(<TradeValueBreakdown snapshot={snap([player()])} />)
    expect(screen.getByTestId('tv-asset-base')).toHaveTextContent('6,552')
    expect(screen.getByTestId('tv-asset-basis')).toHaveTextContent(/Projection/)
  })

  it('describes each basis differently — a label that fits everything explains nothing', () => {
    const seen = new Set<string>()
    for (const basis of ['projection', 'idp', 'market'] as const) {
      const { unmount } = render(<TradeValueBreakdown snapshot={snap([player({ valuationBasis: basis })])} />)
      seen.add(screen.getByTestId('tv-asset-basis').textContent ?? '')
      unmount()
    }
    expect(seen.size).toBe(3)
  })

  it('names the IDP basis as computed, not quoted — no market ranks defenders', () => {
    render(<TradeValueBreakdown snapshot={snap([player({ valuationBasis: 'idp', position: 'LB' })])} />)
    expect(screen.getByTestId('tv-asset-basis')).toHaveTextContent(/no market ranks defenders/i)
  })

  /*
   * ⚠ ABSENT IS NOT A BASIS. Snapshots written before the field existed carry none, and the panel
   * must not reach into `sources` to guess — that would be a second implementation of the
   * engine's precedence, which is exactly what `valueBasisFor` exists to prevent.
   */
  it('says "not recorded" for an older snapshot rather than inferring one', () => {
    render(<TradeValueBreakdown snapshot={snap([player({ valuationBasis: undefined })])} />)
    expect(screen.getByText(/Basis not recorded/i)).toBeInTheDocument()
  })
})

describe('🛑 a refusal is a sentence, not a zero', () => {
  it('an unpriced player says it is missing data, NOT that he is worthless', () => {
    render(<TradeValueBreakdown snapshot={snap([
      player({ playerName: 'Unpriced Guy', internalValue: 0, valuationBasis: 'none', sources: NO_SOURCES }),
    ])} />)
    const basis = screen.getByTestId('tv-asset-basis')
    expect(basis).toHaveTextContent(/gap in our data/i)
    expect(basis).toHaveTextContent(/NOT a judgement that he is worthless/i)
  })

  it('warns that the side totals are incomplete, and counts how many', () => {
    render(<TradeValueBreakdown snapshot={snap(
      [player(), player({ playerName: 'A', internalValue: 0, valuationBasis: 'none' })],
      [player({ playerName: 'B', internalValue: 0, valuationBasis: 'none' })],
    )} />)
    const note = screen.getByTestId('tv-unpriced-note')
    expect(note).toHaveTextContent(/2 players/)
    expect(note).toHaveTextContent(/totals above are incomplete/i)
  })

  it('says nothing when every asset priced — no permanent scary banner', () => {
    render(<TradeValueBreakdown snapshot={snap([player()])} />)
    expect(screen.queryByTestId('tv-unpriced-note')).toBeNull()
  })

  it('uses singular for one unpriced player', () => {
    render(<TradeValueBreakdown snapshot={snap([player({ internalValue: 0, valuationBasis: 'none' })])} />)
    const note = screen.getByTestId('tv-unpriced-note')
    expect(note).toHaveTextContent(/1 player in this trade could not be priced/)
    // Singular throughout, including the closing clause — "they are worthless" for one player
    // reads as a different, worse sentence.
    expect(note).toHaveTextContent(/he is worthless/)
    expect(note).not.toHaveTextContent(/1 players/)
  })
})

describe('🛑 the format fit is a SEPARATE number', () => {
  const withFit = player({
    formatFit: {
      formatId: 'four_horsemen', label: 'Four Horsemen',
      fit: { multiplier: 1.05, reason: 'Taxi-eligible, so holding him costs this roster nothing.' },
      legality: { ok: true },
    },
  })

  it('renders the fit without changing the base number', () => {
    render(<TradeValueBreakdown snapshot={snap([withFit])} />)
    // The base is still exactly the engine's number.
    expect(screen.getByTestId('tv-asset-base')).toHaveTextContent('6,552')
    // And the fit is its own figure, as a percentage, never a blended total.
    expect(screen.getByTestId('tv-asset-fit')).toHaveTextContent('+5%')
  })

  it('🛑 never renders the fit-adjusted product anywhere', () => {
    /*
     * 6552 * 1.05 = 6879.6 -> 6880. If that number appears, somebody has folded the multiplier
     * into the price, which is the exact invisibility the split was chosen to avoid.
     */
    const { container } = render(<TradeValueBreakdown snapshot={snap([withFit])} />)
    expect(container.textContent).not.toMatch(/6,880|6880/)
  })

  it('carries the format\'s reason, because the number alone cannot be argued with', () => {
    render(<TradeValueBreakdown snapshot={snap([withFit])} />)
    expect(screen.getByTestId('tv-asset-fit-reason')).toHaveTextContent(/Taxi-eligible/)
    expect(screen.getByTestId('tv-asset-fit-reason')).toHaveTextContent(/Four Horsemen/)
  })

  it('distinguishes "looked and no change" from "no opinion"', () => {
    // multiplier 1.0 means the format considered it and declined to move it.
    render(<TradeValueBreakdown snapshot={snap([player({
      formatFit: {
        formatId: 'four_horsemen', label: 'Four Horsemen',
        fit: { multiplier: 1, reason: 'Three Eliminator strikes — one more low week ends you.' },
        legality: null,
      },
    })])} />)
    expect(screen.getByTestId('tv-asset-fit')).toHaveTextContent('no change')

    // A null fit renders no fit block at all, which is a different statement.
    const { container } = render(<TradeValueBreakdown snapshot={snap([player()])} />)
    expect(within(container).queryByTestId('tv-asset-fit')).toBeNull()
  })

  it('shows a closed trade window as a warning, not as a discount', () => {
    render(<TradeValueBreakdown snapshot={snap([player({
      formatFit: {
        formatId: 'guillotine', label: 'Guillotine', fit: null,
        legality: { ok: false, reason: 'Trades closed after week 11.' },
      },
    })])} />)
    expect(screen.getByTestId('tv-asset-legality')).toHaveTextContent(/Trades closed after week 11/)
    // The player is worth the same; he is simply untradeable.
    expect(screen.getByTestId('tv-asset-base')).toHaveTextContent('6,552')
  })
})

describe('non-player assets', () => {
  it('a pick is explained by where it falls, not by a basis it never had', () => {
    render(<TradeValueBreakdown snapshot={snap([{
      kind: 'draft_pick', fromRosterId: 'r1', toRosterId: 'r2',
      pickSeason: 2027, pickRound: 2, pickLabel: '2027 2nd',
      sources: NO_SOURCES, internalValue: 1200, valuationBasis: null,
    } as AssetValueSnapshot])} />)
    expect(screen.getByText(/where the pick actually falls/i)).toBeInTheDocument()
    expect(screen.getByTestId('tv-asset-base')).toHaveTextContent('1,200')
  })

  it('FAAB is priced from the amount itself', () => {
    render(<TradeValueBreakdown snapshot={snap([{
      kind: 'faab', fromRosterId: 'r1', toRosterId: 'r2', faabAmount: 25,
      sources: NO_SOURCES, internalValue: 250, valuationBasis: null,
    } as AssetValueSnapshot])} />)
    expect(screen.getByText(/\$25 FAAB/)).toBeInTheDocument()
  })

  /*
   * ⚠ A zero-value PICK must not trip the unpriced warning. That warning is about players the
   * engine could not price; a pick or FAAB at zero is a valuation, not a refusal, and firing the
   * banner for it would cry wolf on every trade containing a late pick.
   */
  it('does not count a zero-value pick as an unpriced player', () => {
    render(<TradeValueBreakdown snapshot={snap([{
      kind: 'draft_pick', fromRosterId: 'r1', toRosterId: 'r2', pickRound: 7, pickLabel: '2027 7th',
      sources: NO_SOURCES, internalValue: 0, valuationBasis: null,
    } as AssetValueSnapshot])} />)
    expect(screen.queryByTestId('tv-unpriced-note')).toBeNull()
  })
})

describe('sides', () => {
  it('uses the manager names when given, and the totals are the engine\'s', () => {
    render(
      <TradeValueBreakdown
        snapshot={snap([player()], [player({ playerName: 'Other', internalValue: 4000 })])}
        sideNames={{ r1: 'Casey', r2: 'Jordan' }}
      />,
    )
    expect(screen.getByText(/Casey sends/)).toBeInTheDocument()
    expect(screen.getByText(/Jordan sends/)).toBeInTheDocument()
  })

  it('says so when a side is empty rather than rendering a bare zero', () => {
    render(<TradeValueBreakdown snapshot={snap([player()], [])} />)
    expect(screen.getByText(/Nothing on this side/i)).toBeInTheDocument()
  })
})
