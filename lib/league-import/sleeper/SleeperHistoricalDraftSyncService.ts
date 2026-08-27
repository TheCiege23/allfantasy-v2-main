import { normalizeSportForWarehouse } from '@/lib/data-warehouse/types'
import { prisma } from '@/lib/prisma'
import { getDraftPicks, getLeagueDrafts, getLeagueRosters } from '@/lib/sleeper-client'
import { getSourceTeamIdFromPlayerData } from './SleeperHistoricalMatchupSyncService'
import { getSleeperHistoricalLeagueChain } from './SleeperHistoricalLeagueChain'

interface PendingSleeperDraftFact {
  sourceDraftId: string
  leagueId: string
  sport: string
  round: number
  pickNumber: number
  playerId: string
  managerId?: string
  season: number
}

export interface SleeperHistoricalDraftSyncSummary {
  attempted: boolean
  refreshed: boolean
  skipped: boolean
  reason?: string
  seasonsImported?: number
  seasonsReplaced?: number
  importedDraftCount?: number
  importedPickCount?: number
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

function normalizePickNumber(rawPick: any, fallbackPickNumber: number): number {
  const directPick = Number(rawPick?.pick_no)
  if (Number.isFinite(directPick) && directPick > 0) {
    return directPick
  }

  const round = Number(rawPick?.round)
  const draftSlot = Number(rawPick?.draft_slot)
  const rosterSize = Number(rawPick?.draft_slot_count)
  if (
    Number.isFinite(round) &&
    round > 0 &&
    Number.isFinite(draftSlot) &&
    draftSlot > 0 &&
    Number.isFinite(rosterSize) &&
    rosterSize > 0
  ) {
    return (round - 1) * rosterSize + draftSlot
  }

  return fallbackPickNumber
}

function normalizeManagerId(rawPick: any): string | undefined {
  if (rawPick?.roster_id != null) {
    return String(rawPick.roster_id)
  }

  if (rawPick?.owner_id != null) {
    return String(rawPick.owner_id)
  }

  if (typeof rawPick?.picked_by === 'string' && rawPick.picked_by.trim()) {
    return rawPick.picked_by.trim()
  }

  return undefined
}

async function collectSleeperDraftFacts(args: {
  internalLeagueId: string
  sport: string
  startingLeagueId: string
  maxPreviousSeasons: number
  force: boolean
}): Promise<{
  rows: Array<Omit<PendingSleeperDraftFact, 'sourceDraftId'>>
  seasons: number[]
  importedDraftCount: number
  seasonsConsidered: number
  seasonsSkippedAlreadyComplete: number
  providerCallsAvoided: number
}> {
  const historyChain = await getSleeperHistoricalLeagueChain(args.startingLeagueId, args.maxPreviousSeasons)

  /*
   * ⚠ WITHOUT THIS, A PICK BELONGS TO WHOEVER HOLDS THAT ROSTER SLOT TODAY.
   *
   * `normalizeManagerId` returns the pick's raw `roster_id` — a number that identifies
   * a slot within ONE season, not a person across seasons. Slots get reused: the
   * manager who was roster 4 in 2022 is very often not roster 4 now. Any reader that
   * filters DraftFact by a current team's `externalId` would therefore show one
   * manager another manager's draft, silently and plausibly.
   *
   * The matchup sync already resolves this — historical roster -> that season's owner
   * -> the owner's CURRENT `source_team_id`, which is what `LeagueTeam.externalId`
   * holds. This is the same resolution, against the same helper, so the two fact
   * tables agree on what a team id means.
   */
  const currentRosters = await prisma.roster.findMany({
    where: { leagueId: args.internalLeagueId },
    select: { platformUserId: true, playerData: true },
  })
  const canonicalIdByManagerId = new Map<string, string>()
  for (const roster of currentRosters) {
    const sourceTeamId = getSourceTeamIdFromPlayerData(roster.playerData)
    if (sourceTeamId) canonicalIdByManagerId.set(roster.platformUserId, sourceTeamId)
  }

  const pendingRows: PendingSleeperDraftFact[] = []
  const seasonsWithDrafts = new Set<number>()
  let importedDraftCount = 0
  let seasonsSkippedAlreadyComplete = 0
  let providerCallsAvoided = 0

  for (const seasonLeague of historyChain) {
    // Completion gate (P0-D): a completed historical season's DraftFact rows are stable —
    // don't re-hit Sleeper's draft/pick endpoints for a season we already imported. Mirrors the
    // `skipExistingSeasons` pattern in `lib/dynasty-import/backfill-orchestrator.ts`.
    if (!args.force) {
      const existing = await prisma.draftFact.findFirst({
        where: { leagueId: args.internalLeagueId, season: seasonLeague.season },
        select: { draftId: true },
      })
      if (existing) {
        seasonsSkippedAlreadyComplete += 1
        providerCallsAvoided += 1
        continue
      }
    }

    /*
     * That season's own rosters map its roster_id to an owner; the owner maps to the
     * current team. Fetched AFTER the completion gate above, so a season we already
     * imported still costs no provider call.
     */
    const seasonRosters = await getLeagueRosters(seasonLeague.externalLeagueId).catch(() => null)
    const canonicalByHistoricalRosterId = new Map<string, string>()
    for (const roster of seasonRosters ?? []) {
      const raw = (roster as { roster_id?: unknown; owner_id?: unknown } | null) ?? {}
      const historicalRosterId = raw.roster_id != null ? String(raw.roster_id) : ''
      if (!historicalRosterId) continue
      const ownerId = typeof raw.owner_id === 'string' ? raw.owner_id : null
      canonicalByHistoricalRosterId.set(
        historicalRosterId,
        (ownerId ? canonicalIdByManagerId.get(ownerId) : undefined) ?? historicalRosterId,
      )
    }

    /*
     * `normalizeManagerId` may hand back a roster id, an owner id, or `picked_by`.
     * Try both maps, then fall through to the raw value — an unresolvable manager
     * keeps its historical id rather than being dropped, so the pick still exists on
     * the board even when it cannot be attributed to a current team.
     */
    const canonicalManagerId = (raw: string | undefined): string | undefined => {
      if (!raw) return undefined
      return canonicalByHistoricalRosterId.get(raw) ?? canonicalIdByManagerId.get(raw) ?? raw
    }

    const drafts = await getLeagueDrafts(seasonLeague.externalLeagueId)
    const seenDraftIds = new Set<string>()

    for (const draft of drafts ?? []) {
      const sourceDraftId = typeof draft?.draft_id === 'string' ? draft.draft_id.trim() : ''
      if (!sourceDraftId || seenDraftIds.has(sourceDraftId)) {
        continue
      }
      seenDraftIds.add(sourceDraftId)

      const picks = await getDraftPicks(sourceDraftId)
      if (!Array.isArray(picks) || picks.length === 0) {
        continue
      }

      // Best-effort: fetch traded picks for this draft. Sleeper exposes
      // /v1/draft/{draft_id}/traded_picks. 404 and network errors are
      // swallowed so draft-pick ingestion keeps going. DraftFact schema has
      // no metadata column today, so results are logged for future use.
      try {
        const tpRes = await fetch(`https://api.sleeper.app/v1/draft/${sourceDraftId}/traded_picks`)
        if (tpRes.ok) {
          const tradedPicks = (await tpRes.json()) as unknown
          if (Array.isArray(tradedPicks) && tradedPicks.length > 0) {
            console.info(
              `[SleeperHistoricalDraftSync] draft ${sourceDraftId} traded_picks count=${tradedPicks.length}`,
            )
          }
        }
      } catch {
        /* non-fatal */
      }

      let draftProducedRows = false
      for (const [index, pick] of picks.entries()) {
        const playerId = typeof pick?.player_id === 'string' ? pick.player_id.trim() : ''
        const round = Number(pick?.round)
        if (!playerId || !Number.isFinite(round) || round <= 0) {
          continue
        }

        const pickNumber = normalizePickNumber(pick, index + 1)
        if (!Number.isFinite(pickNumber) || pickNumber <= 0) {
          continue
        }

        pendingRows.push({
          sourceDraftId,
          leagueId: args.internalLeagueId,
          sport: args.sport,
          round,
          pickNumber,
          playerId,
          managerId: canonicalManagerId(normalizeManagerId(pick)),
          season: seasonLeague.season,
        })
        draftProducedRows = true
      }

      if (draftProducedRows) {
        importedDraftCount += 1
        seasonsWithDrafts.add(seasonLeague.season)
      }
    }
  }

  const dedupedRows: Array<Omit<PendingSleeperDraftFact, 'sourceDraftId'>> = []
  const seenKeys = new Set<string>()
  for (const row of pendingRows) {
    const dedupeKey = [
      row.sourceDraftId,
      row.season,
      row.round,
      row.pickNumber,
      row.playerId,
      row.managerId ?? '',
    ].join(':')

    if (seenKeys.has(dedupeKey)) {
      continue
    }
    seenKeys.add(dedupeKey)

    const { sourceDraftId: _sourceDraftId, ...persistedRow } = row
    dedupedRows.push(persistedRow)
  }

  return {
    rows: dedupedRows,
    seasons: Array.from(seasonsWithDrafts).sort((a, b) => b - a),
    importedDraftCount,
    seasonsConsidered: historyChain.length,
    seasonsSkippedAlreadyComplete,
    providerCallsAvoided,
  }
}

export async function syncSleeperHistoricalDraftFactsAfterImport(args: {
  leagueId: string
  maxPreviousSeasons?: number
  /** Admin/internal-only escape hatch to force a full refetch of already-imported seasons. */
  force?: boolean
}): Promise<SleeperHistoricalDraftSyncSummary> {
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
      reason: 'Historical draft sync only applies to Sleeper leagues with a platformLeagueId.',
    }
  }

  try {
    const collected = await collectSleeperDraftFacts({
      internalLeagueId: league.id,
      sport: normalizeSportForWarehouse(league.sport),
      startingLeagueId: league.platformLeagueId,
      maxPreviousSeasons: args.maxPreviousSeasons ?? 10,
      force: args.force ?? false,
    })

    if (!collected.rows.length || !collected.seasons.length) {
      const allAlreadyComplete =
        collected.seasonsConsidered > 0 && collected.seasonsSkippedAlreadyComplete === collected.seasonsConsidered
      return {
        attempted: true,
        refreshed: false,
        skipped: true,
        reason: allAlreadyComplete
          ? 'All discovered seasons already have imported draft data; nothing to refetch.'
          : 'No historical Sleeper draft picks were available to import.',
        seasonsImported: 0,
        seasonsReplaced: 0,
        importedDraftCount: 0,
        importedPickCount: 0,
        seasonsConsidered: collected.seasonsConsidered,
        seasonsSkippedAlreadyComplete: collected.seasonsSkippedAlreadyComplete,
        providerCallsAvoided: collected.providerCallsAvoided,
      }
    }

    await prisma.$transaction([
      prisma.draftFact.deleteMany({
        where: {
          leagueId: league.id,
          season: { in: collected.seasons },
        },
      }),
      prisma.draftFact.createMany({
        data: collected.rows,
      }),
    ])

    return {
      attempted: true,
      refreshed: true,
      skipped: false,
      seasonsImported: collected.seasons.length,
      seasonsReplaced: collected.seasons.length,
      importedDraftCount: collected.importedDraftCount,
      seasonsConsidered: collected.seasonsConsidered,
      seasonsSkippedAlreadyComplete: collected.seasonsSkippedAlreadyComplete,
      providerCallsAvoided: collected.providerCallsAvoided,
      importedPickCount: collected.rows.length,
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
