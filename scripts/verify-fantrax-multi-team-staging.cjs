/** Rollback-only 128-team schema probe, or read-only verification of two real Fantrax imports. */
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const dotenv = require('dotenv')
const { Client } = require('pg')
const { identifyTarget } = require('./db-target-identity.cjs')

async function verifyRealImports(db, sourceId) {
  const leagues = await db.query(
    `SELECT id, season FROM leagues
     WHERE platform = 'fantrax' AND "platformLeagueId" = $1
       AND settings->>'fantraxSourceLeagueId' = $1
     ORDER BY season DESC`,
    [sourceId],
  )
  assert.ok(leagues.rowCount, 'No completed live Fantrax import found for that league ID')
  const season = leagues.rows[0].season
  assert.equal(
    leagues.rows.filter((row) => row.season === season).length,
    1,
    'Multiple live League rows exist for the latest season',
  )
  const leagueId = leagues.rows[0].id

  const snapshots = await db.query(
    `SELECT fl."appUserId", COUNT(DISTINCT fu."fantraxUsername")::int AS teams
     FROM "FantraxLeague" fl JOIN "FantraxUser" fu ON fu.id = fl."userId"
     WHERE fl."sourceLeagueId" = $1 AND fl.season = $2
       AND starts_with(fu."fantraxUsername", $3)
     GROUP BY fl."appUserId"`,
    [sourceId, season, `fantrax-team:${sourceId}:`],
  )
  const owner = snapshots.rows.find((row) => row.appUserId && row.teams >= 2)
  assert.ok(owner, 'No staging account has two distinct live snapshots for this Fantrax league')

  const claims = await db.query(
    `SELECT COUNT(DISTINCT c."teamExternalId")::int AS teams,
            COUNT(*) FILTER (WHERE c."isConfirmed" AND t."claimedByUserId" = c."afUserId")::int AS valid_claims
     FROM "LeagueManagerClaim" c
     JOIN league_teams t ON t."leagueId" = c."leagueId" AND t."externalId" = c."teamExternalId"
     WHERE c."leagueId" = $1 AND c."afUserId" = $2`,
    [leagueId, owner.appUserId],
  )
  assert.ok(claims.rows[0].teams >= 2, 'The account does not have two distinct team claims on the shared league')
  assert.equal(claims.rows[0].valid_claims, claims.rows[0].teams, 'A team claim is unconfirmed or mismatches its team owner')

  console.log(`PASS: latest season ${season} has one live Fantrax League row, ${owner.teams} distinct owner snapshots, and ${claims.rows[0].teams} confirmed team claims for one account.`)
}

async function main() {
  const realImportId = process.argv[2] === '--league-id' ? process.argv[3] : null
  assert.ok(process.argv.length === 2 || (process.argv.length === 4 && realImportId),
    'Usage: node scripts/verify-fantrax-multi-team-staging.cjs [--league-id FANTRAX_LEAGUE_ID]')
  const staging = dotenv.parse(fs.readFileSync('.env.staging'))
  assert.equal(identifyTarget(staging.DIRECT_URL).label, 'staging', 'Refusing a non-staging database')

  const db = new Client({ connectionString: staging.DIRECT_URL })
  const id = crypto.randomUUID()
  const sourceId = `af-fantrax-staging-probe-${id}`
  await db.connect()
  if (realImportId) {
    try {
      await verifyRealImports(db, realImportId)
    } finally {
      await db.end()
    }
    return
  }
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

    const teamIds = Array.from({ length: 128 }, (_, index) => `team-${String(index + 1).padStart(3, '0')}`)
    const teamRowIds = teamIds.map(() => crypto.randomUUID())
    await db.query(
      `INSERT INTO league_teams (id, "leagueId", "externalId", "ownerName", "teamName", "claimedByUserId", "lastUpdatedAt")
       SELECT ids.id, $1, ids.external_id, 'Shared display name', 'Same team name',
              CASE WHEN ids.external_id = ANY($4::text[]) THEN $2 ELSE NULL END, NOW()
       FROM unnest($3::text[], $5::text[]) AS ids(external_id, id)`,
      [leagueId, ownerId, teamIds, teamIds.slice(0, 2), teamRowIds],
    )
    for (const teamId of teamIds.slice(0, 2)) {
      await db.query(
        'INSERT INTO "LeagueManagerClaim" (id, "leagueId", "afUserId", "teamExternalId", "isConfirmed") VALUES ($1,$2,$3,$4,$5)',
        [crypto.randomUUID(), leagueId, ownerId, teamId, true],
      )
    }
    const teams = await db.query(
      `SELECT COUNT(*)::int AS total, COUNT(DISTINCT "externalId")::int AS distinct_ids,
              COUNT(DISTINCT "teamName")::int AS distinct_names,
              COUNT(*) FILTER (WHERE "claimedByUserId"=$2)::int AS owned
       FROM league_teams WHERE "leagueId"=$1`,
      [leagueId, ownerId],
    )
    assert.deepEqual(teams.rows[0], { total: 128, distinct_ids: 128, distinct_names: 1, owned: 2 })
    const claims = await db.query(
      'SELECT COUNT(*)::int AS total, COUNT(DISTINCT "teamExternalId")::int AS distinct_teams FROM "LeagueManagerClaim" WHERE "leagueId"=$1 AND "afUserId"=$2',
      [leagueId, ownerId],
    )
    assert.deepEqual(claims.rows[0], { total: 2, distinct_teams: 2 })

    await db.query('SAVEPOINT duplicate_team')
    try {
      await db.query(
        'INSERT INTO "LeagueManagerClaim" (id, "leagueId", "afUserId", "teamExternalId") VALUES ($1,$2,$3,$4)',
        [crypto.randomUUID(), leagueId, otherId, teamIds[0]],
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

    console.log('PASS: 128 distinct teams with duplicate names, two teams claimed by one account, duplicate claims rejected, and one live league identity.')
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
