/**
 * ONE-TIME: re-price every existing v1 completed-trade original at the time of its trade (Decision 2,
 * Guap 2026-10-03). Plan and report: `lib/decision-os/trade/repriceFrozenTradeGrades.ts`. Grading:
 * `completedTradeGrade.repriceFrozenOriginalAtTradeTime` — the same grader every new freeze uses. A v1
 * row frozen within a day after its trade is CARRIED (letter unchanged), never re-priced.
 *
 *   ALLOW_PROD_READONLY=1 npx tsx --conditions=react-server scripts/reprice-frozen-trade-grades-at-trade-time.ts
 *       DRY RUN (the default). Reads only, and prints per-pair old letter → new letter, the counts, and
 *       which changed pairs were emailed.
 *
 *   ALLOW_PROD_MIGRATION=1 npx tsx --conditions=react-server scripts/reprice-frozen-trade-grades-at-trade-time.ts --apply
 *       Writes the v2 rows, all in ONE transaction. Appends only: v1 rows are never updated or
 *       deleted, and a pair that already has a v2 row is skipped, so a re-run writes nothing twice.
 *
 * (`--conditions=react-server` lets the grader's `server-only` imports load outside Next.js.)
 *
 * 🛑 WHAT KEEPS A DRY RUN READ-ONLY, BECAUSE THE GRADER IS APP CODE ON THE SHARED PRISMA CLIENT:
 *   - this script's own reads run inside `BEGIN READ ONLY` on a `pg` client;
 *   - the app's Prisma client is pointed at the DIRECT endpoint with
 *     `options=-c default_transaction_read_only=on`, and the run REFUSES unless that client reports
 *     `transaction_read_only = on` — so Postgres itself rejects any write the grader might attempt;
 *   - the grader is built `marketless`: today's FantasyCalc chart (and the live fetch behind it) and
 *     the league's defender board are never loaded;
 *   - a pair with a player who has no `sports_players` row is skipped BEFORE grading: `getPlayer`
 *     answers a miss by queueing a provider importer run, which a re-price job must never trigger.
 * Credentials are never printed — targets are described as `endpoint/database`.
 */
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { Client } from 'pg'
import {
  describeDbTarget,
  findRepoRoot,
  identifyDbTarget,
  readEnvFile,
} from './_db-target-identity'

const APPLY = process.argv.includes('--apply')
const SCRIPT = 'reprice-frozen-trade-grades'
const V1 = 'completed_trade_grade_v1'
const V2 = 'completed_trade_grade_v2'
const NAMESPACE = 'system:completed-trade-grade'

const redact = (s: unknown) => String(s).replace(/postgres(ql)?:\/\/[^\s'"]+/g, 'postgres://[REDACTED]')

function resolveUrl(): string | undefined {
  if (process.env.DIRECT_URL || process.env.DATABASE_URL) return process.env.DIRECT_URL || process.env.DATABASE_URL
  const root = findRepoRoot()
  for (const dir of [root, path.resolve(root, '..', 'allfantasy-v2-main')]) {
    const env = { ...readEnvFile(path.join(dir, '.env')), ...readEnvFile(path.join(dir, '.env.local')) }
    if (env.DIRECT_URL || env.DATABASE_URL) return env.DIRECT_URL || env.DATABASE_URL
  }
  return undefined
}

/** The same URL, every session read-only at the server. Exported shape for the test. */
export function readOnlyUrl(url: string): string {
  const u = new URL(url)
  u.searchParams.set('options', '-c default_transaction_read_only=on')
  return u.toString()
}

async function main() {
  const url = resolveUrl()
  const target = identifyDbTarget(url)
  console.log(`[${SCRIPT}] target: ${describeDbTarget(url)} · mode: ${APPLY ? 'APPLY' : 'dry run'}`)
  if (!url || target.kind === 'unknown' || target.kind === 'unparseable') throw new Error('refusing: the database target is not positively identified')
  if (target.kind === 'production') {
    if (APPLY && process.env.ALLOW_PROD_MIGRATION !== '1') throw new Error('refusing: --apply on PRODUCTION needs ALLOW_PROD_MIGRATION=1')
    if (!APPLY && process.env.ALLOW_PROD_READONLY !== '1') throw new Error('refusing: a dry run against PRODUCTION needs ALLOW_PROD_READONLY=1')
  }

  // Every connection the grader opens is read-only at the server, in BOTH modes: the writes happen
  // later, on a separate client, only after the plan is complete.
  const ro = readOnlyUrl(url)
  process.env.DATABASE_URL = ro
  process.env.DIRECT_URL = ro
  const { prisma } = await import('@/lib/prisma')
  const roCheck = await prisma.$queryRawUnsafe<Array<{ transaction_read_only: string }>>('SHOW transaction_read_only')
  if (roCheck[0]?.transaction_read_only !== 'on') throw new Error('refusing: the grader’s database client is not read-only')
  console.log(`[${SCRIPT}] grader client transaction_read_only = on`)

  const { createLeagueTradeGrader } = await import('@/lib/decision-os/trade/leagueTradeGrader')
  const {
    archivedTradeInputs, completedTradeInputs, completedTradeInputsAtTradeTime, repriceFrozenOriginalAtTradeTime,
  } = await import('@/lib/decision-os/trade/completedTradeGrade')
  const { gradedAtTradeTime, tradeTimeOf } = await import('@/lib/decision-os/trade/tradeTimeCapture')
  const { planFrozenGradeReprice } = await import('@/lib/decision-os/trade/repriceFrozenTradeGrades')
  type GradedTrade = import('@/lib/trade-intel/sleeperTradeGradeService').GradedTrade
  type V1Row = import('@/lib/decision-os/trade/frozenCompletedGrade').FrozenCompletedGradeV1

  const db = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await db.connect()
  let plan: Awaited<ReturnType<typeof planFrozenGradeReprice>>
  try {
    await db.query('BEGIN READ ONLY')
    await db.query("SET LOCAL statement_timeout = '120s'")
    const roRead = await db.query('SHOW transaction_read_only')
    if (roRead.rows[0]?.transaction_read_only !== 'on') throw new Error('refusing: the read transaction is not read-only')

    const v1 = await db.query<{ leagueId: string; contextKey: string; payloadJson: V1Row }>(
      `SELECT "leagueId", "contextKey", "payloadJson" FROM "trade_analysis_snapshots"
        WHERE "sleeperUsername" = $1 AND "snapshotType" = $2 AND "contextKey" IS NOT NULL ORDER BY "createdAt" ASC`, [NAMESPACE, V1])
    const pairs: Array<{ afLeagueId: string; tradeId: string; row: V1Row }> = []
    const seen = new Set<string>()
    for (const r of v1.rows) {
      const k = `${r.leagueId}:${r.contextKey}`
      const p = r.payloadJson
      if (seen.has(k) || p?.v !== 1 || !p.grade?.graded || !Array.isArray(p.give) || !Array.isArray(p.get)) continue
      seen.add(k) // earliest wins, as every reader does
      pairs.push({ afLeagueId: r.leagueId, tradeId: r.contextKey, row: p })
    }
    const v2 = await db.query<{ k: string }>(
      `SELECT DISTINCT "leagueId" || ':' || "contextKey" AS k FROM "trade_analysis_snapshots" WHERE "sleeperUsername" = $1 AND "snapshotType" = $2`, [NAMESPACE, V2])
    const hasV2 = new Set(v2.rows.map((r) => r.k))
    const txIds = [...new Set(pairs.map((p) => p.tradeId))]

    const leagues = await db.query<{ id: string; platformLeagueId: string | null }>(
      `SELECT id, "platformLeagueId" FROM "leagues" WHERE id = ANY($1)`, [[...new Set(pairs.map((p) => p.afLeagueId))]])
    const platformOf = new Map(leagues.rows.map((l) => [l.id, l.platformLeagueId]))

    // The graded ledger: each trade by its Sleeper transaction id (the last segment of the ledger id).
    const ledger = await db.query<{ trade: GradedTrade }>(
      `SELECT t AS trade FROM "SportsDataCache" c, jsonb_array_elements(c.data->'trades') t
        WHERE c."key" LIKE 'trade-grades:v2:%' AND jsonb_typeof(c.data->'trades') = 'array'
          AND reverse(split_part(reverse(t->>'id'), ':', 1)) = ANY($1)`, [txIds])
    const ledgerByTx = new Map<string, GradedTrade>()
    for (const r of ledger.rows) {
      const tx = String(r.trade.id).split(':').pop()!
      if (!ledgerByTx.has(tx)) ledgerByTx.set(tx, r.trade)
    }
    // The archive, for trades the ledger does not carry.
    const archived = await db.query<{ transactionId: string; playersGiven: unknown; playersReceived: unknown; picksGiven: unknown; picksReceived: unknown; tradeDate: Date | null }>(
      `SELECT "transactionId", "playersGiven", "playersReceived", "picksGiven", "picksReceived", "tradeDate" FROM "LeagueTrade" WHERE "transactionId" = ANY($1)`, [txIds])
    const archivedByTx = new Map<string, (typeof archived.rows)[number]>()
    for (const r of archived.rows) if (!archivedByTx.has(r.transactionId)) archivedByTx.set(r.transactionId, r)

    const ids = (v: unknown) => (Array.isArray(v) ? v.map(String) : [])
    const allPlayerIds = new Set<string>()
    for (const t of ledgerByTx.values()) for (const s of t.sides) for (const p of [...s.playersIn, ...s.playersOut]) allPlayerIds.add(p.playerId)
    for (const r of archivedByTx.values()) for (const id of [...ids(r.playersGiven), ...ids(r.playersReceived)]) allPlayerIds.add(id)
    const players = await db.query<{ id: string; name: string }>(`SELECT id, name FROM "sports_players" WHERE id = ANY($1)`, [[...allPlayerIds].map((id) => `NFL:${id}`)])
    const nameOf = new Map(players.rows.map((r) => [r.id.slice(4), r.name]))

    // Completion emails sent (`trade-notify:sent:v1:<league>:<kind>:<tradeId>:<channel>:<user>`, 30-day rows).
    const sent = await db.query<{ key: string }>(`SELECT "key" FROM "SportsDataCache" WHERE "key" LIKE 'trade-notify:sent:v1:%:completion:%:email:%'`)
    const emailed = new Set<string>()
    for (const r of sent.rows) {
      const parts = r.key.slice('trade-notify:sent:v1:'.length).split(':')
      const ci = parts.lastIndexOf('email')
      if (ci > 2) emailed.add(parts[ci - 1]!)
    }

    await db.query('ROLLBACK')
    console.log(`[${SCRIPT}] read: v1 pairs ${pairs.length} · v2 pairs ${hasV2.size} · ledger trades ${ledgerByTx.size} · archived trades ${archivedByTx.size} · emailed completions ${emailed.size}`)

    const currentSeason = new Date().getUTCFullYear()
    const graders = new Map<string, ReturnType<typeof createLeagueTradeGrader>>()
    const graderFor = (leagueId: string) => {
      let g = graders.get(leagueId)
      if (!g) {
        g = createLeagueTradeGrader({ leagueId, marketless: true }).catch(() => null)
        graders.set(leagueId, g)
      }
      return g
    }

    plan = await planFrozenGradeReprice({
      pairs,
      hasV2,
      emailed,
      now: new Date(),
      reprice: async (pair) => {
        const t = ledgerByTx.get(pair.tradeId)
        const a = t ? null : archivedByTx.get(pair.tradeId)
        // A v1 frozen within a day after its trade is carried as it stands — nothing to grade or look up.
        const when = t ? tradeTimeOf({ completedAt: t.createdIso, tradeId: t.id }) : tradeTimeOf({ tradeId: pair.tradeId })
        if (gradedAtTradeTime(when, new Date(pair.row.frozenAt))) return { kind: 'carried', tradeAt: when!.toISOString() }
        const playerIds = t
          ? t.sides.flatMap((s) => [...s.playersIn, ...s.playersOut].map((p) => p.playerId))
          : a ? [...ids(a.playersGiven), ...ids(a.playersReceived)] : []
        if (playerIds.some((id) => !nameOf.has(id))) return { kind: 'skip', why: 'a player has no sports_players row (grading would queue an importer)' }
        if (!platformOf.has(pair.afLeagueId)) return { kind: 'skip', why: 'the AF league row is gone' }
        let deal: Parameters<typeof repriceFrozenOriginalAtTradeTime>[0]['deal'] = null
        let tradeAt: Date | null = null
        if (t) {
          const today = completedTradeInputs(t, currentSeason)
          const atTradeTime = completedTradeInputsAtTradeTime(t)
          deal = today && atTradeTime ? { today, atTradeTime } : null
          tradeAt = tradeTimeOf({ completedAt: t.createdIso, tradeId: t.id })
        } else if (a) {
          const picks = (v: unknown) => (Array.isArray(v) ? v : []).map((p: { season?: unknown; round?: unknown }) => ({
            season: (p?.season as string | number | null) ?? null, round: typeof p?.round === 'number' ? p.round : null, label: `${p?.season} round ${p?.round}`,
          }))
          deal = archivedTradeInputs({
            received: ids(a.playersReceived).map((id) => ({ name: nameOf.get(id) ?? null, sleeperId: id })),
            gave: ids(a.playersGiven).map((id) => ({ name: nameOf.get(id) ?? null, sleeperId: id })),
            picksIn: picks(a.picksReceived), picksOut: picks(a.picksGiven), currentSeason,
          })
          tradeAt = tradeTimeOf({ tradeId: pair.tradeId })
        }
        return repriceFrozenOriginalAtTradeTime({ grader: await graderFor(pair.afLeagueId), row: pair.row, deal, tradeAt })
      },
    })
  } finally {
    await db.end().catch(() => undefined)
  }

  const r = plan.report
  console.log('\nper pair (league · trade · outcome · old → new · why):')
  for (const x of r.perPair) console.log(`  ${x.afLeagueId} · ${x.tradeId} · ${x.outcome} · ${x.from} → ${x.to ?? '—'}${x.why ? ` · ${x.why}` : ''}`)
  console.log('\nchanged letters:')
  for (const c of r.changes) {
    console.log(`  ${c.afLeagueId} · ${c.tradeId} · ${c.from} → ${c.to} (priced ${c.pricedAsOf}; v1 frozen ${c.v1FrozenAt.slice(0, 16)})${c.emailed ? ' · EMAILED' : ''}`)
  }
  console.log(`\nSUMMARY ${JSON.stringify({
    pairs: r.pairs, alreadyV2: r.alreadyV2, carried: r.carried, tradeDate: r.tradeDate, sameLetter: r.sameLetter, changedLetter: r.changedLetter,
    changedAndEmailed: r.changedAndEmailed, firstGraded: r.firstGraded, firstGradedWhy: r.firstGradedWhy, skipped: r.skipped, skippedWhy: r.skippedWhy,
    v2RowsToWrite: plan.rows.length,
  }, null, 1)}`)

  if (!APPLY) {
    console.log(`\n[${SCRIPT}] dry run: nothing written. Re-run with --apply to write ${plan.rows.length} v2 rows.`)
    return
  }
  const w = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await w.connect()
  try {
    await w.query('BEGIN')
    // Idempotent under a concurrent run too: re-check inside the write transaction.
    const existing = await w.query<{ k: string }>(
      `SELECT DISTINCT "leagueId" || ':' || "contextKey" AS k FROM "trade_analysis_snapshots" WHERE "sleeperUsername" = $1 AND "snapshotType" = $2`, [NAMESPACE, V2])
    const already = new Set(existing.rows.map((x) => x.k))
    let written = 0
    for (const row of plan.rows) {
      if (already.has(`${row.afLeagueId}:${row.v2.tradeId}`)) continue
      await w.query(
        `INSERT INTO "trade_analysis_snapshots" ("id", "leagueId", "sleeperUsername", "snapshotType", "contextKey", "payloadJson", "expiresAt")
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, NULL)`,
        [randomUUID(), row.afLeagueId, NAMESPACE, V2, row.v2.tradeId, JSON.stringify(row.v2)])
      written += 1
    }
    await w.query('COMMIT')
    console.log(`[${SCRIPT}] APPLIED: ${written} v2 rows written in one transaction.`)
  } catch (e) {
    await w.query('ROLLBACK').catch(() => undefined)
    throw e
  } finally {
    await w.end().catch(() => undefined)
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`[${SCRIPT}] ${redact(e instanceof Error ? e.message : e)}`)
    process.exit(1)
  })
