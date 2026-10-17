/**
 * 🛑 A COMPLETED TRADE GRADED LATER IS PRICED ON ITS LEAGUE'S OWN FANTASYCALC PROFILE (2026-10-04).
 *
 * The warm cron stores each profile the leagues use once a day (`lib/fantasycalc-profile-capture.ts`).
 * A trade graded more than a day after it happened is priced on THAT capture — the exact board the
 * league's chart requests (its team count, QBs and PPR) — and on the 12-team PPR-1
 * `PlayerValueSnapshot` book only when the league's own capture is missing.
 *
 * End to end through the ONE grader (real `createLeagueTradeGrader`, `resolveAssets`, `pricePlayer`,
 * `gradeTrade`), with only the data layer stubbed: the league row, today's chart, the 12-team captures
 * (`PlayerValueSnapshot`) and the profile captures (`SportsDataCache`).
 *
 * The league here is a 10-TEAM league, so its profile is NOT the 12-team book: a capture of the
 * 12-team profile must never price it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  today: [] as unknown[],
  captures: new Map<string, unknown[]>(),
  cache: new Map<string, { data: unknown; createdAt: Date }>(),
  profileReads: [] as string[],
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerValueSnapshot: {
      findMany: vi.fn(async ({ where }: { where: { capturedAt?: Date | { gte: Date } } }) => {
        if (where.capturedAt instanceof Date) return (h.captures.get(where.capturedAt.toISOString().slice(0, 10)) ?? []) as never
        return []
      }),
    },
    $queryRaw: vi.fn(async () => [...h.captures.keys()].map((day) => ({ day }))),
    playerAnalyticsSnapshot: { findFirst: vi.fn(async () => null) },
    sportsDataCache: {
      findMany: vi.fn(async ({ where }: { where: { cacheKey: { startsWith: string } } }) =>
        [...h.cache.entries()]
          .filter(([k]) => k.startsWith(where.cacheKey.startsWith))
          .map(([cacheKey, r]) => ({ cacheKey, createdAt: r.createdAt }))),
      findUnique: vi.fn(async ({ where }: { where: { cacheKey: string } }) => {
        h.profileReads.push(where.cacheKey)
        const r = h.cache.get(where.cacheKey)
        return r ? { data: r.data } : null
      }),
    },
    tradeAnalysisSnapshot: {
      findMany: vi.fn(async () => []),
      createMany: vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })),
    },
  },
}))
vi.mock('@/lib/trade-value-console/league-loader', () => ({
  loadLeagueForTrade: async ({ leagueId }: { leagueId: string }) => ({
    id: leagueId,
    platformLeagueId: null,
    name: 'Ten-team dynasty',
    sport: 'NFL',
    leagueSize: 10,
    isDynasty: true,
    leagueType: 'dynasty',
    scoring: 'ppr',
    settings: { scoring_settings: { rec: 1 }, roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN'] },
    waiverBudget: 100,
    taxiSlots: 0,
    leagueVariant: 'dynasty',
    bestBallMode: false,
    starters: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX'],
  }),
}))
vi.mock('@/lib/league-context-engine', () => ({ resolveNormalizedLeagueContext: async () => ({ ok: false }) }))
vi.mock('@/lib/fantasycalc-db', () => ({
  getFantasyCalcValuesDbFirst: async () => h.today,
  getFantasyCalcChartDbFirst: async () => ({ players: h.today, syncedAt: '2026-10-04T09:00:00.000Z' }),
}))
vi.mock('@/lib/league-values/leagueTradeValues', () => ({ loadLeagueTradeValues: async () => null }))
vi.mock('@/lib/data/players', () => ({ getPlayer: async () => null, searchPlayers: async () => [] }))
vi.mock('@/lib/shared-services/player-identity/PlayerIdentityResolver', () => ({ resolvePlayer: async () => ({ confidence: 'none' }) }))

import { clearDatedMarketMemo, fantasyCalcPlayerFromSnapshot, loadProfileCaptures, loadProfileMarket } from '@/lib/decision-os/trade/datedMarket'
import { createLeagueTradeGrader } from '@/lib/decision-os/trade/leagueTradeGrader'
import { completedOriginal, gradeAtTradeTime, sleeperPlayerInput } from '@/lib/decision-os/trade/completedTradeGrade'
import type { GradeInputs } from '@/lib/decision-os/trade/tradeGradeInputs'
import { packProfileCapture, profileCaptureKey } from '@/lib/fantasycalc-profile-capture'

const snap = (sleeperId: string, name: string, position: string, value: number) =>
  ({ sleeperId, name, position, value, overallRank: null, positionRank: null, trend30d: null, tradeFrequency: null, marketStdDev: null })
const row = (sleeperId: string, name: string, position: string, value: number) => fantasyCalcPlayerFromSnapshot(snap(sleeperId, name, position, value))

const PUKA = { id: '9001', name: 'Puka Nacua', pos: 'WR' }
const DRAKE = { id: '9002', name: 'Drake London', pos: 'WR' }

/** The league's own profile: dynasty, 1QB, TEN teams, PPR 1 — what its chart requests. */
const OWN = { isDynasty: true, numQbs: 1 as const, numTeams: 10, ppr: 1 as const }
/** The generic profile: the same book at 12 teams. Never this league's. */
const TWELVE = { ...OWN, numTeams: 12 }

const board = (puka: number, drake: number, pick: number) =>
  [row(PUKA.id, PUKA.name, 'WR', puka), row('FP_2027_1', '2027 1st', 'PICK', pick), row(DRAKE.id, DRAKE.name, 'WR', drake)]

/** Store a profile capture exactly as the warm cron writes it: packed, JSON, `createdAt` = taken. */
function storeCapture(profile: typeof OWN, takenAt: string, players: ReturnType<typeof board>) {
  const at = new Date(takenAt)
  h.cache.set(profileCaptureKey(profile, takenAt.slice(0, 10)), {
    data: JSON.parse(JSON.stringify(packProfileCapture(profile, players, at))),
    createdAt: at,
  })
}

/** 15:00 UTC on Sep 24. */
const TRADE_AT = '2026-09-24T15:00:00.000Z'
/** Graded ten days later — long past the live-chart window, so a stored capture prices it. */
const NOW = new Date('2026-10-04T12:00:00.000Z')

beforeEach(() => {
  clearDatedMarketMemo()
  h.cache.clear()
  h.profileReads.length = 0
  h.today = board(5000, 6000, 1000)
  // The 12-team book (`PlayerValueSnapshot`, taken 10:00 UTC): 6000 out, 4500 + 3000 in — a B.
  h.captures = new Map([
    ['2026-09-23', [snap(PUKA.id, PUKA.name, 'WR', 6100), snap(DRAKE.id, DRAKE.name, 'WR', 4400), snap('FP_2027_1', '2027 1st', 'PICK', 3000)]],
    ['2026-09-24', [snap(PUKA.id, PUKA.name, 'WR', 6000), snap(DRAKE.id, DRAKE.name, 'WR', 4500), snap('FP_2027_1', '2027 1st', 'PICK', 3000)]],
  ])
  // The league's OWN board that day, taken by the first warm at 00:05 UTC: 6000 out, 5800 + 3200 in.
  storeCapture(OWN, '2026-09-24T00:05:00.000Z', board(6000, 5800, 3200))
})

const p = (x: { id: string; name: string; pos: string }) => sleeperPlayerInput(x.name, x.id, x.pos)
const side = (assets: GradeInputs['assets']): GradeInputs => ({ assets, unpriceable: [] })
const DEAL = { give: side([p(PUKA)]), get: side([p(DRAKE), { kind: 'pick', year: 2027, round: 1 }]) }

let n = 0
const grader = async () => (await createLeagueTradeGrader({ leagueId: `L-${++n}` }))!
const at = (iso: string) => new Date(iso)
const values = (d: Awaited<ReturnType<typeof gradeAtTradeTime>>) => [d?.grade.giveValue, d?.grade.getValue]

describe('the grader knows its league’s own profile', () => {
  it('is the board its chart requests — 10 teams here, not the 12-team book', async () => {
    const g = await grader()
    expect(g.profile).toEqual(OWN)
    expect(g.book).toEqual({ format: 'DYNASTY', qbFormat: 'ONE_QB' })
  })
})

describe('🛑 the league’s own profile capture is preferred; the 12-team book is only the fallback', () => {
  it('prices on the league’s own capture from the trade date, and says so', async () => {
    const g = await grader()
    const dated = await gradeAtTradeTime(g, DEAL, at(TRADE_AT), {}, NOW)
    expect(values(dated)).toEqual([6000, 9000])
    expect(dated).toMatchObject({ pricedAsOf: '2026-09-24', pricedBook: 'league_profile' })
    // Every line dated that day, from that day's board.
    expect(dated!.grade.lines.map((l) => [l.valueSource, l.valueAsOf])).toEqual([
      ['fantasycalc', '2026-09-24T00:00:00.000Z'],
      ['fantasycalc', '2026-09-24T00:00:00.000Z'],
      ['fantasycalc_pick', '2026-09-24T00:00:00.000Z'],
    ])
    // The same deal on the 12-team book is a different grade — the reason this exists.
    h.cache.clear()
    clearDatedMarketMemo()
    const standard = await gradeAtTradeTime(g, DEAL, at(TRADE_AT), {}, NOW)
    expect(values(standard)).toEqual([6000, 7500])
    expect(standard!.grade.letter).not.toBe(dated!.grade.letter)
  })

  it('falls back to the 12-team book, exactly as before, when the league has no capture', async () => {
    h.cache.clear()
    const g = await grader()
    const dated = await gradeAtTradeTime(g, DEAL, at(TRADE_AT), {}, NOW)
    expect(values(dated)).toEqual([6000, 7500])
    expect(dated).toMatchObject({ pricedAsOf: '2026-09-24', pricedBook: 'standard_12_ppr1', grade: { letter: 'B' } })
  })

  it('never prices on ANOTHER profile’s capture — a 12-team capture is not this league’s board', async () => {
    h.cache.clear()
    storeCapture(TWELVE, '2026-09-24T00:05:00.000Z', board(6000, 9000, 9000))
    const g = await grader()
    const dated = await gradeAtTradeTime(g, DEAL, at(TRADE_AT), {}, NOW)
    expect(dated).toMatchObject({ pricedBook: 'standard_12_ppr1' })
    expect(values(dated)).toEqual([6000, 7500])
    expect(h.profileReads).toEqual([])
  })

  it('a capture that will not parse, or whose payload names another profile, counts as missing', async () => {
    const key = profileCaptureKey(OWN, '2026-09-24')
    h.cache.set(key, { data: { v: 1, nope: true }, createdAt: new Date('2026-09-24T00:05:00.000Z') })
    const g = await grader()
    expect(await gradeAtTradeTime(g, DEAL, at(TRADE_AT), {}, NOW)).toMatchObject({ pricedBook: 'standard_12_ppr1' })

    clearDatedMarketMemo()
    // A 12-team board stored under the 10-team key: refused, never priced as this league's.
    h.cache.set(key, { data: JSON.parse(JSON.stringify(packProfileCapture(TWELVE, board(6000, 9000, 9000), new Date('2026-09-24T00:05:00.000Z')))), createdAt: new Date('2026-09-24T00:05:00.000Z') })
    expect(await gradeAtTradeTime(g, DEAL, at(TRADE_AT), {}, NOW)).toMatchObject({ pricedBook: 'standard_12_ppr1' })
  })

  it('ONE source per trade: an own capture that cannot price an asset is not “missing” — no second board is tried', async () => {
    h.cache.clear()
    // The league's board that day, without Drake.
    storeCapture(OWN, '2026-09-24T00:05:00.000Z', [row(PUKA.id, PUKA.name, 'WR', 6000), row('FP_2027_1', '2027 1st', 'PICK', 3200)])
    const g = await grader()
    expect(await gradeAtTradeTime(g, DEAL, at(TRADE_AT), {}, NOW)).toBeNull()
  })

  it('records which board priced it on the frozen v2 row', async () => {
    const g = await grader()
    const current = await g.grade({ give: DEAL.give.assets, get: DEAL.get.assets, viewerSide: false })
    const own = await completedOriginal({ grader: g, tradeId: 'tx-1', inputs: DEAL, tradeTimeInputs: DEAL, tradeAt: at(TRADE_AT), current, frozen: undefined, now: NOW })
    expect(own.toFreeze).toMatchObject({ v: 2, basis: 'trade_date', pricedAsOf: '2026-09-24', pricedBook: 'league_profile' })

    h.cache.clear()
    clearDatedMarketMemo()
    const std = await completedOriginal({ grader: g, tradeId: 'tx-1', inputs: DEAL, tradeTimeInputs: DEAL, tradeAt: at(TRADE_AT), current, frozen: undefined, now: NOW })
    expect(std.toFreeze).toMatchObject({ v: 2, basis: 'trade_date', pricedAsOf: '2026-09-24', pricedBook: 'standard_12_ppr1' })

    // Within a day of the trade: the league's own live chart.
    const live = await completedOriginal({ grader: g, tradeId: 'tx-1', inputs: DEAL, tradeTimeInputs: DEAL, tradeAt: at('2026-10-04T08:00:00.000Z'), current, frozen: undefined, now: NOW })
    expect(live.toFreeze).toMatchObject({ basis: 'trade_date', pricedBook: 'league_live' })
  })
})

describe('the capture rule holds for the league’s own captures — on their REAL capture time', () => {
  beforeEach(() => {
    storeCapture(OWN, '2026-09-23T00:05:00.000Z', board(6000, 5000, 3000))
  })

  it('the latest capture taken at or before the trade — never one taken after it', async () => {
    const g = await grader()
    // 00:04 on Sep 24: Sep 24's capture (00:05) did not exist yet → Sep 23's, 23h59m old.
    const early = await gradeAtTradeTime(g, DEAL, at('2026-09-24T00:04:00.000Z'), {}, NOW)
    expect(early).toMatchObject({ pricedAsOf: '2026-09-23', pricedBook: 'league_profile' })
    expect(values(early)).toEqual([6000, 8000])
    // 00:05 exactly: Sep 24's.
    expect(await gradeAtTradeTime(g, DEAL, at('2026-09-24T00:05:00.000Z'), {}, NOW)).toMatchObject({ pricedAsOf: '2026-09-24', pricedBook: 'league_profile' })
  })

  it('on the capture’s real time, not the 12-team book’s fixed 10:00 stamp', async () => {
    const g = await grader()
    // 09:00 on Sep 24 — before the 12-team book's 10:00 capture, after the league's 00:05 one.
    expect(await gradeAtTradeTime(g, DEAL, at('2026-09-24T09:00:00.000Z'), {}, NOW)).toMatchObject({ pricedAsOf: '2026-09-24', pricedBook: 'league_profile' })
  })

  it('more than a day after the last own capture, the own book does not cover it — the 12-team book may', async () => {
    const g = await grader()
    // 24h01m after Sep 24 00:05 — and 14h after the 12-team book's Sep 24 10:00 capture.
    const late = await gradeAtTradeTime(g, DEAL, at('2026-09-25T00:06:00.000Z'), {}, NOW)
    expect(late).toMatchObject({ pricedAsOf: '2026-09-24', pricedBook: 'standard_12_ppr1' })
  })
})

describe('the readers (`loadProfileCaptures` / `loadProfileMarket`)', () => {
  it('list this profile’s captures with their real times, and rebuild one day’s board', async () => {
    storeCapture(TWELVE, '2026-09-24T00:07:00.000Z', board(1, 1, 1))
    expect(await loadProfileCaptures(OWN)).toEqual([{ day: '2026-09-24', takenAt: '2026-09-24T00:05:00.000Z' }])
    const m = await loadProfileMarket(OWN, '2026-09-24')
    expect(m).toMatchObject({ capturedOn: '2026-09-24', source: 'league_profile', book: { format: 'DYNASTY', qbFormat: 'ONE_QB' } })
    expect(m!.players.map((x) => [x.player.sleeperId, x.value])).toEqual([[PUKA.id, 6000], ['FP_2027_1', 3200], [DRAKE.id, 5800]])
    expect(await loadProfileMarket(OWN, '2026-09-25')).toBeNull()
  })
})
