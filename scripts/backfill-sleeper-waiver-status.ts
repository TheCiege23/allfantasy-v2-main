/**
 * One-off backfill: Sleeper's `status_updated` onto the waiver claims we already hold.
 *
 *   node --require ./scripts/_audit-preload.cjs --import tsx scripts/backfill-sleeper-waiver-status.ts \
 *     --target=<endpoint>/<database> [--plan | --apply] [--limit=N] [--concurrency=N]
 *
 * WHY. From #1905 the transaction sync stores `statusUpdatedAt` (when Sleeper RESOLVED a claim), and
 * lib/waivers/observedWaiverSchedule.ts reads each Sleeper league's waiver schedule off it. But the
 * sync only re-reads the last two weeks of a season it already holds — `force` does not change that
 * — so without this a weekly league would need ~three weeks of new runs before its schedule showed.
 *
 * WHAT IT WRITES — DELIBERATELY THE LEAST IT CAN:
 * - Current NFL season only, weeks 1..current, Sleeper NFL leagues that already hold waiver rows.
 * - One key, merged in: `payload = payload || {"statusUpdatedAt": …}` on rows whose id the sync's own
 *   `buildTransactionFacts` produces. It never INSERTS a row (a missing claim is the sync's job), never
 *   rewrites any other field, and skips rows that already carry the same value — so it is idempotent.
 * - Waiver rows only.
 *
 * SAFETY. `--target=<endpoint>/<database>` must equal what DATABASE_URL resolves to
 * (scripts/db-target-identity.cjs — credential-free), or nothing runs. `--plan` reads counts and makes one
 * Sleeper state read — no transaction reads, no writes. Ingestion by nature: the Sleeper reads go through lib/sleeper-client like the sync's.
 */
import { createRequire } from 'node:module'

import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { getLeagueTransactions, getNflState, type SleeperTransaction } from '@/lib/sleeper-client'
import { buildTransactionFacts } from '@/lib/league-import/sleeper/SleeperHistoricalTransactionSyncService'

const require = createRequire(import.meta.url)
const { identifyTarget, describeTarget } = require('./db-target-identity.cjs') as {
  identifyTarget: (url: string) => { kind: string; endpoint: string | null; database: string | null }
  describeTarget: (url: string) => string
}

const arg = (name: string): string | null => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}
const flag = (name: string) => process.argv.includes(`--${name}`)

/** One claim's resolution, against every fact row the sync keyed for it. */
export type StatusUpdate = { transactionId: string; statusUpdatedAt: string }

/** The rows to touch for one week's feed: completed waiver claims carrying `status_updated`. Pure. */
export function statusUpdatesFor(txs: readonly SleeperTransaction[], internalLeagueId: string, season: number): StatusUpdate[] {
  const out: StatusUpdate[] = []
  for (const tx of txs) {
    if (tx?.type !== 'waiver' || tx.status !== 'complete') continue
    if (typeof tx.status_updated !== 'number' || !Number.isFinite(tx.status_updated) || tx.status_updated <= 0) continue
    const at = new Date(tx.status_updated).toISOString()
    for (const f of buildTransactionFacts({ tx, internalLeagueId, sport: 'NFL', season })) {
      out.push({ transactionId: f.transactionId, statusUpdatedAt: at })
    }
  }
  return out
}

async function main() {
  const url = process.env.DATABASE_URL ?? ''
  const target = arg('target')
  const t = identifyTarget(url)
  console.log(`[backfill] DATABASE_URL resolves to ${describeTarget(url)}`)
  if (!target || target !== `${t.endpoint}/${t.database}`) {
    console.error(`[backfill] REFUSING: --target=${target ?? '(missing)'} does not name the resolved target. Nothing ran.`)
    process.exit(2)
  }
  const apply = flag('apply')
  if (apply === flag('plan')) {
    console.error('[backfill] REFUSING: pass exactly one of --plan or --apply.')
    process.exit(2)
  }
  const limit = Number(arg('limit') ?? '0') || 0
  const concurrency = Math.max(1, Math.min(8, Number(arg('concurrency') ?? '4') || 4))

  const state = await getNflState()
  const season = Number(state?.season)
  const week = Number(state?.week)
  if (!Number.isInteger(season) || !Number.isInteger(week) || week < 1) {
    console.error('[backfill] REFUSING: Sleeper NFL state unreadable — an unknown week is not a range to write.')
    process.exit(3)
  }
  const lastWeek = Math.min(week, 18)

  /* Sleeper NFL leagues that already hold current-season waiver rows — one per real league. */
  const rows = await prisma.$queryRaw<Array<{ leagueId: string; platformLeagueId: string; claims: number; stamped: number }>>(Prisma.sql`
    SELECT l.id AS "leagueId", l."platformLeagueId",
           count(*)::int AS claims,
           count(*) FILTER (WHERE f.payload ? 'statusUpdatedAt' AND f.payload->>'statusUpdatedAt' IS NOT NULL)::int AS stamped
    FROM "dw_transaction_facts" f
    JOIN "leagues" l ON l.id = f."leagueId"
    WHERE f.type = 'waiver' AND f.season = ${season}
      AND l.platform = 'sleeper' AND l."platformLeagueId" IS NOT NULL
      AND upper(coalesce(l.sport::text, 'NFL')) = 'NFL'
    GROUP BY l.id, l."platformLeagueId"
    ORDER BY l.id
  `)
  const byPlatform = new Map<string, { leagueId: string; platformLeagueId: string }>()
  for (const r of rows) if (!byPlatform.has(r.platformLeagueId)) byPlatform.set(r.platformLeagueId, r)
  let leagues = [...byPlatform.values()]
  if (limit > 0) leagues = leagues.slice(0, limit)

  const claims = rows.reduce((n, r) => n + r.claims, 0)
  const stamped = rows.reduce((n, r) => n + r.stamped, 0)
  console.log(
    `[backfill] season ${season}, weeks 1-${lastWeek}: ${rows.length} AF rows / ${byPlatform.size} real leagues hold ` +
      `${claims} waiver fact rows, ${stamped} already stamped. This run: ${leagues.length} leagues, ` +
      `${leagues.length * lastWeek} Sleeper reads.`,
  )
  if (!apply) {
    console.log('[backfill] --plan: one Sleeper state read, no transaction reads, nothing written.')
    return
  }

  let reads = 0
  let failedReads = 0
  let candidates = 0
  let updated = 0
  const queue = [...leagues]
  const worker = async () => {
    for (let l = queue.shift(); l; l = queue.shift()) {
      const updates: StatusUpdate[] = []
      for (let w = 1; w <= lastWeek; w++) {
        reads++
        try {
          const txs = await getLeagueTransactions(l.platformLeagueId, w, { strict: true })
          updates.push(...statusUpdatesFor(txs ?? [], l.leagueId, season))
        } catch {
          failedReads++
        }
      }
      candidates += updates.length
      if (updates.length === 0) continue
      const n = await prisma.$executeRaw(Prisma.sql`
        UPDATE "dw_transaction_facts" AS f
        SET payload = f.payload || jsonb_build_object('statusUpdatedAt', v.ts)
        FROM (
          SELECT unnest(${updates.map((u) => u.transactionId)}::text[]) AS id,
                 unnest(${updates.map((u) => u.statusUpdatedAt)}::text[]) AS ts
        ) AS v
        WHERE f."transactionId" = v.id
          AND f.type = 'waiver'
          AND (f.payload->>'statusUpdatedAt') IS DISTINCT FROM v.ts
      `)
      updated += n
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  console.log(
    `[backfill] DONE: ${reads} Sleeper reads (${failedReads} failed), ${candidates} resolved-claim rows seen, ` +
      `${updated} rows stamped.`,
  )
}

/* Only when run directly — the test imports `statusUpdatesFor` without starting a backfill. */
if (process.argv[1] && /backfill-sleeper-waiver-status/.test(process.argv[1])) {
  main()
    .catch((e) => {
      console.error('[backfill] FAILED:', e instanceof Error ? e.message : e)
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect().catch(() => undefined))
}
