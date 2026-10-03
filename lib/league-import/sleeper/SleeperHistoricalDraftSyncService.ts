import type { Prisma } from '@prisma/client'
import { sleeperDraftArchiveMetadata } from './draftArchiveMetadata'
import { normalizeSportForWarehouse } from '@/lib/data-warehouse/types'
import { runWithConcurrency } from '@/lib/async-utils'
import { prisma } from '@/lib/prisma'
import { getDraftPicks, getLeagueDrafts, getLeagueRosters } from '@/lib/sleeper-client'
import {
  SLEEPER_DRAFT_FETCH_CONCURRENCY,
  withSleeperHistoricalRequestLimit,
} from './SleeperFetchConcurrency'
import {
  canonicalIdsForSeason,
  currentSlotBySleeperOwner,
  draftTeamForOwners,
  formerSleeperManagerKey,
  formerSleeperSlotKey,
} from './historicalTeamIdentity'
import { getSleeperHistoricalLeagueChain } from './SleeperHistoricalLeagueChain'
import { shouldSkipImportedSeason } from '../seasonCompletion'
import { normalizePickNumber, sleeperOwnerByRosterId, sleeperPickOwnerId } from './sleeperDraftPickIdentity'

interface PendingSleeperDraftFact {
  sourceDraftId: string
  leagueId: string
  sport: string
  round: number
  pickNumber: number
  playerId: string
  managerId?: string
  season: number
  /**
   * `ownerSleeperId` — who owned the drafting team that season (see `sleeperPickOwnerId`).
   * `isKeeper` — Sleeper slotted this player into the draft as a KEEPER (`is_keeper`), so `round`
   * is what keeping him cost that season. Written only when true (2026-09-28): the sync fetched the
   * flag for years and discarded it, which left every keeper league with no keeper cost on file.
   */
  metadata?: Prisma.InputJsonObject
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
  /** Stored picks moved to another team because who holds which slot changed (no provider call). */
  picksRemapped?: number
  /** Seasons whose rosters could not be read: their picks are left as stored rather than written unattributed. */
  seasonsSkippedNoRosters?: number
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'Unknown error'
}

type StoredDraftRow = { draftId: string; managerId: string | null; metadata: unknown }

/**
 * Stored picks whose team no longer matches who holds which slot today — re-derived from the owner
 * stored on each pick (`ownerSleeperId`, `coOwnerSleeperIds`), so it needs no provider call. A pick
 * with no stored owner is left alone; `draftOwnerBackfill.ts` fills those in, and the next run maps them.
 */
export function planDraftTeamRemap(
  rows: ReadonlyArray<StoredDraftRow>,
  currentSlotByOwner: ReadonlyMap<string, string>,
): Array<{ draftId: string; managerId: string }> {
  const out: Array<{ draftId: string; managerId: string }> = []
  for (const row of rows) {
    const meta = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? (row.metadata as { ownerSleeperId?: unknown; coOwnerSleeperIds?: unknown })
      : null
    const coOwners = Array.isArray(meta?.coOwnerSleeperIds) ? (meta!.coOwnerSleeperIds as unknown[]).map(String) : []
    const team = draftTeamForOwners([typeof meta?.ownerSleeperId === 'string' ? meta.ownerSleeperId : null, ...coOwners], currentSlotByOwner)
    if (team && team !== row.managerId) out.push({ draftId: row.draftId, managerId: team })
  }
  return out
}

async function applyDraftTeamRemap(updates: Array<{ draftId: string; managerId: string }>): Promise<void> {
  const byTeam = new Map<string, string[]>()
  for (const u of updates) {
    const list = byTeam.get(u.managerId)
    if (list) list.push(u.draftId)
    else byTeam.set(u.managerId, [u.draftId])
  }
  await prisma.$transaction(
    [...byTeam.entries()].map(([managerId, ids]) =>
      prisma.draftFact.updateMany({ where: { draftId: { in: ids } }, data: { managerId } }),
    ),
  )
}

async function collectSleeperDraftFacts(args: {
  internalLeagueId: string
  sport: string
  startingLeagueId: string
  maxPreviousSeasons: number
  force: boolean
  currentSlotByOwner: ReadonlyMap<string, string>
}): Promise<{
  rows: Array<Omit<PendingSleeperDraftFact, 'sourceDraftId'>>
  seasons: number[]
  importedDraftCount: number
  seasonsConsidered: number
  seasonsSkippedAlreadyComplete: number
  providerCallsAvoided: number
  picksRemapped: number
  seasonsSkippedNoRosters: number
}> {
  const historyChain = await getSleeperHistoricalLeagueChain(args.startingLeagueId, args.maxPreviousSeasons)

  /*
   * ⚠ WITHOUT THIS, A PICK BELONGS TO WHOEVER HOLDS THAT ROSTER SLOT TODAY.
   *
   * A pick carries its raw `roster_id` — a number that identifies
   * a slot within ONE season, not a person across seasons. Slots get reused: the
   * manager who was roster 4 in 2022 is very often not roster 4 now. Any reader that
   * filters DraftFact by a current team's `externalId` would therefore show one
   * manager another manager's draft, silently and plausibly.
   *
   * The matchup sync already resolves this — historical roster -> that season's owner
   * -> the owner's CURRENT `source_team_id`, which is what `LeagueTeam.externalId`
   * holds. This is the same resolution, against the same helper, so the two fact
   * tables agree on what a team id means.
   *
   * 🛑 AND THAT RESOLUTION ITSELF FELL BACK TO THE SLOT FOR A MANAGER WHO HAD LEFT, which put
   * them straight back on whoever took the slot. Both syncs now share `historicalTeamIdentity.ts`
   * (2026-10-01): a departed owner is `former:sleeper:<ownerId>`, owners are looked up by
   * `source_manager_id`, and stored picks are re-derived from the owner stored on each pick
   * whenever who holds which slot changes.
   */
  const { currentSlotByOwner } = args

  const pendingRows: PendingSleeperDraftFact[] = []
  const seasonsWithDrafts = new Set<number>()
  let importedDraftCount = 0
  let seasonsSkippedAlreadyComplete = 0
  let providerCallsAvoided = 0
  let picksRemapped = 0
  let seasonsSkippedNoRosters = 0

  for (const seasonLeague of historyChain) {
    /*
     * Completion gate (P0-D): a completed historical season's DraftFact rows are stable — don't
     * re-hit Sleeper's draft/pick endpoints for a season we already imported.
     *
     * 🛑 THIS USED TO TEST ONLY `!args.force`, SO IT SKIPPED ANY SEASON THAT HAD ROWS — INCLUDING
     * THE ONE BEING PLAYED. The chain starts at the CURRENT league and walks back, so its first
     * element is the in-progress season; importing mid-season wrote rows for it, and every later
     * run then skipped it. A user's live draft froze at the moment they imported, while a counter
     * named `seasonsSkippedAlreadyComplete` reported it as finished. See `seasonCompletion.ts`.
     */
    const isCurrentSeason = seasonLeague.externalLeagueId === args.startingLeagueId
    if (shouldSkipImportedSeason({ force: args.force, league: seasonLeague.league })) {
      const existing = await prisma.draftFact.findFirst({
        where: { leagueId: args.internalLeagueId, season: seasonLeague.season },
        select: { draftId: true },
      })
      if (existing) {
        seasonsSkippedAlreadyComplete += 1
        providerCallsAvoided += 1
        /*
         * Finished picks never change, but which team they belong to does — a manager leaves and
         * someone else takes the slot. Re-derived here from the owner on each pick: a database
         * read, a write only where a pick moved. The current season's roster ids ARE its teams.
         */
        if (!isCurrentSeason) {
          const stored = await prisma.draftFact.findMany({
            where: { leagueId: args.internalLeagueId, season: seasonLeague.season },
            select: { draftId: true, managerId: true, metadata: true },
          })
          const updates = planDraftTeamRemap(stored, currentSlotByOwner)
          if (updates.length > 0) {
            await applyDraftTeamRemap(updates)
            picksRemapped += updates.length
          }
        }
        continue
      }
    }

    /*
     * That season's own rosters map its roster_id to an owner; the owner maps to the
     * current team. Fetched AFTER the completion gate above, so a season we already
     * imported still costs no provider call.
     */
    const seasonRosters = await getLeagueRosters(seasonLeague.externalLeagueId).catch(() => null)
    const canonicalByHistoricalRosterId = canonicalIdsForSeason({
      season: seasonLeague.season,
      rosters: (seasonRosters ?? []) as Array<{ roster_id: unknown; owner_id?: unknown; co_owners?: unknown }>,
      currentSlotByOwner,
      isCurrentSeason,
    })
    const coOwnersByRosterId = new Map<string, string[]>()
    for (const roster of seasonRosters ?? []) {
      const raw = (roster as { roster_id?: unknown; co_owners?: unknown } | null) ?? {}
      const ids = Array.isArray(raw.co_owners) ? raw.co_owners.filter((x): x is string => typeof x === 'string' && !!x) : []
      if (raw.roster_id != null && ids.length) coOwnersByRosterId.set(String(raw.roster_id), ids)
    }

    /*
     * The pick's team: its roster, through that season's owner, to the team they hold today.
     * A roster this season's payload does not list gets a key of its own — never the bare slot
     * number, which is someone else's team now. With no roster id, the owner the pick names; failing
     * that `picked_by` as it always was (whoever clicked: never mapped to a team).
     */
    const canonicalManagerId = (pick: any): string | undefined => {
      const rosterId = pick?.roster_id != null ? String(pick.roster_id) : ''
      if (rosterId) {
        return (
          canonicalByHistoricalRosterId.get(rosterId) ??
          (isCurrentSeason ? rosterId : formerSleeperSlotKey(seasonLeague.season, rosterId))
        )
      }
      const owner = typeof pick?.owner_id === 'string' && pick.owner_id.trim() ? pick.owner_id.trim() : ''
      if (owner) return currentSlotByOwner.get(owner) ?? formerSleeperManagerKey(owner)
      return typeof pick?.picked_by === 'string' && pick.picked_by.trim() ? pick.picked_by.trim() : undefined
    }
    const ownerByRosterId = sleeperOwnerByRosterId(seasonRosters)
    /*
     * ⚠ NO ROSTERS, NO WRITE. `getLeagueRosters` answers `[]` for a failed request; without that
     * season's owners every pick would be stored unattributed — and the write replaces the season.
     */
    const rostersUnreadable = !seasonRosters || seasonRosters.length === 0

    const drafts = await getLeagueDrafts(seasonLeague.externalLeagueId, { strict: true })
    if (!Array.isArray(drafts)) throw new Error('Sleeper draft history returned an invalid payload')
    const sourceDraftIds = Array.from(
      new Set(
        (drafts ?? [])
          .map((draft) =>
            typeof draft?.draft_id === 'string' ? draft.draft_id.trim() : '',
          )
          .filter(Boolean),
      ),
    )
    const loadedDrafts = await runWithConcurrency(
      sourceDraftIds,
      SLEEPER_DRAFT_FETCH_CONCURRENCY,
      async (sourceDraftId) => {
        const picks = await withSleeperHistoricalRequestLimit(() => getDraftPicks(sourceDraftId, { strict: true }))
        const sourceDraft = drafts.find((draft) => draft?.draft_id === sourceDraftId)
        if (!Array.isArray(picks) || (sourceDraft?.status === 'complete' && picks.length === 0)) {
          throw new Error('Sleeper selections unavailable for draft ' + sourceDraftId)
        }
        const tradedPicks = Array.isArray(picks) && picks.length > 0
          ? await withSleeperHistoricalRequestLimit(() =>
              fetch(`https://api.sleeper.app/v1/draft/${sourceDraftId}/traded_picks`, {
                signal: AbortSignal.timeout(12_000),
              })
                .then(async (response) => {
                  if (!response.ok) return null
                  const payload = (await response.json()) as unknown
                  return Array.isArray(payload) ? payload : null
                })
                .catch(() => null),
            )
          : null
        return { sourceDraftId, picks, tradedPicks }
      },
    )

    if (rostersUnreadable && loadedDrafts.some(({ picks }) => Array.isArray(picks) && picks.length > 0)) {
      seasonsSkippedNoRosters += 1
      continue
    }

    for (const { sourceDraftId, picks, tradedPicks } of loadedDrafts) {
      if (!Array.isArray(picks) || picks.length === 0) {
        continue
      }

      const sourceDraft = (drafts ?? []).find((draft) => draft?.draft_id === sourceDraftId)
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

        const ownerSleeperId = sleeperPickOwnerId(pick, ownerByRosterId)
        const coOwnerSleeperIds = pick?.roster_id != null ? coOwnersByRosterId.get(String(pick.roster_id)) : undefined
        const isKeeper = pick?.is_keeper === true
        const metadata = {
          ...sleeperDraftArchiveMetadata({ sourceDraftId,
            sourceLeagueId: seasonLeague.externalLeagueId, season: seasonLeague.season,
            draft: sourceDraft, league: seasonLeague.league, pick, tradedPicks,
            includeDraftSnapshot: !draftProducedRows }),
          ...(ownerSleeperId ? { ownerSleeperId } : {}),
          ...(ownerSleeperId && coOwnerSleeperIds ? { coOwnerSleeperIds } : {}),
          ...(isKeeper ? { isKeeper: true as const } : {}),
        }
        pendingRows.push({
          sourceDraftId,
          leagueId: args.internalLeagueId,
          sport: args.sport,
          round,
          pickNumber,
          playerId,
          managerId: canonicalManagerId(pick),
          season: seasonLeague.season,
          ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
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
    picksRemapped,
    seasonsSkippedNoRosters,
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
    const [currentRosters, currentTeams] = await Promise.all([
      prisma.roster.findMany({
        where: { leagueId: league.id },
        select: { platformUserId: true, playerData: true },
      }),
      prisma.leagueTeam.findMany({
        where: { leagueId: league.id },
        select: { externalId: true, platformUserId: true },
      }),
    ])
    const currentSlotByOwner = currentSlotBySleeperOwner({ rosters: currentRosters, teams: currentTeams })
    // ⚠ Nobody to map onto, so do not map: every past pick would read as a departed manager's.
    if (currentSlotByOwner.size === 0) {
      return {
        attempted: false,
        refreshed: false,
        skipped: true,
        reason: 'No current Sleeper managers on file to map draft history onto.',
      }
    }

    const collected = await collectSleeperDraftFacts({
      internalLeagueId: league.id,
      sport: normalizeSportForWarehouse(league.sport),
      startingLeagueId: league.platformLeagueId,
      maxPreviousSeasons: args.maxPreviousSeasons ?? 10,
      force: args.force ?? false,
      currentSlotByOwner,
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
        picksRemapped: collected.picksRemapped,
        seasonsSkippedNoRosters: collected.seasonsSkippedNoRosters,
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
      picksRemapped: collected.picksRemapped,
      seasonsSkippedNoRosters: collected.seasonsSkippedNoRosters,
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
