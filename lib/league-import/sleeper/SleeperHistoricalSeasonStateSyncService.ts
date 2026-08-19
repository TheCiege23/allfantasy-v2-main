import type { Prisma } from '@prisma/client'
import { persistDynastySeason } from '@/lib/dynasty-import/normalize-historical'
import { normalizeSportForWarehouse } from '@/lib/data-warehouse/types'
import { prisma } from '@/lib/prisma'
import { getLeagueRosters, getLeagueUsers, type SleeperLeague, type SleeperRoster } from '@/lib/sleeper-client'
import { getSleeperHistoricalLeagueChain } from './SleeperHistoricalLeagueChain'

const SEASON_END_ROSTER_SNAPSHOT_PERIOD = 0

interface SnapshotPlayer {
  id: string
  bucket: 'starter' | 'bench' | 'reserve' | 'taxi'
  ownerId: string | null
  ownerName: string | null
  rosterId: string
}

export interface SleeperHistoricalSeasonStateSyncSummary {
  attempted: boolean
  refreshed: boolean
  skipped: boolean
  reason?: string
  seasonsProcessed?: number
  settingsSnapshotsPersisted?: number
  rosterSnapshotsPersisted?: number
  error?: string
  /** Completion-gate counters (P0-D). */
  seasonsConsidered?: number
  seasonsSkippedAlreadyComplete?: number
  providerCallsAvoided?: number
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'Unknown error'
}

function parseNumberOrNull(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseFloat(value)
        : Number.NaN

  return Number.isFinite(parsed) ? parsed : null
}

function getScoringFormat(scoringSettings: Record<string, number> | undefined): string {
  const ppr = scoringSettings?.rec ?? 0
  if (ppr >= 1) return 'PPR'
  if (ppr >= 0.5) return 'HALF_PPR'
  return 'STANDARD'
}

function buildSeasonMetadata(league: SleeperLeague): Record<string, unknown> {
  const rawSettings = (league.settings ?? {}) as Record<string, unknown>

  return {
    sourceProvider: 'sleeper',
    importedAt: new Date().toISOString(),
    leagueName: league.name,
    sport: league.sport,
    season: parseNumberOrNull(league.season),
    status: league.status ?? null,
    totalRosters: league.total_rosters ?? null,
    draftId: league.draft_id ?? null,
    previousLeagueId: league.previous_league_id ?? null,
    scoringFormat: getScoringFormat(league.scoring_settings),
    scoringSettings: league.scoring_settings ?? {},
    rosterPositions: league.roster_positions ?? [],
    playoffSettings: {
      playoffTeams: parseNumberOrNull(rawSettings.playoff_teams),
      playoffWeekStart: parseNumberOrNull(rawSettings.playoff_week_start),
      playoffRoundType: parseNumberOrNull(rawSettings.playoff_round_type),
      playoffSeedType: parseNumberOrNull(rawSettings.playoff_seed_type),
    },
    rawSettings,
  }
}

function toSnapshotPlayers(roster: SleeperRoster, ownerName: string | null): SnapshotPlayer[] {
  const rosterId = String(roster.roster_id)
  const ownerId = roster.owner_id ?? null
  const starterIds = new Set((roster.starters ?? []).filter((playerId) => Boolean(playerId) && playerId !== '0'))
  const reserveIds = new Set((roster.reserve ?? []).filter(Boolean))
  const taxiIds = new Set((roster.taxi ?? []).filter(Boolean))
  const allIds = new Set<string>()

  for (const playerId of roster.players ?? []) {
    if (playerId) allIds.add(playerId)
  }
  for (const playerId of starterIds) {
    allIds.add(playerId)
  }
  for (const playerId of reserveIds) {
    allIds.add(playerId)
  }
  for (const playerId of taxiIds) {
    allIds.add(playerId)
  }

  return Array.from(allIds).map((playerId) => ({
    id: playerId,
    bucket: starterIds.has(playerId)
      ? 'starter'
      : taxiIds.has(playerId)
        ? 'taxi'
        : reserveIds.has(playerId)
          ? 'reserve'
          : 'bench',
    ownerId,
    ownerName,
    rosterId,
  }))
}

export async function syncSleeperHistoricalSeasonStateAfterImport(args: {
  leagueId: string
  maxPreviousSeasons?: number
  /** Admin/internal-only escape hatch to force a full refetch of already-imported seasons. */
  force?: boolean
}): Promise<SleeperHistoricalSeasonStateSyncSummary> {
  const league = await prisma.league.findUnique({
    where: { id: args.leagueId },
    select: {
      id: true,
      platform: true,
      platformLeagueId: true,
      sport: true,
    },
  })

  if (!league) {
    return {
      attempted: false,
      refreshed: false,
      skipped: true,
      reason: 'League not found.',
    }
  }

  if (league.platform !== 'sleeper' || !league.platformLeagueId) {
    return {
      attempted: false,
      refreshed: false,
      skipped: true,
      reason: 'Historical season-state sync only applies to Sleeper leagues with a platformLeagueId.',
    }
  }

  try {
    const sport = normalizeSportForWarehouse(league.sport)
    const historyChain = await getSleeperHistoricalLeagueChain(
      league.platformLeagueId,
      args.maxPreviousSeasons ?? 10
    )

    if (!historyChain.length) {
      return {
        attempted: true,
        refreshed: false,
        skipped: true,
        reason: 'No historical Sleeper seasons were available to sync.',
        seasonsProcessed: 0,
        settingsSnapshotsPersisted: 0,
        rosterSnapshotsPersisted: 0,
      }
    }

    let seasonsProcessed = 0
    let settingsSnapshotsPersisted = 0
    let rosterSnapshotsPersisted = 0
    let seasonsSkippedAlreadyComplete = 0
    let providerCallsAvoided = 0

    for (const seasonState of historyChain) {
      // Completion gate (P0-D): a completed historical season's roster snapshot is stable —
      // don't re-hit Sleeper's users/rosters endpoints for a season we already imported. Mirrors
      // the `skipExistingSeasons` pattern in `lib/dynasty-import/backfill-orchestrator.ts`.
      if (!args.force) {
        const existingSnapshot = await prisma.rosterSnapshot.findFirst({
          where: {
            leagueId: league.id,
            season: seasonState.season,
            weekOrPeriod: SEASON_END_ROSTER_SNAPSHOT_PERIOD,
          },
          select: { snapshotId: true },
        })
        if (existingSnapshot) {
          seasonsSkippedAlreadyComplete += 1
          providerCallsAvoided += 1
          continue
        }
      }

      const [users, rosters] = await Promise.all([
        getLeagueUsers(seasonState.externalLeagueId),
        getLeagueRosters(seasonState.externalLeagueId),
      ])

      const ownerNameById = new Map<string, string>()
      const ownerAvatarById = new Map<string, string>()
      for (const user of users) {
        if (user.user_id) {
          ownerNameById.set(user.user_id, user.display_name || user.username || user.user_id)
          if (user.avatar) {
            ownerAvatarById.set(user.user_id, user.avatar)
          }
        }
      }

      // Backfill managerAvatar on existing LeagueSeason.teamRecords so the
      // historical UI always has avatar ids available (null-safe: skips if
      // no row exists or teamRecords is missing).
      try {
        const existingSeason = await prisma.leagueSeason.findFirst({
          where: { leagueId: league.id, season: seasonState.season },
          select: { id: true, teamRecords: true },
        })
        if (existingSeason?.teamRecords) {
          const recs = existingSeason.teamRecords as unknown as Array<Record<string, unknown>>
          let mutated = false
          const updated = recs.map((rec) => {
            const ownerId = rec?.ownerId as string | undefined
            if (!ownerId) return rec
            const avatar = ownerAvatarById.get(ownerId) ?? null
            if (avatar && rec.managerAvatar !== avatar) {
              mutated = true
              return { ...rec, managerAvatar: avatar }
            }
            return rec
          })
          if (mutated) {
            await prisma.leagueSeason.update({
              where: { id: existingSeason.id },
              data: { teamRecords: updated as unknown as Prisma.InputJsonValue },
            })
          }
        }
      } catch (avatarErr) {
        // Non-fatal: avatar backfill should never break the main sync
        console.warn('[SleeperHistoricalSeasonStateSync] avatar backfill failed', avatarErr)
      }

      await persistDynastySeason(
        league.id,
        seasonState.season,
        seasonState.externalLeagueId,
        'sleeper',
        buildSeasonMetadata(seasonState.league)
      )
      settingsSnapshotsPersisted += 1

      const rosterRows = rosters.map((roster) => {
        const rosterPlayers = toSnapshotPlayers(roster, ownerNameById.get(roster.owner_id) ?? null)
        const lineupPlayers = rosterPlayers.filter((player) => player.bucket === 'starter')
        const benchPlayers = rosterPlayers.filter((player) => player.bucket !== 'starter')

        return prisma.rosterSnapshot.create({
          data: {
            leagueId: league.id,
            teamId: String(roster.roster_id),
            sport,
            weekOrPeriod: SEASON_END_ROSTER_SNAPSHOT_PERIOD,
            season: seasonState.season,
            rosterPlayers: rosterPlayers as unknown as Prisma.InputJsonValue,
            lineupPlayers: lineupPlayers as unknown as Prisma.InputJsonValue,
            benchPlayers: benchPlayers as unknown as Prisma.InputJsonValue,
          },
        })
      })

      await prisma.$transaction([
        prisma.rosterSnapshot.deleteMany({
          where: {
            leagueId: league.id,
            season: seasonState.season,
            weekOrPeriod: SEASON_END_ROSTER_SNAPSHOT_PERIOD,
          },
        }),
        ...rosterRows,
      ])

      rosterSnapshotsPersisted += rosters.length
      seasonsProcessed += 1
    }

    const allAlreadyComplete = historyChain.length > 0 && seasonsSkippedAlreadyComplete === historyChain.length
    return {
      attempted: true,
      refreshed: seasonsProcessed > 0,
      skipped: allAlreadyComplete,
      reason: allAlreadyComplete
        ? 'All discovered seasons already have imported roster data; nothing to refetch.'
        : undefined,
      seasonsProcessed,
      settingsSnapshotsPersisted,
      rosterSnapshotsPersisted,
      seasonsConsidered: historyChain.length,
      seasonsSkippedAlreadyComplete,
      providerCallsAvoided,
    }
  } catch (error) {
    return {
      attempted: true,
      refreshed: false,
      skipped: false,
      error: getErrorMessage(error),
    }
  }
}
