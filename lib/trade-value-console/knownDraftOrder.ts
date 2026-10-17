import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveBracketPlacements, rosterIdOf, storedBracketGames } from '@/lib/league-import/sleeper/bracketPlacements'
import { draftOrderFromFinish, type DraftOrderSource, type StandingsTeam } from '@/lib/trade-value/pickSlotProjection'

/**
 * A draft order that is already KNOWN — read from Postgres, never from the provider.
 *
 * Guap, 2026-10-12 ("go ahead with offseason pick pricing"). From the end of the regular season to the
 * rookie draft, which is when most picks change hands, the projection kept simulating a season and a
 * bracket that were already decided. Two facts make the order knowable instead:
 *
 *   1. A finished season and its playoffs. The bracket is `league_dynasty_seasons.metadata.playoffStructure`
 *      (written by the Sleeper history sync, refreshed until the title game is decided), its places read by
 *      the repo's one rule, `resolveBracketPlacements`; the records are `LeagueTeam` for the season this row
 *      is playing, `season_results` for the one before.
 *   2. The league's own rookie draft with its order SET. The draft-tick mirror copies Sleeper's
 *      `slot_to_roster_id` into `DraftSession.slotOrder`. Only an order whose every slot is NAMED is used:
 *      a name comes from Sleeper's `draft_order`, which stays null until the commissioner sets it, so an
 *      unnamed slot map is not evidence of an order (19 of 19 mirrored orders were fully named, 2026-10-12).
 *
 * ⚠ THE MIRROR KEEPS THE FIRST ORDER IT SEES (see `lib/draft/sleeperSync.ts`), so a commissioner who
 * re-orders after it was mirrored is not followed here either. Named, measured, not fixed in this change.
 */

export type KnownDraftOrder = { order: string[]; source: DraftOrderSource }

/** Rookie drafts are short; a startup draft is not this league's rookie order. */
const MAX_ROOKIE_ROUNDS = 7

export async function loadSetDraftOrder(leagueId: string): Promise<KnownDraftOrder | null> {
  const session = await prisma.draftSession.findFirst({
    where: { leagueId, sleeperDraftId: { not: null }, status: { in: ['pre_draft', 'in_progress'] }, rounds: { lte: MAX_ROOKIE_ROUNDS } },
    select: { slotOrder: true },
  })
  const raw = Array.isArray(session?.slotOrder) ? (session!.slotOrder as unknown[]) : []
  const slots = raw
    .map((e) => (e && typeof e === 'object' ? (e as Record<string, unknown>) : null))
    .filter((e): e is Record<string, unknown> => e != null)
  if (slots.length < 3 || slots.some((e) => typeof e.displayName !== 'string' || !e.displayName.trim())) return null
  const bySlot = new Map<number, string>()
  for (const e of slots) {
    const slot = Number(e.slot)
    const roster = e.rosterId == null ? '' : String(e.rosterId)
    if (!Number.isInteger(slot) || slot < 1 || !roster || bySlot.has(slot)) return null
    bySlot.set(slot, roster)
  }
  const order = [...bySlot.keys()].sort((a, b) => a - b).map((s) => bySlot.get(s)!)
  if (new Set(order).size !== order.length) return null
  return { order, source: 'draft_order_set' }
}

/** The bracket's teams and decided places for one of this league's seasons, as stored. */
async function storedPlayoffs(leagueId: string, season: number) {
  const row = await prisma.leagueDynastySeason.findUnique({
    where: { uniq_league_dynasty_season_league_season: { leagueId, season } },
    select: { metadata: true },
  })
  const meta = row?.metadata && typeof row.metadata === 'object' ? (row.metadata as Record<string, unknown>) : null
  const games = storedBracketGames(meta?.playoffStructure)
  if (games.length === 0) return null
  const teams = new Set<string>()
  for (const g of games) for (const t of [g.t1, g.t2]) { const id = rosterIdOf(t); if (id) teams.add(String(id)) }
  const placeByTeam = new Map<string, number>()
  for (const [id, place] of resolveBracketPlacements(games).placementByRosterId) placeByTeam.set(String(id), place)
  return { teams, placeByTeam }
}

/** The order the finished season gives, from these records and the season's stored bracket — or null. */
export async function finishedSeasonOrder(
  leagueId: string,
  season: number,
  records: readonly StandingsTeam[],
): Promise<KnownDraftOrder | null> {
  const playoffs = await storedPlayoffs(leagueId, season)
  if (!playoffs) return null
  const order = draftOrderFromFinish(records, playoffs)
  return order ? { order, source: 'final_standings' } : null
}

/** Last season's final records for this league (`season_results`, keyed by provider roster id). */
export async function previousSeasonRecords(leagueId: string, season: number): Promise<StandingsTeam[]> {
  const rows = await prisma.seasonResult.findMany({
    where: { leagueId, season: String(season) },
    select: { rosterId: true, wins: true, losses: true, pointsFor: true },
  })
  return rows
    .filter((r) => r.wins != null && r.losses != null)
    .map((r) => ({ id: String(r.rosterId), wins: r.wins!, losses: r.losses!, ties: 0, pointsFor: Number(r.pointsFor ?? 0) }))
}
