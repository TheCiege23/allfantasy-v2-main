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

/** True when this league's picks are read from the provider-id-keyed table rather than `Roster.id`. */
export function hasSyncedProviderPicks(platform: string | null | undefined): boolean {
  return PROVIDERS_WITH_SYNCED_PICKS.has(String(platform ?? '').trim().toLowerCase())
}

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

export type ImportedFuturePicks = {
  picksByRosterId: Map<string, RosterFuturePick[]>
  coverage: FuturePickCoverage
  /** Provider team id → `Roster.id`, for callers that keep picks in roster-id space. */
  rosterIdByTeamId: Map<string, string>
  /** True when the pick table could not be read — not the same as a league with no picks. */
  readFailed: boolean
}

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
}): Promise<ImportedFuturePicks> {
  const empty: ImportedFuturePicks = {
    picksByRosterId: new Map(),
    coverage: 'none',
    rosterIdByTeamId: new Map(),
    readFailed: false,
  }
  if (!hasSyncedProviderPicks(args.platform) || !args.leagueSeason || args.teams.length === 0) return empty

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
  if (stored == null) return { ...empty, readFailed: true }

  const rounds = history
    ? rookieRoundsFromDraftHistory(
        history.map((h) => ({ season: h.season ?? 0, maxRound: h._max.round ?? 0, picks: h._count._all })),
        teamIds.length,
      )
    : null
  if (rounds == null && stored.length === 0) return empty

  const inventory = futurePickInventory({ teamIds, seasons, rounds, stored })
  const teamNameByExternal = new Map(args.teams.map((t) => [t.externalId, t.teamName]))
  const teamById = new Map(args.teams.map((t) => [t.id, t]))
  const rosterIdByExternal = new Map<string, string>()
  const heldBy = new Map<string, { rank: number[]; id: string }>()
  for (const r of args.rosters) {
    const teamId = matchTeamIdForRoster(r, args.teams)
    const team = teamId ? teamById.get(teamId) : undefined
    if (!team?.externalId) continue
    const rank = rosterRank(r, team)
    const held = heldBy.get(team.externalId)
    if (held && !outranks(rank, r.id, held)) continue
    heldBy.set(team.externalId, { rank, id: r.id })
    rosterIdByExternal.set(team.externalId, r.id)
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
  return {
    picksByRosterId,
    coverage: rounds != null ? 'complete' : 'traded_only',
    rosterIdByTeamId: rosterIdByExternal,
    readFailed: false,
  }
}

/*
 * 🛑 ONE PROVIDER TEAM CAN HAVE TWO ROSTER ROWS, AND "LAST ROW WINS" GAVE A REAL TEAM'S PICKS TO THE
 * COPY. Measured on staging 2026-09-17: 14 teams in 12 of 225 Sleeper/MFL leagues, 11 of them with a
 * copy carrying no owner id (a re-import). Which row won depended on the order the rows came back in:
 * in "The Last IDP Dynasty!!" the owner's roster showed no picks and the ownerless copy held all of them.
 *
 * So the roster that holds a team's picks is chosen, not inherited from row order: the one whose owner
 * IS the team's owner (or claimant), then one with any owner, then the fuller roster, then the lower id.
 */
function rosterRank(
  r: { platformUserId: string; playerData: unknown },
  team: { platformUserId: string | null; claimedByUserId: string | null },
): number[] {
  const owner = String(r.platformUserId ?? '').trim()
  const ownsTeam = owner.length > 0 && (owner === team.platformUserId || owner === team.claimedByUserId)
  const players = (r.playerData as { players?: unknown } | null)?.players
  return [ownsTeam ? 1 : 0, owner.length > 0 ? 1 : 0, Array.isArray(players) ? players.length : 0]
}

function outranks(rank: number[], id: string, held: { rank: number[]; id: string }): boolean {
  for (let i = 0; i < rank.length; i++) {
    if (rank[i] !== held.rank[i]) return rank[i] > held.rank[i]
  }
  return id < held.id
}
