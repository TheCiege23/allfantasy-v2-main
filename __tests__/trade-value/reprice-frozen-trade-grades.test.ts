/**
 * The one-time re-price of existing v1 originals (Decision 2) against a faked database: the plan
 * the script prints in a dry run and writes with --apply. The grading step is the real
 * `repriceFrozenOriginalAtTradeTime` → `gradeAtTradeTime`, on a fake league grader whose market is
 * keyed by capture day.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { repriceFrozenOriginalAtTradeTime, sleeperPlayerInput } from '@/lib/decision-os/trade/completedTradeGrade'
import { planFrozenGradeReprice, type V1Pair } from '@/lib/decision-os/trade/repriceFrozenTradeGrades'
import { gradeTrade, type TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import type { LeagueTradeGrader } from '@/lib/decision-os/trade/leagueTradeGrader'
import type { DatedMarket } from '@/lib/decision-os/trade/datedMarket'
import type { GradeInputs } from '@/lib/decision-os/trade/tradeGradeInputs'
import type { TradeAssetInput } from '@/lib/trade-value-console/types'

type Graded = Extract<TradeGradeView, { graded: true }>
const BOOK = { format: 'DYNASTY' as const, qbFormat: 'ONE_QB' as const }
/** Values by capture day, by asset key. */
const MARKET: Record<string, Record<string, number>> = {
  '2026-09-24': { 'sleeper:1': 6000, 'sleeper:2': 4500, 'sleeper:3': 3000 },
  '2026-09-29': { 'sleeper:1': 5000, 'sleeper:2': 5200 },
}
const keyOf = (a: TradeAssetInput) => (a.kind === 'player' ? `sleeper:${a.providerIdentity?.id}` : a.kind === 'pick' ? `pick:${a.year}:${a.round}` : 'faab')

function gradeOn(day: string, give: TradeAssetInput[], get: TradeAssetInput[]): TradeGradeView {
  const values = MARKET[day] ?? {}
  if ([...give, ...get].some((a) => values[keyOf(a)] == null)) return { graded: false, reason: 'unpriced', basis: null }
  const line = (side: 'give' | 'get') => (a: TradeAssetInput) => ({
    side, name: keyOf(a), marketValue: values[keyOf(a)]!, leagueValue: values[keyOf(a)]!, valueSource: 'fantasycalc' as const, valueAsOf: `${day}T00:00:00.000Z`,
  })
  const total = (xs: TradeAssetInput[]) => xs.reduce((s, a) => s + values[keyOf(a)]!, 0)
  return gradeTrade({
    giveValue: total(give), getValue: total(get), giveMarket: total(give), getMarket: total(get), unpriced: 0,
    giveCount: give.length, getCount: get.length, basis: 'Dynasty · 1QB', scoringApplied: true, needApplied: false, needGap: null,
    lines: [...give.map(line('give')), ...get.map(line('get'))], moves: [],
  })
}

const grader: LeagueTradeGrader = {
  leagueId: 'af-1', chart: {} as never, leagueType: null as never, book: BOOK,
  async grade() { throw new Error('a re-price never grades on today’s values') },
  atMarket: (m: DatedMarket) => ({ ...grader, async grade(d) { return gradeOn(m.capturedOn, d.give, d.get) } }),
}
const deps = {
  captureDays: async () => Object.keys(MARKET),
  market: async (_b: unknown, day: string): Promise<DatedMarket> => ({ capturedOn: day, book: BOOK, players: [] }),
}

const p = (id: string) => sleeperPlayerInput(`P${id}`, id, 'WR')
const side = (...assets: TradeAssetInput[]): GradeInputs => ({ assets, unpriceable: [] })
const keys = (s: GradeInputs) => s.assets.map(keyOf).sort()
const v1Grade = (letter: 'A' | 'B' | 'C' | 'D' | 'F'): Graded => ({ ...(gradeOn('2026-09-29', [p('1')], [p('2')]) as Graded), letter, partnerLetter: letter === 'A' ? 'F' : letter === 'B' ? 'D' : 'C' })

/** A v1 row frozen Sep 30 on Sep 29's values: side one sent P1, got P2 + P3. */
function pair(tradeId: string, letter: 'A' | 'B' | 'C' | 'D' | 'F', give: GradeInputs, get: GradeInputs): V1Pair {
  return { afLeagueId: 'af-1', tradeId, row: { v: 1, tradeId, give: keys(give), get: keys(get), grade: v1Grade(letter), frozenAt: '2026-09-30T12:00:00.000Z' } }
}

describe('re-pricing existing originals at the time of the trade', () => {
  const GIVE = side(p('1'))
  const GET = side(p('2'), p('3'))
  const deal = { today: { give: GIVE, get: GET }, atTradeTime: { give: GIVE, get: GET } }

  it('prices a coverable pair on its date — and orients it as the stored row, even when the deal is read from the other side', async () => {
    const asStored = await repriceFrozenOriginalAtTradeTime({ grader, row: pair('t1', 'C', GIVE, GET).row, deal, tradeAt: new Date('2026-09-24T15:00:00Z'), deps })
    expect(asStored).toMatchObject({ kind: 'trade_date', pricedAsOf: '2026-09-24', grade: { letter: 'B', giveValue: 6000, getValue: 7500 } })
    const swapped = { today: { give: GET, get: GIVE }, atTradeTime: { give: GET, get: GIVE } }
    const fromOtherSide = await repriceFrozenOriginalAtTradeTime({ grader, row: pair('t1', 'C', GIVE, GET).row, deal: swapped, tradeAt: new Date('2026-09-24T15:00:00Z'), deps })
    expect(fromOtherSide).toMatchObject({ kind: 'trade_date', grade: { letter: 'B', giveValue: 6000 } })
  })

  it('no capture within a day, or an asset with no record on that date → first-graded (the v1 letter stays)', async () => {
    expect(await repriceFrozenOriginalAtTradeTime({ grader, row: pair('t2', 'C', GIVE, GET).row, deal, tradeAt: new Date('2026-09-27T15:00:00Z'), deps }))
      .toMatchObject({ kind: 'first_graded', why: 'no capture within a day before the trade' })
    // Sep 29 is captured, but P3 is not on it.
    expect(await repriceFrozenOriginalAtTradeTime({ grader, row: pair('t3', 'C', GIVE, GET).row, deal, tradeAt: new Date('2026-09-29T15:00:00Z'), deps }))
      .toMatchObject({ kind: 'first_graded', why: 'an asset has no record on the trade date' })
  })

  it('a deal that is not on record, or does not match the frozen row, is SKIPPED — never guessed', async () => {
    expect(await repriceFrozenOriginalAtTradeTime({ grader, row: pair('t4', 'C', GIVE, GET).row, deal: null, tradeAt: new Date('2026-09-24T15:00:00Z'), deps }))
      .toMatchObject({ kind: 'skip' })
    const other = { today: { give: side(p('9')), get: GET }, atTradeTime: { give: side(p('9')), get: GET } }
    expect(await repriceFrozenOriginalAtTradeTime({ grader, row: pair('t4', 'C', GIVE, GET).row, deal: other, tradeAt: new Date('2026-09-24T15:00:00Z'), deps }))
      .toMatchObject({ kind: 'skip', why: 'the recorded assets do not match the frozen row' })
  })

  it('🛑 the plan: counts, per-pair letters, emailed changes, idempotent, and v1 never rewritten', async () => {
    const pairs = [pair('t1', 'C', GIVE, GET), pair('t2', 'C', GIVE, GET), pair('t5', 'B', GIVE, GET), pair('t6', 'B', GIVE, GET), pair('t1', 'F', GIVE, GET)]
    const v1Before = JSON.stringify(pairs)
    const when: Record<string, string> = { t1: '2026-09-24T15:00:00Z', t2: '2026-09-27T15:00:00Z', t5: '2026-09-24T15:00:00Z' }
    const plan = await planFrozenGradeReprice({
      pairs,
      hasV2: new Set(['af-1:t6']),
      emailed: new Set(['t1']),
      now: new Date('2026-10-04T00:00:00Z'),
      reprice: (x) => repriceFrozenOriginalAtTradeTime({ grader, row: x.row, deal, tradeAt: new Date(when[x.tradeId]!), deps }),
    })
    expect(plan.report).toMatchObject({
      pairs: 5, alreadyV2: 1, tradeDate: 2, sameLetter: 1, changedLetter: 1, changedAndEmailed: 1, firstGraded: 1,
      firstGradedWhy: { 'no capture within a day before the trade': 1 }, skipped: 0,
    })
    expect(plan.report.changes).toEqual([{ afLeagueId: 'af-1', tradeId: 't1', from: 'C', to: 'B', pricedAsOf: '2026-09-24', v1FrozenAt: '2026-09-30T12:00:00.000Z', emailed: true }])
    expect(plan.report.perPair.map((x) => `${x.tradeId}:${x.outcome}:${x.from}->${x.to}`)).toEqual(['t1:trade_date:C->B', 't2:first_graded:C->C', 't5:trade_date:B->B'])
    // One v2 row per pair that has none — never a second for the duplicate t1, never one for t6.
    expect(plan.rows.map((r) => [r.v2.tradeId, r.v2.basis, r.v2.grade.letter, r.v2.pricedAsOf])).toEqual([
      ['t1', 'trade_date', 'B', '2026-09-24'],
      ['t2', 'first_graded', 'C', '2026-09-30T12:00:00.000Z'],
      ['t5', 'trade_date', 'B', '2026-09-24'],
    ])
    expect(plan.rows.every((r) => r.v2.v === 2 && r.v2.frozenAt === '2026-10-04T00:00:00.000Z')).toBe(true)
    // The stored grade carries no read-time fields.
    expect(plan.rows[0]!.v2.grade).not.toHaveProperty('frozenBasis')
    expect(JSON.stringify(pairs)).toBe(v1Before)
  })

  it('a grading failure is a skip with its reason, not a first-graded claim', async () => {
    const plan = await planFrozenGradeReprice({
      pairs: [pair('t7', 'C', GIVE, GET)], hasV2: new Set(), emailed: new Set(), now: new Date(),
      reprice: async () => { throw new Error('db down') },
    })
    expect(plan.rows).toEqual([])
    expect(plan.report.skippedWhy).toEqual({ 'grading failed: db down': 1 })
  })
})

describe('the script stays read-only unless told otherwise', () => {
  const src = readFileSync(resolve(process.cwd(), 'scripts/reprice-frozen-trade-grades-at-trade-time.ts'), 'utf8')
  it('reads inside BEGIN READ ONLY, grades on a server-enforced read-only client, and refuses without consent', () => {
    expect(src).toContain("db.query('BEGIN READ ONLY')")
    expect(src).toContain("'-c default_transaction_read_only=on'")
    expect(src).toMatch(/transaction_read_only !== 'on'\) throw/)
    expect(src).toMatch(/APPLY && process\.env\.ALLOW_PROD_MIGRATION !== '1'\) throw/)
    expect(src).toMatch(/!APPLY && process\.env\.ALLOW_PROD_READONLY !== '1'\) throw/)
    expect(src).toContain('marketless: true')
  })
  it('only ever INSERTs v2 rows — never an UPDATE or DELETE, and never a v1 write', () => {
    expect(src).not.toMatch(/\bUPDATE\s+"/i)
    expect(src).not.toMatch(/\bDELETE\s+FROM/i)
    expect(src.match(/INSERT INTO "trade_analysis_snapshots"/g)).toHaveLength(1)
    expect(src).toMatch(/\[randomUUID\(\), row\.afLeagueId, NAMESPACE, V2,/)
  })
})
