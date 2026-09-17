/**
 * The future draft picks each roster of an imported league holds, read from `future_draft_picks`
 * and the league's own draft history. See `futurePickInventory.ts` for the rules; this module is
 * only the reads and the roster join.
 *
 * ⚠ SLEEPER AND MFL ONLY. Those are the providers whose traded picks are synced into the table.
 * Rebuilding every team's own picks for an ESPN, Yahoo or Fantrax league would list a pick with its
 * original team even where it has been traded, because nothing records the trade.
 *
 * ⚠ NOT FOR NATIVE LEAGUES. Their picks live in `Roster.playerData` and are what a proposal
 * references; these picks carry no such id and are for display and valuation only.
 *
 * DB-first: two indexed reads on a request path, no provider call. Failures cost the picks and
 * nothing else.
 */
import { prisma } from '@/lib/prisma'
import { matchTeamIdForRoster } from '@/lib/decision-os/world/assemble'
import {
  futurePickInventory,
  rookieRoundsFromDraftHistory,
  upcomingDraftSeasons,
  type InventoryPick,
} from './futurePickInventory'

const PROVIDERS_WITH_SYNCED_PICKS = new Set(['sleeper', 'mfl'])

export type RosterFuturePick = InventoryPick & {
  /** The original team's name when the pick came from another team; null for the roster's own. */
  fromTeamName: string | null
}

/**
 * `complete`: every pick in the upcoming drafts is listed.
 * `traded_only`: the round count is unknown, so only picks that changed hands are listed.
 * `none`: this league's picks are not read here at all (not a synced provider, or no evidence).
 */
export type FuturePickCoverage = 'complete' | 'traded_only' | 'none'

export async function loadImportedFuturePicks(args: {
  leagueId: string
  platform: string | null | undefined
  isDynasty: boolean
  leagueSeason: number | null
  /** The provider's league status (`settings.status` on Sleeper): `pre_draft`, `drafting`, `in_season`… */
  status: string | null | undefined
  teams: ReadonlyArray<{
    id: string
    externalId: string
    platformUserId: string | null
    claimedByUserId: string | null
    teamName: string | null
  }>
  rosters: ReadonlyArray<{ id: string; platformUserId: string; playerData: unknown }>
}): Promise<{ picksByRosterId: Map<string, RosterFuturePick[]>; coverage: FuturePickCoverage }> {
  const empty = { picksByRosterId: new Map<string, RosterFuturePick[]>(), coverage: 'none' as const }
  const platform = String(args.platform ?? '').trim().toLowerCase()
  if (!PROVIDERS_WITH_SYNCED_PICKS.has(platform) || !args.leagueSeason || args.teams.length === 0) return empty

  const seasons = upcomingDraftSeasons({ leagueSeason: args.leagueSeason, status: args.status })
  const teamIds = [...new Set(args.teams.map((t) => t.externalId).filter((x) => x.length > 0))]

  const [stored, history] = await Promise.all([
    prisma.futureDraftPick
      .findMany({
        where: { leagueId: args.leagueId, status: 'active', pickSeason: { in: seasons } },
        select: { pickSeason: true, round: true, originalRosterId: true, currentOwnerId: true },
      })
      .catch(() => null),
    // Only a dynasty league has a rookie draft to size; a keeper or redraft league lists stored picks alone.
    args.isDynasty
      ? prisma.draftFact
          .groupBy({
            by: ['season'],
            where: { leagueId: args.leagueId, season: { not: null } },
            _max: { round: true },
            _count: { _all: true },
          })
          .catch(() => null)
      : Promise.resolve(null),
  ])
  if (stored == null) return empty

  const rounds = history
    ? rookieRoundsFromDraftHistory(
        history.map((h) => ({ season: h.season ?? 0, maxRound: h._max.round ?? 0, picks: h._count._all })),
        teamIds.length,
      )
    : null
  if (rounds == null && stored.length === 0) return empty

  const inventory = futurePickInventory({ teamIds, seasons, rounds, stored })
  const teamNameByExternal = new Map(args.teams.map((t) => [t.externalId, t.teamName]))
  const externalByTeamId = new Map(args.teams.map((t) => [t.id, t.externalId]))
  const rosterIdByExternal = new Map<string, string>()
  for (const r of args.rosters) {
    const teamId = matchTeamIdForRoster(r, args.teams)
    const external = teamId ? externalByTeamId.get(teamId) : undefined
    if (external) rosterIdByExternal.set(external, r.id)
  }

  const picksByRosterId = new Map<string, RosterFuturePick[]>()
  for (const p of inventory) {
    const rosterId = rosterIdByExternal.get(p.ownerTeamId)
    if (!rosterId) continue
    const list = picksByRosterId.get(rosterId) ?? []
    list.push({
      ...p,
      fromTeamName: p.originalTeamId === p.ownerTeamId ? null : teamNameByExternal.get(p.originalTeamId) ?? null,
    })
    picksByRosterId.set(rosterId, list)
  }
  return { picksByRosterId, coverage: rounds != null ? 'complete' : 'traded_only' }
}
