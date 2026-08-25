#!/usr/bin/env node
/**
 * READ-ONLY database probe.
 *
 * Exists so "how many rows are actually in this table?" can be answered without
 * hand-rolling a throwaway script each time — the question this repo punishes you
 * for not asking, since almost every grounding path typechecks and passes tests
 * while returning nothing in production.
 *
 * THREE THINGS MAKE THIS SAFE TO ALLOWLIST:
 *
 *   1. The query runs inside `BEGIN TRANSACTION READ ONLY` and is always rolled
 *      back. Postgres itself rejects INSERT/UPDATE/DELETE/DDL — this is a server
 *      guarantee, not a regex we could out-clever.
 *   2. One statement only. Semicolon-chained input is refused before connecting.
 *   3. The connection string is read from the env file and NEVER printed. Errors
 *      are scrubbed of it before they reach stdout.
 *
 * Usage:
 *   node scripts/db-readonly-probe.mjs --env=test  "select count(*) from leagues"
 *   node scripts/db-readonly-probe.mjs --env=local "select count(*) from leagues"
 *
 * ⚠ `--env=local` reads `.env.local`, which IS PRODUCTION in this repo. That is
 * deliberate and sometimes necessary — production is where the rows are — but it
 * is why this script can only ever read.
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import pg from 'pg'

const ENV_FILES = { local: '.env.local', test: '.env.test' }

function fail(message) {
  console.error(message)
  process.exit(1)
}

const args = process.argv.slice(2)
const envArg = args.find((a) => a.startsWith('--env='))?.slice('--env='.length) ?? 'test'
const jsonOut = args.includes('--json')
const sql = args.filter((a) => !a.startsWith('--')).join(' ').trim()

if (!sql) fail('Usage: node scripts/db-readonly-probe.mjs --env=test|local "<single SELECT>"')
if (!ENV_FILES[envArg]) fail(`--env must be one of: ${Object.keys(ENV_FILES).join(', ')}`)

/*
 * One statement. A trailing semicolon is fine; anything after it is not — the
 * read-only transaction would still reject a write, but refusing here keeps the
 * failure legible instead of surfacing as a Postgres error.
 */
if (sql.replace(/;\s*$/, '').includes(';')) {
  fail('Refusing multi-statement input: pass exactly one query.')
}

const envPath = path.resolve(process.cwd(), ENV_FILES[envArg])
if (!fs.existsSync(envPath)) fail(`${ENV_FILES[envArg]} not found in ${process.cwd()}`)

const line = fs
  .readFileSync(envPath, 'utf8')
  .split(/\r?\n/)
  .find((l) => l.startsWith('DATABASE_URL'))
if (!line) fail(`DATABASE_URL not found in ${ENV_FILES[envArg]}`)

let url = line.slice(line.indexOf('=') + 1).trim()
if ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'"))) {
  url = url.slice(1, -1)
}

/** Never let the connection string reach stdout, even inside a driver error. */
function scrub(text) {
  return String(text).split(url).join('[connection string redacted]')
}

const host = url.match(/@([^/:?]+)/)?.[1] ?? 'unknown-host'

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })

try {
  await client.connect()
} catch (e) {
  fail(`Connect failed (${e.code ?? 'no code'}): ${scrub(e.message)}`)
}

try {
  // The actual guarantee. Any write in `sql` errors out here rather than running.
  await client.query('BEGIN TRANSACTION READ ONLY')
  const result = await client.query(sql)
  await client.query('ROLLBACK')

  if (jsonOut) {
    console.log(JSON.stringify(result.rows, null, 2))
  } else {
    console.log(`# ${envArg} (${host}) — ${result.rows.length} row(s)`)
    for (const row of result.rows) console.log(JSON.stringify(row))
  }
} catch (e) {
  try {
    await client.query('ROLLBACK')
  } catch {
    // Already unwound; nothing to do.
  }
  fail(`Query failed (${e.code ?? 'no code'}): ${scrub(e.message)}`)
} finally {
  await client.end().catch(() => {})
}
