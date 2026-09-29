import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  buildPendingTradeOfferEmail,
  buildTradeGradeEmail,
  hasNoSignal,
  sideMath,
} from '@/lib/trade-intel/tradeGradeEmail'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import type { LeagueTypeBasis } from '@/lib/league/leagueTypeGrading'
import type { PendingTradeAsset } from '@/lib/provider-trades/scanPendingSleeperTrades'
import type {
  GradedTrade,
  TradeAsset,
  TradePickAsset,
  TradeSideGrade,
} from '@/lib/trade-intel/sleeperTradeGradeService'

/*
 * 🛑 THE EMAIL PRINTS THE APP'S GRADE AND COMPUTES NONE (Guap, 2026-09-25: "the trade emails need to
 * match the grade from the system"). Until then it was a second grader — B (+24%) in the inbox beside
 * A (+25%) on the screen for the same trade, an "uncertainty" from a value no screen uses, and the
 * realized-POINTS scale explaining a value letter. These tests pin the rendering of a supplied
 * `TradeGradeView`; which row it is taken on is pinned in trade-notify-offers.test.ts.
 */

function player(name: string, credited: number, position = 'WR'): TradeAsset {
  return {
    playerId: name,
    name,
    position,
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
    rosterId: o.rosterId ?? 1,
    ownerId: o.ownerId ?? 'o',
    managerName: o.managerName,
    teamName: o.teamName ?? null,
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
    week: 3,
    createdIso: '2026-09-20T01:31:00.000Z',
    multiTeam: sides.length > 2,
    tie,
    hasPendingPicks: sides.some((s) => [...s.picksIn, ...s.picksOut].some((p) => p.pending)),
    sides,
  }
}

/** Preseason: nothing scored, picks undrafted. Side one receives Strange + a 2nd; side two the rest. */
const PRESEASON = trade(
  [
    side({
      rosterId: 1,
      ownerId: 'u1',
      managerName: 'managerOne',
      playersIn: [player('Brenton Strange', 0, 'TE')],
      picksIn: [pick(2, true)],
      playersOut: [player('Rashid Shaheed', 0), player('Woody Marks', 0, 'RB')],
      picksOut: [pick(3, true)],
      net: 0,
    }),
    side({
      rosterId: 2,
      ownerId: 'u2',
      managerName: 'managerTwo',
      playersIn: [player('Rashid Shaheed', 0), player('Woody Marks', 0, 'RB')],
      picksIn: [pick(3, true)],
      playersOut: [player('Brenton Strange', 0, 'TE')],
      picksOut: [pick(2, true)],
      net: 0,
    }),
  ],
  true,
)

/** Points already credited, with realized letters D / B that the email must NOT print. */
const MIDSEASON = trade([
  side({
    rosterId: 1,
    ownerId: 'u1',
    managerName: 'managerOne',
    playersIn: [player('Brenton Strange', 121.4, 'TE')],
    playersOut: [player('Rashid Shaheed', 154.8), player('Woody Marks', 96.1, 'RB')],
    net: -129.5,
    initialGrade: 'D',
  }),
  side({
    rosterId: 2,
    ownerId: 'u2',
    managerName: 'managerTwo',
    playersIn: [player('Rashid Shaheed', 154.8), player('Woody Marks', 96.1, 'RB')],
    playersOut: [player('Brenton Strange', 121.4, 'TE')],
    net: 129.5,
    initialGrade: 'B',
  }),
])

const DYNASTY_FROM_SLEEPER: LeagueTypeBasis = { type: 'dynasty', label: 'Dynasty', source: 'platform', platform: 'Sleeper' }

/** Side one's view: side one sends `give` (Shaheed, Marks, 3rd) and receives `get` (Strange, 2nd). */
function graded(o: Partial<Extract<TradeGradeView, { graded: true }>> = {}): TradeGradeView {
  return {
    graded: true,
    letter: 'A',
    partnerLetter: 'F',
    percentDiff: 25,
    label: 'Major win (you)',
    sideAdvantage: 'you',
    action: 'accept',
    recommendation: 'A clear win on league value. Check lineup fit and injury risk, then take it.',
    giveValue: 6000,
    getValue: 8000,
    giveMarket: 6000,
    getMarket: 8000,
    basis: 'Dynasty · Superflex · 12 teams · PPR',
    scoringApplied: true,
    needApplied: false,
    needGap: null,
    lines: [
      { side: 'give', name: 'Rashid Shaheed', marketValue: 2600, leagueValue: 2600 },
      { side: 'give', name: 'Woody Marks', marketValue: 2100, leagueValue: 2100 },
      { side: 'give', name: '2026 3rd', marketValue: 1300, leagueValue: 1300 },
      { side: 'get', name: 'Brenton Strange', marketValue: 5170, leagueValue: 5170 },
      { side: 'get', name: '2026 2nd', marketValue: 2830, leagueValue: 2830 },
    ],
    moves: [],
    leagueType: DYNASTY_FROM_SLEEPER,
    ...o,
  }
}

const URL = 'https://www.allfantasy.ai/core/trades?league=row-1&trade=tx'
const CONFIRM = 'https://www.allfantasy.ai/core?league=row-1#league-type'

describe('trade grade email — rendering', () => {
  it('emits no literal HTML entities in the visible body', () => {
    const { html } = buildTradeGradeEmail({ leagueName: 'Dads Dynasty', trade: PRESEASON, ledgerUrl: URL, grade: graded() })
    // An old version double-escaped its own spacers, so managers literally read the entity name.
    expect(html).not.toContain('&amp;nbsp;')
    expect(html).not.toContain('&nbsp;')
    expect(html).not.toContain('&middot;')
  })

  it('renders both managers and every asset each side received', () => {
    const { html } = buildTradeGradeEmail({ leagueName: 'Dads Dynasty', trade: PRESEASON, ledgerUrl: URL, grade: graded() })
    for (const text of ['managerOne', 'managerTwo', 'Brenton Strange', 'Rashid Shaheed', 'Woody Marks', '2026 2nd round pick', '2026 3rd round pick']) {
      expect(html, text).toContain(text)
    }
  })

  it('escapes a hostile league name rather than emitting markup', () => {
    const { html } = buildTradeGradeEmail({ leagueName: '<img src=x onerror=alert(1)>', trade: PRESEASON, ledgerUrl: URL, grade: graded() })
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('carries a hidden inbox preview with the letters, not the eyebrow', () => {
    const { html } = buildTradeGradeEmail({ leagueName: 'L', trade: PRESEASON, ledgerUrl: URL, grade: graded() })
    expect(html).toMatch(/display:none[^>]*>managerOne: A \(\+25% value\) · managerTwo: F \(−25% value\)</)
  })
})

describe('the one grade, and only the one grade', () => {
  it('side one holds `letter`, side two the mirror — in the subject and the body', () => {
    const { subject, html } = buildTradeGradeEmail({ leagueName: 'Dads Dynasty', trade: PRESEASON, ledgerUrl: URL, grade: graded() })
    expect(subject).toBe('Trade completed in Dads Dynasty — managerOne A, managerTwo F — Brenton Strange, Rashid Shaheed, Woody Marks, 2026 2nd +1')
    expect(html).toContain('+25% value')
    expect(html).toContain('−25% value')
    expect(html).toContain('Clear win on value')
    expect(html).toContain('Clear overpay')
  })

  it('prints the league value each asset was graded on, and each side’s total', () => {
    const { html } = buildTradeGradeEmail({ leagueName: 'L', trade: PRESEASON, ledgerUrl: URL, grade: graded() })
    // side one receives the `get` lines, side two the `give` lines
    for (const v of ['5,170', '2,830', '8,000', '2,600', '2,100', '1,300', '6,000']) expect(html, v).toContain(v)
  })

  it('a count mismatch prints names without values rather than values against the wrong asset', () => {
    const g = graded({ lines: [{ side: 'get', name: 'Brenton Strange', marketValue: 5170, leagueValue: 5170 }] })
    const { html } = buildTradeGradeEmail({ leagueName: 'L', trade: PRESEASON, ledgerUrl: URL, grade: g })
    expect(html).toContain('Brenton Strange')
    expect(html).not.toContain('5,170')
  })

  it('never prints a realized-points letter, the points scale, an uncertainty or "projected on" copy', () => {
    const { subject, html } = buildTradeGradeEmail({ leagueName: 'L', trade: MIDSEASON, ledgerUrl: URL, grade: graded({ lines: [] }) })
    expect(subject).toContain('managerOne A, managerTwo F')
    expect(subject).not.toMatch(/managerOne D|managerTwo B/)
    expect(html).not.toMatch(/net ≥ 100|Uncertainty|Projected on|MARKET GRADE|last season|121\.4/)
  })

  it('a withheld grade prints no letter at all, and says why', () => {
    const g: TradeGradeView = { graded: false, reason: 'Sample Rookie could not be found in the NFL player database, so this deal is not graded.', basis: null, leagueType: DYNASTY_FROM_SLEEPER }
    const { subject, html } = buildTradeGradeEmail({ leagueName: 'L', trade: PRESEASON, ledgerUrl: URL, grade: g })
    expect(subject).toContain('— not graded —')
    expect(html).toContain('Sample Rookie could not be found')
    expect(html).toContain('Not graded')
    expect(html).not.toMatch(/Clear win|Clear overpay|Even on value/)
  })

  it('no grade at all is not graded, never a neutral C', () => {
    const { subject, html } = buildTradeGradeEmail({ leagueName: 'L', trade: PRESEASON, ledgerUrl: URL, grade: null })
    expect(subject).toContain('not graded')
    expect(html).toContain('could not be loaded')
    expect(html).not.toContain('Even on value')
  })

  it('a three-team trade is not graded even if a letter is supplied', () => {
    const three = trade([...PRESEASON.sides, side({ rosterId: 3, ownerId: 'u3', managerName: 'managerThree', net: 0 })])
    const { subject, html } = buildTradeGradeEmail({ leagueName: 'L', trade: three, ledgerUrl: URL, grade: graded() })
    expect(subject).toContain('not graded')
    expect(html).toContain('Only two-team trades are graded')
    expect(html).toContain('managerThree')
  })
})

/*
 * Guap, 2026-09-29: "make the email explain why it's a C". A C beside "−2%" read as a grader stuck on
 * one letter; the email now says why, in the deal's own totals and the grader's own bands.
 */
describe('why these letters', () => {
  const why = (html: string) => html.match(/Why these letters<\/div><div[^>]*>([^<]*)<\/div><div[^>]*>([^<]*)</)

  it('a C says both totals, the gap, and that it is under the even band', () => {
    // Freedom Fantasy Football, 2026 week 3: Pitts + 2027 3rd (3,259) for Kittle + 2027 4th (3,326).
    const g = graded({ letter: 'C', partnerLetter: 'C', percentDiff: -2, giveValue: 3326, getValue: 3259 })
    const { html } = buildTradeGradeEmail({ leagueName: 'L', trade: PRESEASON, ledgerUrl: URL, grade: g })
    const m = why(html)
    expect(m, 'why card present').not.toBeNull()
    expect(m![1]).toBe(
      'Both sides got a C: managerOne received 3,259 and managerTwo received 3,326 in this league’s values. ' +
        'That is 67 apart, 2% of the bigger side — under 10%, so the trade reads as even and neither side earns a B.',
    )
    expect(m![2]).toBe('The scale: a gap under 10% is a C for both sides · 10–24% is a B and a D · 25% or more is an A and an F.')
  })

  it('a B/D names who gained, by how much, and the band', () => {
    const g = graded({ letter: 'D', partnerLetter: 'B', percentDiff: -18, giveValue: 4000, getValue: 3280 })
    const { html } = buildTradeGradeEmail({ leagueName: 'L', trade: PRESEASON, ledgerUrl: URL, grade: g })
    expect(why(html)![1]).toBe(
      'managerTwo got a B and managerOne a D: managerTwo received 4,000 in this league’s values for 3,280, 18% more. ' +
        'A gap of 10–24% is a B for the side that gained and a D for the side that gave; 25% or more would be an A and an F.',
    )
  })

  it('an A/F says the strong band, with "an"', () => {
    const { html } = buildTradeGradeEmail({ leagueName: 'L', trade: PRESEASON, ledgerUrl: URL, grade: graded() })
    expect(why(html)![1]).toBe(
      'managerOne got an A and managerTwo an F: managerOne received 8,000 in this league’s values for 6,000, 25% more. ' +
        'A gap of 25% or more is an A for the side that gained and an F for the side that gave.',
    )
  })

  it('speaks to the reader as "You" on their own side', () => {
    const g = graded({ letter: 'C', partnerLetter: 'C', percentDiff: -2, giveValue: 3326, getValue: 3259 })
    const { html } = buildTradeGradeEmail({ leagueName: 'L', trade: PRESEASON, ledgerUrl: URL, grade: g, viewerOwnerId: 'u2' })
    expect(why(html)![1]).toMatch(/^Both sides got a C: You received 3,326 and managerOne received 3,259/)
  })

  it('a withheld or missing grade explains nothing — there is no letter to explain', () => {
    const withheld: TradeGradeView = { graded: false, reason: 'One side of this trade has no assets recorded.', basis: null }
    for (const grade of [withheld, null]) {
      const { html } = buildTradeGradeEmail({ leagueName: 'L', trade: PRESEASON, ledgerUrl: URL, grade })
      expect(html).not.toContain('Why these letters')
    }
  })
})

describe('the reader and their league type', () => {
  it('marks the reader’s side YOU, puts it first, and says their letter', () => {
    const { subject, html } = buildTradeGradeEmail({ leagueName: 'L', trade: PRESEASON, ledgerUrl: URL, grade: graded(), viewerOwnerId: 'u2' })
    expect(subject).toContain('— you F, managerOne A —')
    expect(html).toContain('>YOU<')
    expect(html).toContain('Your side graded F')
    // Past the hidden preview, which names the reader "You" and so only mentions managerOne.
    const body = html.indexOf('AllFantasy</div>')
    expect(body).toBeGreaterThan(0)
    expect(html.indexOf('managerTwo', body)).toBeLessThan(html.indexOf('managerOne', body))
  })

  it('asks to confirm an unconfirmed league type, with the same link the app uses', () => {
    const { html } = buildTradeGradeEmail({ leagueName: 'L', trade: PRESEASON, ledgerUrl: URL, grade: graded(), confirmUrl: CONFIRM })
    expect(html).toContain('Dynasty')
    expect(html).toContain('from Sleeper, not confirmed')
    expect(html).toContain('Your league type decides how every trade in this league is graded.')
    expect(html).toContain(`href="${CONFIRM}"`)
    expect(html).toContain('Confirm your league type')
  })

  it('does not nag once the type is confirmed', () => {
    const g = graded({ leagueType: { ...DYNASTY_FROM_SLEEPER, source: 'confirmed' } })
    const { html } = buildTradeGradeEmail({ leagueName: 'L', trade: PRESEASON, ledgerUrl: URL, grade: g, confirmUrl: CONFIRM })
    expect(html).toContain('confirmed')
    expect(html).not.toContain('Confirm your league type')
  })

  it('an explicit league type wins over the one on the grade (a withheld grade may carry none)', () => {
    const g: TradeGradeView = { graded: false, reason: 'x', basis: null }
    const { html } = buildTradeGradeEmail({ leagueName: 'L', trade: PRESEASON, ledgerUrl: URL, grade: g, leagueType: DYNASTY_FROM_SLEEPER, confirmUrl: CONFIRM })
    expect(html).toContain('Confirm your league type')
  })
})

describe('an open offer', () => {
  const get: PendingTradeAsset[] = [{ playerId: '1', playerName: 'Brenton Strange', position: 'TE', team: 'JAX' }]
  const give: PendingTradeAsset[] = [
    { playerId: '2', playerName: 'Rashid Shaheed', position: 'WR', team: 'NO' },
    { playerId: null, playerName: '2027 1st round pick', position: 'PICK', team: '—', isPick: true, pickYear: 2027, pickRoundNumber: 1 },
  ]
  const base = { leagueName: 'Dads Dynasty', proposerName: 'managerTwo', youGet: get, youGive: give, reviewUrl: URL, baseUrl: 'https://www.allfantasy.ai' }
  const offerGrade = (): TradeGradeView =>
    graded({
      letter: 'B',
      partnerLetter: 'D',
      percentDiff: 14,
      label: 'Slightly favors you',
      recommendation: 'Favors you on league value. Confirm lineup fit and player risk before acting.',
      giveValue: 4300,
      getValue: 5000,
      needApplied: true,
      lines: [
        { side: 'give', name: 'Rashid Shaheed', marketValue: 2600, leagueValue: 2600 },
        { side: 'give', name: '2027 1st', marketValue: 1700, leagueValue: 1700 },
        { side: 'get', name: 'Brenton Strange', marketValue: 5000, leagueValue: 5000 },
      ],
    })

  it('with the inbox grade: the letter from the reader’s side, the values, and the recommendation', () => {
    const { subject, html } = buildPendingTradeOfferEmail({ ...base, grade: offerGrade(), confirmUrl: CONFIRM })
    expect(subject).toBe('Trade offer in Dads Dynasty — B for you: you get Brenton Strange for Rashid Shaheed, 2027 1st round pick')
    expect(html).toContain('Slightly favors you · +14% value')
    expect(html).toContain('Favors you on league value.')
    expect(html).toContain('counting how it fits your roster')
    for (const v of ['5,000', '2,600', '1,700', '4,300']) expect(html, v).toContain(v)
    expect(html).toContain('Confirm your league type')
  })

  it('without a grade it is the swap and the link, as before', () => {
    const { subject, html } = buildPendingTradeOfferEmail(base)
    expect(subject).toBe('Trade offer in Dads Dynasty — you get Brenton Strange for Rashid Shaheed, 2027 1st round pick')
    expect(html).toContain('managerTwo sent you an offer on Sleeper.')
    expect(html).not.toContain('Our read')
  })

  it('a withheld offer grade says why and prints no letter', () => {
    const { subject, html } = buildPendingTradeOfferEmail({ ...base, grade: { graded: false, reason: '2027 1st cannot be priced.', basis: null } })
    expect(subject).not.toContain('for you:')
    expect(html).toContain('2027 1st cannot be priced.')
  })

  it('offers no accept button — Sleeper has no write API', () => {
    const { html } = buildPendingTradeOfferEmail({ ...base, grade: offerGrade(), sleeperUrl: 'https://sleeper.com/leagues/1/trade' })
    expect(html).not.toMatch(/>\s*Accept/)
    expect(html).toContain('Answer it in Sleeper')
  })
})

describe('what the realized-points helpers still answer', () => {
  it('detects that nothing has been credited yet', () => {
    expect(hasNoSignal(PRESEASON)).toBe(true)
    expect(hasNoSignal(MIDSEASON)).toBe(false)
  })

  it('reports net as got minus gave', () => {
    const m = sideMath(MIDSEASON.sides[0]!)
    expect(m.got).toBe(121.4)
    expect(m.gave).toBe(250.9)
    expect(m.net).toBe(-129.5)
  })
})

/*
 * Stored manager psychology once rode into this email as a parameter and was withheld at the render
 * boundary. There is no parameter now, so it cannot leak by construction; this keeps it that way.
 */
describe('stored manager psychology cannot reach the email', () => {
  it('neither builder accepts it', () => {
    const src = readFileSync(join(process.cwd(), 'lib/trade-intel/tradeGradeEmail.ts'), 'utf8')
    expect(src).not.toMatch(/psychology\??\s*:/i)
  })
})
