#!/usr/bin/env node
/**
 * Backfill `sportradar` into `Player.provider_ids`.
 *
 * ⚠ WHY THIS ID AND NOT ANOTHER. It is the only key that crosses BOTH a platform
 * boundary and the college-to-pro boundary. Measured 2026-08-26:
 *
 *     Fantrax CFB map  sportRadarId on 15,915/16,886 (94%)
 *     Fantrax NFL map  sportRadarId on  7,310/8,646  (85%)
 *     Sleeper /players sportradar_id on 11,578/12,225 (95%)
 *
 * So the same human is traceable from a Fantrax college roster to a Sleeper pro
 * roster after he graduates. That is what makes cross-platform manager identity
 * inferable at all: a manager who held a player in college and holds him in the
 * pros is very likely the same manager. Our `Player.provider_ids` carries
 * rolling_insights, sleeper, cfbd, thesportsdb and api_football — and no
 * sportradar — so today that chain has no middle link.
 *
 * ⚠ THE JOIN IS EXACT, NOT BY NAME. Every row is matched on its existing Sleeper
 * id. Name matching across the college-pro boundary is exactly where this kind
 * of backfill goes wrong, and it is not used here.
 *
 * ⚠ `provider_ids` IS NOT CONSISTENTLY FORMATTED. `sleeper` is stored prefixed
 * (`"sleeper:14039"`) while `cfbd` and `rolling_insights` are bare (`"5306715"`).
 * The prefix is stripped when reading, and `sportradar` is written BARE to match
 * the majority. A reader that assumes one format will silently miss rows.
 *
 * Never overwrites an existing sportradar value, so re-running is safe.
 *
 * Usage:
 *   node scripts/backfill-sportradar-ids.mjs [--apply] [--limit=N]
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

/** `"sleeper:14039"` and `"14039"` both mean 14039. */
function bareSleeperId(v) {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null
  return s.startsWith('sleeper:') ? s.slice('sleeper:'.length) : s
}

async function main() {
  const apply = process.argv.includes('--apply')
  const limit = Number(arg('limit')) || 0

  console.log(`mode : ${apply ? 'APPLY' : 'DRY RUN (rolls back)'}`)

  const res = await fetch('https://api.sleeper.app/v1/players/nfl')
  if (!res.ok) return fail(`Sleeper players fetch failed: HTTP ${res.status}`)
  const sleeperPlayers = await res.json()
  const total = Object.keys(sleeperPlayers).length
  if (total === 0) return fail('Sleeper returned no players')

  /** sleeper id -> sportradar id */
  const srBySleeper = new Map()
  for (const [id, p] of Object.entries(sleeperPlayers)) {
    if (p && typeof p.sportradar_id === 'string' && p.sportradar_id.trim()) {
      srBySleeper.set(id, p.sportradar_id.trim())
    }
  }
  console.log(`sleeper players : ${total}, with sportradar_id: ${srBySleeper.size}`)

  const url = readUrl()
  const client = new pg.Client({ connectionString: url })
  await client.connect()

  try {
    const before = await client.query(
      `SELECT count(*)::int AS n FROM "Player" WHERE provider_ids::jsonb ? 'sportradar'`,
    )
    console.log(`players already carrying sportradar: ${before.rows[0].n}`)

    const rows = await client.query(
      `SELECT id, provider_ids::jsonb AS ids
         FROM "Player"
        WHERE provider_ids::jsonb ? 'sleeper'
          AND NOT (provider_ids::jsonb ? 'sportradar')
        ${limit ? `LIMIT ${limit}` : ''}`,
    )
    console.log(`candidates (have sleeper, lack sportradar): ${rows.rowCount}`)

    let matched = 0
    let unmatched = 0
    const updates = []
    for (const r of rows.rows) {
      const sleeperId = bareSleeperId(r.ids?.sleeper)
      const sr = sleeperId ? srBySleeper.get(sleeperId) : null
      if (!sr) {
        unmatched++
        continue
      }
      matched++
      updates.push([r.id, sr])
    }

    console.log(`matched  : ${matched}`)
    console.log(`unmatched: ${unmatched}  (sleeper id not in the map, or no sportradar_id on it)`)

    /*
     * ⚠ A COLLAPSE IN THE MATCH RATE MEANS THE FORMAT CHANGED, NOT THAT THE
     * PLAYERS VANISHED. Bailing beats writing a handful of rows and reporting
     * success.
     */
    if (rows.rowCount > 100 && matched / rows.rowCount < 0.5) {
      return fail(
        `only ${matched} of ${rows.rowCount} matched. That is the signature of an id-format ` +
          `change rather than missing data, so nothing was written.`,
      )
    }

    await client.query('BEGIN')
    /* One statement, not one per row: 12k round trips is a different kind of
       mistake. */
    if (updates.length > 0) {
      await client.query(
        `UPDATE "Player" AS p
            SET provider_ids = (p.provider_ids::jsonb || jsonb_build_object('sportradar', u.sr))::json
           FROM (SELECT * FROM unnest($1::text[], $2::text[]) AS t(id, sr)) AS u
          WHERE p.id = u.id`,
        [updates.map((u) => u[0]), updates.map((u) => u[1])],
      )
    }

    const after = await client.query(
      `SELECT count(*)::int AS n FROM "Player" WHERE provider_ids::jsonb ? 'sportradar'`,
    )
    console.log(`players carrying sportradar after: ${after.rows[0].n} (delta ${after.rows[0].n - before.rows[0].n})`)

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
