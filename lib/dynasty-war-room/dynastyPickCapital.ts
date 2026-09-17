/**
 * Each team's future pick capital for the dynasty War Room, in `Roster.id` space.
 *
 * 🛑 EVERY IMPORTED TEAM SHOWED NO PICKS, WHILE THE ROOM SAID PICK DATA WAS AVAILABLE. The War Room
 * grouped `future_draft_picks` by `currentOwnerId` and looked each team up by `Roster.id`. Imported
 * leagues write the PROVIDER's team id there (Sleeper roster "3", MFL franchise "0001"), which is
 * `LeagueTeam.externalId` and never a roster cuid — so every lookup missed. Measured on staging
 * 2026-09-17: 103 imported dynasty leagues with pick rows, 1,462 teams, 0 picks shown, and the
 * availability flag `available` for all 103 because it only counted rows.
 *
 * ⚠ AND THE ROWS WERE NEVER A TEAM'S WHOLE CAPITAL. Imported leagues store only TRADED picks, and
 * rows for drafts already held stay `active`. So Sleeper and MFL leagues read the shared inventory
 * (`lib/league-trade-engine/importedFuturePicks.ts`), which rebuilds the upcoming drafts and maps
 * owners to rosters. Every other league keeps the `Roster.id`-keyed read it always had — the native
 * seed writes picks in that space, and no other provider writes the table at all.
 *
 * The availability state now says whether picks reached a TEAM, not whether rows exist — and
 * `partial` when the list is known to leave out each team's own picks.
 */
import { prisma } from '@/lib/prisma'
import {
  hasSyncedProviderPicks,
  loadImportedFuturePicks,
} from '@/lib/league-trade-engine/importedFuturePicks'
import { inventoryPickId } from '@/lib/league-trade-engine/futurePickInventory'
import { pickHeuristicValue } from './dynastyPlayerValue'
import type { DataState, DynastyFuturePick } from './types'

export type DynastyPickCapital = {
  picksByRosterId: Map<string, DynastyFuturePick[]>
  state: DataState
  /** Extra caveat for `missingDataFlags`, when the state alone does not say it. */
  note: string | null
}

export async function loadDynastyPickCapital(args: {
  leagueId: string
  platform: string | null | undefined
  leagueSeason: number
  /** The provider's league status (`settings.status` on Sleeper). */
  providerStatus: string | null | undefined
  rosters: ReadonlyArray<{ id: string; platformUserId: string; playerData: unknown }>
  teams: ReadonlyArray<{
    id: string
    externalId: string
    platformUserId: string | null
    claimedByUserId: string | null
    teamName: string | null
  }>
}): Promise<DynastyPickCapital> {
  return hasSyncedProviderPicks(args.platform) ? loadImported(args) : loadRosterKeyed(args)
}

async function loadImported(args: Parameters<typeof loadDynastyPickCapital>[0]): Promise<DynastyPickCapital> {
  const imported = await loadImportedFuturePicks({
    leagueId: args.leagueId,
    platform: args.platform,
    isDynasty: true,
    leagueSeason: args.leagueSeason,
    status: args.providerStatus,
    teams: args.teams,
    rosters: args.rosters,
  })
  if (imported.readFailed) return { picksByRosterId: new Map(), state: 'missing', note: null }

  const picksByRosterId = new Map<string, DynastyFuturePick[]>()
  for (const [rosterId, picks] of imported.picksByRosterId) {
    picksByRosterId.set(
      rosterId,
      picks.map((p) => ({
        id: inventoryPickId(p),
        season: p.season,
        round: p.round,
        // In roster space, so the pick engine's "own vs acquired" comparison holds. A pick from a team
        // with no roster keeps the provider id, which can never equal a roster id — still "acquired".
        originalRosterId: imported.rosterIdByTeamId.get(p.originalTeamId) ?? p.originalTeamId,
        currentOwnerId: rosterId,
        traded: p.originalTeamId !== p.ownerTeamId,
        status: 'active',
        estValue: pickHeuristicValue(p.round, p.season - args.leagueSeason),
        originalTeamName: p.fromTeamName,
      })),
    )
  }
  if (imported.coverage !== 'complete') {
    // No draft size, so no team's own picks: whatever is listed is a fragment of its capital.
    return {
      picksByRosterId,
      state: 'partial',
      note: "Only picks that changed hands are modeled: this league's rookie-draft size is unknown, so each team's own picks are not.",
    }
  }
  const mapped = [...picksByRosterId.values()].some((list) => list.length > 0)
  return { picksByRosterId, state: mapped ? 'available' : 'available_empty', note: null }
}

async function loadRosterKeyed(args: Parameters<typeof loadDynastyPickCapital>[0]): Promise<DynastyPickCapital> {
  // The table may be absent in some environments (no migration applied): P2021 → 'missing'.
  let tableMissing = false
  const rows = await prisma.futureDraftPick
    .findMany({
      where: { leagueId: args.leagueId, status: { in: ['active', 'traded'] } },
      select: {
        id: true,
        pickSeason: true,
        round: true,
        originalRosterId: true,
        currentOwnerId: true,
        status: true,
        traded: true,
      },
      orderBy: [{ pickSeason: 'asc' }, { round: 'asc' }],
    })
    .catch((e: unknown) => {
      if ((e as { code?: string } | null)?.code === 'P2021') tableMissing = true
      return []
    })
  if (tableMissing) return { picksByRosterId: new Map(), state: 'missing', note: null }

  const rosterIds = new Set(args.rosters.map((r) => r.id))
  const picksByRosterId = new Map<string, DynastyFuturePick[]>()
  let unmatched = 0
  for (const pk of rows) {
    // Picks are keyed by the roster that holds them now. A row whose owner is no roster here is not
    // this league's capital to show — counted, so the room can say so instead of reading as "none".
    if (!rosterIds.has(pk.currentOwnerId)) {
      unmatched++
      continue
    }
    const list = picksByRosterId.get(pk.currentOwnerId) ?? []
    list.push({
      id: pk.id,
      season: pk.pickSeason,
      round: pk.round,
      originalRosterId: pk.originalRosterId,
      currentOwnerId: pk.currentOwnerId,
      traded: pk.traded,
      status: pk.status,
      estValue: pickHeuristicValue(pk.round, pk.pickSeason - args.leagueSeason),
      originalTeamName: null,
    })
    picksByRosterId.set(pk.currentOwnerId, list)
  }
  return {
    picksByRosterId,
    state: picksByRosterId.size > 0 ? 'available' : 'available_empty',
    note: unmatched > 0 ? `${unmatched} recorded pick(s) could not be matched to a team in this league.` : null,
  }
}
