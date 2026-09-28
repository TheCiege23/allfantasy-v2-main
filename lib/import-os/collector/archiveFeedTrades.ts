import 'server-only'

import { prisma } from '@/lib/prisma'
import { persistTradesForSeason } from '@/lib/dynasty-import/normalize-historical'
import type { NormalizedTradeFact } from '@/lib/dynasty-import/types'
import { fetchLeagueRosters, type FeedTrade } from '@/lib/trade-intel/sleeperTradeSync'

/**
 * Write the completed trades a LIVE read just saw into the trade archive (`LeagueTradeHistory` /
 * `LeagueTrade`).
 *
 * 🛑 WHY (2026-09-25). A just-accepted Sleeper trade showed on the live-reading screens within
 * minutes, but the surfaces that read the ARCHIVE — /core Trades' grade list, the cross-league
 * board, Chimmy's trade history — waited for a sync lane to write it: ~5 min for a just-viewed
 * league when the active lane is on, ~4 h on the full-sync lap, ~1.3 days on the historical
 * refresh. The same trade read as done on one screen and absent on the next.
 *
 * `getReconciledTradeGrades` already knows the moment: it compares the graded ledger with Sleeper's
 * live feed and rebuilds when a completed trade is missing. That feed row carries everything the
 * archive needs, so the archive is written from it there and then.
 *
 * ⚠ IDEMPOTENT BY CONSTRUCTION. `persistTradesForSeason` upserts one row per trade SIDE, keyed on
 * (history, transaction), so writing every completed trade in the feed — not only the new one —
 * costs a few upserts and heals any older gap the lanes left.
 *
 * ⚠ ONLY `complete`. The feed also carries pending offers (the alert path needs them); a trade that
 * has not happened must never reach a table the trade grader and the board read as history.
 *
 * Never throws: the caller runs it behind a live read, and an archive write must not cost that read.
 */

type WirePick = { season?: string | number; round?: number; roster_id?: number | string; previous_owner_id?: number | string; owner_id?: number | string }

function rosterMap(input: unknown): Record<string, string> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const out: Record<string, string> = {}
  for (const [playerId, rosterId] of Object.entries(input as Record<string, unknown>)) {
    const id = String(rosterId ?? '')
    if (id !== '') out[playerId] = id
  }
  return Object.keys(out).length > 0 ? out : null
}

/** PURE. A completed feed row in the archive's shape; null for anything that did not complete. */
export function feedTradeToFact(t: FeedTrade, season: number): NormalizedTradeFact | null {
  if (t.status !== 'complete') return null
  const picks = Array.isArray(t.tx?.draft_picks) ? (t.tx.draft_picks as unknown as WirePick[]) : []
  return {
    transactionId: t.id,
    season,
    // 0 when the week is unknown — the sentinel `persistTradesForSeason` and the historical importer already use.
    week: typeof t.week === 'number' && Number.isFinite(t.week) ? t.week : 0,
    rosterIds: t.rosterIds.map((r) => String(r)).filter((r) => r !== ''),
    adds: rosterMap(t.tx?.adds),
    drops: rosterMap(t.tx?.drops),
    draftPicks: picks
      .map((p) => ({
        season: String(p.season ?? ''),
        round: Number(p.round ?? 0),
        rosterId: String(p.roster_id ?? ''),
        previousOwnerId: String(p.previous_owner_id ?? ''),
        ownerId: String(p.owner_id ?? ''),
      }))
      .filter((p) => p.season !== '' && Number.isFinite(p.round)),
    created: t.createdMs ?? 0,
    creator: t.creator ?? '',
  }
}

export type ArchiveFeedTradesResult =
  | { written: number; trades: number }
  | { written: 0; skipped: 'no-completed-trades' | 'no-league-row' | 'no-rosters' | 'failed' }

export async function archiveCompletedFeedTrades(
  args: { sleeperLeagueId: string; feed: FeedTrade[] },
  deps: {
    seasonOf?: (sleeperLeagueId: string) => Promise<number | null>
    rostersOf?: typeof fetchLeagueRosters
    persist?: typeof persistTradesForSeason
  } = {},
): Promise<ArchiveFeedTradesResult> {
  try {
    const completed = args.feed.filter((t) => t.status === 'complete')
    if (completed.length === 0) return { written: 0, skipped: 'no-completed-trades' }

    /*
     * The season is the league ROW's: a Sleeper league id belongs to one season, and the archive
     * readers key on the two together. No row means no imported league to archive for.
     */
    const season = await (deps.seasonOf ?? seasonOfLeague)(args.sleeperLeagueId)
    if (season == null) return { written: 0, skipped: 'no-league-row' }

    // roster -> owner, the join `persistLiveTrades` makes from the same rosters.
    const rosters = await (deps.rostersOf ?? fetchLeagueRosters)(args.sleeperLeagueId)
    if (!rosters || rosters.length === 0) return { written: 0, skipped: 'no-rosters' }
    const owners = new Map<string, string>()
    for (const r of rosters) {
      if (r.owner_id) owners.set(String(r.roster_id), String(r.owner_id))
    }

    const facts = completed.map((t) => feedTradeToFact(t, season)).filter((f): f is NormalizedTradeFact => f != null)
    const written = await (deps.persist ?? persistTradesForSeason)(args.sleeperLeagueId, season, facts, owners)
    return { written, trades: facts.length }
  } catch (err) {
    console.warn('[archiveCompletedFeedTrades] archive write failed', {
      sleeperLeagueId: args.sleeperLeagueId,
      error: err instanceof Error ? err.message : String(err),
    })
    return { written: 0, skipped: 'failed' }
  }
}

async function seasonOfLeague(sleeperLeagueId: string): Promise<number | null> {
  const row = await prisma.league.findFirst({
    where: { platform: 'sleeper', platformLeagueId: sleeperLeagueId },
    select: { season: true },
    orderBy: { season: 'desc' },
  })
  const season = Number(row?.season)
  return Number.isFinite(season) && season > 0 ? season : null
}
