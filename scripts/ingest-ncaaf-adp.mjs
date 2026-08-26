#!/usr/bin/env node
/**
 * Ingest college ADP from Fantrax into `DevyAdp` and `DevyPlayer.devyAdp`.
 *
 * ⚠ THIS IS THE SIGNAL THE DEVY STACK HAS NEVER HAD. `DevyAdp` holds zero rows
 * and `DevyPlayer.devyAdp` is null for all 1,718 players, so `devy-model.ts`
 * weights an ADP signal at 0.15 and never receives one. Verified 2026-08-26:
 * `getAdp?sport=NCAAF` returns 984 college players with a real `ADP_PPR`, which
 * is market-shaped in a way the derived scouting composite is not — it is
 * aggregated draft behaviour rather than our own opinion.
 *
 * ⚠ IT IS ADP, NOT A TRADE PRICE, and the distinction matters. ADP orders a
 * draft board; it does not say what a player trades for. It does NOT restore the
 * rank bridge in lib/trade-intel/afValue.ts, which is honest only because it
 * reconciles two independently derived TRADE-VALUE sources. One ADP feed is a
 * second signal, not a second market.
 *
 * ⚠ BOTH DESTINATIONS ARE WRITTEN ON PURPOSE. `DevyAdp` is the history table and
 * nothing reads it except lib/adp-data.ts; `devy-model.ts` and `devy-intel.ts`
 * read the `DevyPlayer.devyAdp` SCALAR. Writing only the table would leave every
 * model still seeing null, which is how this signal stays dark while looking
 * ingested.
 *
 * ⚠ NAME IS THE ONLY AVAILABLE KEY. Fantrax gives its own id, we store none, and
 * the formats differ ("Allen, Jordan" against "jordan allen"). Measured: 357 of
 * 984 match uniquely, 2 are ambiguous, 625 are unmatched — the gap is coverage
 * (Fantrax rates all of college football, we ingest 50 schools), not a broken
 * join. AMBIGUOUS NAMES ARE SKIPPED, never assigned to the first hit.
 *
 * Usage:
 *   node scripts/ingest-ncaaf-adp.mjs [--apply] [--season=2026]
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import process from 'node:process'
import pg from 'pg'

const SOURCE = 'fantrax_ncaaf'
const ADP_URL = 'https://www.fantrax.com/fxea/general/getAdp?sport=NCAAF'

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

/** "Allen, Jordan" -> "jordan allen"; "Jordan Allen" -> "jordan allen". */
function normalizeName(raw) {
  let s = String(raw ?? '').trim()
  if (s.includes(',')) {
    const [last, first] = s.split(',').map((x) => x.trim())
    s = `${first} ${last}`
  }
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

async function main() {
  const apply = process.argv.includes('--apply')
  const season = Number(arg('season')) || new Date().getFullYear()
  console.log(`mode   : ${apply ? 'APPLY' : 'DRY RUN (rolls back)'}`)
  console.log(`season : ${season}`)

  const res = await fetch(ADP_URL, { headers: { Accept: 'application/json' } })
  const text = await res.text()
  if (text.trimStart().startsWith('<')) return fail(`Fantrax returned HTML (HTTP ${res.status})`)
  const parsed = JSON.parse(text)
  /* Fantrax answers HTTP 200 for errors — check the body, not the status. */
  if (parsed && parsed.error) return fail(`Fantrax: ${parsed.error.message}`)

  const rows = (Array.isArray(parsed) ? parsed : Object.values(parsed)).filter(
    (r) => r && typeof r.ADP_PPR === 'number' && r.ADP_PPR > 0 && r.name,
  )
  if (rows.length === 0) return fail('Fantrax returned no rated players')
  console.log(`adp rows: ${rows.length}`)

  const byKey = new Map()
  for (const r of rows) {
    const key = normalizeName(r.name)
    if (!key) continue
    /* Two ADP entries normalising to one name: keep neither rather than pick. */
    byKey.set(key, byKey.has(key) ? null : r)
  }

  const url = readUrl()
  const client = new pg.Client({ connectionString: url })
  await client.connect()

  try {
    const keys = [...byKey.keys()]
    const players = await client.query(
      `SELECT "normalizedName" AS k, array_agg(id) AS ids
         FROM "DevyPlayer" WHERE "normalizedName" = ANY($1) GROUP BY 1`,
      [keys],
    )

    const updates = []
    let ambiguous = 0
    let unmatched = 0
    for (const row of players.rows) {
      const adpRow = byKey.get(row.k)
      if (!adpRow) {
        ambiguous++
        continue
      }
      /* More than one DevyPlayer with this name — skip, never take the first. */
      if (row.ids.length !== 1) {
        ambiguous++
        continue
      }
      updates.push({ playerId: row.ids[0], adp: adpRow.ADP_PPR })
    }
    unmatched = keys.length - players.rowCount

    console.log(`matched  : ${updates.length}`)
    console.log(`ambiguous: ${ambiguous}  (skipped, never assigned to the first hit)`)
    console.log(`unmatched: ${unmatched}  (Fantrax rates all of college football; we ingest 50 schools)`)

    if (updates.length === 0) return fail('nothing matched — the name format or the feed changed')

    await client.query('BEGIN')

    /* The scalar every model actually reads. */
    await client.query(
      `UPDATE "DevyPlayer" AS p SET "devyAdp" = u.adp
         FROM (SELECT * FROM unnest($1::text[], $2::float8[]) AS t(id, adp)) AS u
        WHERE p.id = u.id`,
      [updates.map((u) => u.playerId), updates.map((u) => u.adp)],
    )

    /* The history table, keyed (playerId, source, season). */
    await client.query(
      `INSERT INTO "DevyAdp" (id, "playerId", adp, source, season, "updatedAt")
       SELECT t.newid, t.id, t.adp, $4, $5, now()
         FROM unnest($1::text[], $2::float8[], $3::text[]) AS t(id, adp, newid)
       ON CONFLICT ("playerId", source, season)
       DO UPDATE SET adp = EXCLUDED.adp, "updatedAt" = now()`,
      [
        updates.map((u) => u.playerId),
        updates.map((u) => u.adp),
        updates.map(() => crypto.randomUUID()),
        SOURCE,
        season,
      ],
    )

    const scalar = await client.query(`SELECT count("devyAdp")::int AS n FROM "DevyPlayer"`)
    const table = await client.query(`SELECT count(*)::int AS n FROM "DevyAdp"`)
    console.log(`\nDevyPlayer.devyAdp non-null: ${scalar.rows[0].n}`)
    console.log(`DevyAdp rows              : ${table.rows[0].n}`)

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
