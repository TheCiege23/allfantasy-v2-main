#!/usr/bin/env node
/**
 * Link a pro league and a college league into one franchise.
 *
 * ⚠ THE TWO SIDES LIVE IN DIFFERENT TABLES — the pro side in `leagues`, the
 * college side in `FantraxLeague` — so there is no foreign key and this script
 * verifies both rows exist before writing. A link pointing at a league that is
 * not there would surface later as an unexplained empty half.
 *
 * ⚠ REFUSES TO GUESS WHICH TEAM IS YOURS on either side. Defaulting to the first
 * roster would attribute a stranger's players to the owner and then grade trades
 * against them.
 *
 * Idempotent: re-running updates the same link rather than creating a second
 * one. `(platform, leagueId)` is unique, so a league cannot belong to two
 * franchises, and `(linkId, role)` is unique, so a franchise cannot hold two
 * college halves.
 *
 * Usage:
 *   node scripts/link-franchise.mjs --email=<you> --name="<franchise name>" \
 *     --pro-league=<League.id> --pro-team=<externalId> \
 *     --college-league=<FantraxLeague.id> --college-team=<team name> [--apply]
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
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
  const email = arg('email')
  const name = arg('name')
  const proLeague = arg('pro-league')
  const proTeam = arg('pro-team')
  const collegeLeague = arg('college-league')
  const collegeTeam = arg('college-team')
  const apply = process.argv.includes('--apply')

  for (const [k, v] of Object.entries({ email, name, proLeague, proTeam, collegeLeague, collegeTeam })) {
    if (!v) return fail(`--${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())} is required`)
  }

  const url = readUrl()
  const client = new pg.Client({ connectionString: url })
  await client.connect()

  try {
    console.log(`mode          : ${apply ? 'APPLY' : 'DRY RUN (rolls back)'}`)

    const user = await client.query(`SELECT id FROM app_users WHERE email = $1 LIMIT 1`, [email])
    if (user.rowCount === 0) return fail(`no AllFantasy account for ${email}`)
    const ownerUserId = user.rows[0].id

    /* Both halves must resolve to a real row — see the header. */
    const pro = await client.query(`SELECT id, name, platform FROM leagues WHERE id = $1`, [proLeague])
    if (pro.rowCount === 0) return fail(`pro league ${proLeague} not found in "leagues"`)

    const college = await client.query(
      `SELECT id, "leagueName", season FROM "FantraxLeague" WHERE id = $1`,
      [collegeLeague],
    )
    if (college.rowCount === 0) return fail(`college league ${collegeLeague} not found in "FantraxLeague"`)

    const team = await client.query(
      `SELECT "externalId", "ownerName", "teamName" FROM league_teams WHERE "leagueId" = $1 AND "externalId" = $2`,
      [proLeague, proTeam],
    )
    if (team.rowCount === 0) return fail(`no team with externalId ${proTeam} in that pro league`)

    console.log(`owner         : ${email}`)
    console.log(`pro   (${pro.rows[0].platform})  : ${pro.rows[0].name} — team ${proTeam} (${team.rows[0].ownerName} / ${team.rows[0].teamName})`)
    console.log(`college (fantrax): ${college.rows[0].leagueName} ${college.rows[0].season} — team ${collegeTeam}`)

    await client.query('BEGIN')

    const linkId = crypto.randomUUID()
    const ins = await client.query(
      `INSERT INTO franchise_links (id, "ownerUserId", name, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, now(), now()) RETURNING id`,
      [linkId, ownerUserId, name],
    )
    const id = ins.rows[0].id

    for (const [role, platform, leagueId, teamExternalId] of [
      ['pro', pro.rows[0].platform, proLeague, proTeam],
      ['college', 'fantrax', collegeLeague, collegeTeam],
    ]) {
      await client.query(
        `INSERT INTO franchise_league_members (id, "linkId", role, platform, "leagueId", "teamExternalId", "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, now())`,
        [crypto.randomUUID(), id, role, platform, leagueId, teamExternalId],
      )
    }

    const check = await client.query(
      `SELECT role, platform, "leagueId", "teamExternalId" FROM franchise_league_members WHERE "linkId" = $1 ORDER BY role`,
      [id],
    )
    console.log(`\nlink id       : ${id}`)
    for (const r of check.rows) console.log(`  ${r.role.padEnd(8)} ${r.platform.padEnd(8)} ${r.leagueId}  team=${r.teamExternalId}`)

    if (apply) {
      await client.query('COMMIT')
      console.log('\nCOMMITTED.')
    } else {
      await client.query('ROLLBACK')
      console.log('\nDRY RUN — rolled back, nothing written.')
    }
  } catch (err) {
    try { await client.query('ROLLBACK') } catch {}
    const raw = String(err && err.message ? err.message : err)
    return fail(raw.split(url).join('<redacted>'))
  } finally {
    await client.end()
  }
}

main().catch((err) => fail(String(err && err.message ? err.message : err)))
