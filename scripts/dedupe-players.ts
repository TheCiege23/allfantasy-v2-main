/**
 * Merge duplicate rows in the canonical `Player` table.
 *
 * ⚠ THE SCOPE IS DELIBERATELY MUCH NARROWER THAN "PLAYERS WITH THE SAME NAME".
 * Measured on production: 6,407 name+position+sport groups covering 13,394 rows —
 * but 5,783 of those groups span MORE THAN ONE TEAM, and in NCAAF/NCAAB that
 * overwhelmingly means different athletes who happen to share a name (five
 * distinct guards called "Jordan Davis", at five schools). Merging on name alone
 * would silently destroy thousands of real people. This script only ever
 * considers rows matching on name + position + sport + TEAM, which is 624 groups
 * / 1,300 rows, and even then it refuses any group whose provider ids disagree.
 *
 * ⚠ THE REFERENCE SURFACE WAS MEASURED, NOT ASSUMED. There are ZERO foreign key
 * constraints on Player.id, so nothing in the schema tells you what breaks. A
 * name-based sweep found 92 candidate columns; a FORMAT-based sweep of all 2,238
 * id-shaped text columns in the database (matching `nfl-aaron-rodgers-d6c41acc`)
 * found the true answer: exactly two columns hold Player.id —
 * sports_core_player_images.player_id and
 * sports_core_player_provider_identities.player_id. Both are repointed here.
 *
 * Run with no flag for a dry run. `--apply` writes, inside one transaction.
 */
import { prisma } from '../lib/prisma'

const APPLY = process.argv.includes('--apply')

/**
 * Which evidence of duplication to act on.
 *
 * `name`     — same name + position + sport + TEAM. Suggestive, never proof, so
 *              the provider-id gate below still has to clear it.
 * `provider` — two Player rows that a provider gives the SAME id. This is
 *              stronger evidence than any name match: the source itself asserts
 *              they are one athlete. It catches what `name` structurally cannot —
 *              rows differing only by position spelling (Grady Jarrett DE vs DT)
 *              or by a stale team (Joe Cardona LAR vs MIA) — which is exactly the
 *              residue the first pass left behind.
 */
const SCOPE = (process.argv.find((a) => a.startsWith('--scope='))?.split('=')[1] ?? 'name') as
  | 'name'
  | 'provider'

type Row = {
  id: string
  name: string
  position: string
  sport: string
  team: string | null
  providerIds: Record<string, string> | null
  identityCount: number
  imageCount: number
}

function pidKeys(p: Record<string, string> | null): string[] {
  return p ? Object.keys(p) : []
}

/**
 * ⚠ THIS IS THE SAFETY GATE, NOT A HEURISTIC. If two rows both carry the same
 * provider under DIFFERENT ids — say sleeper:96 and sleeper:5000 — they are two
 * different people who happen to share a name, position and team, and merging
 * them would fuse two athletes into one. Matching name/position/team is
 * suggestive; a contradicting provider id is proof, and proof wins.
 */
function providerIdsConflict(a: Row, b: Row): string | null {
  const pa = a.providerIds ?? {}
  const pb = b.providerIds ?? {}
  for (const k of Object.keys(pa)) {
    if (pb[k] != null && String(pb[k]) !== String(pa[k])) {
      return `${k}: ${pa[k]} vs ${pb[k]}`
    }
  }
  return null
}

/**
 * The survivor is the row other data already points at, then the one that knows
 * the most about itself. Ties break on id so two runs choose the same winner —
 * a non-deterministic survivor would make this script unrepeatable and its dry
 * run meaningless.
 */
function pickSurvivor(rows: Row[]): Row {
  return [...rows].sort((x, y) => {
    const ref = y.identityCount + y.imageCount - (x.identityCount + x.imageCount)
    if (ref !== 0) return ref
    const pk = pidKeys(y.providerIds).length - pidKeys(x.providerIds).length
    if (pk !== 0) return pk
    return x.id < y.id ? -1 : 1
  })[0]
}

async function main() {
  const target = await prisma.$queryRawUnsafe<any[]>(
    `SELECT current_database() db, inet_server_addr()::text host`
  )
  console.log(`target: ${target[0].db} @ ${target[0].host ?? 'local'}`)
  console.log(APPLY ? 'MODE: APPLY (writes)' : 'MODE: dry run (no writes)')

  console.log(`SCOPE: ${SCOPE}`)

  const NAME_SQL = `WITH g AS (
       SELECT lower(trim(name)) n, position, sport, team
       FROM "Player" WHERE team IS NOT NULL AND trim(name) <> ''
       GROUP BY 1,2,3,4 HAVING COUNT(*) > 1
     )
     SELECT p.id, p.name, p.position, p.sport, p.team, p.provider_ids AS "providerIds",
            (SELECT COUNT(*) FROM sports_core_player_provider_identities i WHERE i.player_id = p.id)::int AS "identityCount",
            (SELECT COUNT(*) FROM sports_core_player_images im WHERE im.player_id = p.id)::int AS "imageCount",
            lower(trim(p.name)) || '|' || p.position || '|' || p.sport || '|' || p.team AS gkey
     FROM "Player" p
     JOIN g ON lower(trim(p.name)) = g.n AND p.position = g.position
           AND p.sport = g.sport AND p.team = g.team
     ORDER BY gkey, p.id`

  /*
   * ⚠ SCOPED BY sport_key AS WELL AS provider. Rolling Insights reuses its numeric
   * ids ACROSS sports — id 340 is a different athlete in NFL than in NCAAB — so
   * grouping on (provider, provider_player_id) alone would fuse people from
   * different sports entirely. Counting it that way reported 15,291 groups; scoped
   * correctly it is 274, and none of them span a sport.
   */
  const PROVIDER_SQL = `WITH g AS (
       SELECT provider, sport_key, provider_player_id
       FROM sports_core_player_provider_identities
       WHERE player_id IS NOT NULL
       GROUP BY 1,2,3 HAVING COUNT(DISTINCT player_id) > 1
     )
     SELECT DISTINCT p.id, p.name, p.position, p.sport, p.team, p.provider_ids AS "providerIds",
            (SELECT COUNT(*) FROM sports_core_player_provider_identities i2 WHERE i2.player_id = p.id)::int AS "identityCount",
            (SELECT COUNT(*) FROM sports_core_player_images im WHERE im.player_id = p.id)::int AS "imageCount",
            g.provider || '|' || g.sport_key || '|' || g.provider_player_id AS gkey
     FROM g
     JOIN sports_core_player_provider_identities i
       ON i.provider = g.provider AND i.sport_key = g.sport_key
      AND i.provider_player_id = g.provider_player_id
     JOIN "Player" p ON p.id = i.player_id
     ORDER BY gkey, p.id`

  const rows = await prisma.$queryRawUnsafe<any[]>(SCOPE === 'provider' ? PROVIDER_SQL : NAME_SQL)

  const groups = new Map<string, Row[]>()
  for (const r of rows) {
    const arr = groups.get(r.gkey) ?? []
    arr.push(r as Row)
    groups.set(r.gkey, arr)
  }

  let merged = 0
  let losersToDelete = 0
  let skippedConflict = 0
  let identitiesRepointed = 0
  let imagesRepointed = 0
  let imagesDropped = 0
  const conflicts: string[] = []
  const plan: Array<{ survivor: Row; losers: Row[]; mergedPids: Record<string, string> }> = []

  for (const [gkey, rs] of groups) {
    /*
     * ⚠ NEVER MERGE ACROSS SPORTS, WHATEVER THE EVIDENCE SAYS. A provider id that
     * appears against two different sports is id reuse, not one athlete playing
     * both.
     */
    if (new Set(rs.map((r) => r.sport)).size > 1) {
      skippedConflict++
      if (conflicts.length < 8) conflicts.push(`${gkey} — spans sports: ${[...new Set(rs.map((r) => r.sport))].join('/')}`)
      continue
    }
    const survivor = pickSurvivor(rs)
    const losers = rs.filter((r) => r.id !== survivor.id)

    const bad = losers
      .map((l) => {
        const c = providerIdsConflict(survivor, l)
        return c ? `${gkey} — ${c}` : null
      })
      .filter(Boolean) as string[]

    if (bad.length > 0) {
      skippedConflict++
      if (conflicts.length < 8) conflicts.push(bad[0])
      continue
    }

    // Survivor's own values win; losers only contribute providers it lacks.
    const mergedPids: Record<string, string> = { ...(survivor.providerIds ?? {}) }
    for (const l of losers) {
      for (const [k, v] of Object.entries(l.providerIds ?? {})) {
        if (mergedPids[k] == null) mergedPids[k] = String(v)
      }
    }

    merged++
    losersToDelete += losers.length
    identitiesRepointed += losers.reduce((a, l) => a + l.identityCount, 0)
    imagesRepointed += losers.reduce((a, l) => a + l.imageCount, 0)
    plan.push({ survivor, losers, mergedPids })
  }

  console.log(`\ngroups considered (same name+position+sport+team): ${groups.size}`)
  console.log(`  mergeable:                 ${merged}`)
  console.log(`  refused (provider clash):  ${skippedConflict}`)
  console.log(`  Player rows to delete:     ${losersToDelete}`)
  console.log(`  identity rows to repoint:  ${identitiesRepointed}`)
  console.log(`  image rows to repoint:     ${imagesRepointed}`)
  if (conflicts.length) {
    console.log('\n  sample refusals (these are DIFFERENT people, correctly left alone):')
    conflicts.forEach((c) => console.log(`    ${c}`))
  }

  console.log('\n  sample merges:')
  plan.slice(0, 5).forEach((p) => {
    console.log(
      `    ${p.survivor.name} (${p.survivor.sport}/${p.survivor.position}/${p.survivor.team}) ` +
        `keep ${p.survivor.id} <- ${p.losers.map((l) => l.id).join(', ')} | pids ${JSON.stringify(p.mergedPids)}`
    )
  })

  if (!APPLY) {
    console.log('\ndry run — nothing written. Re-run with --apply to execute.')
    await prisma.$disconnect()
    return
  }

  /*
   * ⚠ SNAPSHOT BEFORE THE FIRST WRITE, BECAUSE THIS RUNS AGAINST PRODUCTION AND A
   * DELETE HAS NO UNDO. Everything needed to reconstruct the prior state is
   * captured: the full loser rows, the identity and image rows about to be
   * repointed, and each survivor's provider_ids as they were before the merge.
   * Without the survivors' ORIGINAL ids, restoring the deleted rows would still
   * leave the survivor carrying merged provider ids it never had.
   */
  const snapshot = {
    takenAtIso: new Date().toISOString(),
    database: `${target[0].db}`,
    groups: [] as unknown[],
  }
  for (const { survivor, losers } of plan) {
    const loserIds = losers.map((l) => l.id)
    const [full, idents, imgs] = await Promise.all([
      prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "Player" WHERE id = ANY($1::text[])`, loserIds),
      prisma.$queryRawUnsafe<any[]>(
        `SELECT * FROM sports_core_player_provider_identities WHERE player_id = ANY($1::text[])`,
        loserIds
      ),
      prisma.$queryRawUnsafe<any[]>(
        `SELECT * FROM sports_core_player_images WHERE player_id = ANY($1::text[])`,
        loserIds
      ),
    ])
    snapshot.groups.push({
      survivorId: survivor.id,
      survivorProviderIdsBefore: survivor.providerIds,
      deletedPlayers: full,
      repointedIdentities: idents,
      repointedImages: imgs,
    })
  }
  const fs = await import('node:fs')
  const nodePath = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  /*
   * ⚠ ANCHORED TO THIS FILE, NOT cwd. The snapshot is a verbatim dump of PRODUCTION rows and
   * this repo is public, so it must land beside the `.gitignore` rule that covers it no matter
   * which directory the command was run from. A cwd-relative path writes the dump into whichever
   * checkout you happened to be standing in — and from a git worktree that is a different tree,
   * where the ignore rule may not exist yet.
   */
  const snapPath = nodePath.join(
    nodePath.dirname(fileURLToPath(import.meta.url)),
    `.dedupe-players-snapshot-${SCOPE}-${snapshot.takenAtIso.replace(/[:.]/g, '-')}.json`,
  )
  fs.writeFileSync(snapPath, JSON.stringify(snapshot, null, 2), 'utf8')
  // The snapshot is the only undo for the deletes below — refuse to proceed without it.
  if (!fs.statSync(snapPath).size) {
    console.error('\nABORTED: snapshot is empty. Nothing merged or deleted.')
    await prisma.$disconnect()
    process.exit(1)
  }
  console.log(`\nsnapshot written: ${snapPath} (${snapshot.groups.length} groups)`)

  /*
   * ⚠ ONE TRANSACTION FOR THE WHOLE MERGE. A partial run leaves identity rows
   * pointing at Player rows that no longer exist, and with no FK constraints
   * nothing would complain — the corruption would surface later as a screen
   * quietly showing nothing.
   */
  await prisma.$transaction(
    async (tx) => {
      for (const { survivor, losers, mergedPids } of plan) {
        const loserIds = losers.map((l) => l.id)

        await tx.$executeRawUnsafe(
          `UPDATE "Player" SET provider_ids = $1::jsonb WHERE id = $2`,
          JSON.stringify(mergedPids),
          survivor.id
        )

        // The provider-identities unique index is (provider, sport_key,
        // league_key, provider_player_id) — player_id is NOT part of it, so a
        // repoint here can never collide.
        const ic = await tx.$executeRawUnsafe(
          `UPDATE sports_core_player_provider_identities SET player_id = $1
           WHERE player_id = ANY($2::text[])`,
          survivor.id,
          loserIds
        )
        identitiesRepointed += 0 * ic

        /*
         * Images ARE uniquely keyed on (player_id, image_type, url), so a loser
         * holding the same image as the survivor cannot be repointed. Those rows
         * are deleted rather than kept: they are the same picture of the same
         * person, and carrying a second copy pointed at a dead id is worse.
         */
        const dropped = await tx.$executeRawUnsafe(
          `DELETE FROM sports_core_player_images l
           WHERE l.player_id = ANY($1::text[])
             AND EXISTS (SELECT 1 FROM sports_core_player_images s
                         WHERE s.player_id = $2 AND s.image_type = l.image_type AND s.url = l.url)`,
          loserIds,
          survivor.id
        )
        imagesDropped += dropped

        await tx.$executeRawUnsafe(
          `UPDATE sports_core_player_images SET player_id = $1 WHERE player_id = ANY($2::text[])`,
          survivor.id,
          loserIds
        )

        await tx.$executeRawUnsafe(`DELETE FROM "Player" WHERE id = ANY($1::text[])`, loserIds)
      }
    },
    { timeout: 600_000 }
  )

  console.log(`\napplied. duplicate images dropped: ${imagesDropped}`)

  // ⚠ POST-CONDITION, NOT A HOPE. Zero orphans is the claim this script makes;
  // it is cheap to check and expensive to be wrong about.
  const orphans = await prisma.$queryRawUnsafe<any[]>(
    `SELECT
       (SELECT COUNT(*)::int FROM sports_core_player_provider_identities i
        WHERE i.player_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Player" p WHERE p.id = i.player_id)) AS ident,
       (SELECT COUNT(*)::int FROM sports_core_player_images im
        WHERE NOT EXISTS (SELECT 1 FROM "Player" p WHERE p.id = im.player_id)) AS img`
  )
  console.log(`orphaned identity rows: ${orphans[0].ident} | orphaned image rows: ${orphans[0].img}`)

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
