/**
 * Decision OS — repair for the `decision_os_imported_activity` league-id column misuse (Aug 2026).
 *
 * ── The bug ────────────────────────────────────────────────────────────────────────────────
 * `DecisionOsImportedActivity` has two league columns with distinct meanings:
 *   - `providerLeagueId` (required) — the PROVIDER's own id (Sleeper `league_id`, e.g. "1314303191852011520")
 *   - `afLeagueId`       (nullable) — AllFantasy's canonical `League.id` uuid, when mapped
 *
 * Both production writers passed AllFantasy's canonical `League.id` into the pipeline's ambiguous
 * `leagueId` input, which the store persisted to `providerLeagueId`:
 *   - `app/api/cron/decision-os-activity-ingest/route.ts` (computed `sourceLeagueId` correctly, then passed `league.id`)
 *   - `scripts/decision-os-ingest-sleeper-activity-nonprod.ts` (same slip)
 * and `prismaImportedActivityStore.ts` hardcoded `afLeagueId: null` ("Increment 4" was never wired).
 *
 * Prod census 2026-08-20 (read-only): 6,429 rows, `afLeagueId` NULL on all 6,429, 42 distinct
 * `providerLeagueId`, 42/42 joining `leagues.id`, 0/42 joining `leagues.platformLeagueId`.
 *
 * ── Why the key must be rewritten too (the idempotency trap) ───────────────────────────────
 * `externalSourceKey` IS the dedupe key, and the normalizer folds the league id into it:
 *   `dos:act:<provider>:<leagueId>:<activityType>:<providerEventId>`
 * Every existing key therefore embeds the canonical uuid. Fixing only the writer would make the
 * next cron fire derive PROVIDER-scoped keys, match nothing, and INSERT a second copy of all
 * 6,429 rows. So this repair rewrites the key in the same transaction as the columns — after
 * which the fixed writer's keys match the repaired rows exactly and re-ingest converges (`updated`).
 *
 * `afLeagueId` is deliberately NOT part of the key, so mapping a league to an AF id later never
 * changes its key again. This repair is a one-time correction, not a recurring migration.
 *
 * ── How keys are rewritten (no re-implementation of the escaping) ──────────────────────────
 * `providerEventId` is NULL on every row (the store never populated it), so the event id cannot be
 * re-read from a column — it is recovered from the key itself. The script strips the exact old
 * prefix, unescapes the trailing event-id segment, and calls the REAL
 * {@link deriveActivityNaturalKey} to build the new key. Every row is additionally asserted to
 * round-trip (re-deriving the OLD key from the recovered parts must reproduce the stored key byte
 * for byte); any row that fails is skipped and reported, never guessed at.
 *
 * ── Safety ─────────────────────────────────────────────────────────────────────────────────
 *   - DRY RUN by default. `--apply` is required to write. Never runs `prisma migrate`.
 *   - Only touches rows that are unambiguously mis-written: `afLeagueId IS NULL`, the
 *     `providerLeagueId` joins `leagues.id`, and the key carries the expected old prefix.
 *   - Pre-flight aborts on ANY duplicate/colliding target key, before opening the write transaction.
 *   - Single transaction; re-runnable (a second run finds 0 candidates and no-ops).
 *   - Read-only against `leagues`; writes only `decision_os_imported_activity`.
 *
 *   npx tsx scripts/decision-os-repair-imported-activity-league-ids.ts            # dry run + census
 *   npx tsx scripts/decision-os-repair-imported-activity-league-ids.ts --apply    # perform repair
 */
import { PrismaClient } from '@prisma/client'
import { hasDatabaseUrl, resolveDatabaseUrl } from '../lib/env/database-url'
import { deriveActivityNaturalKey } from '../lib/decision-os/ingestion/importedActivityNormalizer'
import type { ImportProvider } from '../lib/league-import/types'
import type { ImportedActivityType } from '../lib/decision-os/ingestion/importedActivityNormalizer'

const APPLY = process.argv.includes('--apply')

/** Inverse of the normalizer's `esc` (see {@link deriveActivityNaturalKey}). */
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

/** The normalizer's `esc`, mirrored so the old prefix can be reconstructed exactly. */
function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/:/g, '\\:')
}

interface CandidateRow {
  id: string
  externalSourceKey: string
  provider: string
  providerLeagueId: string
  activityType: string
  platformLeagueId: string
}

interface Planned {
  id: string
  oldKey: string
  newKey: string
  providerLeagueId: string
  afLeagueId: string
}

type SkipReason = 'KEY_PREFIX_MISMATCH' | 'KEY_ROUNDTRIP_MISMATCH'

async function main(): Promise<void> {
  if (!hasDatabaseUrl()) {
    console.error('REFUSED: no DATABASE_URL resolved. Set it to the database you intend to repair.')
    process.exit(1)
  }

  // Report the target so an operator can confirm WHICH database is about to be repaired.
  // Host only — the URL carries credentials and must never be logged.
  const resolved = resolveDatabaseUrl() ?? ''
  const host = (/@([^/:?]+)/.exec(resolved)?.[1] ?? 'unknown').split('.')[0]
  console.log(`target db host: ${host}   mode: ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}\n`)

  const prisma = new PrismaClient()
  try {
    // ── Census BEFORE ────────────────────────────────────────────────────────────────────
    const before = await prisma.$queryRawUnsafe<Array<Record<string, bigint>>>(`
      SELECT count(*) AS total,
             count(*) FILTER (WHERE "afLeagueId" IS NULL) AS af_null,
             count(DISTINCT "providerLeagueId") AS distinct_provider_league_ids
      FROM decision_os_imported_activity
    `)
    const b = before[0]
    console.log('── census BEFORE ───────────────────────────────')
    console.log(`  rows=${b.total}  afLeagueId NULL=${b.af_null}  distinct providerLeagueId=${b.distinct_provider_league_ids}`)

    const joinBefore = await prisma.$queryRawUnsafe<Array<Record<string, bigint>>>(`
      SELECT count(DISTINCT a."providerLeagueId") FILTER (WHERE l.id IS NOT NULL) AS joins_canonical,
             count(DISTINCT a."providerLeagueId") FILTER (WHERE p.id IS NOT NULL) AS joins_platform
      FROM decision_os_imported_activity a
      LEFT JOIN leagues l ON l.id = a."providerLeagueId"
      LEFT JOIN leagues p ON p."platformLeagueId" = a."providerLeagueId"
    `)
    console.log(`  providerLeagueId joining leagues.id=${joinBefore[0].joins_canonical}  joining leagues.platformLeagueId=${joinBefore[0].joins_platform}`)

    // ── Candidates ───────────────────────────────────────────────────────────────────────
    const candidates = await prisma.$queryRawUnsafe<CandidateRow[]>(`
      SELECT a.id,
             a."externalSourceKey",
             a.provider,
             a."providerLeagueId",
             a."activityType",
             l."platformLeagueId"
      FROM decision_os_imported_activity a
      JOIN leagues l ON l.id = a."providerLeagueId"
      WHERE a."afLeagueId" IS NULL
        AND l."platformLeagueId" IS NOT NULL
        AND l."platformLeagueId" <> ''
      ORDER BY a.id
    `)
    console.log(`\n── repair plan ─────────────────────────────────`)
    console.log(`  candidate rows (afLeagueId NULL + providerLeagueId is a canonical League.id): ${candidates.length}`)

    const planned: Planned[] = []
    const skipped: Array<{ id: string; key: string; reason: SkipReason }> = []

    for (const row of candidates) {
      const oldPrefix = `dos:act:${esc(row.provider)}:${esc(row.providerLeagueId)}:${esc(row.activityType)}:`
      if (!row.externalSourceKey.startsWith(oldPrefix)) {
        skipped.push({ id: row.id, key: row.externalSourceKey, reason: 'KEY_PREFIX_MISMATCH' })
        continue
      }
      const escapedEventId = row.externalSourceKey.slice(oldPrefix.length)
      const providerEventId = unescapeSegment(escapedEventId)

      // Self-proof: re-deriving the OLD key from the recovered parts must reproduce it exactly.
      // If it does not, our understanding of this row's key is wrong — skip rather than guess.
      const rederivedOld = deriveActivityNaturalKey(
        row.provider as ImportProvider,
        row.providerLeagueId,
        row.activityType as ImportedActivityType,
        providerEventId,
      )
      if (rederivedOld !== row.externalSourceKey) {
        skipped.push({ id: row.id, key: row.externalSourceKey, reason: 'KEY_ROUNDTRIP_MISMATCH' })
        continue
      }

      // The NEW key is built by the real writer-side function → byte-identical to what the fixed
      // cron will derive on its next fire, which is what preserves idempotency.
      const newKey = deriveActivityNaturalKey(
        row.provider as ImportProvider,
        row.platformLeagueId,
        row.activityType as ImportedActivityType,
        providerEventId,
      )
      planned.push({
        id: row.id,
        oldKey: row.externalSourceKey,
        newKey,
        providerLeagueId: row.platformLeagueId,
        afLeagueId: row.providerLeagueId,
      })
    }

    console.log(`  repairable: ${planned.length}`)
    if (skipped.length > 0) {
      const byReason = skipped.reduce<Record<string, number>>((acc, s) => {
        acc[s.reason] = (acc[s.reason] ?? 0) + 1
        return acc
      }, {})
      console.log(`  SKIPPED (left untouched, never guessed): ${JSON.stringify(byReason)}`)
      for (const s of skipped.slice(0, 5)) console.log(`    - ${s.reason} id=${s.id} key=${s.key}`)
    }

    if (planned.length === 0) {
      console.log('\nNothing to repair. (A second run of this script is expected to reach here.)')
      return
    }

    // ── Pre-flight collision checks (before any write) ───────────────────────────────────
    const newKeys = planned.map((p) => p.newKey)
    const dupes = newKeys.filter((k, i) => newKeys.indexOf(k) !== i)
    if (dupes.length > 0) {
      console.error(`\nABORT: ${dupes.length} rewritten keys collide with each other (two AF leagues sharing one provider league id?).`)
      console.error(`  e.g. ${[...new Set(dupes)].slice(0, 3).join('\n       ')}`)
      process.exit(1)
    }

    const untouchedIds = planned.map((p) => p.id)
    const existing = await prisma.$queryRawUnsafe<Array<{ externalSourceKey: string }>>(
      `SELECT "externalSourceKey" FROM decision_os_imported_activity
       WHERE "externalSourceKey" = ANY($1::text[]) AND id <> ALL($2::text[])`,
      newKeys,
      untouchedIds,
    )
    if (existing.length > 0) {
      console.error(`\nABORT: ${existing.length} rewritten keys already exist on rows outside the repair set — repairing would violate the unique index.`)
      console.error(`  e.g. ${existing.slice(0, 3).map((e) => e.externalSourceKey).join('\n       ')}`)
      console.error(
        '\n  Most likely cause: the FIXED writer already ran (cron fires 07:00 UTC daily) and inserted\n' +
          '  correctly-keyed rows alongside the old mis-keyed ones. The old rows are now redundant\n' +
          '  DUPLICATES of the new ones rather than rows to rewrite — deleting them is the correct\n' +
          '  repair at that point, not this rewrite. Nothing has been written; re-census and decide\n' +
          '  deliberately before proceeding.',
      )
      process.exit(1)
    }
    console.log('  pre-flight: no key collisions (self or pre-existing) ✓')

    const sample = planned[0]
    console.log('\n  sample rewrite:')
    console.log(`    providerLeagueId : ${sample.afLeagueId}  →  ${sample.providerLeagueId}`)
    console.log(`    afLeagueId       : NULL  →  ${sample.afLeagueId}`)
    console.log(`    externalSourceKey: ${sample.oldKey}`)
    console.log(`                     → ${sample.newKey}`)

    if (!APPLY) {
      console.log(`\nDRY RUN — no write performed. ${planned.length} rows would be repaired.`)
      console.log('Re-run with --apply to perform the repair.')
      console.log('DOS_IMPORTED_ACTIVITY_REPAIR_DRY_RUN_OK')
      return
    }

    // ── Apply, in ONE transaction ───────────────────────────────────────────────────────
    console.log(`\nApplying repair to ${planned.length} rows in a single transaction…`)
    const updated = await prisma.$transaction(
      async (tx) => {
        let n = 0
        for (const p of planned) {
          const r = await tx.$executeRawUnsafe(
            `UPDATE decision_os_imported_activity
             SET "providerLeagueId" = $1, "afLeagueId" = $2, "externalSourceKey" = $3, "updatedAt" = now()
             WHERE id = $4 AND "afLeagueId" IS NULL`,
            p.providerLeagueId,
            p.afLeagueId,
            p.newKey,
            p.id,
          )
          n += r
        }
        return n
      },
      { timeout: 300_000 },
    )
    console.log(`  rows updated: ${updated}`)

    // ── Census AFTER ────────────────────────────────────────────────────────────────────
    const after = await prisma.$queryRawUnsafe<Array<Record<string, bigint>>>(`
      SELECT count(*) AS total,
             count(*) FILTER (WHERE "afLeagueId" IS NULL) AS af_null,
             count(DISTINCT "providerLeagueId") AS distinct_provider_league_ids,
             count(DISTINCT "afLeagueId") AS distinct_af_league_ids
      FROM decision_os_imported_activity
    `)
    const a = after[0]
    console.log('\n── census AFTER ────────────────────────────────')
    console.log(`  rows=${a.total}  afLeagueId NULL=${a.af_null}  distinct providerLeagueId=${a.distinct_provider_league_ids}  distinct afLeagueId=${a.distinct_af_league_ids}`)

    const joinAfter = await prisma.$queryRawUnsafe<Array<Record<string, bigint>>>(`
      SELECT count(DISTINCT a."providerLeagueId") FILTER (WHERE p.id IS NOT NULL) AS provider_joins_platform,
             count(DISTINCT a."afLeagueId") FILTER (WHERE l.id IS NOT NULL) AS af_joins_canonical
      FROM decision_os_imported_activity a
      LEFT JOIN leagues p ON p."platformLeagueId" = a."providerLeagueId"
      LEFT JOIN leagues l ON l.id = a."afLeagueId"
    `)
    console.log(`  providerLeagueId joining leagues.platformLeagueId=${joinAfter[0].provider_joins_platform}  afLeagueId joining leagues.id=${joinAfter[0].af_joins_canonical}`)
    console.log('\nDOS_IMPORTED_ACTIVITY_REPAIR_OK')
  } finally {
    await prisma.$disconnect().catch(() => undefined)
  }
}

main().catch((error) => {
  console.error('REPAIR FAILED:', error instanceof Error ? error.message : error)
  process.exit(1)
})
