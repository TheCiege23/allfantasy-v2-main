#!/usr/bin/env node
/**
 * Repoint one `rosters` row to the platform id its league team actually uses.
 *
 * ⚠ THE BUG THIS FIXES. `rosters.platformUserId` and `league_teams.platformUserId`
 * are supposed to be the same id space, and sometimes are not: a roster can be
 * written keyed by an AllFantasy UUID while every team row in the same league
 * carries the platform's own numeric id. The join then silently returns nothing
 * and the owner looks like a manager with no players.
 *
 * ⚠ ONLY SAFE WHEN THE PAIRING IS UNAMBIGUOUS, and this refuses otherwise: it
 * requires EXACTLY ONE team in the league with no roster and EXACTLY ONE roster
 * that matches no team. With more than one of either, which orphan belongs to
 * which team is a guess, and guessing here hands one manager another's players.
 *
 * Usage:
 *   node scripts/repoint-roster-owner.mjs --league=<League.id> [--apply]
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import pg from 'pg'

function fail(msg) {
  console.error(`\nABORTED — ${msg}`)
  process.exitCode = 1
}

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}

function readUrl() {
  for (const f of ['.env.local', '.env']) {
    for (const base of [process.cwd(), 'F:/allfantasy-v2-main']) {
      const p = path.resolve(base, f)
      if (!fs.existsSync(p)) continue
      const body = fs.readFileSync(p, 'utf8')
      const m = body.match(/^DIRECT_URL=(.*)$/m) || body.match(/^DATABASE_URL=(.*)$/m)
      if (m) return m[1].trim().replace(/^["']|["']$/g, '')
    }
  }
  throw new Error('no DIRECT_URL/DATABASE_URL found')
}

async function main() {
  const leagueId = arg('league')
  const apply = process.argv.includes('--apply')
  if (!leagueId) return fail('--league=<League.id> is required')

  const url = readUrl()
  const client = new pg.Client({ connectionString: url })
  await client.connect()

  try {
    console.log(`league : ${leagueId}`)
    console.log(`mode   : ${apply ? 'APPLY' : 'DRY RUN (rolls back)'}`)

    const orphanTeams = await client.query(
      `SELECT lt."externalId", lt."ownerName", lt."platformUserId"
         FROM league_teams lt
         LEFT JOIN rosters r
           ON r."leagueId" = lt."leagueId" AND r."platformUserId" = lt."platformUserId"
        WHERE lt."leagueId" = $1 AND r.id IS NULL AND lt."platformUserId" IS NOT NULL`,
      [leagueId],
    )
    const orphanRosters = await client.query(
      `SELECT r.id, r."platformUserId",
              jsonb_array_length((r."playerData"::jsonb)->'players') AS players
         FROM rosters r
        WHERE r."leagueId" = $1
          AND r."platformUserId" NOT IN (
                SELECT "platformUserId" FROM league_teams
                 WHERE "leagueId" = $1 AND "platformUserId" IS NOT NULL)`,
      [leagueId],
    )

    console.log(`teams with no roster : ${orphanTeams.rowCount}`)
    console.log(`rosters with no team : ${orphanRosters.rowCount}`)

    if (orphanTeams.rowCount === 0 && orphanRosters.rowCount === 0) {
      console.log('\nnothing to do — every roster already joins a team.')
      return
    }
    if (orphanTeams.rowCount !== 1 || orphanRosters.rowCount !== 1) {
      return fail(
        `pairing is ambiguous (${orphanTeams.rowCount} teams, ${orphanRosters.rowCount} rosters). ` +
          `Repointing would be a guess, and a wrong guess hands one manager another's players.`,
      )
    }

    const team = orphanTeams.rows[0]
    const roster = orphanRosters.rows[0]
    console.log(`\n  team   : ${team.ownerName} (externalId ${team.externalId}) wants ${team.platformUserId}`)
    console.log(`  roster : ${roster.players} players currently keyed ${roster.platformUserId}`)

    await client.query('BEGIN')
    const upd = await client.query(
      `UPDATE rosters SET "platformUserId" = $1 WHERE id = $2 AND "leagueId" = $3`,
      [team.platformUserId, roster.id, leagueId],
    )
    if (upd.rowCount !== 1) {
      await client.query('ROLLBACK')
      return fail(`expected to update exactly 1 row, updated ${upd.rowCount}. Rolled back.`)
    }

    const after = await client.query(
      `SELECT count(*)::int AS n
         FROM rosters r
         JOIN league_teams lt
           ON lt."leagueId" = r."leagueId" AND lt."platformUserId" = r."platformUserId"
        WHERE r."leagueId" = $1`,
      [leagueId],
    )
    const teams = await client.query(
      `SELECT count(*)::int AS n FROM league_teams WHERE "leagueId" = $1`,
      [leagueId],
    )
    console.log(`\n  rosters joining a team after: ${after.rows[0].n}/${teams.rows[0].n}`)

    if (after.rows[0].n !== teams.rows[0].n) {
      await client.query('ROLLBACK')
      return fail(`expected every team to join after the fix; ${after.rows[0].n}/${teams.rows[0].n}. Rolled back.`)
    }

    if (apply) {
      await client.query('COMMIT')
      console.log('\nCOMMITTED.')
    } else {
      await client.query('ROLLBACK')
      console.log('\nDRY RUN — rolled back, nothing changed.')
    }
  } catch (err) {
    try { await client.query('ROLLBACK') } catch {}
    return fail(String(err && err.message ? err.message : err).split(url).join('<redacted>'))
  } finally {
    await client.end()
  }
}

main().catch((err) => fail(String(err && err.message ? err.message : err)))
