import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The daily FantasyCalc PROFILE CAPTURE (2026-10-04): the warm cron stores each profile's board once
 * per UTC day, so a completed trade graded later is priced on its league's own board from the trade
 * date (`__tests__/trade-value/league-profile-capture-pricing.test.ts` covers the pricing).
 *
 *   · one capture per profile per UTC day — a second warm the same day never replaces it
 *   · the capture rebuilds into the board it came from: every field the trade pricer reads, the
 *     pick rows whole and in place, and `pricePlayer` / `livePickValue` give identical answers on both
 *   · a failed capture never fails the warm
 */

type Row = { cacheKey: string; data: unknown; expiresAt: Date; createdAt: Date }

const h = vi.hoisted(() => ({
  table: new Map<string, { cacheKey: string; data: unknown; expiresAt: Date; createdAt: Date }>(),
  fetch: vi.fn(),
  failCapture: false,
}))

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsDataCache: {
      findMany: vi.fn(async ({ where, take }: { where: { cacheKey: { startsWith: string } }; take?: number }) =>
        [...h.table.values()]
          .filter((r) => r.cacheKey.startsWith(where.cacheKey.startsWith))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, take ?? Infinity)
          .map((r) => ({ cacheKey: r.cacheKey, data: clone(r.data) }))),
      upsert: vi.fn(async ({ where, create, update }: { where: { cacheKey: string }; create: Row; update: Omit<Row, 'cacheKey'> }) => {
        const prev = h.table.get(where.cacheKey)
        h.table.set(where.cacheKey, prev ? { ...prev, ...update, data: clone(update.data) } : { ...create, data: clone(create.data) })
        return {}
      }),
      // `INSERT … ON CONFLICT DO NOTHING`: an existing key is left exactly as it was.
      createMany: vi.fn(async ({ data, skipDuplicates }: { data: Row[]; skipDuplicates?: boolean }) => {
        if (h.failCapture) throw new Error('connection lost')
        let count = 0
        for (const d of data) {
          if (h.table.has(d.cacheKey)) {
            if (!skipDuplicates) throw new Error('unique violation')
            continue
          }
          h.table.set(d.cacheKey, { ...d, data: clone(d.data) })
          count += 1
        }
        return { count }
      }),
    },
  },
}))
vi.mock('@/lib/fantasycalc-fetch', () => ({ fetchFantasyCalcValues: h.fetch }))
vi.mock('@/lib/player-analytics', () => ({ getPlayerAnalytics: vi.fn(async () => null) }))

import type { FantasyCalcPlayer, FantasyCalcSettings } from '@/lib/fantasycalc'
import { captureFantasyCalcProfileDaily, warmFantasyCalcCache } from '@/lib/fantasycalc-db'
import {
  PROFILE_CAPTURE_EXPIRES_AT,
  PROFILE_CAPTURE_PREFIX,
  buildFantasyCalcCacheKey,
  packProfileCapture,
  parseProfileCapture,
  profileCaptureKey,
  unpackProfileCapture,
} from '@/lib/fantasycalc-profile-capture'
import { pricePlayer, type ValuationContext } from '@/lib/hybrid-valuation'
import { livePickValue } from '@/lib/trade-value-console/leagueTradePricing'
import { chooseCaptureTakenAt, chooseTradeTimeCapture } from '@/lib/decision-os/trade/tradeTimeCapture'

vi.mock('server-only', () => ({}))

/** A board row with EVERY field FantasyCalc publishes set — so a dropped field cannot hide behind a default. */
function fc(i: number, over: Partial<FantasyCalcPlayer['player']> & { value: number }, extra: Partial<FantasyCalcPlayer> = {}): FantasyCalcPlayer {
  const { value, ...player } = over
  return {
    player: {
      id: 7000 + i, name: `Player ${i}`, mflId: `${15000 + i}`, sleeperId: `${9000 + i}`, position: 'WR',
      maybeBirthday: '1999-04-12', maybeHeight: '73', maybeWeight: 214, maybeCollege: 'Ohio State',
      maybeTeam: 'KC', maybeAge: 26.37, maybeYoe: 4, espnId: `${4400000 + i}`, fleaflickerId: `${17000 + i}`,
      ...player,
    },
    value,
    overallRank: i + 1, positionRank: i + 2, trend30Day: -143 + i, redraftDynastyValueDifference: -1234,
    redraftDynastyValuePercDifference: -0.12, redraftValue: Math.round(value * 0.81), combinedValue: value * 2,
    maybeMovingStandardDeviation: 211.4 + i, maybeMovingStandardDeviationPerc: 3.1 + i / 10,
    maybeMovingStandardDeviationAdjusted: 190.2, displayTrend: true, maybeOwner: 'someone', starter: true,
    maybeTier: 3, maybeAdp: 41.2, maybeTradeFrequency: 0.0021 * (i + 1),
    ...extra,
  }
}
const pick = (i: number, name: string, value: number): FantasyCalcPlayer =>
  fc(i, { name, sleeperId: `FP_${name.replace(/\W+/g, '_')}`, position: 'PICK', maybeTeam: null, maybeAge: null, value }, { redraftValue: 0, positionRank: 0 })

/** A live board: players and picks INTERLEAVED, as FantasyCalc orders them (by value). */
const LIVE: FantasyCalcPlayer[] = [
  fc(0, { name: 'Jahmyr Gibbs', position: 'RB', value: 10777 }),
  fc(1, { name: 'Josh Allen', position: 'QB', value: 9900, maybeAge: 30.1 }),
  pick(2, '2027 1st (Early)', 6100),
  fc(3, { name: 'Mike Williams', position: 'WR', maybeTeam: 'PIT', value: 2400 }),
  fc(4, { name: 'Mike Williams', position: 'WR', maybeTeam: 'NYJ', value: 300 }), // a duplicate name, told apart by team
  pick(5, '2027 1st (Mid)', 4800),
  fc(6, { name: 'Free Agent', position: 'TE', maybeTeam: null, maybeAge: null, value: 120 }, { maybeMovingStandardDeviationPerc: null }),
  fc(7, { name: 'No Volatility', position: 'RB', value: 900 }, { maybeMovingStandardDeviation: null, maybeMovingStandardDeviationPerc: null }),
  pick(8, '2027 2nd', 1500),
]

const SETTINGS: FantasyCalcSettings = { isDynasty: true, numQbs: 2, numTeams: 10, ppr: 0.5 }

/** Every field the trade pricer reads off a board row — what "identical" means for a non-pick row. */
const priced = (p: FantasyCalcPlayer) => ({
  sleeperId: p.player.sleeperId, name: p.player.name, position: p.player.position, team: p.player.maybeTeam, age: p.player.maybeAge,
  value: p.value, overallRank: p.overallRank, positionRank: p.positionRank, redraftValue: p.redraftValue, trend30Day: p.trend30Day,
  sd: p.maybeMovingStandardDeviation, sdPerc: p.maybeMovingStandardDeviationPerc, tradeFrequency: p.maybeTradeFrequency,
})

function liveRow(settings: FantasyCalcSettings, syncedAt: string) {
  return {
    cacheKey: buildFantasyCalcCacheKey(settings),
    data: { players: [{ player: { name: 'x' } }], settings, syncedAt },
    expiresAt: new Date(Date.parse(syncedAt) + 6 * 3600_000),
    createdAt: new Date(syncedAt),
  }
}

const captures = () => [...h.table.values()].filter((r) => r.cacheKey.startsWith(PROFILE_CAPTURE_PREFIX))

beforeEach(() => {
  vi.useRealTimers()
  h.table.clear()
  h.fetch.mockReset()
  h.failCapture = false
})

describe('the warm cron writes ONE capture per profile per UTC day', () => {
  it('the first successful warm of the day captures; a second warm the same day does not overwrite it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-04T00:05:00.000Z'))
    const ten = { ...SETTINGS }
    const twelve = { ...SETTINGS, numTeams: 12 }
    for (const s of [ten, twelve]) h.table.set(buildFantasyCalcCacheKey(s), liveRow(s, '2026-10-03T20:00:00.000Z'))
    h.fetch.mockResolvedValue(LIVE)

    const first = await warmFantasyCalcCache({ minAgeMs: 0 })
    expect(first).toMatchObject({ refreshed: 2, captured: 2, captureFailed: 0 })
    expect(captures().map((r) => r.cacheKey).sort()).toEqual([profileCaptureKey(ten, '2026-10-04'), profileCaptureKey(twelve, '2026-10-04')].sort())

    // Later the same day the market moves; the warm refreshes the live rows but the capture stands.
    vi.setSystemTime(new Date('2026-10-04T13:00:00.000Z'))
    const moved = LIVE.map((p) => ({ ...p, value: p.value + 500 }))
    h.fetch.mockResolvedValue(moved)
    const second = await warmFantasyCalcCache({ minAgeMs: 0 })
    expect(second).toMatchObject({ refreshed: 2, captured: 0, captureFailed: 0 })
    expect(captures()).toHaveLength(2)
    const stored = h.table.get(profileCaptureKey(ten, '2026-10-04'))!
    const capture = parseProfileCapture(stored.data)!
    // The FIRST warm's board and its real time.
    expect(capture.capturedAt).toBe('2026-10-04T00:05:00.000Z')
    expect(stored.createdAt.toISOString()).toBe('2026-10-04T00:05:00.000Z')
    expect(unpackProfileCapture(capture).map((p) => p.value)).toEqual(LIVE.map((p) => p.value))
    // …while the live row carries the new values.
    expect((h.table.get(buildFantasyCalcCacheKey(ten))!.data as { players: FantasyCalcPlayer[] }).players[0]!.value).toBe(LIVE[0]!.value + 500)

    // The next UTC day gets its own capture.
    vi.setSystemTime(new Date('2026-10-05T00:04:00.000Z'))
    const third = await warmFantasyCalcCache({ minAgeMs: 0 })
    expect(third.captured).toBe(2)
    expect(captures()).toHaveLength(4)
    expect(h.table.get(profileCaptureKey(ten, '2026-10-05'))!.expiresAt).toEqual(PROFILE_CAPTURE_EXPIRES_AT)
  })

  it('a capture never joins the warm list or the live-profile family', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-04T00:05:00.000Z'))
    h.table.set(buildFantasyCalcCacheKey(SETTINGS), liveRow(SETTINGS, '2026-10-03T20:00:00.000Z'))
    h.fetch.mockResolvedValue(LIVE)
    await warmFantasyCalcCache({ minAgeMs: 0 })
    vi.setSystemTime(new Date('2026-10-04T05:00:00.000Z'))
    const again = await warmFantasyCalcCache({ minAgeMs: 0 })
    // One live profile warmed, not the capture row beside it.
    expect(again.attempted).toBe(1)
    expect(h.fetch).toHaveBeenCalledTimes(2)
    expect(PROFILE_CAPTURE_PREFIX.startsWith('fantasycalc:values:')).toBe(false)
  })

  it('a failed capture is reported and never fails the warm', async () => {
    h.table.set(buildFantasyCalcCacheKey(SETTINGS), liveRow(SETTINGS, '2026-10-03T20:00:00.000Z'))
    h.fetch.mockResolvedValue(LIVE)
    h.failCapture = true
    const r = await warmFantasyCalcCache({ minAgeMs: 0 })
    expect(r).toMatchObject({ refreshed: 1, failed: 0, captured: 0, captureFailed: 1 })
    expect(r.profiles[0]).toMatchObject({ ok: true, captureError: 'connection lost' })
  })

  it('an empty board never takes the day’s only slot', async () => {
    expect(await captureFantasyCalcProfileDaily(SETTINGS, [], new Date('2026-10-04T00:05:00.000Z'))).toBe(false)
    expect(captures()).toEqual([])
  })
})

describe('the capture rebuilds into the board it came from', () => {
  async function roundTrip(): Promise<FantasyCalcPlayer[]> {
    // Through the real writer and a JSON column, exactly as the reader will meet it.
    expect(await captureFantasyCalcProfileDaily(SETTINGS, LIVE, new Date('2026-10-04T00:05:00.000Z'))).toBe(true)
    const capture = parseProfileCapture(clone(h.table.get(profileCaptureKey(SETTINGS, '2026-10-04'))!.data))
    expect(capture).not.toBeNull()
    expect(capture!.profile).toEqual(SETTINGS)
    expect(capture!.profileKey).toBe(buildFantasyCalcCacheKey(SETTINGS))
    return unpackProfileCapture(capture!)
  }

  it('same rows, same order; every priced field equal; pick rows whole', async () => {
    const rebuilt = await roundTrip()
    expect(rebuilt).toHaveLength(LIVE.length)
    expect(rebuilt.map(priced)).toEqual(LIVE.map(priced))
    LIVE.forEach((p, i) => {
      if (p.player.position === 'PICK') expect(rebuilt[i]).toEqual(p)
    })
  })

  it('prices every player and every pick identically on the live board and the rebuilt one', async () => {
    const rebuilt = await roundTrip()
    const ctx = (players: FantasyCalcPlayer[]): ValuationContext => ({
      asOfDate: new Date().toISOString().slice(0, 10), isSuperFlex: true, numTeams: 10, fantasyCalcPlayers: players,
    })
    for (const p of LIVE.filter((x) => x.player.position !== 'PICK')) {
      // By id (how a completed trade prices) and by name with no id (team disambiguation, `findPlayerByName`).
      const id = { sleeperId: p.player.sleeperId, position: p.player.position }
      expect(await pricePlayer(p.player.name, ctx(rebuilt), id)).toEqual(await pricePlayer(p.player.name, ctx(LIVE), id))
      expect(await pricePlayer(p.player.name, ctx(rebuilt))).toEqual(await pricePlayer(p.player.name, ctx(LIVE)))
    }
    for (const [round, tier] of [[1, 'early'], [1, 'mid'], [1, null], [2, null], [3, null]] as const) {
      expect(livePickValue(rebuilt, 2027, round, tier)).toBe(livePickValue(LIVE, 2027, round, tier))
    }
  })

  it('is compact: the stored row is a fraction of the live row', () => {
    const live = JSON.stringify({ players: LIVE, settings: SETTINGS, syncedAt: 'x' }).length
    const captured = JSON.stringify(packProfileCapture(SETTINGS, LIVE, new Date())).length
    expect(captured).toBeLessThan(live * 0.75)
  })

  it('refuses a payload it does not understand rather than guessing at it', () => {
    const good = clone(packProfileCapture(SETTINGS, LIVE, new Date('2026-10-04T00:05:00.000Z')))
    expect(parseProfileCapture(good)).not.toBeNull()
    expect(parseProfileCapture({ ...good, v: 2 })).toBeNull()
    expect(parseProfileCapture({ ...good, fields: [...good.fields].reverse() })).toBeNull()
    expect(parseProfileCapture({ ...good, capturedAt: 'yesterday' })).toBeNull()
    expect(parseProfileCapture(null)).toBeNull()
  })
})

describe('the capture rule on a real capture time (`chooseCaptureTakenAt`)', () => {
  const caps = [
    { day: '2026-09-23', takenAt: '2026-09-23T00:05:00.000Z' },
    { day: '2026-09-24', takenAt: '2026-09-24T00:05:00.000Z' },
  ]
  it('the latest capture taken at or before the trade, never after, at most a day older', () => {
    expect(chooseCaptureTakenAt(caps, new Date('2026-09-24T00:04:59.000Z'))?.day).toBe('2026-09-23')
    expect(chooseCaptureTakenAt(caps, new Date('2026-09-24T00:05:00.000Z'))?.day).toBe('2026-09-24')
    expect(chooseCaptureTakenAt(caps, new Date('2026-09-25T00:05:00.000Z'))?.day).toBe('2026-09-24')
    expect(chooseCaptureTakenAt(caps, new Date('2026-09-25T00:05:01.000Z'))).toBeNull()
    expect(chooseCaptureTakenAt(caps, new Date('2026-09-23T00:04:00.000Z'))).toBeNull()
    expect(chooseCaptureTakenAt(caps, null)).toBeNull()
  })
  it('the 12-team book keeps its fixed 10:00 rule, through the same chooser', () => {
    expect(chooseTradeTimeCapture(['2026-09-23', '2026-09-24'], new Date('2026-09-24T09:59:00.000Z'))?.day).toBe('2026-09-23')
    expect(chooseTradeTimeCapture(['2026-09-23', '2026-09-24'], new Date('2026-09-24T10:00:00.000Z'))).toEqual({ day: '2026-09-24', takenAt: '2026-09-24T10:00:00.000Z' })
    expect(chooseTradeTimeCapture(['2026-09-24', 'not-a-day'], new Date('2026-09-25T10:00:01.000Z'))).toBeNull()
  })
})
