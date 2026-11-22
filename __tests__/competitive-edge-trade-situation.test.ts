/**
 * Manager trade facts (owner's call, 2026-11-22 — trade learning, step 7): the situation around a manager's trades —
 * when, their record, their depth, FAAB — as counts for the paid manager record, never labels.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const m = vi.hoisted(() => ({ leagueTrade: vi.fn(), sportsPlayer: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { leagueTrade: { findMany: m.leagueTrade }, sportsPlayer: { findMany: m.sportsPlayer } } }))

import { buildTradeSituationFacts, type SavedTradeContext, type SituationTrade } from '@/lib/competitive-edge/tradeSituationFacts'
import { buildManagerRecord } from '@/lib/competitive-edge/managerRecord'
import { managerTradeSituationOn, readTradeSituation } from '@/lib/competitive-edge/managerRecordLoader'

const NOW = new Date('2026-11-22T12:00:00Z')
const SF = { QB: 1, SUPER_FLEX: 1, RB: 2, WR: 3, TE: 1 }
const roster = (counts: Record<string, number>) =>
  Object.entries(counts).flatMap(([pos, n]) => Array.from({ length: n }, () => ({ position: pos })))

const trade = (id: string, week: number, mike: Partial<SituationTrade['sides'][number]>): SituationTrade => ({
  id, season: '2026', week, createdIso: '2026-10-15T18:00:00Z',
  sides: [
    { ownerId: 'mike', rosterId: 3, playersIn: [], playersOut: [], picksIn: [], picksOut: [], ...mike },
    { ownerId: 'other', rosterId: 7, playersIn: [], playersOut: [], picksIn: [], picksOut: [] },
  ],
})
const ctx = (wins: number, losses: number, mikeRoster: Array<{ position: string | null }>): SavedTradeContext => ({
  starterSlots: SF,
  sides: [{ rosterId: '3', record: { wins, losses, ties: 0 }, rosterBefore: mikeRoster }, { rosterId: '7', record: { wins: 4, losses: 4, ties: 0 } }],
})

const trades = [
  // At 6-2 (week 9), two QBs in superflex: takes on a 29-year-old QB and pays FAAB.
  trade('L1:a', 9, { playersIn: [{ playerId: 'oldqb', position: 'QB' }], faabOut: 20 }),
  // At 7-1 (week 10), takes on a WR whose age is unknown, with three QBs — not counted as 27 or older.
  trade('L1:b', 10, { playersIn: [{ playerId: 'mystery', position: 'WR' }] }),
  // At 1-7 (week 9): takes on picks.
  trade('L1:c', 9, { picksIn: [{ season: '2027', round: 1 }], faabIn: 5 }),
  // Offseason: no record yet.
  trade('L1:d', 0, { playersIn: [{ playerId: 'young', position: 'RB' }] }),
]
const contexts = new Map<string, SavedTradeContext>([
  ['L1:a', ctx(6, 2, roster({ QB: 2, WR: 5 }))],
  ['L1:b', ctx(7, 1, roster({ QB: 3, WR: 5 }))],
  ['L1:c', ctx(1, 7, roster({ QB: 3, WR: 4 }))],
  ['L1:d', ctx(0, 0, roster({ QB: 3, RB: 5 }))],
])
const ages = new Map<string, number | null>([['oldqb', 29], ['oldwr', 30], ['young', 22]])
const facts = (over: Partial<Parameters<typeof buildTradeSituationFacts>[0]> = {}) =>
  buildTradeSituationFacts({ name: 'Mike', managerOwnerId: 'mike', trades, contexts, ages, now: NOW, ...over })
const text = (fs: ReturnType<typeof facts>, key: string) => fs.find((f) => f.key === key)?.text

describe('the situation around a manager\'s trades', () => {
  it('when in the season they trade', () => {
    expect(text(facts(), 'trade.situation.timing')).toBe("Of Mike's 4 trades, 1 came in the offseason or week 1, 0 in weeks 2–8 and 3 from week 9 on.")
  })

  it('their record when they traded, and what they took on from there — thresholds stated, not labels', () => {
    const fs = facts()
    expect(text(fs, 'trade.situation.record')).toBe('With a record on file for 3 trades (week 4 on): 2 made at .600 or better, 1 at .400 or worse and 0 in between.')
    // Only the 29-year-old counts; the receiver of unknown age is not assumed to be old.
    expect(text(fs, 'trade.situation.ahead')).toBe('Of the 2 trades they made at .600 or better, 1 took on a player 27 or older and 0 took on draft picks.')
    expect(text(fs, 'trade.situation.behind')).toBe('Of the 1 trade they made at .400 or worse, 0 took on a player 27 or older and 1 took on draft picks.')
  })

  it('their depth at what they took on: two QBs in superflex is no spare quarterback', () => {
    const fs = facts()
    expect(text(fs, 'trade.situation.depth.QB')).toBe('Mike took on a QB in 1 trade with their roster on file; in 1 of them they held no spare quarterback (superflex counted as a QB slot).')
    expect(text(fs, 'trade.situation.depth.WR')).toBe('Mike took on a WR in 1 trade with their roster on file; in 0 of them they held no spare WR.')
    expect(text(fs, 'trade.situation.faab')).toBe('Mike sent FAAB in 1 of their 4 trades ($20 in all) and received it in 1 ($5).')
    expect(text(fs, 'trade.situation.source')).toBe('Record and roster at the time are on file for all 4 trades.')
  })

  it('facts only: no trait words anywhere', () => {
    for (const f of facts()) expect(f.text).not.toMatch(/buyer|seller|contender|rebuild|win-now|aggressive|shark|likes/i)
  })

  it('coverage is part of the answer: too few trades says nothing; too few contexts says only that', () => {
    expect(facts({ trades: trades.slice(0, 2) })).toEqual([])
    const thin = facts({ contexts: new Map([...contexts].slice(0, 2)) })
    expect(text(thin, 'trade.situation.coverage')).toBe("Only 2 trades of Mike's 4 have their situation on file — fewer than 3, so nothing is read from it yet.")
    expect(text(thin, 'trade.situation.record')).toBeUndefined()
    // An "unavailable" marker is not a context.
    const marked = facts({ contexts: new Map([...contexts].map(([k, v]) => [k, k === 'L1:a' ? { unavailable: 'no_roster_rows' } : v])) })
    expect(text(marked, 'trade.situation.source')).toBe('Record and roster at the time are on file for 3 of their 4 trades.')
  })

  it('the side is matched by roster id: the partner\'s record is never read as theirs', () => {
    const swapped = new Map([...contexts].map(([k, v]) => [k, { ...v, sides: v.sides!.map((s) => ({ ...s, rosterId: s.rosterId === '3' ? '9' : s.rosterId })) }]))
    expect(facts({ contexts: swapped }).find((f) => f.key === 'trade.situation.record')).toBeUndefined()
  })
})

describe('in the manager record', () => {
  const base = {
    manager: { name: 'Mike', teamExternalId: '3', ownerId: 'mike' },
    viewerOwnerId: null,
    waivers: { available: false as const, reason: 'n/a' },
    drafts: { available: false as const, reason: 'n/a' },
  }
  const history = { trades: trades as never, seasonsScanned: ['2026'], historyGaps: [], asOf: NOW.toISOString(), stale: false }

  it('the situation lines follow the record\'s own; without a read situation the record is exactly as before', () => {
    const plain = buildManagerRecord({ ...base, trades: { available: true, data: history } })
    const withSit = buildManagerRecord({ ...base, trades: { available: true, data: { ...history, situation: { contexts, ages, now: NOW } } } })
    if (!plain.trades.available || !withSit.trades.available) throw new Error('unavailable')
    expect(withSit.trades.data.facts.slice(0, plain.trades.data.facts.length)).toEqual(plain.trades.data.facts)
    expect(withSit.trades.data.facts.map((f) => f.key)).toContain('trade.situation.record')
    expect(plain.trades.data.facts.some((f) => f.key.startsWith('trade.situation'))).toBe(false)
  })
})

describe('reading the situation', () => {
  it('one read for the trades\' saved contexts (by league and transaction), one for the ages; MANAGER_TRADE_SITUATION=off', async () => {
    m.leagueTrade.mockResolvedValue([
      { transactionId: 'a', contextSnapshot: contexts.get('L1:a'), history: { sleeperLeagueId: 'L1' } },
      { transactionId: 'a', contextSnapshot: { other: 'side row' }, history: { sleeperLeagueId: 'L1' } },
    ])
    m.sportsPlayer.mockResolvedValue([{ sleeperId: 'oldqb', age: 29 }])
    const r = await readTradeSituation(trades, NOW)
    const where = m.leagueTrade.mock.calls[0]![0].where
    expect(where.transactionId.in.sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(where.history.sleeperLeagueId.in).toEqual(['L1'])
    expect(r.contexts.get('L1:a')).toEqual(contexts.get('L1:a'))
    expect(r.contexts.size).toBe(1)
    expect(r.ages.get('oldqb')).toBe(29)
    expect(managerTradeSituationOn({})).toBe(true)
    expect(managerTradeSituationOn({ MANAGER_TRADE_SITUATION: 'off' })).toBe(false)
  })
})
