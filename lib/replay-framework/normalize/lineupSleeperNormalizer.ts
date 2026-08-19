/**
 * Decision OS Replay Framework Phase 13 — Sleeper lineup normalizer.
 * Converts one real, raw Sleeper roster-week `SleeperMatchup` entry
 * (lib/sleeper-client.ts) plus its league/roster/user context into the
 * generic `ReplayImportInput` shape (decisionType: 'lineup'), mirroring
 * `sleeperTradeNormalizer.ts`'s exact pattern.
 *
 * Unlike a trade, a lineup decision has no natural provider transaction ID
 * — it's implicitly defined by (league, roster, week), so a deterministic
 * synthetic ID (`lineup-{leagueId}-roster{rosterId}-week{week}`) is used,
 * preserving the same idempotent-upsert guarantee `writer.ts` already gives
 * every other decision type.
 */
import type { SleeperLeague, SleeperMatchup, SleeperRoster, SleeperUser } from '@/lib/sleeper-client'
import { getPlayerName } from '@/lib/sleeper-client'
import type { LineupReplayPayload, LineupReplayPlayer, ReplayImportInput } from '../types'

type PlayerDirectory = Record<string, { full_name?: string; first_name?: string; last_name?: string; position?: string }>

function resolveLineupPlayer(
  playerId: string,
  players: PlayerDirectory,
  pointsByPlayer: Record<string, number>,
): LineupReplayPlayer {
  const directoryEntry = players[playerId]
  return {
    providerAssetId: playerId,
    name: getPlayerName(players as any, playerId),
    // Real position, matching Sleeper's own convention (e.g. team defenses
    // are `position: 'DEF'`) — a single-element array here, since this
    // codebase's `SleeperPlayer` type only carries one `position` field
    // (matching `sleeperTradeNormalizer.ts`'s identical convention, not a
    // richer multi-position `fantasy_positions` list).
    pos: directoryEntry?.position ? [directoryEntry.position] : [],
    // Real, historical, already-scored points — NEVER a projection (see
    // `LineupReplayPlayer`'s docstring in types.ts).
    actualPoints: pointsByPlayer[playerId] ?? 0,
  }
}

/**
 * Approximates a real calendar date from season+week for `proposedAt`/
 * `resolvedAt` — Sleeper's matchup object carries no per-entry timestamp
 * (unlike a trade's `created`/`status_updated`). Good enough for relative
 * ordering; not a claim of exact real-world accuracy, mirroring the same
 * honest caveat `ReplayImportInput.providerWeek`'s docstring already makes
 * about week buckets not being guaranteed to equal the real calendar week.
 */
function approximateWeekDate(season: number, week: number): Date {
  return new Date(Date.UTC(season, 8, 1 + week * 7))
}

export function normalizeSleeperLineup(input: {
  matchup: SleeperMatchup
  league: SleeperLeague
  rosters: SleeperRoster[]
  users: SleeperUser[]
  players: PlayerDirectory
  ingestSourceUserId: string
  week: number
}): ReplayImportInput {
  const { matchup, league, rosters, users, players, ingestSourceUserId, week } = input

  const roster = rosters.find((r) => r.roster_id === matchup.roster_id)
  const ownerId = roster?.owner_id ?? null
  const displayName = ownerId ? users.find((u) => u.user_id === ownerId)?.display_name ?? null : null

  const pointsByPlayer = matchup.players_points ?? {}
  const fullRoster: LineupReplayPlayer[] = (matchup.players ?? []).map((playerId) =>
    resolveLineupPlayer(playerId, players, pointsByPlayer),
  )

  const isDynasty = league.settings?.type === 2 || league.settings?.type === 1
  const numQb = (league.roster_positions ?? []).filter((p) => p === 'QB' || p === 'SUPER_FLEX').length
  const isSuperFlex = numQb >= 2

  const payload: LineupReplayPayload = {
    actualStarterIds: matchup.starters ?? [],
    fullRoster,
    slotPositions: league.roster_positions ?? [],
  }

  const approximateDate = approximateWeekDate(Number(league.season), week)

  return {
    provider: 'sleeper',
    decisionType: 'lineup',
    providerLeagueId: league.league_id,
    providerTransactionId: `lineup-${league.league_id}-roster${matchup.roster_id}-week${week}`,
    season: Number(league.season),
    providerWeek: week,
    proposedAt: approximateDate,
    resolvedAt: approximateDate,
    // A lineup decision for a real, scored week is inherently resolved —
    // there is no pending/failed equivalent the way a trade proposal has
    // one. The ingest driver only ever calls this normalizer for weeks with
    // real recorded points (see ingestSleeperLineupsForLeague.ts).
    providerStatus: 'scored',
    participantsInvolved: [matchup.roster_id],
    managerUserIds: [{ rosterId: matchup.roster_id, sleeperUserId: ownerId }],
    managerDisplayNames: [{ rosterId: matchup.roster_id, displayName }],
    payload,
    rawProviderPayload: matchup as unknown,
    contextSnapshot: {
      scoring_settings: league.scoring_settings,
      roster_positions: league.roster_positions,
      settings: league.settings,
      total_rosters: league.total_rosters,
    },
    isDynasty,
    isSuperFlex,
    ingestSourceUserId,
  }
}
