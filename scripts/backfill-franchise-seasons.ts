/**
 * Phase 0 follow-up B — FranchiseSeason historical backfill.
 *
 * The Phase 0 fix made `franchise_seasons` populate at season-finalize
 * *going forward* (`RedraftOffseasonService.ts`'s `enterRedraftOffseason`).
 * Leagues that already completed a season before that fix landed have no
 * row, so their history doesn't count toward career rank yet. This script
 * backfills those from the real, already-persisted `LeagueSeason.teamRecords`
 * snapshot — it never recomputes standings, it only reads what was already
 * written at the time that season finalized.
 *
 * Reuses `upsertFranchiseSeasonRows` (the SAME helper the live finalize path
 * calls) — never a second, independently-derived champion/record mapping.
 *
 * Champion/runner-up are read directly from each stored record's own real
 * `rank` field (`rank === 1` / `rank === 2`), NOT from `LeagueSeason.
 * championTeamId` (which stores a franchiseId, not a rosterId, and
 * `LeagueSeason` has no `runnerUpTeamId` column at all — only a display
 * name). The stored `records` array was itself built, at finalize time,
 * from `season.rosters` already ordered by wins desc / pointsFor desc with
 * `rank: index + 1` — so `rank` is the real, authoritative ordering, not a
 * guess.
 *
 * SAFETY: skips cleanly (exit 0) without DATABASE_URL. REFUSES the
 * production host. `--dry-run` never writes — logs counts only.
 *
 *   DATABASE_URL=<non-prod db> npx tsx scripts/backfill-franchise-seasons.ts --dry-run
 *   DATABASE_URL=<non-prod db> npx tsx scripts/backfill-franchise-seasons.ts --dry-run --league <leagueId>
 *   DATABASE_URL=<non-prod db> npx tsx scripts/backfill-franchise-seasons.ts            # real write, once approved
 */
import { hasDatabaseUrl, resolveDatabaseUrl } from '../lib/env/database-url'
import { assertNonProductionDbTarget, describeDbTarget } from './_db-target-identity'

// CORRECTION (2026-08-20): the note that used to sit here had it backwards. It claimed the
// production endpoint was `ep-spring-tooth-adaoi9x1` and that `ep-curly-block` was a non-prod
// clone. It is the other way round — production is `ep-curly-block-ad0dlt9o`/`neondb` (verified
// against `.env.local`), and `ep-spring-tooth-adaoi9x1` is the `claude-dashboard-local-dev` fork.
// Target identity now comes from scripts/db-target-identity.cjs so it cannot drift again.


const NATIVE_PLATFORMS = ['allfantasy', 'af', 'manual', 'native']

interface RawNativeSeasonRecord {
  rosterId?: unknown
  franchiseId?: unknown
  managerUserId?: unknown
  wins?: unknown
  losses?: unknown
  ties?: unknown
  pointsFor?: unknown
  pointsAgainst?: unknown
  playoffSeed?: unknown
  rank?: unknown
}

/**
 * Defensive parse — `LeagueSeason.teamRecords` is a `Json` column written by
 * TWO different real code paths with two different shapes (native vs.
 * Sleeper-history-sync — see `upsertFranchiseSeasonRows.ts`'s header). A row
 * that doesn't have the native shape's `rank`/`rosterId` fields is skipped
 * with a warning, never force-mapped.
 */
function parseNativeRecords(raw: unknown): Array<{
  rosterId: string
  franchiseId: string | null
  managerUserId: string | null
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
  playoffSeed: number | null
  rank: number
}> | null {
  if (!Array.isArray(raw)) return null
  const out: ReturnType<typeof parseNativeRecords> = []
  for (const item of raw as RawNativeSeasonRecord[]) {
    if (typeof item?.rosterId !== 'string' || typeof item?.rank !== 'number') return null // not the native shape
    out!.push({
      rosterId: item.rosterId,
      franchiseId: typeof item.franchiseId === 'string' ? item.franchiseId : null,
      managerUserId: typeof item.managerUserId === 'string' ? item.managerUserId : null,
      wins: typeof item.wins === 'number' ? item.wins : 0,
      losses: typeof item.losses === 'number' ? item.losses : 0,
      ties: typeof item.ties === 'number' ? item.ties : 0,
      pointsFor: typeof item.pointsFor === 'number' ? item.pointsFor : 0,
      pointsAgainst: typeof item.pointsAgainst === 'number' ? item.pointsAgainst : 0,
      playoffSeed: typeof item.playoffSeed === 'number' ? item.playoffSeed : null,
      rank: item.rank,
    })
  }
  return out
}

;(async () => {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const leagueArgIdx = args.indexOf('--league')
  const leagueFilter = leagueArgIdx >= 0 ? args[leagueArgIdx + 1] : null

  if (!hasDatabaseUrl()) {
    console.log('BACKFILL_FRANCHISE_SEASONS SKIPPED (no DATABASE_URL) — set a non-prod DATABASE_URL to run.')
    process.exit(0)
  }
  const dbTargetUrl = resolveDatabaseUrl()
  const host = describeDbTarget(dbTargetUrl)
  assertNonProductionDbTarget({
    script: 'backfill-franchise-seasons',
    url: dbTargetUrl,
    action: 'backfills franchise season rows',
    exitCode: 0,
  })
  console.log(`FranchiseSeason backfill — DB host: ${host} — mode: ${dryRun ? 'DRY RUN (no writes)' : 'REAL WRITE'}${leagueFilter ? ` — league: ${leagueFilter}` : ''}`)

  const { prisma } = await import('../lib/prisma')
  const { upsertFranchiseSeasonRows } = await import('../lib/rank/upsertFranchiseSeasonRows')
  const { calculateAndSaveRank } = await import('../lib/rank/calculateRank')

  const leagues = await prisma.league.findMany({
    where: {
      platform: { in: NATIVE_PLATFORMS },
      ...(leagueFilter ? { id: leagueFilter } : {}),
    },
    select: { id: true, name: true },
  })
  console.log(`Found ${leagues.length} native league(s) to consider.`)

  let leaguesProcessed = 0
  let leaguesSkippedNoSeasons = 0
  let leaguesFailed = 0
  let seasonsConsidered = 0
  let seasonsSkippedWrongShape = 0
  let seasonsSkippedAlreadyPresent = 0
  let seasonsWritten = 0
  let rowsWritten = 0
  const affectedUserIds = new Set<string>()

  for (const league of leagues) {
    try {
      const seasons = await prisma.leagueSeason.findMany({
        where: { leagueId: league.id },
        select: { id: true, season: true, teamRecords: true },
        orderBy: { season: 'asc' },
      })
      if (seasons.length === 0) {
        leaguesSkippedNoSeasons++
        continue
      }

      for (const leagueSeason of seasons) {
        seasonsConsidered++
        const records = parseNativeRecords(leagueSeason.teamRecords)
        if (!records || records.length === 0) {
          seasonsSkippedWrongShape++
          console.log(`  [skip] league=${league.id} season=${leagueSeason.season}: teamRecords is not the native shape (likely Sleeper-history-sync shaped, or empty) — not backfilled.`)
          continue
        }

        // Skip whole-season if any real FranchiseSeason row already exists for it — idempotent,
        // avoids needless writes on a re-run.
        const existingCount = await prisma.franchiseSeason.count({ where: { leagueId: league.id, season: leagueSeason.season } })
        if (existingCount > 0) {
          seasonsSkippedAlreadyPresent++
          continue
        }

        const champion = records.find((r) => r.rank === 1) ?? null
        const runnerUp = records.find((r) => r.rank === 2) ?? null

        console.log(`  [${dryRun ? 'would write' : 'writing'}] league=${league.id} (${league.name ?? 'unnamed'}) season=${leagueSeason.season}: ${records.length} franchise row(s), champion=${champion?.rosterId ?? 'unknown'}`)

        if (!dryRun) {
          const written = await prisma.$transaction((tx) =>
            upsertFranchiseSeasonRows(tx, {
              leagueId: league.id,
              season: leagueSeason.season,
              records,
              championRosterId: champion?.rosterId ?? null,
              runnerUpRosterId: runnerUp?.rosterId ?? null,
            }),
          )
          rowsWritten += written
          for (const r of records) {
            if (r.managerUserId) affectedUserIds.add(r.managerUserId)
          }
        } else {
          rowsWritten += records.length
          for (const r of records) {
            if (r.managerUserId) affectedUserIds.add(r.managerUserId)
          }
        }
        seasonsWritten++
      }
      leaguesProcessed++
    } catch (err) {
      leaguesFailed++
      console.error(`  [error] league=${league.id} failed, continuing with remaining leagues:`, err instanceof Error ? err.message : err)
    }
  }

  console.log('')
  console.log('=== Summary ===')
  console.log(`Leagues processed: ${leaguesProcessed} (no-seasons skipped: ${leaguesSkippedNoSeasons}, failed: ${leaguesFailed})`)
  console.log(`Seasons considered: ${seasonsConsidered} (wrong-shape skipped: ${seasonsSkippedWrongShape}, already-present skipped: ${seasonsSkippedAlreadyPresent}, ${dryRun ? 'would-write' : 'written'}: ${seasonsWritten})`)
  console.log(`FranchiseSeason rows ${dryRun ? 'that would be written' : 'written'}: ${rowsWritten}`)
  console.log(`Distinct users affected: ${affectedUserIds.size}`)

  if (dryRun) {
    console.log('')
    console.log('DRY RUN — no writes performed. Re-run without --dry-run to write, then rank-recompute affected users.')
    process.exit(0)
  }

  console.log('')
  console.log(`Recomputing rank for ${affectedUserIds.size} affected user(s)...`)
  let rankRecomputeFailures = 0
  for (const userId of affectedUserIds) {
    try {
      await calculateAndSaveRank(userId)
    } catch (err) {
      rankRecomputeFailures++
      console.error(`  [rank-recompute error] user=${userId}:`, err instanceof Error ? err.message : err)
    }
  }
  console.log(`Rank recompute done (${rankRecomputeFailures} failure(s)).`)
  console.log('BACKFILL_FRANCHISE_SEASONS_OK')
})()
