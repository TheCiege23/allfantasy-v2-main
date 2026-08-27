#!/usr/bin/env node
/**
 * Apply ONLY the franchise-link migration, in a transaction.
 *
 * ⚠ WHY NOT `prisma migrate deploy`. Checked against production 2026-08-26:
 * NINE migrations are pending and EIGHT of them are not this one — including
 * another session's `20260826150000_trade_draft`. `migrate deploy` would apply
 * all nine, so unrelated schema changes would land on prod as a side effect of
 * linking two leagues. The local history has also diverged: four migrations
 * exist in the database that are not in prisma/migrations at all.
 *
 * ⚠ THIS MIGRATION IS PURELY ADDITIVE — four CREATE TABLEs, seven indexes and
 * three foreign keys that all point at the new tables. It does not touch a
 * single existing table, which is what makes applying it surgically safe.
 *
 * Safety properties:
 *   1. One transaction — any failure rolls the whole thing back.
 *   2. Table count captured before and after; only the four new tables may appear.
 *   3. Refuses to run twice — checks for the tables first.
 *   4. Records the migration in `_prisma_migrations` so later tooling does not
 *      try to re-create the tables and fail the whole batch.
 *   5. The connection string is read from the env file and never printed.
 *
 * Usage:
 *   node scripts/apply-franchise-link-migration.mjs --env=local            # dry run
 *   node scripts/apply-franchise-link-migration.mjs --env=local --apply    # commit
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import process from 'node:process'
import pg from 'pg'

const MIGRATION = '20260826150000_franchise_cross_platform_link'
const NEW_TABLES = [
  'franchise_links',
  'franchise_league_members',
  'cross_platform_trades',
  'cross_platform_trade_legs',
]

const ENV_FILES = { local: '.env.local', test: '.env.test', env: '.env' }

function fail(msg) {
  console.error(`\nABORTED — ${msg}`)
  process.exitCode = 1
}

function readUrl(envKey) {
  const file = ENV_FILES[envKey]
  if (!file) throw new Error(`unknown --env=${envKey}`)
  const candidates = [path.resolve(process.cwd(), file), path.resolve('F:/allfantasy-v2-main', file)]
  const src = candidates.find((p) => fs.existsSync(p))
  if (!src) throw new Error(`${file} not found`)
  const body = fs.readFileSync(src, 'utf8')
  const m = body.match(/^DIRECT_URL=(.*)$/m) || body.match(/^DATABASE_URL=(.*)$/m)
  if (!m) throw new Error(`no DIRECT_URL or DATABASE_URL in ${file}`)
  return m[1].trim().replace(/^["']|["']$/g, '')
}

async function main() {
  const envArg = (process.argv.find((a) => a.startsWith('--env=')) || '--env=local').slice(6)
  const apply = process.argv.includes('--apply')

  const url = readUrl(envArg)
  const sqlPath = path.resolve(process.cwd(), `prisma/migrations/${MIGRATION}/migration.sql`)
  if (!fs.existsSync(sqlPath)) return fail(`migration file not found: ${sqlPath}`)
  const sql = fs.readFileSync(sqlPath, 'utf8')

  const client = new pg.Client({ connectionString: url })
  await client.connect()

  try {
    const dbName = (await client.query('SELECT current_database() AS db')).rows[0].db
    const hostLabel = (url.match(/@([^.]+)/) || [, 'unknown'])[1]
    console.log(`target       : ${dbName} @ ${hostLabel}`)
    console.log(`mode         : ${apply ? 'APPLY' : 'DRY RUN (rolls back)'}`)

    const countTables = async () =>
      (
        await client.query(
          `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'`,
        )
      ).rows[0].n

    const before = await countTables()
    console.log(`tables before: ${before}`)

    const existing = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1)`,
      [NEW_TABLES],
    )
    if (existing.rows.length > 0) {
      return fail(
        `already applied — these tables exist: ${existing.rows.map((r) => r.table_name).join(', ')}`,
      )
    }

    await client.query('BEGIN')
    await client.query(sql)

    /*
     * Record it so a later `migrate deploy` skips this one rather than trying to
     * re-create the tables and failing the whole batch.
     */
    const checksum = crypto.createHash('sha256').update(sql).digest('hex')
    await client.query(
      `INSERT INTO "_prisma_migrations"
         (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES ($1, $2, now(), $3, NULL, NULL, now(), 1)`,
      [crypto.randomUUID(), checksum, MIGRATION],
    )

    const after = await countTables()
    const created = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1) ORDER BY table_name`,
      [NEW_TABLES],
    )

    console.log(`tables after : ${after} (delta ${after - before})`)
    console.log(`created      : ${created.rows.map((r) => r.table_name).join(', ')}`)

    if (after - before !== NEW_TABLES.length) {
      await client.query('ROLLBACK')
      return fail(`expected exactly ${NEW_TABLES.length} new tables, saw ${after - before}. Rolled back.`)
    }

    if (apply) {
      await client.query('COMMIT')
      console.log('\nCOMMITTED.')
    } else {
      await client.query('ROLLBACK')
      console.log('\nDRY RUN — rolled back, nothing changed.')
    }
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {}
    const raw = String(err && err.message ? err.message : err)
    return fail(raw.split(url).join('<redacted>'))
  } finally {
    await client.end()
  }
}

main().catch((err) => fail(String(err && err.message ? err.message : err)))
