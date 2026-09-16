import 'server-only'

import { prisma } from '@/lib/prisma'
import type { TradeGradesPayload, GradedTrade } from '@/lib/trade-intel/sleeperTradeGradeService'
import {
  buildLegacyCanonicalGrade,
  type LegacyTradeAssetInput,
} from '@/lib/decision-os/trade/legacyCanonicalGrade'
import { scanPendingSleeperTrades } from '@/lib/provider-trades/scanPendingSleeperTrades'

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
  platform?: string | null
}

export type RecentTradesLiveOptions = {
  ownerSleeperId: string | null
  currentWeek: number | null
  /** Provider reads are bounded; the cache remains the source for the rest. */
  maxLeagues?: number
  /**
   * The same scan also finds offers WAITING ON YOU. They are not trades that
   * "landed", so this loader does not render them — but the Trades urgency badge
   * needs them, and a second provider read to learn what this one already knows
   * would be pure cost. Called once per completed pass with every league whose
   * scan actually answered; a league that did not answer is absent, never "0".
   */
  onPendingOffers?: (scanned: Array<{ leagueId: string; waiting: number }>) => void
  /**
   * 🛑 THIS READ RESOLVES WHILE MISSING TRADES, AND ALWAYS HAS. Every source below degrades
   * rather than throwing: the grade-cache query falls back to `[]`, each league's live scan
   * catches its own failure, and a scan that answered for only SOME of its weeks still
   * reports `scanned: true` (see `weeksUnanswered` on PendingTradeScan). So a caller that
   * watches only for a REJECTION cannot tell "nothing traded" from "we could not see most
   * of it".
   *
   * That difference decides whether /core closes the "since your last visit" window, and
   * closing it over trades this read never saw means they never appear in any brief. Called
   * once per OCCURRENCE — three unanswered leagues fire three times — before the returned
   * promise settles. `reason` is a closed vocabulary: never a league id, a provider id or an
   * error message.
   *
   * ⚠ NOR IS IT CALLED FOR ANYTHING PERMANENT, and that rule has three separate applications —
   * the `maxLeagues` cap, a non-Sleeper league, and a scan that came back `unscannedKind:
   * 'identity'` (no roster of yours in that league). A permanent bound reported as a transient
   * failure holds the caller's window open for the life of the league, with nothing able to
   * clear it. Their reasons are all DIFFERENT, and two earlier versions of this note got one or
   * another of them wrong:
   *   - `unscannedKind: 'identity'` costs nothing. The grade cache is read for that league anyway
   *     (`byPlatformId` is built before any filter) and `trade-grades:v2:*` is LEAGUE-scoped, not
   *     viewer-scoped. The live scan could never have added anything either: `completedTrades` is
   *     filtered by the viewer's roster id, and there is no roster id.
   *   - A non-Sleeper league has no trade source here AT ALL. The cache is keyed by Sleeper league
   *     id and written only by lib/trade-intel/sleeperTradeGradeService, so an ESPN or Yahoo
   *     league has no row and never will — it is not "covered by the cache".
   *   - 🛑 THE `maxLeagues` CAP *IS* A BLIND SPOT, AND THIS NOTE SAID OTHERWISE. It claimed "the
   *     exposure is only a trade newer than the 30-minute grade sweep", which is wrong in the way
   *     that matters: that exposure is not bounded, it is LOST. A trade lands in capped league #12
   *     at T−5min; this render does not live-scan it and the cache does not have it yet, so the
   *     caller's boundary closes at T; when the sweep catches up, `tradesSince` filters on
   *     `acceptedAt > T` and T−5min never qualifies. The trade appears in no brief, ever, and the
   *     league list is sorted by name so it is the same leagues every render. It stays unreported
   *     here only because reporting it would hold the boundary open forever for anyone with nine
   *     Sleeper leagues — which is a bad trade, not a safe one. The real fix is a per-league
   *     boundary or no cap; both are their own change.
   * What all three share is being PERMANENT and deterministic. Reporting a permanent bound as a
   * transient failure would hold the trade boundary open for the life of the league.
   */
  onIncomplete?: (reason: 'grade-cache-unreadable' | 'league-scan-unanswered' | 'league-scan-partial-weeks') => void
}

/**
 * Report a gap in what this read could see. A throwing listener must never cost the trades
 * this loader exists to return — same rule as `onPendingOffers`, and the same reason.
 */
function reportIncomplete(
  live: RecentTradesLiveOptions | undefined,
  reason: Parameters<NonNullable<RecentTradesLiveOptions['onIncomplete']>>[0],
): void {
  try {
    live?.onIncomplete?.(reason)
  } catch {
    // A listener's failure is not this read's failure.
  }
}

function liveCompletedTrade(
  league: RecentTradesLeague,
  trade: NonNullable<Awaited<ReturnType<typeof scanPendingSleeperTrades>>['completedTrades']>[number],
): RecentTrade | null {
  if (!league.platformLeagueId || !trade.proposedAt) return null
  const viewerRosterId = Number(trade.viewerRosterExternalId)
  const otherRosterId = Number(trade.counterpartyRosterExternalId)
  const toAsset = (asset: (typeof trade.assetsReceived)[number]): RecentTradeAsset => ({
    kind: asset.isPick ? 'pick' : 'player',
    name: asset.isPick ? (asset.pickRound ?? asset.playerName) : asset.playerName,
    position: asset.isPick ? null : asset.position || null,
  })
  const sides: RecentTradeSide[] = [
    {
      rosterId: Number.isFinite(viewerRosterId) ? viewerRosterId : 0,
      managerName: 'You',
      teamName: null,
      received: trade.assetsReceived.map(toAsset),
    },
    {
      rosterId: Number.isFinite(otherRosterId) ? otherRosterId : -1,
      managerName: trade.proposedBy || 'Another team',
      teamName: null,
      received: trade.assetsGiven.map(toAsset),
    },
  ]
  return {
    id: trade.transactionId,
    leagueId: league.id,
    leagueName: league.name,
    platformLeagueId: league.platformLeagueId,
    acceptedAt: trade.proposedAt,
    sides,
    partial: sides.some((side) => side.received.length === 0),
    verdict: null,
  }
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
  live?: RecentTradesLiveOptions,
): Promise<RecentTrade[]> {
  const byPlatformId = new Map<string, RecentTradesLeague>()
  for (const l of leagues) {
    if (l.platformLeagueId) byPlatformId.set(l.platformLeagueId, l)
  }
  if (byPlatformId.size === 0) return []

  const keys = [...byPlatformId.keys()].map((id) => `${CACHE_PREFIX}${id}`)
  /*
   * ⚠ THIS FALLBACK IS THE READ'S LARGEST BLIND SPOT, NOT A CORNER CASE — it is the PRIMARY
   * source, and the live scan below only tops it up for Sleeper. Failing to `[]` keeps the
   * card up, which is right; letting the caller believe that `[]` meant "nothing traded" is
   * not. A pool timeout here is exactly how /core would close the visit window over every
   * graded trade it holds, so the failure is reported rather than swallowed.
   */
  const rows = await prisma.sportsDataCache
    .findMany({ where: { cacheKey: { in: keys } }, select: { cacheKey: true, data: true } })
    .catch(() => {
      reportIncomplete(live, 'grade-cache-unreadable')
      return [] as { cacheKey: string; data: unknown }[]
    })

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

  /*
   * The durable grade cache is filled by the background pipeline. For leagues
   * the manager is actively using, also read the current and adjacent Sleeper
   * transaction weeks. Three weeks per league finds a just-accepted trade in
   * minutes without repeating the old 18-weeks × every-league request fan-out.
   * SleeperCacheLayer persists each transaction response for five minutes, so
   * this remains DB-first on repeated dashboard loads.
   */
  if (live?.ownerSleeperId) {
    const week = Math.min(18, Math.max(1, live.currentWeek ?? 1))
    const weeks = [...new Set([week - 1, week, week + 1].filter((value) => value >= 1 && value <= 18))]
    const liveLeagues = leagues
      .filter((league) => String(league.platform ?? '').toLowerCase() === 'sleeper' && league.platformLeagueId)
      .slice(0, live.maxLeagues ?? 8)
    const scans: Array<Awaited<ReturnType<typeof scanPendingSleeperTrades>> | null> = new Array(liveLeagues.length).fill(null)
    const concurrency = 4
    for (let start = 0; start < liveLeagues.length; start += concurrency) {
      await Promise.all(liveLeagues.slice(start, start + concurrency).map(async (league, offset) => {
        scans[start + offset] = await scanPendingSleeperTrades({
          platformLeagueId: league.platformLeagueId!,
          ownerSleeperId: live.ownerSleeperId!,
          sport: 'NFL',
          weeks,
        }).catch(() => null)
      }))
    }
    /*
     * What this pass could NOT see, reported before anything is returned. `scanned` alone hides
     * all of it: a league whose scan threw is `null`, one Sleeper refused is `scanned: false`, and
     * one that answered for a single week of three is `scanned: TRUE` with `weeksUnanswered > 0` —
     * its own docblock says "nothing waiting" is weaker than it looks there.
     *
     * ⚠ `scanned: false` is NOT uniformly reportable, though; see the split below.
     */
    for (const scan of scans) {
      if (!scan?.scanned) {
        /*
         * 🛑 ONLY A PROVIDER FAILURE IS WORTH REPORTING. `scanned: false` also covers "this
         * account owns no roster in this league" and "we do not know which Sleeper account is
         * yours" — `unscannedKind: 'identity'`, and both are permanent: same input, same answer,
         * every render for the life of the league. Reporting one as a transient failure holds
         * /core's trade window open forever, which is the rule this file states two hunks up and
         * the reason the `maxLeagues` cap is not reported either.
         *
         * A `null` scan is the loader's own `.catch` on the provider call, so it is `provider`.
         */
        if (scan?.unscannedKind !== 'identity') reportIncomplete(live, 'league-scan-unanswered')
      } else if (scan.weeksUnanswered > 0) reportIncomplete(live, 'league-scan-partial-weeks')
    }
    if (live.onPendingOffers) {
      /*
       * Only leagues whose scan ANSWERED are reported. A scan that failed tells us
       * nothing, and reporting it as zero would clear a badge for an offer that may
       * still be waiting.
       */
      const scanned: Array<{ leagueId: string; waiting: number }> = []
      for (let i = 0; i < liveLeagues.length; i += 1) {
        const scan = scans[i]
        if (!scan?.scanned) continue
        scanned.push({
          leagueId: liveLeagues[i]!.id,
          waiting: scan.trades.filter((t) => !t.proposedByViewer && t.lifecycleStatus !== 'complete').length,
        })
      }
      try {
        live.onPendingOffers(scanned)
      } catch {
        // Recording a badge must never cost the trades this loader exists to return.
      }
    }
    const seen = new Set(out.map((trade) => `${trade.platformLeagueId}:${trade.id}`))
    for (let i = 0; i < liveLeagues.length; i += 1) {
      for (const trade of scans[i]?.completedTrades ?? []) {
        const converted = liveCompletedTrade(liveLeagues[i], trade)
        if (!converted) continue
        if (new Date(converted.acceptedAt).getTime() < cutoff) continue
        const key = `${converted.platformLeagueId}:${converted.id}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push(converted)
      }
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
