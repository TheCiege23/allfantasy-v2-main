import { describe, expect, it } from 'vitest'

import { buildTradeEdge, TRADE_FLOOR, type EdgeTrade, type EdgeTradeSide } from '@/lib/competitive-edge/tradeEdge'

/*
 * Competitive Edge for a trade (lib/competitive-edge/tradeEdge.ts). The contract is Milestone 32's:
 * counts over real trades, bound to the deal and the manager, coverage stated, no labels, no odds.
 */

const MANAGER = 'sleeper-user-tasha'
const VIEWER = 'sleeper-user-you'
const OTHER = 'sleeper-user-mike'

const side = (ownerId: string, over: Partial<EdgeTradeSide> = {}): EdgeTradeSide => ({
  ownerId,
  playersIn: [],
  playersOut: [],
  picksIn: [],
  picksOut: [],
  ...over,
})
const p = (position: string | null) => ({ position })
const trade = (id: string, season: string, createdIso: string, sides: EdgeTradeSide[]): EdgeTrade => ({
  id,
  season,
  week: 5,
  createdIso,
  sides,
})

/** Tasha's five trades across two seasons, plus one that does not involve her. */
const HISTORY: EdgeTrade[] = [
  trade('t1', '2024', '2024-09-20T15:00:00.000Z', [
    side(MANAGER, { playersIn: [p('WR')], playersOut: [p('RB'), p('TE')] }),
    side(OTHER, { playersIn: [p('RB'), p('TE')], playersOut: [p('WR')] }),
  ]),
  trade('t2', '2024', '2024-10-11T15:00:00.000Z', [
    side(MANAGER, { playersIn: [p('WR'), p('WR')], playersOut: [p('QB')], picksOut: [{}] }),
    side(VIEWER, { playersIn: [p('QB')], playersOut: [p('WR'), p('WR')], picksIn: [{}] }),
  ]),
  trade('t3', '2025', '2025-08-30T15:00:00.000Z', [
    side(MANAGER, { playersIn: [p('RB')], playersOut: [p('RB')] }),
    side(OTHER, { playersIn: [p('RB')], playersOut: [p('RB')] }),
  ]),
  trade('t4', '2025', '2025-11-02T15:00:00.000Z', [
    side(MANAGER, { playersIn: [p('WR')], picksIn: [{}], playersOut: [p('TE')] }),
    side(OTHER, { playersIn: [p('TE')], playersOut: [p('WR')], picksOut: [{}] }),
  ]),
  trade('t5', '2026', '2026-09-10T15:00:00.000Z', [
    side(MANAGER, { playersIn: [p('QB')], playersOut: [p('WR'), p('RB')] }),
    side(VIEWER, { playersIn: [p('WR'), p('RB')], playersOut: [p('QB')] }),
  ]),
  // Not hers — must not be counted.
  trade('t6', '2026', '2026-09-12T15:00:00.000Z', [side(OTHER, { playersIn: [p('WR')] }), side(VIEWER, { playersOut: [p('WR')] })]),
]

const BASE = {
  trades: HISTORY,
  managerOwnerId: MANAGER,
  managerName: 'tashaR',
  teamExternalId: '3',
  viewerOwnerId: VIEWER,
  seasonsScanned: ['2026', '2024', '2025'],
  historyGaps: [],
  asOf: '2026-09-24T18:00:00.000Z',
  stale: false,
}

const fact = (edge: ReturnType<typeof buildTradeEdge>, key: string) => edge.facts.find((f) => f.key === key)?.text

describe('Competitive Edge — a trade decision', () => {
  it('counts only this manager’s trades, across seasons, and says how many and since when', () => {
    const edge = buildTradeEdge({ ...BASE, deal: { theyGet: [], theySend: [] } })
    expect(edge.coverage).toMatchObject({ trades: 5, firstSeason: '2024', sufficient: true, shortfall: null })
    expect(edge.coverage.seasons).toEqual(['2024', '2025', '2026'])
    expect(edge.coverage.lastTradeAt).toBe('2026-09-10T15:00:00.000Z')
    expect(fact(edge, 'trade.volume')).toBe('tashaR has made 5 trades in this league since 2024; the last was Sep 10, 2026.')
    expect(fact(edge, 'trade.with_you')).toBe('2 of them were with you.')
  })

  it('binds to the deal: the positions she would take on and send, each against her own trades', () => {
    const edge = buildTradeEdge({
      ...BASE,
      deal: { theyGet: [{ kind: 'player', position: 'WR' }], theySend: [{ kind: 'player', position: 'RB' }] },
    })
    // WR in t1, t2 (two), t4 — 3 of 5 trades, 4 WRs.
    expect(fact(edge, 'trade.acquired.WR')).toBe('tashaR took on a WR in 3 of their 5 trades (4 WRs in all).')
    // RB out in t1, t3, t5.
    expect(fact(edge, 'trade.sent.RB')).toBe('tashaR sent away a RB in 3 of their 5 trades.')
    // The deal lines lead, then the record.
    expect(edge.facts.map((f) => f.bearsOnDeal)).toEqual([true, true, false, false])
  })

  it('says a zero as a zero, rather than leaving the position out', () => {
    const edge = buildTradeEdge({ ...BASE, deal: { theyGet: [{ kind: 'player', position: 'K' }], theySend: [] } })
    expect(fact(edge, 'trade.acquired.K')).toBe("tashaR hasn't taken on a K in any of their 5 trades.")
  })

  it('reads picks only when the deal has picks, in the direction the deal moves them', () => {
    const none = buildTradeEdge({ ...BASE, deal: { theyGet: [{ kind: 'player', position: 'WR' }], theySend: [] } })
    expect(none.facts.some((f) => f.key.startsWith('trade.picks'))).toBe(false)
    const toThem = buildTradeEdge({ ...BASE, deal: { theyGet: [{ kind: 'pick' }], theySend: [{ kind: 'pick' }] } })
    expect(fact(toThem, 'trade.picks.acquired')).toBe('tashaR took on draft picks in 1 of their 5 trades.')
    expect(fact(toThem, 'trade.picks.sent')).toBe('tashaR gave up draft picks in 1 of their 5 trades.')
  })

  it('reads the deal’s shape — fewer pieces back, or more — against how her trades went', () => {
    const fewer = buildTradeEdge({
      ...BASE,
      deal: { theyGet: [{ kind: 'player', position: 'QB' }], theySend: [{ kind: 'player', position: 'WR' }, { kind: 'player', position: 'RB' }] },
    })
    // Pieces back vs given: t1 1–2, t2 2–2, t3 1–1, t4 2–1, t5 1–2 → fewer back in t1 and t5.
    expect(fact(fewer, 'trade.shape.fewer_back')).toBe(
      'This offer gives tashaR fewer pieces than they send. They took back fewer pieces than they gave in 2 of their 5 trades.',
    )
    const even = buildTradeEdge({
      ...BASE,
      deal: { theyGet: [{ kind: 'player', position: 'QB' }], theySend: [{ kind: 'player', position: 'WR' }] },
    })
    expect(even.facts.some((f) => f.key.startsWith('trade.shape'))).toBe(false)
  })

  it(`🛑 below ${TRADE_FLOOR} trades it shows the record and NO pattern — two trades are an anecdote`, () => {
    const edge = buildTradeEdge({
      ...BASE,
      trades: HISTORY.slice(0, 2),
      deal: { theyGet: [{ kind: 'player', position: 'WR' }], theySend: [{ kind: 'pick' }] },
    })
    expect(edge.coverage.sufficient).toBe(false)
    expect(edge.coverage.shortfall).toBe('Only 2 completed trades on file — fewer than 3, so no pattern is shown.')
    expect(edge.facts.every((f) => !f.bearsOnDeal)).toBe(true)
    expect(fact(edge, 'trade.volume')).toBe('tashaR has made 2 trades in this league since 2024; the last was Oct 11, 2024.')
  })

  it('a manager with no trades on file says so, and never implies they refuse to trade', () => {
    const edge = buildTradeEdge({ ...BASE, managerOwnerId: 'nobody', deal: { theyGet: [{ kind: 'player', position: 'WR' }], theySend: [] } })
    expect(edge.coverage.trades).toBe(0)
    expect(edge.facts.map((f) => f.text)).toEqual(["tashaR has no completed trades in this league's history on file."])
    expect(edge.coverage.shortfall).toBe('No completed trades by tashaR on file, so there is nothing to read yet.')
  })

  it('keeps only the history gaps that could hide a trade, and passes freshness through', () => {
    const edge = buildTradeEdge({
      ...BASE,
      historyGaps: ['2023: transactions', '2025: season stats', 'part of the league chain (an older season did not load)', '2024: some weekly stat lines'],
      stale: true,
      deal: { theyGet: [], theySend: [] },
    })
    expect(edge.coverage.gaps).toEqual(['2023: transactions', 'part of the league chain (an older season did not load)'])
    expect(edge.coverage).toMatchObject({ stale: true, asOf: '2026-09-24T18:00:00.000Z' })
  })

  it('no viewer id → no "with you" line rather than a false zero', () => {
    const edge = buildTradeEdge({ ...BASE, viewerOwnerId: null, deal: { theyGet: [], theySend: [] } })
    expect(fact(edge, 'trade.with_you')).toBeUndefined()
  })
})

/*
 * 🛑 FACTS, NEVER LABELS OR ODDS. Every line the builder can produce, over a deal that exercises every
 * branch, is checked against the vocabulary Milestone 32 retired and the prediction language Milestone
 * 34 has not earned. The positive control proves the check can see a planted word.
 */
describe('the contract: no labels, no acceptance odds', () => {
  const FORBIDDEN = /\b(likes?|loves?|hates?|prefers?|tends?|usually|always|never|shark|gambler|taco|aggressive|conservative|risky|archetype|style|personality|likely|probab\w*|chance|odds|will accept|won't accept|%)/i
  const everyLine = () => {
    const deals = [
      { theyGet: [{ kind: 'player' as const, position: 'WR' }, { kind: 'pick' as const }], theySend: [{ kind: 'player' as const, position: 'RB' }, { kind: 'pick' as const }, { kind: 'player' as const, position: 'QB' }] },
      { theyGet: [{ kind: 'player' as const, position: 'K' }, { kind: 'player' as const, position: 'TE' }], theySend: [{ kind: 'player' as const, position: 'DEF' }] },
    ]
    return [
      ...deals.flatMap((deal) => buildTradeEdge({ ...BASE, deal }).facts.map((f) => f.text)),
      ...deals.flatMap((deal) => buildTradeEdge({ ...BASE, trades: HISTORY.slice(0, 1), deal }).facts.map((f) => f.text)),
      ...deals.flatMap((deal) => buildTradeEdge({ ...BASE, managerOwnerId: 'nobody', deal }).facts.map((f) => f.text)),
    ]
  }

  it('no line uses a label, a trait or a prediction', () => {
    const lines = everyLine()
    expect(lines.length).toBeGreaterThan(10)
    expect(lines.filter((l) => FORBIDDEN.test(l))).toEqual([])
  })

  it('[control] the check sees a planted label', () => {
    expect(FORBIDDEN.test('tashaR likes WRs')).toBe(true)
    expect(FORBIDDEN.test('a 62% chance they accept')).toBe(true)
  })
})
