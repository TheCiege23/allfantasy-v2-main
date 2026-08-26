import 'server-only'

import { prisma } from '@/lib/prisma'
import { FIRST_ROUND_IN_MARKET_UNITS, pickRoundShare } from '@/lib/pick-curve'

/**
 * Manager positional premium — the last open factor in the value ledger.
 *
 * The question it answers: when THIS manager acquires a running back, what
 * fraction of market value do they hand over? A manager who reliably pays 20%
 * over for backs is leverage the moment you are the one holding a back, and it
 * is the one counterparty signal that comes from behaviour rather than from
 * roster arithmetic.
 *
 * ⚠ THE LEDGER LISTED THIS AS BLOCKED AND THE BLOCKER IS GONE. `LEDGER-FACTORS.md`
 * said it needed "per-manager trade history by position" and that
 * `LeagueTradeHistory` was ingestion progress rather than trades. True, and the
 * wrong table: `TransactionFact` payloads carry `playersInIds`, `playersOutIds`
 * and `pickDetail` per side, which is exactly what
 * `scripts/probe-manager-tendencies.ts` already pools to fill
 * `manager_trade_tendencies`. Same source, one more dimension.
 *
 * ⚠ LOG SPACE, NEVER AN ARITHMETIC MEAN OF RATIOS. Trades are zero-sum: if one
 * side gives 1,500 for 1,000 the other gives 1,000 for 1,500, so the two ratios
 * are 1.5 and 0.667 and the population MUST centre on 1. Averaged
 * arithmetically that pair reads 1.083, the bias compounds, and every manager
 * in the product comes out an overpayer — measured on the first cut of the
 * tendencies writer, median 1.56 with 224 of 285 managers classified high risk.
 * The bug is invisible per row and only appears in the population.
 *
 * ⚠ REPORTED, NEVER APPLIED TO THE PRICE. `counterpartyPriceDelta` already
 * moves the counterparty price for THEIR roster need and the waiver wire. A
 * manager overpays for backs largely BECAUSE they are short at back, so folding
 * a behavioural ratio on top of a structural one double-counts the same fact —
 * the exact trap the age factor is kept out of. This produces a note.
 */

/** One side of one completed trade, priced in a single consistent unit. */
export type PricedSide = {
  transactionId: string
  valueReceived: number
  valueGiven: number
  /** Market value arriving, split by the position it arrived as. */
  receivedByPosition: Record<string, number>
}

export type PositionPremium = {
  position: string
  /** Geometric mean of given ÷ received. Above 1 means they pay over market. */
  factor: number
  /** How many trade sides it came from — always reported, never hidden. */
  sides: number
}

/**
 * A side counts toward a position only when that position is most of what they
 * received.
 *
 * ⚠ THE ALTERNATIVE IS AN ALLOCATION MODEL, AND WE DO NOT HAVE ONE. Splitting a
 * mixed trade's overpay across the positions in it by value share would invent
 * a rule about how managers price bundles — a confident number resting on
 * nothing. A trade that is 70% one position tells you about that position; a
 * balanced two-position trade tells you about neither, and is skipped.
 */
export const DOMINANT_SHARE = 0.6

/**
 * Below this the average is one blockbuster away from being a personality.
 *
 * Measured across 771 dynasty trades, the imbalance a fair-trade model leaves
 * unexplained is roughly the size of the trade itself, so a manager's habit
 * only separates from noise with repetition.
 */
export const MIN_SIDES_PER_POSITION = 4

/** Below this the premium is inside the noise and is not worth a sentence. */
export const PREMIUM_FLOOR = 1.08

/** Pure. Exported so the arithmetic can be exercised without a database. */
export function computePositionPremium(sides: readonly PricedSide[]): PositionPremium[] {
  const logsByPosition = new Map<string, number[]>()

  for (const s of sides) {
    if (!(s.valueReceived > 0) || !(s.valueGiven > 0)) continue

    let dominant: string | null = null
    for (const [pos, v] of Object.entries(s.receivedByPosition)) {
      if (v / s.valueReceived >= DOMINANT_SHARE) {
        dominant = pos
        break
      }
    }
    if (!dominant) continue

    const arr = logsByPosition.get(dominant) ?? []
    arr.push(Math.log(s.valueGiven / s.valueReceived))
    logsByPosition.set(dominant, arr)
  }

  const out: PositionPremium[] = []
  for (const [position, logs] of logsByPosition) {
    if (logs.length < MIN_SIDES_PER_POSITION) continue
    const mean = logs.reduce((a, b) => a + b, 0) / logs.length
    out.push({
      position,
      factor: Math.round(Math.exp(mean) * 1000) / 1000,
      sides: logs.length,
    })
  }
  return out.sort((a, b) => b.factor - a.factor)
}

export type ManagerProfile = {
  /** From `manager_trade_tendencies`. Null means the writer had too thin a sample. */
  overpayRatio: number | null
  prefersPicks: boolean | null
  prefersYouth: boolean | null
  riskTolerance: string | null
  tradesAccepted: number | null
  positions: PositionPremium[]
}

const EMPTY_PROFILE: ManagerProfile = {
  overpayRatio: null,
  prefersPicks: null,
  prefersYouth: null,
  riskTolerance: null,
  tradesAccepted: null,
  positions: [],
}

/** Enough to build a habit from without turning one analysis into a table scan. */
const MAX_LEAGUES = 12
const MAX_FACTS = 300

type FactPayload = {
  sleeperTransactionId?: unknown
  playersInIds?: unknown
  playersOutIds?: unknown
  pickDetail?: unknown
}

function idList(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : []
}

/**
 * Everything known about how this manager trades.
 *
 * ⚠ THE IDENTITY CHAIN BREAKS SILENTLY IF IT IS GOT WRONG.
 * `TransactionFact.rosterId` is Sleeper's numeric ROSTER id; `manager_trade_
 * tendencies.user_id` is a Sleeper USER id. `LeagueTeam` is the only bridge —
 * unique on `(leagueId, externalId)`, where `externalId` IS that roster id.
 * Matching on roster id alone across leagues would pool one manager's trades
 * with a stranger who happens to be roster 3 somewhere else.
 *
 * Never throws: every read falls back to an empty profile, because a missing
 * note is a smaller error than a wrong one.
 */
export async function loadManagerProfile(args: {
  /** Sleeper user id — `LeagueTeam.platformUserId`. */
  managerKey: string
  /** Restricts the source leagues, so dynasty habits are not read off redraft trades. */
  isDynasty: boolean
  /** The format every value is priced in, so the ratios share one unit. */
  qbFormat: 'ONE_QB' | 'SUPERFLEX'
}): Promise<ManagerProfile> {
  const { managerKey } = args
  if (!managerKey?.trim()) return EMPTY_PROFILE

  try {
    const tendency = await prisma.manager_trade_tendencies
      .findUnique({ where: { user_id: managerKey } })
      .catch(() => null)

    const base: ManagerProfile = {
      /*
       * ⚠ NULL IS NOT THE COLUMN DEFAULT. `prefers_youth`/`prefers_picks`
       * default to false and `risk_tolerance` to "medium", and the writer
       * deliberately leaves them null when the sample was too thin. Reading a
       * default as an answer asserts we looked and found no preference, which
       * is a different claim from not knowing.
       */
      overpayRatio: tendency?.avg_overpay_ratio ?? null,
      prefersPicks: tendency?.prefers_picks ?? null,
      prefersYouth: tendency?.prefers_youth ?? null,
      riskTolerance: tendency?.risk_tolerance ?? null,
      tradesAccepted: tendency?.trades_accepted ?? null,
      positions: [],
    }

    const memberships = await prisma.leagueTeam
      .findMany({
        where: { platformUserId: managerKey },
        select: { leagueId: true, externalId: true },
        take: 60,
      })
      .catch(() => [])
    if (memberships.length === 0) return base

    const leagues = await prisma.league
      .findMany({
        where: { id: { in: [...new Set(memberships.map((m) => m.leagueId))] } },
        select: { id: true, isDynasty: true },
      })
      .catch(() => [])

    /* Dynasty and redraft price the same player differently; mixing them would
       measure the format rather than the manager. */
    const usable = new Set(
      leagues.filter((l) => Boolean(l.isDynasty) === args.isDynasty).map((l) => l.id),
    )
    const pairs = memberships.filter((m) => usable.has(m.leagueId))
    if (pairs.length === 0) return base

    const leagueIds = [...new Set(pairs.map((p) => p.leagueId))].slice(0, MAX_LEAGUES)
    const mine = new Set(pairs.map((p) => `${p.leagueId}:${String(p.externalId)}`))

    const facts = await prisma.transactionFact
      .findMany({
        where: {
          leagueId: { in: leagueIds },
          type: 'trade',
          rosterId: { in: [...new Set(pairs.map((p) => String(p.externalId)))] },
        },
        orderBy: { createdAt: 'desc' },
        take: MAX_FACTS,
        select: { leagueId: true, rosterId: true, payload: true },
      })
      .catch(() => [])

    /* Pair-filtered in memory: roster id alone is not unique across leagues. */
    const ours = facts.filter((f) => mine.has(`${f.leagueId}:${String(f.rosterId)}`))
    if (ours.length === 0) return base

    const playerIds = new Set<string>()
    for (const f of ours) {
      const p = (f.payload ?? {}) as FactPayload
      for (const id of [...idList(p.playersInIds), ...idList(p.playersOutIds)]) playerIds.add(id)
    }
    if (playerIds.size === 0) return base

    const ids = [...playerIds]
    const [players, snaps] = await Promise.all([
      prisma.sportsPlayer
        .findMany({
          where: { sleeperId: { in: ids } },
          select: { sleeperId: true, position: true },
        })
        .catch(() => []),
      prisma.playerValueSnapshot
        .findMany({
          where: {
            sleeperId: { in: ids },
            source: 'FANTASYCALC',
            format: args.isDynasty ? 'DYNASTY' : 'REDRAFT',
            qbFormat: args.qbFormat,
          },
          orderBy: { capturedAt: 'desc' },
          select: { sleeperId: true, value: true },
        })
        .catch(() => []),
    ])

    const positionOf = new Map<string, string>()
    for (const p of players) {
      if (p.sleeperId && p.position && !positionOf.has(p.sleeperId)) {
        positionOf.set(p.sleeperId, p.position.toUpperCase().trim())
      }
    }
    const valueOf = new Map<string, number>()
    for (const s of snaps) if (!valueOf.has(s.sleeperId)) valueOf.set(s.sleeperId, s.value)

    const sides: PricedSide[] = []
    for (const f of ours) {
      const p = (f.payload ?? {}) as FactPayload
      const txn = p.sleeperTransactionId
      if (!txn) continue

      let received = 0
      let given = 0
      let fullyPriced = true
      const receivedByPosition: Record<string, number> = {}

      for (const id of idList(p.playersInIds)) {
        const v = valueOf.get(id)
        if (v == null) {
          fullyPriced = false
          continue
        }
        received += v
        const pos = positionOf.get(id) ?? 'UNKNOWN'
        receivedByPosition[pos] = (receivedByPosition[pos] ?? 0) + v
      }
      for (const id of idList(p.playersOutIds)) {
        const v = valueOf.get(id)
        if (v == null) {
          fullyPriced = false
          continue
        }
        given += v
      }

      /*
       * ⚠ A HALF-PRICED SIDE IS NOT A CHEAP SIDE. Treating an unpriceable
       * defender as worth nothing mechanically makes whichever manager received
       * him look like a genius. Drop the side instead.
       */
      if (!fullyPriced) continue

      /*
       * Picks count toward the totals through the single fitted curve, so a
       * first traded for a back does not read as paying nothing for the back.
       * They are never a "position" — a pick is not something a manager can
       * have a positional taste for.
       */
      const me = Number(f.rosterId)
      const detail = Array.isArray(p.pickDetail) ? (p.pickDetail as Array<Record<string, unknown>>) : []
      for (const pk of detail) {
        const round = Number(pk.round)
        if (!Number.isFinite(round) || round < 1) continue
        const value = FIRST_ROUND_IN_MARKET_UNITS * pickRoundShare(round)
        if (Number(pk.owner_id) === me) received += value
        else if (Number(pk.previous_owner_id) === me) given += value
      }

      sides.push({ transactionId: String(txn), valueReceived: received, valueGiven: given, receivedByPosition })
    }

    return { ...base, positions: computePositionPremium(sides) }
  } catch {
    return EMPTY_PROFILE
  }
}

/**
 * The notes, in the leverage voice.
 *
 * ⚠ ONLY A PREMIUM IS LEVERAGE, AND ONLY FOR A POSITION IN THIS DEAL. That a
 * manager is disciplined about tight ends is true, unactionable, and — listed
 * beside every other non-finding — the reason people stop reading a panel.
 */
export function managerPremiumNotes(args: {
  who: string
  profile: ManagerProfile
  /** Positions the viewer is sending them. */
  givePositions: readonly string[]
}): string[] {
  const { who, profile } = args
  const wanted = new Set(args.givePositions.map((p) => p.toUpperCase().trim()).filter(Boolean))
  const notes: string[] = []

  for (const p of profile.positions) {
    if (!wanted.has(p.position) || p.factor < PREMIUM_FLOOR) continue
    const pct = Math.round((p.factor - 1) * 100)
    notes.push(
      `On the ${p.sides} trades where ${who} went and got a ${p.position}, they paid about ${pct}% over market for it. That is a habit, not this deal — but you are the one holding the ${p.position}.`,
    )
  }

  /*
   * `prefers_picks === false` is a real finding and still not worth a line: it
   * tells you nothing to do differently. Only the true case changes an offer.
   */
  if (profile.prefersPicks === true) {
    notes.push(`${who} has taken picks over players often enough for it to show. A pick may close this faster than another body.`)
  }

  return notes
}
