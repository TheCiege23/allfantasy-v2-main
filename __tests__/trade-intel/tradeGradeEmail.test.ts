import { describe, expect, it } from 'vitest'

import {
  buildTradeGradeEmail,
  explainGrade,
  hasNoSignal,
  sideMath,
} from '@/lib/trade-intel/tradeGradeEmail'
import type {
  GradedTrade,
  TradeAsset,
  TradePickAsset,
  TradeSideGrade,
} from '@/lib/trade-intel/sleeperTradeGradeService'

function player(name: string, credited: number): TradeAsset {
  return {
    playerId: name,
    name,
    position: 'WR',
    pointsBySeason: { '2026': credited },
    creditedBySeason: { '2026': credited },
    departed: null,
    gamesMissedBySeason: { '2026': 0 },
  }
}

function pick(round: number, pending: boolean, credited = 0): TradePickAsset {
  return {
    season: '2026',
    round,
    originalRosterId: 1,
    label: `2026 round ${round}`,
    resolved: pending
      ? null
      : {
          playerId: `p${round}`,
          name: `Rookie ${round}`,
          position: 'RB',
          creditedBySeason: { '2026': credited },
          departed: null,
        },
    pending,
    rerouted: false,
  }
}

function side(o: Partial<TradeSideGrade> & { managerName: string; net: number }): TradeSideGrade {
  return {
    rosterId: 1,
    ownerId: 'o',
    managerName: o.managerName,
    teamName: null,
    avatar: null,
    playersIn: o.playersIn ?? [],
    playersOut: o.playersOut ?? [],
    picksIn: o.picksIn ?? [],
    picksOut: o.picksOut ?? [],
    madePlayoffs: null,
    seasonNets: [{ season: '2026', net: o.net, partial: true }],
    cumulativeNet: o.net,
    initialGrade: o.initialGrade ?? 'C',
    currentGrade: o.currentGrade ?? 'C',
    trend: 'steady',
  }
}

function trade(sides: TradeSideGrade[], tie = false): GradedTrade {
  return {
    id: 'league:tx',
    season: '2026',
    week: 1,
    createdIso: '2026-08-12T01:31:00.000Z',
    multiTeam: false,
    tie,
    hasPendingPicks: sides.some((s) => [...s.picksIn, ...s.picksOut].some((p) => p.pending)),
    sides,
  }
}

/** The real trade that prompted this: preseason, nothing scored, picks undrafted. */
const PRESEASON = trade(
  [
    side({
      managerName: 'managerOne',
      playersIn: [player('Brenton Strange', 0)],
      picksIn: [pick(2, true)],
      playersOut: [player('Rashid Shaheed', 0), player('Woody Marks', 0)],
      picksOut: [pick(3, true)],
      net: 0,
    }),
    side({
      managerName: 'managerTwo',
      playersIn: [player('Rashid Shaheed', 0), player('Woody Marks', 0)],
      picksIn: [pick(3, true)],
      playersOut: [player('Brenton Strange', 0)],
      picksOut: [pick(2, true)],
      net: 0,
    }),
  ],
  true,
)

const MIDSEASON = trade([
  side({
    managerName: 'managerOne',
    playersIn: [player('Brenton Strange', 121.4)],
    playersOut: [player('Rashid Shaheed', 154.8), player('Woody Marks', 96.1)],
    picksIn: [pick(2, false, 88.2)],
    net: -41.3,
    initialGrade: 'D',
  }),
  side({
    managerName: 'managerTwo',
    playersIn: [player('Rashid Shaheed', 154.8), player('Woody Marks', 96.1)],
    playersOut: [player('Brenton Strange', 121.4)],
    picksOut: [pick(2, false, 88.2)],
    net: 41.3,
    initialGrade: 'B',
  }),
])

const URL = 'https://www.allfantasy.ai/league/abc?view=legacy'

describe('trade grade email — rendering', () => {
  it('emits no literal HTML entities in the visible body', () => {
    const { html } = buildTradeGradeEmail({ leagueName: 'Dads Dynasty', trade: PRESEASON, ledgerUrl: URL })
    // The old email double-escaped its own &nbsp; spacers, so managers literally read "&nbsp;".
    expect(html).not.toContain('&amp;nbsp;')
    expect(html).not.toContain('&nbsp;')
  })

  it('renders both managers and every asset on both sides', () => {
    const { html } = buildTradeGradeEmail({ leagueName: 'Dads Dynasty', trade: PRESEASON, ledgerUrl: URL })
    for (const text of [
      'managerOne',
      'managerTwo',
      'Brenton Strange',
      'Rashid Shaheed',
      'Woody Marks',
      '2026 round 2',
      '2026 round 3',
    ]) {
      expect(html).toContain(text)
    }
    expect(html).toContain(URL)
  })

  it('escapes a hostile league name rather than emitting markup', () => {
    const { html, subject } = buildTradeGradeEmail({
      leagueName: '<script>alert(1)</script>',
      trade: PRESEASON,
      ledgerUrl: URL,
    })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
    // Subject is plain text in the mail header, so it carries the raw name.
    expect(subject).toContain('<script>')
  })
})

describe('trade grade email — refusing to fake a verdict', () => {
  it('detects that nothing has been credited yet', () => {
    expect(hasNoSignal(PRESEASON)).toBe(true)
    expect(hasNoSignal(MIDSEASON)).toBe(false)
  })

  it('does not assert letter grades in the subject before any game is played', () => {
    const { subject } = buildTradeGradeEmail({ leagueName: 'Dads Dynasty', trade: PRESEASON, ledgerUrl: URL })
    expect(subject).toContain('too early to grade')
    // The old subject read "initial grades: managerOne C, managerTwo C" off zero data.
    expect(subject).not.toMatch(/managerOne C/)
  })

  it('explains that a zero-point trade sits mid-C rather than being average', () => {
    const body = explainGrade(PRESEASON, true)
    expect(body).toContain('No games have been played')
    expect(body).toContain('0.0')
    // Both undrafted picks must be called out as unable to count.
    expect(body).toContain('2026 round 2')
    expect(body).toContain('2026 round 3')
    expect(body).toContain('not been drafted yet')
  })

  it('shows a neutral dash instead of a C chip when there is no data', () => {
    const { html } = buildTradeGradeEmail({ leagueName: 'Dads Dynasty', trade: PRESEASON, ledgerUrl: URL })
    expect(html).toContain('no points credited yet')
    expect(html).toContain('>–<')
  })
})

describe('trade grade email — real grades once points exist', () => {
  it('puts both letters back in the subject', () => {
    const { subject } = buildTradeGradeEmail({ leagueName: 'Dads Dynasty', trade: MIDSEASON, ledgerUrl: URL })
    expect(subject).toContain('managerOne D')
    expect(subject).toContain('managerTwo B')
  })

  it('shows the arithmetic that produced the letter', () => {
    const m = sideMath(MIDSEASON.sides[0]!)
    expect(m.got).toBe(209.6)
    expect(m.gave).toBe(250.9)
    expect(m.net).toBe(-41.3)

    const body = explainGrade(MIDSEASON, false)
    expect(body).toContain('netted -41.3')
    expect(body).toContain('got 209.6')
    expect(body).toContain('gave 250.9')
  })

  it('reports net as got minus gave, matching what the engine graded', () => {
    for (const s of MIDSEASON.sides) {
      const m = sideMath(s)
      expect(Math.round((m.got - m.gave) * 10) / 10).toBe(m.net)
      expect(m.net).toBe(s.seasonNets[0]!.net)
    }
  })
})

describe('projected grades are labelled as projections everywhere', () => {
  const EXPECTATION = {
    available: true,
    leagueNote: '12-team superflex dynasty · full PPR · TE premium (+0.5/rec)',
    priorSeason: '2025',
    scoringMode: 'league-scored' as const,
    missing: [],
    sides: [
      {
        rosterId: 1, managerName: 'managerOne',
        assetsIn: [], assetsOut: [],
        marketIn: 3274, marketOut: 3842, marketNet: -568,
        priorIn: 141, priorOut: 289.7, priorNet: -148.7,
        positionDelta: { TE: 1, WR: -1, RB: -1 }, starterGaps: [],
        projected: { letter: 'D' as const, valueEdge: -0.105, valueNet: -568, uncertainty: 420, insideNoise: false, productionDisagrees: false, confidence: 'high' as const },
      },
      {
        rosterId: 8, managerName: 'managerTwo',
        assetsIn: [], assetsOut: [],
        marketIn: 3842, marketOut: 3274, marketNet: 568,
        priorIn: 289.7, priorOut: 141, priorNet: 148.7,
        positionDelta: { TE: -1, WR: 1, RB: 1 }, starterGaps: [],
        projected: { letter: 'B' as const, valueEdge: 0.105, valueNet: 568, uncertainty: 420, insideNoise: false, productionDisagrees: false, confidence: 'high' as const },
      },
    ],
  }

  const withExp = () =>
    buildTradeGradeEmail({
      leagueName: 'Dads Dynasty',
      trade: PRESEASON,
      ledgerUrl: URL,
      expectation: EXPECTATION as never,
    })

  it('says "projected" in the subject rather than implying a result', () => {
    const { subject } = withExp()
    expect(subject).toContain('projected on 2025')
    expect(subject).toContain('managerOne D')
    // The bare "initial grades:" phrasing would read as already-earned.
    expect(subject).not.toContain('initial grades')
  })

  it('marks every chip PROJECTED in the body', () => {
    const { html } = withExp()
    expect(html).toContain('PROJECTED')
    expect(html).toContain('>D<')
    expect(html).toContain('Projected on 2025 production')
  })

  it('explains that value, not player count, drove the letter', () => {
    const body = explainGrade(PRESEASON, true, EXPECTATION as never)
    expect(body).toContain('projections rather than results')
    expect(body).toContain('prices a star correctly against two useful pieces')
  })

  it('falls back to "too early" when there is no projection to show', () => {
    const { subject, html } = buildTradeGradeEmail({
      leagueName: 'Dads Dynasty', trade: PRESEASON, ledgerUrl: URL,
    })
    expect(subject).toContain('too early to grade')
    expect(html).not.toContain('PROJECTED')
  })
})

describe('manager psychology is context, not a thumb on the scale', () => {
  const psychology = {
    available: true,
    sides: [
      {
        rosterId: MIDSEASON.sides[0]!.rosterId,
        managerName: MIDSEASON.sides[0]!.managerName,
        labels: ['trade-heavy' as const],
        tradeEvidenceCount: 29,
        confidence: 'high' as const,
        shortfall: null,
      },
      {
        rosterId: MIDSEASON.sides[1]!.rosterId,
        managerName: MIDSEASON.sides[1]!.managerName,
        labels: [],
        tradeEvidenceCount: 1,
        confidence: null,
        shortfall: 'Only 1 trade action on record — not enough to call a pattern.',
      },
    ],
  }

  it('changes nothing about the grade when added', () => {
    // The whole point of the design decision: describe first, influence
    // explicitly. If psychology ever moves the letter, it does so where the
    // reader cannot see it, in a number they take as arithmetic.
    const withPsych = buildTradeGradeEmail({
      leagueName: 'L',
      trade: MIDSEASON,
      ledgerUrl: URL,
      psychology,
    })
    const without = buildTradeGradeEmail({ leagueName: 'L', trade: MIDSEASON, ledgerUrl: URL })

    expect(withPsych.subject).toBe(without.subject)

    // The card must be a pure INSERTION: everything the email said about the
    // grade is byte-identical, with the psychology block added between. Computed
    // as a common prefix/suffix rather than matched by regex, so the assertion
    // cannot be satisfied by a lucky pattern.
    const a = withPsych.html
    const b = without.html
    let head = 0
    while (head < b.length && a[head] === b[head]) head += 1
    let tail = 0
    while (tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1
    expect(b.slice(0, head) + b.slice(b.length - tail)).toBe(b)
    expect(a.length).toBeGreaterThan(b.length)
    // And the inserted region is the psychology card, nothing else.
    expect(a.slice(head, a.length - tail)).toContain('How these managers trade')
  })

  it('says what it observed, and says when it observed too little', () => {
    const { html } = buildTradeGradeEmail({
      leagueName: 'L',
      trade: MIDSEASON,
      ledgerUrl: URL,
      psychology,
    })
    expect(html).toContain('trade-heavy')
    expect(html).toContain('29 recorded trade actions')
    // The unobserved manager is reported as unobserved rather than described as
    // an ordinary trader, which is the same fabrication the profile engine had.
    expect(html).toContain('not enough to call a pattern')
    expect(html).toContain('did not affect the grade')
  })

  it('renders nothing at all when no manager has an observed pattern', () => {
    const { html } = buildTradeGradeEmail({
      leagueName: 'L',
      trade: MIDSEASON,
      ledgerUrl: URL,
      psychology: { available: false, sides: psychology.sides },
    })
    expect(html).not.toContain('How these managers trade')
  })
})
