import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizePlayerName, normalizePositionForSport, normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'

/**
 * PlayerIdentityMap backfill for every sport that is not NFL.
 *
 * WHY THIS IS THE UNBLOCKER. Measured on production 2026-08-27, `PlayerIdentityMap` held 1,933
 * rows and every one of them was NFL. That single fact is what kept six sports out of the
 * downstream product, because the chain is:
 *
 *   SportsPlayer  ->  PlayerIdentityMap  ->  fantasy_stat_lines  ->  AFProjectionSnapshot  ->  values
 *
 * and `syncRollingInsightsPlayerStatsToDb` refuses at step two with "identity map empty for sport
 * — refusing to write provider-keyed rows". That refusal is CORRECT: writing provider-keyed stat
 * rows that join to nothing is the exact failure this repo has shipped before. The fix is to
 * populate the map, not to relax the guard.
 *
 * NO PROVIDER CALL IS NEEDED. `SportsPlayer` already holds Rolling Insights' own player ids in
 * `externalId` wherever `source = 'rolling_insights'` — 7,295 MLB, 4,115 NHL, 1,756 NBA, 18,209
 * NCAAB, 1,573 SOCCER and 39,671 NCAAF rows of them. So `rollingInsightsId` is copied from a
 * column we already have, and the map is built from the database alone.
 *
 * IDENTITY IS KEYED ON THE PROVIDER ID, NEVER ON THE NAME. Name matching is used only to ATTACH a
 * provider id to a pre-existing row, and only when exactly one candidate survives disambiguation.
 * The production player dedupe already established that "same name" is not a safe key; two
 * ambiguous candidates are counted and skipped rather than merged on a guess.
 */

/** Provider whose ids this backfill trusts as the canonical join key. */
const RI_SOURCE = 'rolling_insights'

/** Read page size. Large enough to be few round trips, small enough not to hold a huge result. */
const READ_PAGE = 5_000

/** Write batch size for `createMany`. */
const CREATE_BATCH = 500

export interface IdentityBackfillResult {
  sport: string
  /** SportsPlayer rows considered (source = rolling_insights). */
  scanned: number
  /** Already had a PlayerIdentityMap row carrying this rollingInsightsId. */
  alreadyMapped: number
  /** Existing identity row gained a rollingInsightsId by unambiguous name match. */
  linked: number
  created: number
  /** Existing mapped row whose team/position/status moved on. */
  refreshed: number
  /** More than one existing identity row matched and none could be told apart — skipped, not guessed. */
  ambiguous: number
  /** Rows with no usable name. */
  skippedNoName: number
  dryRun: boolean
  errors: string[]
}

interface IdentityRow {
  id: string
  normalizedName: string
  position: string | null
  currentTeam: string | null
  rollingInsightsId: string | null
}

/**
 * Build (or top up) the identity map for one sport.
 *
 * Idempotent: re-running links nothing new and creates nothing new once converged, so it is safe
 * on a schedule. NFL is a no-op in practice — its 1,933 rows already carry `rollingInsightsId`.
 */
export async function backfillIdentityMapForSport(
  sportInput: string,
  opts: { dryRun?: boolean; limit?: number } = {},
): Promise<IdentityBackfillResult> {
  const sport = sportInput.trim().toUpperCase()
  const dryRun = opts.dryRun === true
  const result: IdentityBackfillResult = {
    sport,
    scanned: 0,
    alreadyMapped: 0,
    linked: 0,
    created: 0,
    refreshed: 0,
    ambiguous: 0,
    skippedNoName: 0,
    dryRun,
    errors: [],
  }

  // --- existing identity rows, indexed both ways ---
  const byRiId = new Map<string, IdentityRow>()
  const byName = new Map<string, IdentityRow[]>()
  try {
    const existing = await prisma.playerIdentityMap.findMany({
      where: { sport },
      select: { id: true, normalizedName: true, position: true, currentTeam: true, rollingInsightsId: true },
    })
    for (const row of existing) {
      if (row.rollingInsightsId) byRiId.set(row.rollingInsightsId, row)
      const bucket = byName.get(row.normalizedName)
      if (bucket) bucket.push(row)
      else byName.set(row.normalizedName, [row])
    }
  } catch (e) {
    result.errors.push(`identity map load failed: ${e instanceof Error ? e.message : String(e)}`)
    return result
  }

  // --- source rows, paged by id so a large sport does not materialise at once ---
  const pending: Array<{
    canonicalName: string
    normalizedName: string
    position: string | null
    currentTeam: string | null
    status: string | null
    dob: string | null
    rollingInsightsId: string
    sport: string
    lastSyncedAt: Date
  }> = []

  let cursor: string | null = null
  const now = new Date()

  for (;;) {
    if (opts.limit != null && result.scanned >= opts.limit) break

    const take = opts.limit != null ? Math.min(READ_PAGE, opts.limit - result.scanned) : READ_PAGE
    const page: Array<{
      id: string
      externalId: string
      name: string
      position: string | null
      team: string | null
      status: string | null
      dob: string | null
    }> = await prisma.sportsPlayer.findMany({
      where: { sport, source: RI_SOURCE },
      select: { id: true, externalId: true, name: true, position: true, team: true, status: true, dob: true },
      orderBy: { id: 'asc' },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    if (page.length === 0) break
    cursor = page[page.length - 1]!.id

    for (const src of page) {
      result.scanned += 1

      const rawName = src.name?.trim() ?? ''
      if (!rawName) {
        result.skippedNoName += 1
        continue
      }
      const normalizedName = normalizePlayerName(rawName)
      if (!normalizedName) {
        result.skippedNoName += 1
        continue
      }

      const riId = src.externalId.trim()
      const position = normalizePositionForSport(sport, src.position)
      // `normalizeTeamAbbrev` only knows NFL; for every other sport it echoes the input, which is
      // what we want — the identity row and the RI stat row then carry the SAME provider team
      // string, so the matcher in rollingInsightsPlayerStats compares like with like.
      const currentTeam = normalizeTeamAbbrev(src.team) ?? src.team ?? null

      const mapped = byRiId.get(riId)
      if (mapped) {
        result.alreadyMapped += 1
        const teamMoved = (mapped.currentTeam ?? null) !== (currentTeam ?? null)
        const posMoved = position != null && (mapped.position ?? null) !== position
        if ((teamMoved || posMoved) && !dryRun) {
          try {
            await prisma.playerIdentityMap.update({
              where: { id: mapped.id },
              data: {
                currentTeam,
                ...(position ? { position } : {}),
                status: src.status ?? undefined,
                lastSyncedAt: now,
              },
            })
            mapped.currentTeam = currentTeam
            if (position) mapped.position = position
            result.refreshed += 1
          } catch (e) {
            result.errors.push(`refresh ${riId}: ${e instanceof Error ? e.message : String(e)}`)
          }
        } else if (teamMoved || posMoved) {
          result.refreshed += 1
        }
        continue
      }

      // Attach to an existing row only when the answer is unique. Candidates that already carry a
      // DIFFERENT rollingInsightsId are excluded outright: one identity cannot be two RI players.
      const candidates = (byName.get(normalizedName) ?? []).filter((c) => c.rollingInsightsId == null)
      let target: IdentityRow | null = null
      if (candidates.length === 1) {
        target = candidates[0]!
      } else if (candidates.length > 1) {
        const narrowed = candidates.filter((c) => {
          const posOk = !position || !c.position || c.position === position
          const teamOk = !currentTeam || !c.currentTeam || c.currentTeam === currentTeam
          return posOk && teamOk
        })
        if (narrowed.length === 1) target = narrowed[0]!
        else {
          result.ambiguous += 1
          continue
        }
      }

      if (target) {
        if (!dryRun) {
          try {
            await prisma.playerIdentityMap.update({
              where: { id: target.id },
              data: {
                rollingInsightsId: riId,
                currentTeam,
                ...(position ? { position } : {}),
                status: src.status ?? undefined,
                lastSyncedAt: now,
              },
            })
          } catch (e) {
            result.errors.push(`link ${riId}: ${e instanceof Error ? e.message : String(e)}`)
            continue
          }
        }
        target.rollingInsightsId = riId
        byRiId.set(riId, target)
        result.linked += 1
        continue
      }

      pending.push({
        canonicalName: rawName,
        normalizedName,
        position,
        currentTeam,
        status: src.status ?? null,
        dob: src.dob ?? null,
        rollingInsightsId: riId,
        sport,
        lastSyncedAt: now,
      })
      // Register immediately so two source rows for the same RI id in one run cannot both create.
      byRiId.set(riId, {
        id: `pending:${riId}`,
        normalizedName,
        position,
        currentTeam,
        rollingInsightsId: riId,
      })
    }

    if (page.length < take) break
  }

  // --- creates, batched ---
  if (pending.length > 0) {
    if (dryRun) {
      result.created = pending.length
    } else {
      for (let i = 0; i < pending.length; i += CREATE_BATCH) {
        const batch = pending.slice(i, i + CREATE_BATCH)
        try {
          // `skipDuplicates` guards the only unique constraint that can bite here (`sleeperId`,
          // which these rows leave null) and makes a concurrent run harmless.
          const created = await prisma.playerIdentityMap.createMany({ data: batch, skipDuplicates: true })
          result.created += created.count
        } catch (e) {
          result.errors.push(
            `create batch ${i}-${i + batch.length}: ${e instanceof Error ? e.message : String(e)}`,
          )
        }
      }
    }
  }

  return result
}

/**
 * Backfill several sports in order, stopping cleanly when a caller-supplied budget is spent.
 *
 * The stop is checked BETWEEN sports, so a sport already started runs to completion — same
 * contract as `createRunBudget`, and the reason callers should order the list stale-first.
 */
export async function backfillIdentityMaps(
  sports: readonly string[],
  opts: { dryRun?: boolean; limitPerSport?: number; shouldStop?: () => boolean } = {},
): Promise<{ results: IdentityBackfillResult[]; deferred: string[] }> {
  const results: IdentityBackfillResult[] = []
  const deferred: string[] = []

  for (const sport of sports) {
    if (opts.shouldStop?.()) {
      deferred.push(sport)
      continue
    }
    results.push(
      await backfillIdentityMapForSport(sport, { dryRun: opts.dryRun, limit: opts.limitPerSport }),
    )
  }

  return { results, deferred }
}

/** Sports this backfill covers — every supported sport; NFL converges to a no-op. */
export function identityBackfillSports(): string[] {
  return SUPPORTED_SPORTS.map((s) => String(s))
}
