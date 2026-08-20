/**
 * Decision OS — cleanup for duplicate `decision_os_imported_activity` rows written by the OLD
 * (pre-fix) writer AFTER the league-id repair ran.
 *
 * ── When this is needed ────────────────────────────────────────────────────────────────────
 * `scripts/decision-os-repair-imported-activity-league-ids.ts` rewrote the 6,429 mis-keyed rows to
 * provider-scoped `externalSourceKey`s and populated `afLeagueId`. If the UNFIXED writer runs after
 * that (the `decision-os-activity-ingest` cron fires 07:00 UTC daily), it derives the OLD uuid-scoped
 * key shape again, matches nothing, and INSERTS a second copy of each event. The reader
 * (`defaultLoadImportedActivityRows`) unions `afLeagueId` OR `providerLeagueId`, so both copies are
 * returned and every duplicated trade/waiver/draft pick is counted TWICE in behavioral facts.
 *
 * ── How a duplicate is identified (precisely, not heuristically) ───────────────────────────
 * After the repair, EVERY legitimate row has `afLeagueId` set. The old writer cannot set it — it
 * never passed one. So `afLeagueId IS NULL AND providerLeagueId joins leagues.id` is the old
 * writer's exact signature, not a guess.
 *
 * A row is deleted ONLY when its provider-keyed counterpart already exists — i.e. the same logical
 * event is already stored correctly. A stale-shaped row with NO counterpart is REAL data the repair
 * never saw (a genuinely new event the old writer ingested); it is reported and LEFT IN PLACE for a
 * repair pass, never deleted. Deleting it would lose activity.
 *
 * ── Safety ─────────────────────────────────────────────────────────────────────────────────
 *   - DRY RUN by default. `--apply` is required to delete. Never runs `prisma migrate`.
 *   - Deletes only from `decision_os_imported_activity`; read-only against `leagues`.
 *   - Single transaction, re-runnable (a second run finds 0 duplicates and no-ops).
 *   - Prints the target DB host so the operator can confirm the database before deleting.
 *
 *   npx tsx scripts/decision-os-cleanup-imported-activity-duplicates.ts           # dry run
 *   npx tsx scripts/decision-os-cleanup-imported-activity-duplicates.ts --apply   # delete
 */
import { PrismaClient } from '@prisma/client'
import { hasDatabaseUrl, resolveDatabaseUrl } from '../lib/env/database-url'
import { deriveActivityNaturalKey } from '../lib/decision-os/ingestion/importedActivityNormalizer'
import type { ImportProvider } from '../lib/league-import/types'
import type { ImportedActivityType } from '../lib/decision-os/ingestion/importedActivityNormalizer'

const APPLY = process.argv.includes('--apply')

/** Inverse of the normalizer's `esc`. */
function unescapeSegment(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === '\\' && i + 1 < s.length) {
      out += s[i + 1]
      i += 1
      continue
    }
    out += s[i]
  }
  return out
}

/** The normalizer's `esc`, mirrored so the stale prefix can be reconstructed exactly. */
function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/:/g, '\\:')
}

interface StaleRow {
  id: string
  externalSourceKey: string
  provider: string
  providerLeagueId: string
  activityType: string
  platformLeagueId: string
}

async function main(): Promise<void> {
  if (!hasDatabaseUrl()) {
    console.error('REFUSED: no DATABASE_URL resolved.')
    process.exit(1)
  }
  const resolved = resolveDatabaseUrl() ?? ''
  const host = (/@([^/:?]+)/.exec(resolved)?.[1] ?? 'unknown').split('.')[0]
  console.log(`target db host: ${host}   mode: ${APPLY ? 'APPLY (deletes)' : 'DRY RUN (no writes)'}\n`)

  const prisma = new PrismaClient()
  try {
    const totals = await prisma.$queryRawUnsafe<Array<Record<string, bigint>>>(`
      SELECT count(*) AS total,
             count(*) FILTER (WHERE "afLeagueId" IS NULL) AS af_null,
             count(*) FILTER (WHERE "afLeagueId" IS NOT NULL) AS af_set
      FROM decision_os_imported_activity
    `)
    const t = totals[0]
    console.log('── census BEFORE ───────────────────────────────')
    console.log(`  rows=${t.total}  afLeagueId set (repaired)=${t.af_set}  afLeagueId NULL (old-writer shape)=${t.af_null}`)

    // The old writer's exact signature: afLeagueId never set, providerLeagueId holding a League.id.
    const stale = await prisma.$queryRawUnsafe<StaleRow[]>(`
      SELECT a.id, a."externalSourceKey", a.provider, a."providerLeagueId", a."activityType",
             l."platformLeagueId"
      FROM decision_os_imported_activity a
      JOIN leagues l ON l.id = a."providerLeagueId"
      WHERE a."afLeagueId" IS NULL
        AND l."platformLeagueId" IS NOT NULL AND l."platformLeagueId" <> ''
      ORDER BY a.id
    `)
    console.log(`\n── cleanup plan ────────────────────────────────`)
    console.log(`  rows with the old-writer signature: ${stale.length}`)
    if (stale.length === 0) {
      console.log('\nNothing to clean up. (Expected when the cron has not re-run since the repair.)')
      return
    }

    // Only a row whose correctly-keyed counterpart ALREADY EXISTS is a duplicate.
    const counterpartKeys = new Map<string, string>() // staleRowId -> expected provider-scoped key
    const unparseable: string[] = []
    for (const row of stale) {
      const oldPrefix = `dos:act:${esc(row.provider)}:${esc(row.providerLeagueId)}:${esc(row.activityType)}:`
      if (!row.externalSourceKey.startsWith(oldPrefix)) {
        unparseable.push(row.id)
        continue
      }
      const providerEventId = unescapeSegment(row.externalSourceKey.slice(oldPrefix.length))
      counterpartKeys.set(
        row.id,
        deriveActivityNaturalKey(
          row.provider as ImportProvider,
          row.platformLeagueId,
          row.activityType as ImportedActivityType,
          providerEventId,
        ),
      )
    }

    const existing = new Set(
      (
        await prisma.$queryRawUnsafe<Array<{ externalSourceKey: string }>>(
          `SELECT "externalSourceKey" FROM decision_os_imported_activity WHERE "externalSourceKey" = ANY($1::text[])`,
          [...counterpartKeys.values()],
        )
      ).map((r) => r.externalSourceKey),
    )

    const deletable: string[] = []
    const orphans: string[] = []
    for (const [rowId, key] of counterpartKeys) {
      if (existing.has(key)) deletable.push(rowId)
      else orphans.push(rowId)
    }

    console.log(`  duplicates (correctly-keyed counterpart exists) → DELETE: ${deletable.length}`)
    console.log(`  no counterpart → KEPT (real activity the repair never saw): ${orphans.length}`)
    if (unparseable.length > 0) console.log(`  unrecognised key shape → KEPT: ${unparseable.length}`)
    if (orphans.length > 0) {
      console.log('\n  NOTE: the kept rows are genuinely new events ingested by the old writer. Re-run')
      console.log('  the repair script after the fixed writer is deployed to fold them into the')
      console.log('  correct shape — do NOT delete them.')
    }

    if (deletable.length === 0) {
      console.log('\nNo duplicates to delete.')
      return
    }
    if (!APPLY) {
      console.log(`\nDRY RUN — no delete performed. ${deletable.length} duplicate rows would be removed.`)
      console.log('DOS_IMPORTED_ACTIVITY_CLEANUP_DRY_RUN_OK')
      return
    }

    console.log(`\nDeleting ${deletable.length} duplicate rows in a single transaction…`)
    const deleted = await prisma.$transaction(
      async (tx) =>
        tx.$executeRawUnsafe(
          `DELETE FROM decision_os_imported_activity WHERE id = ANY($1::text[]) AND "afLeagueId" IS NULL`,
          deletable,
        ),
      { timeout: 300_000 },
    )
    console.log(`  rows deleted: ${deleted}`)

    const after = await prisma.$queryRawUnsafe<Array<Record<string, bigint>>>(`
      SELECT count(*) AS total,
             count(*) FILTER (WHERE "afLeagueId" IS NULL) AS af_null
      FROM decision_os_imported_activity
    `)
    console.log('\n── census AFTER ────────────────────────────────')
    console.log(`  rows=${after[0].total}  afLeagueId NULL=${after[0].af_null}`)
    console.log('\nDOS_IMPORTED_ACTIVITY_CLEANUP_OK')
  } finally {
    await prisma.$disconnect().catch(() => undefined)
  }
}

main().catch((error) => {
  console.error('CLEANUP FAILED:', error instanceof Error ? error.message : error)
  process.exit(1)
})
