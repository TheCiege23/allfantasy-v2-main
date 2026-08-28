/**
 * Restamp `PlayerIdentityMap.normalizedName` for the rows corrupted by the OLD
 * `normalizePlayerName`, whose generational-suffix strip was unanchored and therefore
 * deleted the FIRST NAME of every J.R./JR player (`'J.R. Sweezy'` → `'sweezy'`).
 *
 * ⚠ WHY THIS SCRIPT EXISTS AT ALL — THE SYNC CANNOT DO IT. The obvious plan, "change the
 * normalizer and re-run `multiSportIdentityMap`", does not work: neither of that module's
 * update branches writes `normalizedName`. Only its CREATE path does, and every existing
 * row already carries a `rollingInsightsId`, so a re-run takes the `alreadyMapped` branch
 * and refreshes team/position/status only. Without this backfill the code change is a net
 * REGRESSION — readers would compute the corrected key while the table still stores the
 * corrupted one.
 *
 * ⚠ SCOPE IS DELIBERATELY NARROW: only rows whose stored value is exactly what the OLD
 * normalizer produced AND whose value changes under the NEW one. That is the set this code
 * change breaks, and nothing else.
 *
 * In particular it does NOT touch the ~241 NFL rows written by an older, period-keeping
 * writer (`'a.j. terrell'`, `'c.j. henderson'`). Those look "wrong" and are tempting to
 * normalize in the same pass — but `lib/draft/analytics/nfl-rolling-insights-draft-analytics.ts`
 * builds its lookup key with plain `.toLowerCase()`, so it MATCHES those rows today and
 * would stop if they were rewritten. Aligning them is a separate decision with its own
 * consumer audit.
 *
 * Usage (from anywhere, including a worktree):
 *   npx tsx scripts/backfill-normalized-name.ts            # report only, writes nothing
 *   npx tsx scripts/backfill-normalized-name.ts --apply    # one transaction, snapshot first
 *
 * ⚠ Defaults to `.env` / `.env.local`, which in this repo is PRODUCTION.
 */

import fs from 'node:fs'
import path from 'node:path'
import { normalizePlayerName } from '../lib/team-abbrev'

/* eslint-disable @typescript-eslint/no-var-requires */
const { resolveTarget } = require('./_prod-sql-target.cjs')

const APPLY = process.argv.includes('--apply')

/**
 * The OLD normalizer, copied verbatim so we can identify which rows it stamped. Do NOT
 * "tidy" this into a call to the new one — its whole job is to reproduce the bug.
 */
function legacyNormalizePlayerName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/\bjr\.?\b/i, '')
    .replace(/\bsr\.?\b/i, '')
    .replace(/\bii+\b/i, '')
    .replace(/\biii\b/i, '')
    .replace(/\biv\b/i, '')
    .replace(/\bv\b/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

type Row = { id: string; sport: string; canonicalName: string; normalizedName: string }

async function main() {
  const target = resolveTarget(__dirname)
  console.log(`target: ${target.description}`)
  console.log(APPLY ? 'MODE  : APPLY (writes)' : 'MODE  : report only (no writes)')

  const client = target.newClient()
  await client.connect()

  try {
    const { rows } = (await client.query(
      'SELECT id, sport, "canonicalName", "normalizedName" FROM "PlayerIdentityMap"',
    )) as { rows: Row[] }

    const planned: Array<Row & { next: string }> = []
    let storedElsewhere = 0

    for (const row of rows) {
      const legacy = legacyNormalizePlayerName(row.canonicalName)
      const next = normalizePlayerName(row.canonicalName)
      if (legacy === next) continue // this fix does not change the row
      if (row.normalizedName !== legacy) {
        // Written by a different writer/convention — out of scope, left alone.
        storedElsewhere += 1
        continue
      }
      planned.push({ ...row, next })
    }

    console.log(`\nrows scanned                : ${rows.length}`)
    console.log(`rows this fix would change  : ${planned.length}`)
    console.log(`skipped (other convention)  : ${storedElsewhere}`)

    if (planned.length === 0) {
      console.log('\nNothing to do.')
      return
    }

    console.log('')
    for (const p of planned) {
      console.log(`  ${p.sport.padEnd(6)} "${p.canonicalName}"  "${p.normalizedName}" -> "${p.next}"`)
    }

    /*
     * A new key is only an improvement if it does not land on another player. Checked here
     * rather than assumed — a collision would silently merge two people downstream.
     */
    const collisions: string[] = []
    for (const p of planned) {
      const { rows: hit } = await client.query(
        'SELECT id FROM "PlayerIdentityMap" WHERE sport = $1 AND "normalizedName" = $2 AND id <> $3',
        [p.sport, p.next, p.id],
      )
      if (hit.length > 0) collisions.push(`${p.sport} "${p.canonicalName}" -> "${p.next}" (${hit.length} existing row(s))`)
    }
    if (collisions.length > 0) {
      console.log(`\n🛑 REFUSING: ${collisions.length} new key(s) collide with an existing row:`)
      collisions.forEach((c) => console.log(`  ${c}`))
      process.exitCode = 1
      return
    }
    console.log('\ncollision check: none of the new keys hit an existing row.')

    if (!APPLY) {
      console.log('\nReport only — re-run with --apply to write.')
      return
    }

    const snapshot = path.join(__dirname, `.normalized-name-snapshot-${planned.length}.json`)
    fs.writeFileSync(
      snapshot,
      JSON.stringify(planned.map((p) => ({ id: p.id, from: p.normalizedName, to: p.next })), null, 2),
    )
    console.log(`\nsnapshot: ${snapshot}`)

    await client.query('BEGIN')
    let updated = 0
    for (const p of planned) {
      // Guard on the OLD value so a concurrent writer's change is never clobbered.
      const res = await client.query(
        'UPDATE "PlayerIdentityMap" SET "normalizedName" = $1 WHERE id = $2 AND "normalizedName" = $3',
        [p.next, p.id, p.normalizedName],
      )
      updated += res.rowCount ?? 0
    }
    await client.query('COMMIT')
    console.log(`updated: ${updated} row(s)`)
    if (updated !== planned.length) {
      console.log(`⚠ ${planned.length - updated} row(s) changed underneath this run and were skipped.`)
    }
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      /* already unwound */
    }
    throw err
  } finally {
    await client.end().catch(() => {})
  }
}

main().catch((err) => {
  console.error('[backfill-normalized-name] failed:', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
