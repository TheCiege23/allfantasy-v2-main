/**
 * Delete rows in `sports_core_player_images` whose `player_id` matches no canonical `Player`.
 *
 * ⚠ THE ORPHANS ARE NOT AN INGEST-ORDERING BUG, SO DELETING THEM IS NOT HIDING ONE.
 * The tempting theory — "images were written before the players existed, fix the ordering" —
 * is wrong here, and it matters because that theory would make this script a cover-up.
 * Measured on production (443 rows, 215 orphaned):
 *
 *   - `resolvePlayerHeadshot`'s `resolveOnce` DERIVES a canonical id via
 *     `deriveCanonicalPlayerIdentity` whenever its caller has no `Player.id` to pass, and the
 *     write-through then persists a row under that id. Nothing checked the player existed.
 *   - `deriveCanonicalPlayerIdentity` switches its whole match key on its inputs:
 *     `sleeper:<id>` when a sleeperId is present, `SPORT|name|position|team` when not. The
 *     canonical backfill and a live request rarely hold identical inputs for the same human,
 *     so they derive DIFFERENT ids. 62 orphans were traced back to `sleeper:<id>` values that
 *     do resolve to a real `Player` — one whose stored id encodes the fallback key instead.
 *   - So the players were never missing. 213 of 215 orphans have a same-named NFL `Player`
 *     already in the table, covering 191 distinct people, 190 of whom already have an
 *     `image_url`. Backfilling `Player` rows for these ids would manufacture ~191 duplicate
 *     players — re-creating exactly the duplication the 2026-08-17 dedupe removed.
 *
 * The rows are therefore redundant cache entries keyed by an id nothing can look up. Deleting
 * them costs at most one provider re-resolution per affected player.
 *
 * The recurrence fix is NOT this script. It is the existence check added to
 * `writePrimaryPlayerImage`, plus the FK in
 * `prisma/migrations/20260817120000_player_image_player_fk`. Run those first; this script
 * only clears what was written before the guard existed.
 *
 * Usage:
 *   npx tsx scripts/cleanup-orphan-player-images.ts            # dry run, writes nothing
 *   npx tsx scripts/cleanup-orphan-player-images.ts --apply    # snapshot, then delete
 *
 * NOTE ON PATHS: these examples assume cwd is the checkout that CONTAINS this file. This
 * branch is usually checked out as a git worktree while the primary tree sits on another
 * branch, in which case run it from the primary tree with the worktree path, e.g.
 *   npx tsx .claude/worktrees/admiring-bassi-bff03b/scripts/cleanup-orphan-player-images.ts
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { prisma } from '../lib/prisma'

const APPLY = process.argv.includes('--apply')

/*
 * ⚠ ANCHORED TO THIS FILE, NOT TO cwd. The snapshot is a verbatim dump of PRODUCTION rows and
 * this repo is public, so it must land next to this script — where the matching .gitignore
 * rule lives — no matter which directory the command was run from. A cwd-relative path writes
 * the dump into whichever checkout you happened to be standing in, which for a worktree means
 * an unignored path in a different tree. (`scripts/dedupe-players.ts` still has this bug.)
 */
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))

type OrphanRow = {
  id: string
  player_id: string
  sport_key: string
  provider: string | null
  url: string
  created_at: Date
}

async function main() {
  const target = await prisma.$queryRawUnsafe<Array<{ db: string; host: string | null }>>(
    `SELECT current_database() AS db, inet_server_addr()::text AS host`,
  )
  console.log(`target: ${target[0].db} @ ${target[0].host ?? 'local'}`)
  console.log(APPLY ? 'MODE: APPLY (writes)' : 'MODE: dry run (no writes)')

  const orphans = await prisma.$queryRawUnsafe<OrphanRow[]>(
    `SELECT i.id, i.player_id, i.sport_key, i.provider, i.url, i.created_at
     FROM sports_core_player_images i
     WHERE i.player_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM "Player" p WHERE p.id = i.player_id)
     ORDER BY i.created_at, i.player_id`,
  )

  const total = await prisma.playerImage.count()
  console.log(`\nrows in sports_core_player_images: ${total}`)
  console.log(`orphaned (player_id names no Player): ${orphans.length}`)

  if (orphans.length === 0) {
    console.log('\nnothing to do.')
    await prisma.$disconnect()
    return
  }

  /*
   * Report what is being removed along the axes that would expose a WRONG diagnosis. If these
   * rows were really pre-ingest writes, they would cluster in one burst before a player-import
   * run and hold urls nothing else has. Orphans interleaved with healthy rows on the same days
   * mean a code path that is still live, which is the guard's problem, not this script's.
   */
  const byDay = new Map<string, number>()
  for (const o of orphans) {
    const d = new Date(o.created_at).toISOString().slice(0, 10)
    byDay.set(d, (byDay.get(d) ?? 0) + 1)
  }
  console.log('\n  orphans by day created:')
  for (const [day, n] of [...byDay].sort()) console.log(`    ${day}  ${n}`)

  const healthyByDay = await prisma.$queryRawUnsafe<Array<{ day: string; n: number }>>(
    `SELECT to_char(date_trunc('day', i.created_at), 'YYYY-MM-DD') AS day, COUNT(*)::int AS n
     FROM sports_core_player_images i
     WHERE i.player_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM "Player" p WHERE p.id = i.player_id)
     GROUP BY 1 ORDER BY 1`,
  )
  console.log('\n  healthy rows by day (interleaving = the writer is still live):')
  for (const r of healthyByDay) console.log(`    ${r.day}  ${r.n}`)

  console.log('\n  sample orphans:')
  orphans.slice(0, 8).forEach((o) => {
    console.log(`    ${o.player_id}  [${o.provider ?? 'none'}]  ${o.url.slice(0, 70)}`)
  })

  if (!APPLY) {
    console.log('\ndry run — nothing written. Re-run with --apply to execute.')
    await prisma.$disconnect()
    return
  }

  /*
   * ⚠ SNAPSHOT BEFORE THE FIRST WRITE. This runs against production and a DELETE has no undo.
   * `SELECT *` rather than the columns above, so the file can reconstruct the rows exactly.
   * The path is gitignored — it contains production data and this repo is public.
   */
  const takenAtIso = new Date().toISOString()
  const full = await prisma.$queryRawUnsafe<unknown[]>(
    `SELECT * FROM sports_core_player_images i
     WHERE i.player_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM "Player" p WHERE p.id = i.player_id)`,
  )
  const fs = await import('node:fs')
  const snapPath = path.join(
    SCRIPT_DIR,
    `.orphan-player-images-snapshot-${takenAtIso.replace(/[:.]/g, '-')}.json`,
  )
  fs.writeFileSync(
    snapPath,
    JSON.stringify({ takenAtIso, database: target[0].db, deletedImages: full }, null, 2),
    'utf8',
  )
  console.log(`\nsnapshot written: ${snapPath} (${full.length} rows)`)

  // Refuse to delete if the snapshot is not on disk and non-trivial. It is the only undo.
  const written = fs.statSync(snapPath).size
  if (!written || full.length !== orphans.length) {
    console.error(
      `\nABORTED: snapshot looks wrong (${written} bytes, ${full.length} rows vs ${orphans.length} expected). Nothing deleted.`,
    )
    await prisma.$disconnect()
    process.exit(1)
  }

  /*
   * ⚠ ONE TRANSACTION, AND RE-SELECTED INSIDE IT. Deleting by the id list read earlier would
   * race a concurrent `Player` insert: a player created between the read and the write would
   * make its image row legitimate, and we would delete a valid row. Re-evaluating the NOT
   * EXISTS inside the transaction means only rows still orphaned at commit time are removed.
   */
  const deleted = await prisma.$transaction(
    async (tx) =>
      tx.$executeRawUnsafe(
        `DELETE FROM sports_core_player_images i
         WHERE i.player_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM "Player" p WHERE p.id = i.player_id)`,
      ),
    { timeout: 600_000 },
  )
  console.log(`\napplied. rows deleted: ${deleted}`)

  // ⚠ POST-CONDITION, NOT A HOPE. Zero orphans is the claim this script makes.
  const after = await prisma.$queryRawUnsafe<Array<{ img: number; ident: number; remaining: number }>>(
    `SELECT
       (SELECT COUNT(*)::int FROM sports_core_player_images im
        WHERE im.player_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "Player" p WHERE p.id = im.player_id)) AS img,
       (SELECT COUNT(*)::int FROM sports_core_player_provider_identities i
        WHERE i.player_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "Player" p WHERE p.id = i.player_id)) AS ident,
       (SELECT COUNT(*)::int FROM sports_core_player_images) AS remaining`,
  )
  console.log(
    `orphaned image rows: ${after[0].img} | orphaned identity rows: ${after[0].ident} | rows remaining: ${after[0].remaining}`,
  )
  if (after[0].img !== 0) {
    console.error('\nPOST-CONDITION FAILED: orphans remain. Investigate before assuming success.')
    process.exitCode = 1
  }

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
