/**
 * A completed Sleeper trade's ORIGINAL grade is frozen the first time any surface grades it, and every
 * surface afterwards shows THAT letter — oriented to its own side — with today's re-evaluation beside
 * it, never merged into it. Guap's ruling 2026-09-28: the existing `trade_analysis_snapshots` table,
 * no migration.
 *
 * The scenario is the D.K. Metcalf report, for an imported league: the email grades the trade, the
 * market moves, and the manager opens history. Before this, history re-priced and showed a different
 * letter from the email. The table is an in-memory stand-in with the real call shapes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

type Row = { leagueId: string; sleeperUsername: string; snapshotType: string; contextKey: string | null; payloadJson: unknown; createdAt: Date }
const table: Row[] = []
let failWrites = false
vi.mock('@/lib/prisma', () => ({
  prisma: {
    tradeAnalysisSnapshot: {
      findMany: vi.fn(async ({ where }: { where: { leagueId: string; sleeperUsername: string; snapshotType: string; contextKey: { in: string[] } } }) =>
        table
          .filter((r) => r.leagueId === where.leagueId && r.sleeperUsername === where.sleeperUsername
            && r.snapshotType === where.snapshotType && where.contextKey.in.includes(r.contextKey ?? ''))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())),
      createMany: vi.fn(async ({ data }: { data: Array<Omit<Row, 'createdAt'>> }) => {
        if (failWrites) throw new Error('write refused')
        for (const d of data) table.push({ ...d, createdAt: new Date(Date.now() + table.length) })
        return { count: data.length }
      }),
    },
  },
}))

type Asset = { kind: string; name?: string; providerIdentity?: { id: string }; year?: number; round?: number }
/** Sleeper id → league value. Mutable: a test moves the market between two reads. */
const VALUES: Record<string, number> = {}
const keyOf = (a: Asset) => (a.kind === 'pick' ? `pick:${a.year}:${a.round}` : `sleeper:${a.providerIdentity?.id}`)

vi.mock('@/lib/decision-os/trade/leagueTradeGrader', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/decision-os/trade/leagueTradeGrader')>()
  const { gradeTrade } = await import('@/lib/decision-os/trade/tradeGrade')
  return {
    ...orig,
    createLeagueTradeGrader: vi.fn(async ({ leagueId }: { leagueId: string }) => ({
      leagueId, chart: {}, leagueType: null,
      async grade(deal: { give: Asset[]; get: Asset[] }) {
        const missing = [...deal.give, ...deal.get].filter((a) => VALUES[keyOf(a)] == null)
        if (missing.length > 0) return { graded: false, reason: `${missing.map(keyOf).join(', ')} has no value yet`, basis: null }
        const total = (xs: Asset[]) => xs.reduce((s, a) => s + VALUES[keyOf(a)]!, 0)
        return gradeTrade({
          giveValue: total(deal.give), getValue: total(deal.get), giveMarket: total(deal.give), getMarket: total(deal.get),
          unpriced: 0, giveCount: deal.give.length, getCount: deal.get.length,
          basis: 'Dynasty · 1QB · 12 teams · PPR', scoringApplied: true, needApplied: false, needGap: null, lines: [], moves: [],
        })
      },
    })),
  }
})
vi.mock('@/lib/core-app/archivedPickOutcomes', () => ({
  ledgerKey: (league: string, tx: string) => `${league}:${tx}`,
  loadLedgerSidesForTrades: vi.fn(async () => new Map()),
}))

import { oneGradeForCompletedTrade } from '@/lib/decision-os/trade/completedTradeGrade'
import { mirrorTradeGrade, type TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import { withFrozenOriginal, loadFrozenCompletedGrades, sleeperTradeKey } from '@/lib/decision-os/trade/frozenCompletedGrade'
import { gradeArchivedTradeRows } from '@/lib/core-app/archivedTradeGrade'
import { clearActivityTradeGradeMemo, gradeSleeperActivityTrade } from '@/lib/activity/tradeGrades'
import { gradeProviderRecentTrade, liveCompletedTrade } from '@/lib/core-app/recentTrades'
import { buildTradeAssetsForRoster } from '@/lib/provider-trades/scanPendingSleeperTrades'
import { gradeMoment } from '@/lib/decision-os/trade/gradeMoment'
import type { GradedTrade } from '@/lib/trade-intel/sleeperTradeGradeService'

const SEASON = 2026
const NOW = new Date(Date.UTC(SEASON, 8, 28, 16))
const PLAYERS = {
  '6794': { full_name: 'DK Metcalf', position: 'WR', team: 'PIT' },
  '11001': { full_name: 'Some Receiver', position: 'WR', team: 'CHI' },
}
// Roster 1 sends Metcalf; roster 2 sends a 2027 2nd and Some Receiver.
const TX = {
  type: 'trade', transaction_id: '1297011223344556677', status: 'complete', roster_ids: [1, 2],
  adds: { '6794': 2, '11001': 1 }, drops: { '6794': 1, '11001': 2 },
  draft_picks: [{ season: '2027', round: 2, roster_id: 2, previous_owner_id: 2, owner_id: 1 }],
  waiver_budget: [], leg: 3, created: 0, creator: 'x', consenter_ids: [1, 2], status_updated: 0,
}
const ledgerTrade = {
  id: `1338541390891606016:${TX.transaction_id}`, season: '2026', week: 3, createdIso: '', multiTeam: false, tie: false, hasPendingPicks: false,
  sides: [
    { rosterId: 1, playersIn: [{ playerId: '11001', name: 'Some Receiver', position: 'WR' }], playersOut: [{ playerId: '6794', name: 'DK Metcalf', position: 'WR' }],
      picksIn: [{ season: '2027', round: 2, originalRosterId: 2, label: '2027 round 2', resolved: null, pending: true, rerouted: false }], picksOut: [] },
    { rosterId: 2, playersIn: [{ playerId: '6794', name: 'DK Metcalf', position: 'WR' }], playersOut: [{ playerId: '11001', name: 'Some Receiver', position: 'WR' }],
      picksIn: [], picksOut: [{ season: '2027', round: 2, originalRosterId: 2, label: '2027 round 2', resolved: null, pending: true, rerouted: false }] },
  ],
} as unknown as GradedTrade
const row = (roster: 1 | 2) => roster === 1
  ? { transactionId: TX.transaction_id, playersReceived: ['11001'], playersGiven: ['6794'], picksReceived: [{ season: '2027', round: 2 }], picksGiven: [], partnerRosterId: 2 }
  : { transactionId: TX.transaction_id, playersReceived: ['6794'], playersGiven: ['11001'], picksReceived: [], picksGiven: [{ season: '2027', round: 2 }], partnerRosterId: 1 }
const nameOf = (id: string) => PLAYERS[id as keyof typeof PLAYERS]?.full_name ?? null

let n = 0
beforeEach(() => {
  table.length = 0
  failWrites = false
  clearActivityTradeGradeMemo()
  Object.assign(VALUES, { 'sleeper:6794': 1766, 'sleeper:11001': 400, 'pick:2027:2': 1184 })
  n++
})
const AF = () => `af-kbfl-${n}` // one league row per test; the grader is memoised per id

describe('the original grade is frozen once and shown everywhere', () => {
  it('🛑 the email freezes it; after the market moves, history, League Buzz and the band show the ORIGINAL', async () => {
    // 1 — the email grades first (roster 1: 1,766 out, 1,584 in).
    const email = await oneGradeForCompletedTrade(AF(), ledgerTrade, SEASON, { now: NOW })
    if (!email.graded) throw new Error(email.reason)
    expect([email.giveValue, email.getValue]).toEqual([1766, 1584])
    expect(email.frozenAt).toBe(NOW.toISOString())
    expect(table).toHaveLength(1)

    // 2 — the market moves hard toward roster 1.
    Object.assign(VALUES, { 'sleeper:6794': 900, 'sleeper:11001': 2000 })

    // 3 — /core history, from EACH manager's own copy.
    const one = (await gradeArchivedTradeRows({ afLeagueId: AF(), platformLeagueId: 'sl', rows: [row(1)], currentSeason: SEASON, nameOf })).get(TX.transaction_id)!.grade
    const two = (await gradeArchivedTradeRows({ afLeagueId: AF(), platformLeagueId: 'sl', rows: [row(2)], currentSeason: SEASON, nameOf })).get(TX.transaction_id)!.grade
    if (!one.graded || !two.graded) throw new Error('expected grades')
    expect([one.letter, one.partnerLetter, one.giveValue, one.getValue]).toEqual([email.letter, email.partnerLetter, 1766, 1584])
    expect([two.letter, two.partnerLetter]).toEqual([email.partnerLetter, email.letter]) // the mirror, not a re-grade
    expect(one.frozenAt).toBe(email.frozenAt)
    // …and today's re-evaluation rides beside it, oriented to each side, never merged in.
    expect(one.current).toMatchObject({ giveValue: 900, getValue: 3184 })
    expect(two.current).toMatchObject({ giveValue: 3184, getValue: 900, letter: one.current!.partnerLetter })
    expect(one.current!.letter).not.toBe(one.letter)

    // 4 — League Buzz shows the original too, and says so.
    const buzz = await gradeSleeperActivityTrade({ afLeagueId: AF(), tx: TX as never, rosterNames: new Map([[1, 'A'], [2, 'B']]), players: PLAYERS, now: NOW.getTime() })
    expect(buzz).toEqual({ graded: true, basis: 'first-graded', sides: [{ name: 'A', letter: email.letter }, { name: 'B', letter: email.partnerLetter }] })

    // 5 — the band before the ledger has the trade: original letters, and today's named where it moved.
    const c = buildTradeAssetsForRoster({ tx: TX as never, userRosterId: 1, players: PLAYERS as never })
    const band = liveCompletedTrade({ id: AF(), name: 'KBFL', platformLeagueId: 'sl' },
      { transactionId: TX.transaction_id, proposedAt: NOW.toISOString(), proposedBy: 'B', viewerRosterExternalId: '1', counterpartyRosterExternalId: '2', ...c } as never)!
    await gradeProviderRecentTrade(band, NOW)
    expect(band.sides.map((s) => s.grade)).toEqual([email.letter, email.partnerLetter])
    expect(band.gradedAt).toBe(email.frozenAt)
    expect(band.sides[0]!.gradeReason).toContain(`on this league’s values ${gradeMoment(email)}`)
    expect(band.sides[0]!.gradeReason).toContain(`On today’s values: ${one.current!.letter}.`)

    // Still one frozen row: nothing re-froze, nothing was overwritten.
    expect(table).toHaveLength(1)
  })

  it('a withheld grade is not an original: it keeps recomputing, and freezes once it can be graded', async () => {
    delete VALUES['sleeper:11001']
    const first = await oneGradeForCompletedTrade(AF(), ledgerTrade, SEASON, { now: NOW })
    expect(first.graded).toBe(false)
    expect(table).toHaveLength(0)

    VALUES['sleeper:11001'] = 400
    const later = await oneGradeForCompletedTrade(AF(), ledgerTrade, SEASON, { now: NOW })
    expect(later.graded && later.frozenAt).toBe(NOW.toISOString())
    expect(table).toHaveLength(1)
  })

  it('each AF league row freezes its OWN original — one Sleeper league is many rows', async () => {
    await oneGradeForCompletedTrade('af-row-a', ledgerTrade, SEASON, { now: NOW })
    Object.assign(VALUES, { 'sleeper:6794': 900 })
    const b = await oneGradeForCompletedTrade('af-row-b', ledgerTrade, SEASON, { now: NOW })
    expect(table.map((r) => r.leagueId).sort()).toEqual(['af-row-a', 'af-row-b'])
    expect(b.graded && b.giveValue).toBe(900) // row b never saw row a's original
  })

  it('a write that fails leaves the letter as TODAY’s — it never claims to be an original', async () => {
    failWrites = true
    const g = await oneGradeForCompletedTrade(AF(), ledgerTrade, SEASON, { now: NOW })
    expect(g.graded).toBe(true)
    expect(g.graded && g.frozenAt).toBeFalsy()
  })

  it('the earliest row wins when two first reads raced', async () => {
    const afId = AF()
    await oneGradeForCompletedTrade(afId, ledgerTrade, SEASON, { now: NOW })
    const firstLetter = (table[0]!.payloadJson as { grade: { letter: string } }).grade.letter
    // A racing second writer with a different market.
    Object.assign(VALUES, { 'sleeper:6794': 100 })
    const { saveFrozenCompletedGrades } = await import('@/lib/decision-os/trade/frozenCompletedGrade')
    const racer = withFrozenOriginal({
      tradeId: ledgerTrade.id, now: new Date(NOW.getTime() + 1000), frozen: undefined,
      inputs: { give: { assets: [{ kind: 'player', name: 'DK Metcalf', providerIdentity: { provider: 'sleeper', id: '6794' } }], unpriceable: [] },
        get: { assets: [{ kind: 'player', name: 'Some Receiver', providerIdentity: { provider: 'sleeper', id: '11001' } }, { kind: 'pick', year: 2027, round: 2 }], unpriceable: [] } },
      current: { ...(await oneGradeForCompletedTrade('scratch', ledgerTrade, SEASON)), frozenAt: undefined, current: undefined } as TradeGradeView,
    }).toFreeze!
    await saveFrozenCompletedGrades(afId, [racer])
    const read = (await loadFrozenCompletedGrades(afId, [TX.transaction_id])).get(TX.transaction_id)!
    expect(read.grade.letter).toBe(firstLetter)
  })
})

describe('withFrozenOriginal — pure orientation rules', () => {
  const inputs = (give: string[], get: string[]) => ({
    give: { assets: give.map((id) => ({ kind: 'player' as const, name: id, providerIdentity: { provider: 'sleeper' as const, id } })), unpriceable: [] },
    get: { assets: get.map((id) => ({ kind: 'player' as const, name: id, providerIdentity: { provider: 'sleeper' as const, id } })), unpriceable: [] },
  })
  const graded = async (give: number, get: number) => {
    const { gradeTrade } = await import('@/lib/decision-os/trade/tradeGrade')
    return gradeTrade({ giveValue: give, getValue: get, giveMarket: give, getMarket: get, unpriced: 0, giveCount: 1, getCount: 1,
      basis: 'x', scoringApplied: true, needApplied: false, needGap: null, lines: [], moves: [] })
  }

  it('assets that match NEITHER way are a different deal: today’s grade, no borrowed letter, nothing frozen', async () => {
    const original = withFrozenOriginal({ tradeId: 't1', inputs: inputs(['a'], ['b']), current: await graded(1000, 2000), frozen: undefined, now: NOW }).toFreeze!
    const other = await graded(1000, 1000)
    const out = withFrozenOriginal({ tradeId: 't1', inputs: inputs(['a'], ['c']), current: other, frozen: original, now: NOW })
    expect(out.view).toBe(other)
    expect(out.toFreeze).toBeNull()
  })

  it('mirrorTradeGrade flips today’s re-evaluation with the original', async () => {
    const view = { ...(await graded(1000, 2000)), frozenAt: NOW.toISOString(), current: { letter: 'B' as const, partnerLetter: 'D' as const, giveValue: 1, getValue: 2 } }
    const m = mirrorTradeGrade(view)
    expect(m.graded && m.current).toEqual({ letter: 'D', partnerLetter: 'B', giveValue: 2, getValue: 1 })
    expect(m.graded && m.frozenAt).toBe(NOW.toISOString())
  })

  it('keys a trade on Sleeper’s own transaction id, whatever prefix a surface wraps it in', () => {
    expect(sleeperTradeKey(`1338541390891606016:${TX.transaction_id}`)).toBe(TX.transaction_id)
    expect(sleeperTradeKey(`sleeper:1338541390891606016:${TX.transaction_id}`)).toBe(TX.transaction_id)
    expect(sleeperTradeKey(TX.transaction_id)).toBe(TX.transaction_id)
  })
})
