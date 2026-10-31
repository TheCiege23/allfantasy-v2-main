/** Rollback-only database probe for the Fantrax multi-team migration. */
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const dotenv = require('dotenv')
const { Client } = require('pg')
const { identifyTarget } = require('./db-target-identity.cjs')

async function main() {
  const staging = dotenv.parse(fs.readFileSync('.env.staging'))
  assert.equal(identifyTarget(staging.DIRECT_URL).label, 'staging', 'Refusing a non-staging database')

  const db = new Client({ connectionString: staging.DIRECT_URL })
  const id = crypto.randomUUID()
  const sourceId = `af-fantrax-staging-probe-${id}`
  await db.connect()
  try {
    const users = await db.query('SELECT DISTINCT "userId" FROM leagues LIMIT 2')
    assert.equal(users.rowCount, 2, 'Need two staging accounts for the uniqueness probe')
    const [ownerId, otherId] = users.rows.map((row) => row.userId)

    await db.query('BEGIN')
    await db.query('SET LOCAL lock_timeout = 10000')
    await db.query('SET LOCAL statement_timeout = 30000')
    const migration = await db.query(
      'SELECT 1 FROM "_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NOT NULL',
      ['20261031000000_fantrax_multi_team_claim'],
    )
    assert.equal(migration.rowCount, 1, 'Fantrax migration is not recorded as applied')

    const leagueId = crypto.randomUUID()
    const settings = JSON.stringify({ fantraxSourceLeagueId: sourceId })
    await db.query(
      'INSERT INTO leagues (id, "userId", platform, "platformLeagueId", name, season, settings, "updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())',
      [leagueId, ownerId, 'fantrax', sourceId, 'Rollback-only Fantrax probe', 2026, settings],
    )

    for (const teamId of ['team-a', 'team-b']) {
      await db.query(
        'INSERT INTO league_teams (id, "leagueId", "externalId", "ownerName", "teamName", "claimedByUserId", "lastUpdatedAt") VALUES ($1,$2,$3,$4,$5,$6,NOW())',
        [crypto.randomUUID(), leagueId, teamId, 'One account', 'Same team name', ownerId],
      )
      await db.query(
        'INSERT INTO "LeagueManagerClaim" (id, "leagueId", "afUserId", "teamExternalId", "isConfirmed") VALUES ($1,$2,$3,$4,$5)',
        [crypto.randomUUID(), leagueId, ownerId, teamId, true],
      )
    }
    const claims = await db.query(
      'SELECT COUNT(*)::int AS total, COUNT(DISTINCT "teamExternalId")::int AS distinct_teams FROM "LeagueManagerClaim" WHERE "leagueId"=$1 AND "afUserId"=$2',
      [leagueId, ownerId],
    )
    assert.deepEqual(claims.rows[0], { total: 2, distinct_teams: 2 })

    await db.query('SAVEPOINT duplicate_team')
    try {
      await db.query(
        'INSERT INTO "LeagueManagerClaim" (id, "leagueId", "afUserId", "teamExternalId") VALUES ($1,$2,$3,$4)',
        [crypto.randomUUID(), leagueId, otherId, 'team-a'],
      )
      throw new Error('A second account claimed the same team')
    } catch (error) {
      if (error.code !== '23505') throw error
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT duplicate_team')
    }

    await db.query('SAVEPOINT duplicate_league')
    try {
      await db.query(
        'INSERT INTO leagues (id, "userId", platform, "platformLeagueId", name, season, settings, "updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())',
        [crypto.randomUUID(), otherId, 'fantrax', sourceId, 'Duplicate Fantrax probe', 2026, settings],
      )
      throw new Error('A second live row was created for the same Fantrax league')
    } catch (error) {
      if (error.code !== '23505') throw error
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT duplicate_league')
    }

    console.log('PASS: one account claims two distinct teams, duplicate claims are rejected, and live league identity is unique.')
  } finally {
    await db.query('ROLLBACK').catch(() => {})
    const remaining = await db.query('SELECT COUNT(*)::int AS n FROM leagues WHERE "platformLeagueId"=$1', [sourceId])
    assert.equal(remaining.rows[0].n, 0, 'Probe row remained after rollback')
    await db.end()
    console.log('PASS: probe transaction rolled back; no staging rows remain.')
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
