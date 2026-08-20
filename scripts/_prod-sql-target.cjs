/**
 * Shared plumbing for scripts that run SQL against a real database.
 *
 * Exists because getting a connection right here has three separate traps, and every script
 * that re-derives them gets one wrong:
 *
 *  1. `psql "$DIRECT_URL"` does NOT work. `$VAR` is bash syntax; PowerShell expands it to an
 *     empty string, so psql falls back to localhost as the Windows user and prompts for a
 *     password that cannot be right. It also puts the credential in shell history, and this
 *     repo is public. So the URL is read from the env file and never printed.
 *  2. DDL must not go through a connection pooler, so DIRECT_URL wins over DATABASE_URL.
 *  3. A git worktree has neither `node_modules` nor its own `.env` — both live in the primary
 *     checkout, found by walking up rather than assuming cwd.
 *
 * Only the credential-free endpoint/database description is ever logged.
 */

const fs = require('fs')
const path = require('path')

/** Walk up from `start` until we find a checkout that actually has the dependency installed. */
function findMainTree(start) {
  let dir = path.resolve(start)
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'node_modules', 'pg'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error('Could not locate a checkout containing node_modules/pg')
}

function readEnvFile(file) {
  if (!fs.existsSync(file)) return {}
  const out = {}
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq < 0) continue
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
  }
  return out
}

/**
 * Resolve everything a prod-SQL script needs.
 * @param {string} fromDir directory to start the upward search from (pass `__dirname`)
 */
function resolveTarget(fromDir) {
  const mainTree = findMainTree(fromDir)
  const env = {
    ...readEnvFile(path.join(mainTree, '.env')),
    ...readEnvFile(path.join(mainTree, '.env.local')),
  }
  const url = env.DIRECT_URL || env.DATABASE_URL
  if (!url) throw new Error('No DIRECT_URL or DATABASE_URL in the primary checkout env files')

  const identity = require(path.join(mainTree, 'scripts', 'db-target-identity.cjs'))
  const { Client } = require(require.resolve('pg', { paths: [path.join(mainTree, 'node_modules')] }))

  return {
    mainTree,
    identity,
    /** Credential-free, safe to log. */
    description: identity.describeTarget(url),
    isProduction: identity.isProductionTarget(url),
    newClient: () => new Client({ connectionString: url }),
  }
}

/**
 * Record a hand-applied migration so `prisma migrate status` stops reporting it pending.
 *
 * The checksum is sha256 over the file BYTES, read without newline translation: this repo has
 * `core.autocrlf=true`, and CRLF-translated reads are what produced past checksum mismatches.
 */
async function recordMigration(client, migrationSqlPath, migrationName) {
  const checksum = require('crypto')
    .createHash('sha256')
    .update(fs.readFileSync(migrationSqlPath))
    .digest('hex')
  await client.query(
    `INSERT INTO "_prisma_migrations"
       (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
     VALUES (gen_random_uuid()::text, $1, now(), $2, NULL, NULL, now(), 1)
     ON CONFLICT DO NOTHING`,
    [checksum, migrationName],
  )
  return checksum
}

module.exports = { resolveTarget, recordMigration, readEnvFile, findMainTree }
