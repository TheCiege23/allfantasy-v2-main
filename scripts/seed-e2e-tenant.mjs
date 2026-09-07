#!/usr/bin/env node
/**
 * Seed the default Tenant row into a CI/e2e database.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 *
 * `League.tenantId` is `String @default("allfantasy")` with a foreign key to
 * `Tenant.id`. CI builds its database with `npx prisma db push`, which creates
 * the SCHEMA and nothing else — no migrations, no seed — so `Tenant` is empty
 * and EVERY league creation fails:
 *
 *     Foreign key constraint violated: `leagues_tenantId_fkey (index)`
 *     {"modelName":"League","field_name":"leagues_tenantId_fkey (index)"}
 *
 * Production is unaffected and always was: its `allfantasy` tenant row was
 * created 2026-08-31 and is ACTIVE (verified by query, not assumed). This is a
 * gap between how production got its row — by hand — and how CI builds a
 * database from nothing. `db push` will never close it, because the row is data.
 *
 * Measured on Playwright run 34079951628: the three `core` shards failed while
 * the other four lanes passed, and the seed for `decision-os-league-home-proof`
 * died on exactly this constraint.
 *
 * ── WHY A SCRIPT, AND WHY NOT IN e2e/global-setup.ts ─────────────────────────
 *
 * 🛑 global-setup runs LOCALLY TOO, where `.env` / `.env.local` point at
 * PRODUCTION. A database WRITE in the suite's setup path is precisely what
 * `vitest.setup.db-guard.ts` exists to prevent, and putting one there would
 * reintroduce it for Playwright. Keeping the write in a CI step, against a URL
 * the workflow states literally, confines it to a database the workflow just
 * created.
 *
 * ── FAILS CLOSED, UNLIKE MOST GUARDS IN THIS REPO ────────────────────────────
 *
 * The cost/ordering guards here fail open because stranding a deploy is worse
 * than the cost they save. This is the opposite case: it WRITES. A write aimed
 * at the wrong database cannot be undone by exiting 0, so a non-local target is
 * refused outright rather than attempted.
 */

import { Client } from 'pg'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const TENANT_ID = 'allfantasy'
const TENANT_NAME = 'AllFantasy'

/** Only ever a database this workflow stood up itself. */
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

function fail(msg) {
  process.stderr.write(`\n  🛑 seed-e2e-tenant: ${msg}\n\n`)
  process.exit(1)
}

const url = process.env.DATABASE_URL || ''
if (!url) fail('DATABASE_URL is not set. Refusing to guess a target.')

let host = ''
try {
  host = new URL(url).hostname
} catch {
  fail('DATABASE_URL is not a parseable URL.')
}

if (!LOCAL_HOSTS.has(host)) {
  fail(
    `refusing to write to a non-local database (host "${host}").\n` +
      `     This script seeds a throwaway CI database and must never touch a\n` +
      `     remote one. There is deliberately no override flag.`,
  )
}

/*
 * ⚠ DRIFT CONTROL. The id below is a SECOND copy of a value whose source of
 * truth is the schema's `@default`. Two copies of one rule is the bug this repo
 * keeps recording, so rather than trusting the comment, assert it: if someone
 * changes the default and not this file, the seed inserts a tenant nothing
 * references and every league create still fails — with the seed reporting
 * success. Cheaper to check than to debug.
 */
try {
  const here = dirname(fileURLToPath(import.meta.url))
  const schema = readFileSync(join(here, '..', 'prisma', 'schema.prisma'), 'utf8')
  const m = schema.match(/tenantId\s+String\s+@default\("([^"]+)"\)/)
  if (!m) {
    fail('could not find `tenantId String @default("…")` in prisma/schema.prisma.')
  } else if (m[1] !== TENANT_ID) {
    fail(
      `schema default is "${m[1]}" but this script seeds "${TENANT_ID}".\n` +
        `     Update TENANT_ID here to match, or the FK will still be violated.`,
    )
  }
} catch (err) {
  if (err?.code === 'ENOENT') fail('prisma/schema.prisma not found.')
  throw err
}

const client = new Client({ connectionString: url })

try {
  await client.connect()

  // `updatedAt` is `@updatedAt`, which Prisma fills in the CLIENT — at SQL level
  // the column is NOT NULL with no default, so a raw insert has to supply it.
  await client.query(
    `INSERT INTO "Tenant" (id, slug, name, "updatedAt")
     VALUES ($1, $1, $2, NOW())
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_ID, TENANT_NAME],
  )

  /*
   * 🛑 READ IT BACK. `ON CONFLICT DO NOTHING` reports success when it inserts
   * nothing, and so does an insert into a table some earlier step dropped. The
   * only thing that answers "can a league be created now" is the row being
   * there, so assert that rather than the command's exit status — the standing
   * rule in CLAUDE.md about checks that cannot fail.
   */
  const { rows } = await client.query(`SELECT id, slug FROM "Tenant" WHERE id = $1`, [TENANT_ID])
  if (rows.length !== 1) {
    fail(`insert reported success but "Tenant" has no row with id "${TENANT_ID}".`)
  }

  process.stdout.write(`  ✅ seed-e2e-tenant: "Tenant" has ${rows[0].id} (slug ${rows[0].slug}) on ${host}\n`)
} finally {
  await client.end().catch(() => {})
}
