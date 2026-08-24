import 'server-only'

import { prisma } from '@/lib/prisma'
import type { TradeGradesPayload, GradedTrade } from '@/lib/trade-intel/sleeperTradeGradeService'
import {
  buildLegacyCanonicalGrade,
  type LegacyTradeAssetInput,
} from '@/lib/decision-os/trade/legacyCanonicalGrade'

/**
 * Trades that landed in your leagues recently.
 *
 * ⚠ THE DATA WAS NEVER MISSING. The /core home carries a coverage note saying
 * trades are not ingested, and the league home hard-codes its activity feed
 * unavailable "because league transactions are not ingested for this platform
 * yet". Both statements are false: the trade-grade sweep runs every 30 minutes
 * over every imported Sleeper league, resolves BOTH sides down to individual
 * players and draft picks, grades them, and caches the result. Two surfaces
 * have been declining to look, and one of them says so in words that are
 * wrong.
 *
 * This reads that cache. One `in` query over the account's Sleeper league ids,
 * no provider call, no per-league fan-out, nothing recomputed — the cron has
 * already paid for all of it.
 *
 * ⚠ THE SWEEP'S OWN LETTER IS NOT USED, AND THAT IS THE POINT. It is a
 * RETROSPECTIVE grade scored on points already realised: days after a trade it
 * is measuring almost nothing, and a 2027 pick contributes exactly zero
 * because that draft has not happened. Publishing it here would be the "C
 * means we have no data" failure this codebase has already been bitten by.
 *
 * The verdict attached below is a different question, asked prospectively: was
 * this deal balanced ON THE DAY, by market value of what each side received?
 * That one CAN be answered now, it is the question a manager actually asks the
 * hour a trade lands, and the canonical engine prices a future pick properly
 * (a 2027 4th is 320 discounted for being a year out, not zero). It is
 * published only when every asset on both sides priced — see gradeOf.
 */

/** A trade older than this is history, not news. */
const RECENT_DAYS = 14
const CACHE_PREFIX = 'trade-grades:v2:'

export type RecentTradeAsset = {
  kind: 'player' | 'pick'
  name: string
  position: string | null
}

export type RecentTradeSide = {
  rosterId: number
  managerName: string
  teamName: string | null
  received: RecentTradeAsset[]
}

/**
 * A prospective verdict on the deal as struck — market value of what each side
 * received, picks included. NOT the retrospective letter the sweep computes
 * from realised points: see the grade note in the loader below.
 */
export type RecentTradeVerdict = {
  /** Legacy vocabulary: "Fair", "Slightly favors A", … */
  verdict: string
  /** 0–100. Stated beside the verdict, never on its own. */
  fairness: number | null
  /** 0–100 confidence the engine reports in its own inputs. */
  confidence: number
  /** Roster id the verdict favours, or null when it reads as fair. */
  favoursRosterId: number | null
}

export type RecentTrade = {
  id: string
  leagueId: string
  leagueName: string
  platformLeagueId: string
  acceptedAt: string
  sides: RecentTradeSide[]
  /** True when a side's assets could not all be named — the card says so. */
  partial: boolean
  /**
   * Present only when every asset on both sides could be priced. Absent means
   * exactly that — never a neutral grade standing in for missing data.
   */
  verdict: RecentTradeVerdict | null
}

export type RecentTradesLeague = {
  id: string
  name: string
  platformLeagueId: string | null
}

function assetsOf(side: GradedTrade['sides'][number]): RecentTradeAsset[] {
  const players: RecentTradeAsset[] = side.playersIn.map((p) => ({
    kind: 'player' as const,
    name: p.name,
    position: p.position,
  }))
  /*
   * A pick is named by its own label ("2027 4th"), never by whoever it later
   * became — the trade was made for the pick, and resolving it to a player
   * would rewrite what the two managers actually agreed.
   */
  const picks: RecentTradeAsset[] = side.picksIn.map((p) => ({
    kind: 'pick' as const,
    name: p.label,
    position: null,
  }))
  return [...players, ...picks]
}

/**
 * Prospective verdict for a two-sided trade, or null.
 *
 * ⚠ IT PUBLISHES NOTHING WHEN ANYTHING IS UNPRICED. The engine reports
 * `insufficientData` itself, and a partially-priced trade systematically
 * favours whoever received the asset we could not price — the exact bias the
 * sweep's own withholding rule exists to avoid. Absent is the honest answer.
 *
 * ⚠ TWO SIDES ONLY. A three-team deal is not two columns and the engine models
 * A-versus-B; grading it as if two of the three traded would be a fiction.
 */
function gradeOf(
  trade: GradedTrade,
  valueByName: Map<string, number>,
  currentSeason: number,
): RecentTradeVerdict | null {
  const sides = trade.sides ?? []
  if (sides.length !== 2 || trade.multiTeam) return null

  const [a, b] = sides
  const toInputs = (side: GradedTrade['sides'][number]): LegacyTradeAssetInput[] => [
    ...side.playersIn.map((p) => ({
      type: 'player' as const,
      player: { name: p.name, pos: p.position, team: null },
    })),
    ...side.picksIn.map((p) => ({
      type: 'pick' as const,
      pick: { year: Number(p.season) || null, round: p.round ?? null },
    })),
  ]

  const assetsA = toInputs(a)
  const assetsB = toInputs(b)
  if (assetsA.length === 0 || assetsB.length === 0) return null

  /*
   * ⚠ EVERY TRADED PLAYER MUST HAVE A PRICE, AND THE ENGINE WILL NOT TELL US.
   * Its `insufficientData` flag did not fire on a trade where the only player
   * was unpriced: an absent price behaves as ZERO inside the value sum, so the
   * side that received that player reads as robbed and the verdict came back
   * "Strongly favors B" with total confidence. A test caught it before this
   * shipped.
   *
   * That is the exact bias the sweep's own withholding rule exists to avoid —
   * a partially priced trade always favours whoever received the asset we
   * could not price. So the gate lives here, ahead of the engine: if one
   * player on either side has no price, there is no verdict. Picks need no
   * check; they are priced from the round table, not the market.
   */
  const everyPlayerPriced = [...a.playersIn, ...b.playersIn].every((p) =>
    valueByName.has(p.name.trim().toLowerCase()),
  )
  if (!everyPlayerPriced) return null

  const graded = buildLegacyCanonicalGrade({
    assetsA,
    assetsB,
    marketValueFor: (name: string) => valueByName.get(name.trim().toLowerCase()) ?? null,
    currentSeason,
  })
  if (graded.insufficientData || !graded.verdict) return null

  /*
   * The engine speaks in "A"/"B"; the card speaks in rosters. Translate here so
   * no surface has to know which side the engine called A.
   */
  const favours = graded.verdict.includes('favors A')
    ? a.rosterId
    : graded.verdict.includes('favors B')
      ? b.rosterId
      : null

  return {
    verdict: graded.verdict,
    fairness: graded.fairnessScore,
    confidence: graded.confidenceScore,
    favoursRosterId: favours,
  }
}

export async function getRecentTrades(
  leagues: RecentTradesLeague[],
  now: Date = new Date(),
  limit = 3,
): Promise<RecentTrade[]> {
  const byPlatformId = new Map<string, RecentTradesLeague>()
  for (const l of leagues) {
    if (l.platformLeagueId) byPlatformId.set(l.platformLeagueId, l)
  }
  if (byPlatformId.size === 0) return []

  const keys = [...byPlatformId.keys()].map((id) => `${CACHE_PREFIX}${id}`)
  const rows = await prisma.sportsDataCache
    .findMany({ where: { cacheKey: { in: keys } }, select: { cacheKey: true, data: true } })
    .catch(() => [] as { cacheKey: string; data: unknown }[])

  const cutoff = now.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000
  const out: RecentTrade[] = []
  /** The raw graded rows, kept so only the visible ones get priced. */
  const graded = new Map<string, GradedTrade>()

  for (const row of rows) {
    const payload =
      row.data && typeof row.data === 'object' && !Array.isArray(row.data)
        ? (row.data as unknown as TradeGradesPayload)
        : null
    if (!payload || payload.version !== 2) continue

    const platformLeagueId = row.cacheKey.slice(CACHE_PREFIX.length)
    const league = byPlatformId.get(platformLeagueId)
    if (!league) continue

    for (const trade of payload.trades ?? []) {
      const at = new Date(trade.createdIso).getTime()
      if (!Number.isFinite(at) || at < cutoff) continue

      const sides: RecentTradeSide[] = (trade.sides ?? []).map((s) => ({
        rosterId: s.rosterId,
        managerName: s.managerName,
        teamName: s.teamName,
        received: assetsOf(s),
      }))
      /*
       * A side that received nothing we can name is not renderable as a swap —
       * saying so beats drawing an arrow into an empty column.
       */
      const partial = sides.some((s) => s.received.length === 0)
      if (sides.length < 2) continue

      out.push({
        id: trade.id,
        leagueId: league.id,
        leagueName: league.name,
        platformLeagueId,
        acceptedAt: new Date(at).toISOString(),
        sides,
        partial,
        /* Filled below, once every traded player has been priced in one read. */
        verdict: null,
      })
      graded.set(`${platformLeagueId}:${trade.id}`, trade)
    }
  }

  out.sort((a, b) => new Date(b.acceptedAt).getTime() - new Date(a.acceptedAt).getTime())
  const visible = out.slice(0, limit)

  /*
   * ⚠ ONE READ, FOR THE VISIBLE TRADES ONLY. Prices are looked up by the
   * Sleeper player id the trade assets already carry — the indexed column —
   * rather than by name, which has no index and would collide across the two
   * athletes this repo already refuses to confuse. Only the trades that will
   * actually render are priced: grading rows nobody sees is pure cost.
   */
  const playerIds = new Set<string>()
  for (const t of visible) {
    const src = graded.get(`${t.platformLeagueId}:${t.id}`)
    for (const side of src?.sides ?? []) {
      for (const p of side.playersIn) if (p.playerId) playerIds.add(p.playerId)
    }
  }

  const valueByName = new Map<string, number>()
  if (playerIds.size > 0) {
    const priceRows = await prisma.playerValueSnapshot
      .findMany({
        where: { sleeperId: { in: [...playerIds] }, source: 'FANTASYCALC' },
        orderBy: { capturedAt: 'desc' },
        select: { sleeperId: true, name: true, value: true },
      })
      .catch(() => [] as { sleeperId: string; name: string; value: number }[])
    const seen = new Set<string>()
    for (const r of priceRows) {
      if (seen.has(r.sleeperId)) continue
      seen.add(r.sleeperId)
      valueByName.set(r.name.trim().toLowerCase(), r.value)
    }
  }

  const currentSeason = now.getUTCFullYear()
  for (const t of visible) {
    const src = graded.get(`${t.platformLeagueId}:${t.id}`)
    if (src) t.verdict = gradeOf(src, valueByName, currentSeason)
  }

  return visible
}
