/**
 * Competitive Edge for the War Room's Scout — every manager's trade and waiver record in one read,
 * for a viewer whose plan includes it.
 *
 * Owner's decision, 2026-10-02: Scout shows these counts behind the Competitive Edge gate, with a
 * lock for everyone else. Until then they appeared only inside a trade or waiver decision.
 *
 * ⚠ NO NEW RULE. The trade counts are `buildTradeEdge`'s own (run once per manager with an empty
 * deal, so only its coverage half applies), and the waiver counts are `loadWaiverEdge`'s. A Scout
 * card and the Trade Center's Competitive Edge section therefore cannot disagree about how many
 * trades a manager has made — the same function counted both.
 *
 * ⚠ THE SAME CONTRACT (./tradeEdge.ts, Milestone 32): counts a reader can check, never a label, no
 * prediction. And the same boundary: Sleeper only, said in words for any other platform.
 *
 * ⚠ READS THE TRADE-HISTORY CACHE, NEVER BUILDS IT — see ./tradeEdgeLoader.ts. A cold cache is
 * reported as "not read yet", not as a league of managers who never trade.
 */
import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveLeagueMembership } from '@/lib/league-access'
import { TRADE_GRADES_CACHE_PREFIX, type TradeGradesPayload } from '@/lib/trade-intel/sleeperTradeGradeService'
import { platformLabel } from '@/lib/core-app/platformLinks'
import type { SectionState } from '@/lib/core-app/leagueHome'
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'
import { buildTradeEdge } from './tradeEdge'
import { loadWaiverEdge } from './waiverEdgeLoader'

export type ScoutEdgeManager = {
  /** Completed trades this manager was part of, across every season the history read. Null when the history is unavailable. */
  trades: number | null
  /** ISO of their most recent completed trade. */
  lastTradeAt: string | null
  /** Winning waiver claims this season. Null when the waiver history is unavailable. */
  waiverClaims: number | null
  /** FAAB left — only in a FAAB league. */
  faabRemaining: number | null
}

export type ScoutEdge = {
  /** Keyed by `LeagueTeam.externalId`. Your own team is not in it — the edge is about the other side. */
  byManager: Record<string, ScoutEdgeManager>
  trades: SectionState<{ seasons: string[]; asOf: string; stale: boolean; gaps: string[] }>
  waivers: SectionState<{ season: number; usesFaab: boolean; asOf: string | null; stale: boolean }>
}

export async function loadScoutEdge(input: { leagueId: string; userId: string; now?: Date }): Promise<SectionState<ScoutEdge>> {
  const now = input.now ?? new Date()

  /*
   * 🛑 MEMBERSHIP FIRST, IN HERE. The league id comes from the URL, and a plan is not a membership:
   * without this a paying viewer could read every manager's record in ANY league by its id. The
   * trade and waiver loaders are only ever reached from a league screen the page already scoped;
   * this one must not rely on that.
   */
  const membership = await resolveLeagueMembership(input.leagueId, input.userId).catch(() => null)
  if (!membership) return { available: false, reason: 'membership in this league could not be checked just now' }
  if (!membership.ok) return { available: false, reason: 'Competitive Edge reads the managers of a league you are in' }

  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    select: { platform: true, platformLeagueId: true },
  })
  if (!league) return { available: false, reason: 'this league could not be read' }

  const platform = String(league.platform ?? '').toLowerCase()
  if (platform !== 'sleeper' || !league.platformLeagueId) {
    return {
      available: false,
      reason: `Competitive Edge reads Sleeper trade and waiver history today, and ${platformLabel(platform)} leagues aren't connected yet`,
    }
  }

  const [teams, cached, rules] = await Promise.all([
    prisma.leagueTeam.findMany({
      where: { leagueId: input.leagueId },
      select: { externalId: true, platformUserId: true, ownerName: true, teamName: true, claimedByUserId: true },
    }),
    prisma.sportsDataCache.findUnique({ where: { cacheKey: `${TRADE_GRADES_CACHE_PREFIX}${league.platformLeagueId}` } }),
    // The Waivers screen's own field and test (lib/core-app/waivers.ts resolveWaiverRules): FAAB only
    // when the ingested rule says so — `League.waiverType` is a schema default.
    prisma.leagueWaiverSettings.findUnique({ where: { leagueId: input.leagueId }, select: { waiverType: true } }),
  ])

  const viewer = teams.find((t) => t.claimedByUserId === input.userId) ?? null
  const others = teams.filter((t) => t.externalId && t.externalId !== viewer?.externalId)

  // ── Trades ────────────────────────────────────────────────────────────
  const payload =
    cached?.data && typeof cached.data === 'object' ? (cached.data as unknown as TradeGradesPayload) : null
  const tradesReadable = Boolean(payload && payload.version === 2 && Array.isArray(payload.trades))
  const tradeStale = Boolean(payload?.staleAsOf) || (cached ? cached.expiresAt.getTime() < now.getTime() : false)
  const tradeCountOf = (t: (typeof teams)[number]) => {
    const ownerId = t.platformUserId?.trim()
    if (!tradesReadable || !payload || !ownerId) return null
    const edge = buildTradeEdge({
      trades: payload.trades,
      managerOwnerId: ownerId,
      managerName: t.ownerName?.trim() || t.teamName?.trim() || 'This manager',
      teamExternalId: t.externalId,
      viewerOwnerId: viewer?.platformUserId?.trim() || null,
      deal: { theyGet: [], theySend: [] },
      seasonsScanned: payload.seasonsScanned ?? [],
      historyGaps: payload.missing ?? [],
      asOf: payload.fetchedAt,
      stale: tradeStale,
    })
    return { trades: edge.coverage.trades, lastTradeAt: edge.coverage.lastTradeAt }
  }

  // ── Waivers ───────────────────────────────────────────────────────────
  const usesFaab = String(rules?.waiverType ?? '').toLowerCase() === 'faab'
  const waivers = await loadWaiverEdge({ leagueId: input.leagueId, userId: input.userId, usesFaab, now }).catch(
    () => ({ available: false as const, reason: 'the waiver history could not be read just now' }),
  )
  const rivalBy = new Map(waivers.available ? waivers.data.rivals.map((r) => [r.manager.teamExternalId, r]) : [])

  const byManager: Record<string, ScoutEdgeManager> = {}
  for (const t of others) {
    const trade = tradeCountOf(t)
    const rival = rivalBy.get(t.externalId)
    byManager[t.externalId] = {
      trades: trade?.trades ?? null,
      lastTradeAt: trade?.lastTradeAt ?? null,
      waiverClaims: waivers.available ? (rival?.claims ?? 0) : null,
      faabRemaining: rival?.faabRemaining ?? null,
    }
  }

  return {
    available: true,
    data: {
      byManager,
      trades:
        tradesReadable && payload
          ? {
              available: true,
              data: { seasons: payload.seasonsScanned ?? [], asOf: payload.fetchedAt, stale: tradeStale, gaps: payload.missing ?? [] },
            }
          : {
              available: false,
              reason: "this league's trade history hasn't been read yet — it loads with the league's Trades screen",
            },
      waivers: waivers.available
        ? {
            available: true,
            data: { season: waivers.data.season, usesFaab: waivers.data.usesFaab, asOf: waivers.data.coverage.asOf, stale: waivers.data.coverage.stale },
          }
        : { available: false, reason: waivers.reason },
    },
  }
}

/**
 * The War Room's read: the edge for a viewer whose plan includes it, and NOTHING otherwise.
 *
 * ⚠ THE SERVER WITHHOLDS, THE LOCK ONLY DRAWS — the rule `loadWaiverEdgeForScreen` follows. A
 * locked viewer gets `null` here, so no rival's counts are ever sent to the browser; Scout's lock
 * card is a picture of the gate, not the gate.
 */
export async function loadScoutEdgeForScreen(input: {
  leagueId: string | null
  access: CoreDepthAccess | null
  userId: string
  now?: Date
}): Promise<SectionState<ScoutEdge> | null> {
  if (!input.leagueId || !input.access?.unlocked) return null
  return loadScoutEdge({ leagueId: input.leagueId, userId: input.userId, now: input.now }).catch(() => ({
    available: false as const,
    reason: 'Competitive Edge could not be read right now',
  }))
}
