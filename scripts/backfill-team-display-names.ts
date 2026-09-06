/**
 * Fold `SportsPlayer.team` abbreviations to display names. DRY-RUN BY DEFAULT.
 *
 *   npx tsx scripts/backfill-team-display-names.ts                        # dry run
 *   npx tsx scripts/backfill-team-display-names.ts --apply --endpoint=<id>
 *
 * Companion to the ingest fix in `lib/sleeper/refreshSleeperPlayerRows.ts` — that stops new
 * code-form rows arriving; this repairs the ones already stored.
 *
 * 🛑 RUN THIS ONLY AFTER THAT FIX IS DEPLOYED. Not landed — DEPLOYED. `/api/cron/import-players`
 * refreshes 1,500 Sleeper players every 6 hours through that writer, so a repair applied while
 * the old code is serving is undone within one lap. That is not hypothetical: on 2026-09-06 the
 * position backfill ran four hours before its fix went live and an ingest lap re-introduced 68
 * rows. Check the DEPLOYED tree, not `origin/main`:
 *
 *     railway status --json   ->   newest SUCCESS commitHash
 *     git cat-file -p <that commit>:lib/sleeper/refreshSleeperPlayerRows.ts | grep teamDisplayNameForSport
 *
 * 🛑 THE GUARD IS A POSITIVE ALLOWLIST. `--apply` needs `--endpoint=<id>` matching the connection.
 * Never a "not production" test — an inverted host-substring guard points at prod, and this repo
 * has shipped one. The endpoint is derived by `lib/db/databaseEndpoint`, shared with the AF market
 * value writer rather than re-derived here.
 */
import { PrismaClient } from '@prisma/client'

import { endpointFromDatabaseUrl, endpointMatches } from '../lib/db/databaseEndpoint'
import { teamDisplayNameForSport } from '../lib/team-abbrev'

const prisma = new PrismaClient()

async function main() {
  const apply = process.argv.includes('--apply')
  const url = process.env.DATABASE_URL
  const endpoint = endpointFromDatabaseUrl(url)
  const want = (process.argv.find((a) => a.startsWith('--endpoint=')) ?? '').split('=')[1] ?? ''

  console.log(`  endpoint: ${endpoint ?? '(unresolved)'}`)
  console.log(`  mode:     ${apply ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`)

  if (apply && !endpointMatches(url, want)) {
    console.error(`\n  REFUSING — --apply requires --endpoint=${endpoint ?? '<id>'} to confirm you mean this database`)
    process.exitCode = 1
    return
  }

  /*
   * ⚠ SCOPED TO NFL, because `teamDisplayNameForSport` only folds NFL and returning early for
   * everything else would still cost a full table scan. The function is the authority on WHAT
   * folds; this query is just avoiding work it knows will be a no-op.
   */
  const rows = await prisma.sportsPlayer.findMany({
    where: { sport: 'NFL', team: { not: null } },
    select: { id: true, sport: true, source: true, name: true, team: true },
  })

  const changes = rows
    .map((r) => ({ ...r, to: teamDisplayNameForSport(r.sport, r.team) }))
    .filter((r): r is typeof r & { to: string } => !!r.to && r.to !== r.team)

  console.log(`  scanned:  ${rows.length} NFL rows with a team`)
  console.log(`  foldable: ${changes.length}`)

  const bySource = new Map<string, number>()
  for (const c of changes) bySource.set(c.source ?? '(null)', (bySource.get(c.source ?? '(null)') ?? 0) + 1)
  for (const [s, n] of [...bySource].sort((a, b) => b[1] - a[1])) console.log(`      ${String(n).padStart(5)}  ${s}`)

  /*
   * ⚠ GROUPED ON A Map KEYED BY THE TARGET ITSELF — no delimiter, no string key to parse back
   * apart. The position backfill did that and a stripped NUL turned the join into
   * split-into-characters, writing single letters into 2,063 production rows. There is nothing
   * here for a stray byte to change the meaning of.
   */
  const byTarget = new Map<string, { to: string; froms: Set<string>; ids: string[] }>()
  for (const c of changes) {
    if (!byTarget.has(c.to)) byTarget.set(c.to, { to: c.to, froms: new Set(), ids: [] })
    const e = byTarget.get(c.to)!
    e.froms.add(c.team ?? '(null)')
    e.ids.push(c.id)
  }

  console.log(`\n  ${byTarget.size} distinct targets. Every value that would be written:`)
  const bad: string[] = []
  for (const g of [...byTarget.values()].sort((a, b) => b.ids.length - a.ids.length)) {
    // A display name is multi-word or a known single-word club; a 2–3 letter code is NOT a target.
    const looksLikeCode = /^[A-Z0-9]{2,3}$/.test(g.to)
    if (looksLikeCode) bad.push(g.to)
    console.log(
      `      ${String(g.ids.length).padStart(5)}  team := ${JSON.stringify(g.to)}${looksLikeCode ? '   <-- STILL A CODE' : ''}   from: ${[...g.froms].join(', ')}`,
    )
  }
  console.log(`\n  targets that are still codes: ${bad.length}   (must be 0)`)
  if (bad.length > 0) {
    console.error('  REFUSING — a target that is still a code means the fold did not resolve; nothing written.')
    process.exitCode = 1
    return
  }

  if (!apply) {
    console.log(`\n  DRY RUN — nothing written. Re-run with --apply --endpoint=${endpoint ?? '<id>'}`)
    return
  }

  let written = 0
  for (const g of byTarget.values()) {
    const r = await prisma.sportsPlayer.updateMany({ where: { id: { in: g.ids } }, data: { team: g.to } })
    written += r.count
    console.log(`      ${String(r.count).padStart(5)}  ${[...g.froms].join(', ')} -> ${g.to}`)
  }
  console.log(`\n  written: ${written}`)

  /*
   * ⚠ VERIFY AGAINST THE INTENDED VALUES, NOT AGAINST THE ABSENCE OF THE OLD ONES. Counting
   * "code-form rows remaining" would have read 0 in the position incident precisely BECAUSE the
   * data had been destroyed — a success condition satisfied by the failure.
   */
  const wantById = new Map<string, string>()
  for (const g of byTarget.values()) for (const id of g.ids) wantById.set(id, g.to)
  const after = await prisma.sportsPlayer.findMany({
    where: { id: { in: [...wantById.keys()] } },
    select: { id: true, team: true },
  })
  const wrong = after.filter((r) => wantById.get(r.id) !== r.team)
  console.log(`  verified: ${after.length - wrong.length}/${after.length} hold the intended display name`)
  for (const w of wrong.slice(0, 10)) {
    console.log(`      ${w.id}  now=${JSON.stringify(w.team)}  want=${JSON.stringify(wantById.get(w.id))}`)
  }
}

main()
  .catch((e) => console.error('failed:', e instanceof Error ? e.message.slice(0, 400) : e))
  .finally(() => prisma.$disconnect())
