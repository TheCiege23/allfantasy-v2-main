import type { PrismaClient } from '@prisma/client'

import { FIRST_ROUND_IN_MARKET_UNITS, pickRoundShare } from '@/lib/pick-curve'

/**
 * AllFantasy market observations, from trades that actually happened.
 *
 * ⚠ THE ENGINE THIS FEEDS HAS NEVER PRODUCED A ROW. `AllFantasyMarketPlayerValue` is empty in
 * production and always has been, because `gatherOfficialObservations` reads
 * `RedraftTradeProposal` — of which there are ZERO — while 7,781 real trades sit in
 * `LeagueTrade`, one table over, untouched.
 *
 * ⚠ AND THE MODEL DOES NOT TRANSFER UNCHANGED, WHICH IS THE PART THAT MATTERS. The proposal
 * model earns its signal from ASYMMETRY: an offer accepted is evidence, an offer rejected or
 * vetoed is counter-evidence, and `computeOfficialMarketValue` scores
 * `accepted - 1.5*vetoed - 0.5*rejected`. Imported trades are COMPLETED ONLY — Sleeper never
 * reports an offer that was declined — so `rejected` and `vetoed` are structurally zero and that
 * expression can only be positive. Pointed at this data unchanged, the engine would publish
 * every player with five trades as "rising", capped at +12%, and call it a market. It is the
 * same shape of error as averaging trade ratios arithmetically and concluding every manager
 * overpays.
 *
 * So the signal here is not "how often was he accepted" but "what did the market actually pay
 * for him, against what the chart says he is worth". That is two-sided by construction: a player
 * routinely acquired for more than his chart value reads high, a player who is routinely the
 * makeweight reads low, and — because trades are zero-sum — the population has to centre near
 * zero. `probe-af-market-values.ts` checks that it does.
 */

export interface CompletedTradeObservation {
  transactionId: string
  playerId: string
  /** What the other side gave up for him, attributed by his share of his own side. */
  observedValue: number
  season: number
  tradeDate: Date | null
}

export interface CompletedTradeGather {
  byPlayer: Map<
    string,
    { name: string | null; position: string | null; baseValue: number; observations: CompletedTradeObservation[] }
  >
  /** Why trades were skipped, counted rather than swallowed. */
  skipped: Record<string, number>
  tradesConsidered: number
  tradesUsed: number
}

type TradeRow = {
  transactionId: string
  season: number
  tradeDate: Date | null
  playersGiven: unknown
  playersReceived: unknown
  picksGiven: unknown
  picksReceived: unknown
}

const asIds = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && x.length > 0) : []

/**
 * Picks priced on OUR curve, not a vendor's.
 *
 * `lib/pick-curve.ts` was fitted to 771 real dynasty trades, so a pick's value here comes from
 * the same market this function is reading. A trade containing a pick is otherwise unusable, and
 * picks appear in roughly a quarter of them.
 */
function pickValue(raw: unknown): number | null {
  if (!Array.isArray(raw)) return 0
  let total = 0
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return null
    const round = Number((entry as Record<string, unknown>).round)
    if (!Number.isFinite(round) || round < 1) return null
    total += FIRST_ROUND_IN_MARKET_UNITS * pickRoundShare(round)
  }
  return total
}

export async function gatherCompletedTradeObservations(args: {
  prisma: Pick<PrismaClient, 'playerValueSnapshot' | 'sportsPlayer'> & {
    leagueTrade: { findMany: (a: unknown) => Promise<TradeRow[]> }
  }
  /** Only trades from this season onward. Older markets priced different players. */
  sinceSeason?: number
  format?: string
  qbFormat?: string
}): Promise<CompletedTradeGather> {
  const skipped: Record<string, number> = {}
  const bump = (k: string) => (skipped[k] = (skipped[k] ?? 0) + 1)

  const trades = await args.prisma.leagueTrade.findMany({
    where: { season: { gte: args.sinceSeason ?? 2024 } },
    select: {
      transactionId: true,
      season: true,
      tradeDate: true,
      playersGiven: true,
      playersReceived: true,
      picksGiven: true,
      picksReceived: true,
    },
  })

  /*
   * ⚠ EVERY TRADE IS STORED TWICE, ONCE FROM EACH SIDE. The mirror rows carry the same
   * `transactionId` with `given` and `received` swapped, so counting both would double every
   * player's sample and halve the effective evidence threshold. One row already describes the
   * whole trade.
   */
  const unique = new Map<string, TradeRow>()
  for (const t of trades) if (t.transactionId && !unique.has(t.transactionId)) unique.set(t.transactionId, t)

  const ids = new Set<string>()
  for (const t of unique.values()) {
    for (const id of [...asIds(t.playersGiven), ...asIds(t.playersReceived)]) ids.add(id)
  }
  if (ids.size === 0) {
    return { byPlayer: new Map(), skipped, tradesConsidered: unique.size, tradesUsed: 0 }
  }

  const snapshots = await args.prisma.playerValueSnapshot.findMany({
    where: {
      sleeperId: { in: [...ids] },
      source: 'FANTASYCALC',
      format: args.format ?? 'DYNASTY',
      qbFormat: args.qbFormat ?? 'ONE_QB',
    },
    orderBy: { capturedAt: 'desc' },
    select: { sleeperId: true, value: true },
  })
  const chart = new Map<string, number>()
  for (const r of snapshots) if (!chart.has(r.sleeperId)) chart.set(r.sleeperId, r.value)

  const players = await args.prisma.sportsPlayer.findMany({
    where: { sleeperId: { in: [...ids] } },
    select: { sleeperId: true, name: true, position: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
  })
  const meta = new Map<string, { name: string; position: string | null }>()
  for (const r of players) {
    if (!r.sleeperId) continue
    const cur = meta.get(r.sleeperId)
    if (!cur || (!cur.position && r.position)) meta.set(r.sleeperId, { name: r.name, position: r.position })
  }

  const byPlayer: CompletedTradeGather['byPlayer'] = new Map()
  let tradesUsed = 0

  for (const t of unique.values()) {
    const given = asIds(t.playersGiven)
    const received = asIds(t.playersReceived)
    if (given.length === 0 && received.length === 0) {
      bump('no_players')
      continue
    }

    const gPicks = pickValue(t.picksGiven)
    const rPicks = pickValue(t.picksReceived)
    if (gPicks == null || rPicks == null) {
      bump('unparseable_pick')
      continue
    }

    /*
     * Every player on BOTH sides must be priced. Attributing a side's value while treating an
     * unpriced player as worth nothing would load his entire value onto his team-mates, and the
     * error lands on exactly the players we know least about.
     */
    if (![...given, ...received].every((id) => chart.has(id))) {
      bump('unpriced_player')
      continue
    }

    const gValue = given.reduce((s, id) => s + (chart.get(id) ?? 0), 0) + gPicks
    const rValue = received.reduce((s, id) => s + (chart.get(id) ?? 0), 0) + rPicks
    if (gValue <= 0 || rValue <= 0) {
      bump('side_worth_nothing')
      continue
    }

    tradesUsed++

    const record = (id: string, sideValue: number, otherValue: number) => {
      const own = chart.get(id) ?? 0
      if (own <= 0) return
      // His share of what his own side was worth, applied to what the other side paid.
      const observedValue = otherValue * (own / sideValue)
      const entry =
        byPlayer.get(id) ??
        {
          name: meta.get(id)?.name ?? null,
          position: meta.get(id)?.position ?? null,
          baseValue: own,
          observations: [] as CompletedTradeObservation[],
        }
      entry.observations.push({
        transactionId: t.transactionId,
        playerId: id,
        observedValue,
        season: t.season,
        tradeDate: t.tradeDate,
      })
      byPlayer.set(id, entry)
    }

    for (const id of given) record(id, gValue, rValue)
    for (const id of received) record(id, rValue, gValue)
  }

  return { byPlayer, skipped, tradesConsidered: unique.size, tradesUsed }
}

/** A published-or-not market value derived from completed trades. */
export interface CompletedTradeMarketValue {
  playerId: string
  playerName: string | null
  position: string | null
  baseValue: number
  marketValue: number
  adjustmentPercent: number
  adjustmentPoints: number
  confidence: number
  sampleSize: number
  direction: 'rising' | 'falling' | 'stable' | 'insufficient'
  published: boolean
  reasons: string[]
}

/** Below this many priced trades a single lopsided deal defines the player. */
export const COMPLETED_MIN_SAMPLE = 5
/** The most we will move a chart value, at any sample size. */
export const COMPLETED_MAX_ADJUSTMENT = 12

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

/**
 * Turn a player's observations into an adjustment on his chart value.
 *
 * ⚠ THE MEDIAN, NOT THE MEAN, AND FOR A REASON THIS CODEBASE HAS ALREADY PAID FOR ONCE. A single
 * blockbuster where a player is the headline piece produces an implied value many times his
 * chart price; a mean lets that one deal define him permanently. The manager-tendency work hit
 * exactly this and had to move to a geometric mean of ratios. The median is the blunter fix and
 * the right one here, because the tail is genuinely one-sided.
 *
 * ⚠ THE SAMPLE TIER CAPS THE MOVE, NOT THE CONFIDENCE. Five trades can say a player is
 * mispriced; they cannot say he is mispriced by 12%. The cap widens only as evidence does.
 */
export function computeCompletedTradeValue(input: {
  playerId: string
  playerName: string | null
  position: string | null
  baseValue: number
  observations: readonly CompletedTradeObservation[]
  /**
   * What a player of THIS value normally fetches, as a ratio of chart value.
   *
   * ⚠ WITHOUT IT EVERY MID-TIER PLAYER READS AS FALLING, AND THAT IS ARITHMETIC, NOT MARKET.
   * Attribution conserves value in the SUM — the mean observed/chart ratio comes out at 1.066 —
   * but the median is 0.816, with only 38% of observations above chart. High-value players
   * dominate the sum and sit near 1, so the many smaller players must sit below it: stars carry
   * a premium and depth is discounted. Measured against a flat 1.0 the median player is charged
   * for the tier he is in rather than for his own market, and the population comes out 147
   * falling to 56 rising. This is the same correction as measuring a defender against his own
   * position's replacement level rather than against the league.
   */
  tierBaselineRatio: number
}): CompletedTradeMarketValue {
  const sampleSize = new Set(input.observations.map((o) => o.transactionId)).size
  const base = {
    playerId: input.playerId,
    playerName: input.playerName,
    position: input.position,
    baseValue: input.baseValue,
    sampleSize,
  }

  const unpublished = (reason: string): CompletedTradeMarketValue => ({
    ...base,
    marketValue: input.baseValue,
    adjustmentPercent: 0,
    adjustmentPoints: 0,
    confidence: 0,
    direction: 'insufficient',
    published: false,
    reasons: [reason],
  })

  if (sampleSize < COMPLETED_MIN_SAMPLE) {
    return unpublished(`Only ${sampleSize} priced trade${sampleSize === 1 ? '' : 's'} on file — not enough to move a price`)
  }
  const observed = median(input.observations.map((o) => o.observedValue))
  if (observed == null || input.baseValue <= 0) return unpublished('No usable observed value')

  const baseline = input.tierBaselineRatio > 0 ? input.tierBaselineRatio : 1
  const rawPercent = (observed / input.baseValue / baseline - 1) * 100
  const tierCap = sampleSize < 8 ? 4 : sampleSize < 15 ? 8 : COMPLETED_MAX_ADJUSTMENT
  const adjustmentPercent = Math.round(clamp(rawPercent, -tierCap, tierCap) * 10) / 10

  /*
   * Confidence rises with evidence and falls with disagreement between trades. A player priced
   * consistently across ten deals is a different claim from one whose implied value swings
   * wildly, even at the same sample size.
   */
  const values = input.observations.map((o) => o.observedValue)
  const spread = values.length > 1 ? (Math.max(...values) - Math.min(...values)) / input.baseValue : 0
  const confidence = clamp(Math.round(45 + 4 * sampleSize - 12 * spread), 0, 100)

  const marketValue = Math.round(input.baseValue * (1 + adjustmentPercent / 100))
  const direction =
    adjustmentPercent > 0.5 ? 'rising' : adjustmentPercent < -0.5 ? 'falling' : 'stable'

  const reasons = [
    `${sampleSize} completed trades; market paid a median ${Math.round(observed)} against a chart value of ` +
      `${Math.round(input.baseValue)} (players at this value normally fetch ${Math.round(baseline * 100)}% of chart)`,
  ]
  if (Math.abs(rawPercent) > tierCap) {
    reasons.push(`Move capped at ±${tierCap}% for a ${sampleSize}-trade sample`)
  }

  return {
    ...base,
    marketValue,
    adjustmentPercent,
    adjustmentPoints: marketValue - input.baseValue,
    confidence,
    direction,
    published: true,
    reasons,
  }
}


/**
 * The median observed/chart ratio for each quartile of chart value.
 *
 * Quartiles rather than a single number because the discount is not flat across the board — the
 * gap between what a 4,000-value star fetches and what a 200-value bench piece fetches is the
 * whole reason a flat baseline mislabels the middle of the market.
 */
export function tierBaselines(gathered: CompletedTradeGather): (baseValue: number) => number {
  const rows: Array<{ base: number; ratio: number }> = []
  for (const [, e] of gathered.byPlayer) {
    if (e.baseValue <= 0) continue
    for (const o of e.observations) rows.push({ base: e.baseValue, ratio: o.observedValue / e.baseValue })
  }
  if (rows.length === 0) return () => 1

  const sorted = [...rows].sort((a, b) => a.base - b.base)
  const cuts = [0.25, 0.5, 0.75].map((f) => sorted[Math.floor(f * (sorted.length - 1))]!.base)
  const buckets: number[][] = [[], [], [], []]
  const indexOf = (base: number) => (base <= cuts[0]! ? 0 : base <= cuts[1]! ? 1 : base <= cuts[2]! ? 2 : 3)
  for (const r of sorted) buckets[indexOf(r.base)]!.push(r.ratio)

  const medians = buckets.map((b) => {
    if (b.length === 0) return 1
    const s = [...b].sort((x, y) => x - y)
    return s[Math.floor(s.length / 2)]!
  })
  return (baseValue: number) => medians[indexOf(baseValue)] ?? 1
}

/**
 * Version markers for rows produced from completed trades.
 *
 * ⚠ DELIBERATELY DISTINCT FROM THE PROPOSAL ENGINE'S `internal-trade-signals` / `t9.1`. The two
 * read different evidence and answer with different models, and the table has one row per
 * player. Stamping both the same way would make a row's provenance unrecoverable the moment the
 * proposal path ever starts producing anything.
 */
export const COMPLETED_SOURCE_VERSION = 'completed-trade-signals'
export const COMPLETED_CALCULATION_VERSION = 'ct1.0'

/**
 * Compute and (optionally) persist AllFantasy market values from completed trades.
 *
 * DRY-RUN BY DEFAULT. Writes ONLY `AllFantasyMarketPlayerValue` and its audit table.
 *
 * `leagueConcept` is 'dynasty' because the chart values underneath are the DYNASTY board. The
 * proposal path writes 'redraft', so the two never collide on the table's unique key and a
 * reader can tell which market a row describes.
 */
export async function recalculateFromCompletedTrades(
  prisma: PrismaClient,
  opts: { sport?: string; sinceSeason?: number; dryRun?: boolean } = {},
): Promise<{
  sport: string
  evaluated: number
  published: number
  written: number
  tradesUsed: number
  medianAdjustment: number | null
  dryRun: boolean
}> {
  const sport = opts.sport ?? 'NFL'
  const dryRun = opts.dryRun !== false
  const leagueConcept = 'dynasty'

  const gathered = await gatherCompletedTradeObservations({
    prisma: prisma as never,
    sinceSeason: opts.sinceSeason,
  })
  const baselineFor = tierBaselines(gathered)

  const values = [...gathered.byPlayer.entries()].map(([playerId, e]) =>
    computeCompletedTradeValue({
      playerId,
      playerName: e.name,
      position: e.position,
      baseValue: e.baseValue,
      observations: e.observations,
      tierBaselineRatio: baselineFor(e.baseValue),
    }),
  )
  const published = values.filter((v) => v.published)

  const adj = published.map((v) => v.adjustmentPercent).sort((a, b) => a - b)
  const medianAdjustment = adj.length ? adj[Math.floor(adj.length / 2)]! : null

  let written = 0
  if (!dryRun) {
    const generatedAt = new Date()
    for (const v of published) {
      const existing = await prisma.allFantasyMarketPlayerValue
        .findUnique({
          where: { sport_leagueConcept_playerId: { sport, leagueConcept, playerId: v.playerId } },
          select: { id: true, marketValue: true, adjustmentPercent: true },
        })
        .catch(() => null)

      const data = {
        playerName: v.playerName,
        position: v.position,
        baseValue: v.baseValue,
        marketValue: v.marketValue,
        adjustmentPercent: v.adjustmentPercent,
        adjustmentPoints: v.adjustmentPoints,
        confidence: v.confidence,
        sampleSize: v.sampleSize,
        acceptedTradeCount: v.sampleSize,
        /*
         * Structurally zero and stated as such. Sleeper reports completed trades only, so there
         * is no declined offer to count — these are not "we looked and found none".
         */
        rejectedSignalCount: 0,
        vetoedSignalCount: 0,
        blockSignalCount: 0,
        interestSignalCount: 0,
        recentSignalCount: v.sampleSize,
        direction: v.direction,
        published: v.published,
        sourceVersion: COMPLETED_SOURCE_VERSION,
        calculationVersion: COMPLETED_CALCULATION_VERSION,
        reasons: v.reasons as unknown as object,
        generatedAt,
      }

      const row = await prisma.allFantasyMarketPlayerValue.upsert({
        where: { sport_leagueConcept_playerId: { sport, leagueConcept, playerId: v.playerId } },
        create: { sport, leagueConcept, playerId: v.playerId, ...data },
        update: data,
      })
      written++

      if (!existing || existing.marketValue !== row.marketValue) {
        await prisma.allFantasyMarketValueAudit
          .create({
            data: {
              marketValueId: row.id,
              sport,
              leagueConcept,
              playerId: v.playerId,
              previousValue: existing?.marketValue ?? null,
              newValue: row.marketValue,
              previousAdjustmentPercent: existing?.adjustmentPercent ?? null,
              newAdjustmentPercent: row.adjustmentPercent,
              confidence: row.confidence,
              sampleSize: row.sampleSize,
              reasonSummary: v.reasons as unknown as object,
              calculationVersion: COMPLETED_CALCULATION_VERSION,
              generatedAt,
            },
          })
          .catch(() => null)
      }
    }
  }

  return {
    sport,
    evaluated: values.length,
    published: published.length,
    written,
    tradesUsed: gathered.tradesUsed,
    medianAdjustment,
    dryRun,
  }
}
