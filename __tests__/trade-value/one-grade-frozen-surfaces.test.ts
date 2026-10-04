/**
 * 🛑 A COMPLETED TRADE SHOWS ITS FROZEN ORIGINAL GRADE ON EVERY SURFACE (Guap's ruling, 2026-09-28).
 *
 * /core Trades, the trades board, the grade email and League Buzz already read the frozen original
 * (`frozenCompletedGrade.ts`). Two surfaces still re-graded on TODAY's values at read time, so the same
 * Sleeper trade could carry one letter there and another everywhere else (found 2026-10-03):
 *
 *  - the Trade Center's provider-completed rows (`app/api/league/trades-panel/route.ts`), which called
 *    `gradeDeal` directly for them;
 *  - league chat trade cards (`lib/league-chat/tradeCardGrade.ts`), which called `gradeArchivedTrade`
 *    without `original`, and by player NAME — so even a frozen row could not have matched.
 *
 * Structural guard first (each completed-trade surface reaches the frozen path), then the behaviour:
 * the email freezes the grade, the market moves, and both surfaces still show the original, oriented
 * to their own side, saying when it was taken. The table is an in-memory stand-in with the real call
 * shapes, as in `completed-trade-frozen-original.test.ts`.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

type Row = { leagueId: string; sleeperUsername: string; snapshotType: string; contextKey: string | null; payloadJson: unknown; createdAt: Date }
const table: Row[] = []
vi.mock('@/lib/prisma', () => ({
  prisma: {
    tradeAnalysisSnapshot: {
      findMany: vi.fn(async ({ where }: { where: { leagueId: string; sleeperUsername: string; snapshotType: string; contextKey: { in: string[] } } }) =>
        table
          .filter((r) => r.leagueId === where.leagueId && r.sleeperUsername === where.sleeperUsername
            && r.snapshotType === where.snapshotType && where.contextKey.in.includes(r.contextKey ?? ''))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())),
      createMany: vi.fn(async ({ data }: { data: Array<Omit<Row, 'createdAt'>> }) => {
        for (const d of data) table.push({ ...d, createdAt: new Date(Date.now() + table.length) })
        return { count: data.length }
      }),
    },
  },
}))

type Asset = { kind: string; name?: string; providerIdentity?: { id: string }; year?: number; round?: number }
/** Sleeper id → league value. Mutable: a test moves the market between two reads. */
const VALUES: Record<string, number> = {}
// A player priced by NAME has no value here — the live surfaces price him by Sleeper id.
const keyOf = (a: Asset) => (a.kind === 'pick' ? `pick:${a.year}:${a.round}` : a.providerIdentity ? `sleeper:${a.providerIdentity.id}` : `name:${a.name}`)

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

import { oneGradeForCompletedTrade } from '@/lib/decision-os/trade/completedTradeGrade'
import { gradeMoment } from '@/lib/decision-os/trade/gradeMoment'
import { buildTradeAssetsForRoster, type PendingProviderTrade } from '@/lib/provider-trades/scanPendingSleeperTrades'
import { gradeProviderCompletedTrades } from '@/lib/provider-trades/providerCompletedGrades'
import { gradeImportedTradeCard } from '@/lib/league-chat/tradeCardGrade'
import { gradedTradeTakeText, readTradeCardGrade, tradeCardGradeBasisLabel } from '@/lib/league-chat/tradeCardGradeView'
import type { GradedTrade } from '@/lib/trade-intel/sleeperTradeGradeService'

const code = (rel: string) =>
  readFileSync(resolve(process.cwd(), rel), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

/** Each surface that shows a COMPLETED provider trade's letter, and the frozen-path call it must make. */
const FROZEN_SURFACES: ReadonlyArray<{ file: string; entry: RegExp; what: string }> = [
  { file: 'lib/core-app/sleeperTradeHistory.ts', entry: /oneGradeForCompletedTrade\([^)]*\{\s*frozen/, what: 'the Trade Center / Chimmy completed history' },
  { file: 'lib/core-app/archivedTradeGrade.ts', entry: /original:/, what: 'the /core Trades list and the player card' },
  { file: 'lib/activity/tradeGrades.ts', entry: /original:\s*\{\s*afLeagueId/, what: 'League Buzz' },
  { file: 'lib/provider-trades/providerCompletedGrades.ts', entry: /withFrozenOriginal\(/, what: 'the Trade Center’s provider-completed rows' },
  { file: 'app/api/league/trades-panel/route.ts', entry: /gradeProviderCompletedTrades\(/, what: 'the trades panel wiring for those rows' },
  { file: 'lib/league-chat/tradeCardGrade.ts', entry: /gradeArchivedTrade\([\s\S]*?original:\s*\{\s*afLeagueId/, what: 'league chat trade cards' },
]

describe.each(FROZEN_SURFACES)('$what', ({ file, entry }) => {
  it('reaches the frozen-original path', () => {
    expect(entry.test(code(file))).toBe(true)
  })
})

describe('the trades panel no longer re-grades completed rows on today’s values', () => {
  const src = code('app/api/league/trades-panel/route.ts')
  it('passes completed provider trades only to the frozen path', () => {
    expect(src).not.toMatch(/gradeProviderOffers\(\s*providerCompleted/)
    expect(src).toMatch(/gradeProviderCompletedTrades\(\s*\{[^}]*trades:\s*providerCompleted/)
  })
  it('positive control: the forbidden shape matches the call it replaced', () => {
    expect(/gradeProviderOffers\(\s*providerCompleted/.test('gradeProviderOffers(providerCompleted, grader, { completed: true })')).toBe(true)
  })
})

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

const providerRow = (roster: 1 | 2): PendingProviderTrade => ({
  transactionId: TX.transaction_id,
  proposedBy: roster === 1 ? 'B' : 'A',
  proposedByViewer: false,
  proposedAt: NOW.toISOString(),
  readOnly: true,
  provider: 'sleeper',
  lifecycleStatus: 'complete',
  ...buildTradeAssetsForRoster({ tx: TX as never, userRosterId: roster, players: PLAYERS as never }),
})

let n = 0
beforeEach(() => {
  table.length = 0
  Object.assign(VALUES, { 'sleeper:6794': 1766, 'sleeper:11001': 400, 'pick:2027:2': 1184 })
  n++
})
const AF = () => `af-frozen-surfaces-${n}` // one league row per test; the grader is memoised per id

async function emailThenMarketMoves() {
  const email = await oneGradeForCompletedTrade(AF(), ledgerTrade, SEASON, { now: NOW })
  if (!email.graded) throw new Error(email.reason)
  expect(table).toHaveLength(1)
  Object.assign(VALUES, { 'sleeper:6794': 900, 'sleeper:11001': 2000 })
  return email
}

describe('the Trade Center’s provider-completed rows show the frozen original', () => {
  it('🛑 after the market moves, each viewer sees the ORIGINAL, oriented to their side, with today beside it', async () => {
    const email = await emailThenMarketMoves()
    const later = new Date(NOW.getTime() + 86_400_000)
    const one = (await gradeProviderCompletedTrades({ afLeagueId: AF(), trades: [providerRow(1)], now: later })).get(TX.transaction_id)!
    const two = (await gradeProviderCompletedTrades({ afLeagueId: AF(), trades: [providerRow(2)], now: later })).get(TX.transaction_id)!
    if (!one.graded || !two.graded) throw new Error('expected grades')
    expect([one.letter, one.partnerLetter, one.giveValue, one.getValue]).toEqual([email.letter, email.partnerLetter, 1766, 1584])
    expect([two.letter, two.partnerLetter]).toEqual([email.partnerLetter, email.letter])
    expect(one.frozenAt).toBe(email.frozenAt)
    expect(gradeMoment(one)).toBe(gradeMoment(email))
    expect(one.current).toMatchObject({ giveValue: 900, getValue: 3184 })
    expect(one.current!.letter).not.toBe(one.letter)
    // Nothing re-froze.
    expect(table).toHaveLength(1)
  })

  it('the first surface to grade it freezes it — and /core then reads the same letter', async () => {
    const tc = (await gradeProviderCompletedTrades({ afLeagueId: AF(), trades: [providerRow(2)], now: NOW })).get(TX.transaction_id)!
    expect(tc.graded && tc.frozenAt).toBe(NOW.toISOString())
    expect(table).toHaveLength(1)
    Object.assign(VALUES, { 'sleeper:6794': 900, 'sleeper:11001': 2000 })
    const email = await oneGradeForCompletedTrade(AF(), ledgerTrade, SEASON, { now: NOW })
    if (!tc.graded || !email.graded) throw new Error('expected grades')
    expect([email.letter, email.partnerLetter]).toEqual([tc.partnerLetter, tc.letter])
  })

  it('a giveaway is graded as before and never written as an original', async () => {
    const giveaway = { ...providerRow(1), assetsReceived: [] }
    await gradeProviderCompletedTrades({ afLeagueId: AF(), trades: [giveaway], now: NOW })
    expect(table).toHaveLength(0)
  })
})

describe('league chat trade cards show the frozen original', () => {
  const card = (roster: 1 | 2) => gradeImportedTradeCard({
    leagueId: AF(),
    tradeId: TX.transaction_id,
    received: roster === 1 ? [{ name: 'Some Receiver', sleeperId: '11001' }] : [{ name: 'DK Metcalf', sleeperId: '6794' }],
    gave: roster === 1 ? [{ name: 'DK Metcalf', sleeperId: '6794' }] : [{ name: 'Some Receiver', sleeperId: '11001' }],
    picksReceived: roster === 1 ? [{ season: '2027', round: 2 }] : [],
    picksGiven: roster === 1 ? [] : [{ season: '2027', round: 2 }],
    teams: 2,
    now: new Date(NOW.getTime() + 86_400_000),
  })

  it('🛑 after the market moves, the card carries the ORIGINAL letters and says when they were taken', async () => {
    const email = await emailThenMarketMoves()
    const a = await card(1)
    const b = await card(2)
    expect(a).toMatchObject({ graded: true, letter: email.letter, partnerLetter: email.partnerLetter, basis: 'first-graded', frozenAt: email.frozenAt, valueGave: 1766, valueGot: 1584 })
    expect(b).toMatchObject({ graded: true, letter: email.partnerLetter, partnerLetter: email.letter, basis: 'first-graded' })
    expect(tradeCardGradeBasisLabel(a as never)).toBe(`on this league's values ${gradeMoment(email)}`)
    expect(gradedTradeTakeText({ manager: 'A', partner: 'B', grade: a!, seed: 't' })).toContain(gradeMoment(email))
    expect(table).toHaveLength(1)
  })

  it('the stored card metadata keeps the frozen moment', async () => {
    await emailThenMarketMoves()
    const stored = JSON.parse(JSON.stringify(await card(1)))
    expect(readTradeCardGrade(stored)).toMatchObject({ basis: 'first-graded', frozenAt: NOW.toISOString() })
  })
})
