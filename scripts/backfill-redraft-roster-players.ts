/**
 * Backfill `RedraftRosterPlayer` from `Roster.playerData` for leagues that never got any.
 *
 * 🛑 WHY THIS SCRIPT EXISTS RATHER THAN JUST THE IMPORT WIRING.
 * `materializeRedraftSeasonForImportedLeague` now projects players, but its only caller is
 * `ImportedLeagueCommitService` — which runs on an import COMMIT. Every league already imported
 * never calls it again, so the wiring fixes future imports and leaves the existing ones untouched.
 * Measured on production 2026-09-04: 3,039 of 3,130 redraft rosters (97%) had no players, including
 * 100% of guillotine, zombie and survivor leagues. This is how those get theirs.
 *
 * The consequence of leaving them empty is not cosmetic: `captureSnapshot` builds its team profile
 * from `roster.players` and reads their positions to judge depth. With none it produces no profile
 * and the trade verdict degrades to "we could not price enough of this deal".
 *
 * ── SAFETY ────────────────────────────────────────────────────────────────────────────────
 * Create-only and idempotent. It never drops or updates a live row, so a league whose redraft
 * engines already own its roster is untouched — running twice is a no-op past the reads.
 *
 * ⚠ DRY RUN BY DEFAULT. Pass `--apply` to write. Without it this reports exactly what it would do
 * and changes nothing, because a bulk write across every league is not something to trigger by
 * running a file.
 *
 *   npx tsx scripts/backfill-redraft-roster-players.ts                 # report only
 *   npx tsx scripts/backfill-redraft-roster-players.ts --apply
 *   npx tsx scripts/backfill-redraft-roster-players.ts --apply --league <id>
 *   npx tsx scripts/backfill-redraft-roster-players.ts --apply --limit 5
 */

import { prisma } from '@/lib/prisma'
import { materializeRedraftRosterPlayersForLeague } from '@/lib/league-runtime/materializeRedraftRosterPlayers'

async function main() {
  const argv = process.argv.slice(2)
  const apply = argv.includes('--apply')
  const leagueArg = argv[argv.indexOf('--league') + 1]
  const onlyLeague = argv.includes('--league') && leagueArg ? leagueArg : null
  const limitArg = Number(argv[argv.indexOf('--limit') + 1])
  const limit = argv.includes('--limit') && Number.isFinite(limitArg) ? limitArg : null

  const leagues = await prisma.league.findMany({
    where: onlyLeague ? { id: onlyLeague } : {},
    select: { id: true, name: true, sport: true, leagueType: true },
    orderBy: { createdAt: 'asc' },
    ...(limit ? { take: limit } : {}),
  })

  console.log(`${apply ? 'APPLY' : 'DRY RUN'} — ${leagues.length} league(s)\n`)

  let totals = { leagues: 0, created: 0, present: 0, noLink: 0, noPlayers: 0 }

  for (const l of leagues) {
    /*
     * The count that decides whether this league needs anything, read BEFORE the work so the
     * report can say what changed rather than only what the end state is.
     */
    const emptyRosters = await prisma.redraftRoster.count({
      where: { leagueId: l.id, players: { none: {} } },
    })
    if (emptyRosters === 0) continue

    if (!apply) {
      console.log(`  would fix  ${l.id}  ${String(l.leagueType ?? '?').padEnd(11)} ${emptyRosters} empty roster(s)  ${l.name ?? ''}`)
      totals.leagues += 1
      continue
    }

    const r = await materializeRedraftRosterPlayersForLeague(l.id, { sport: l.sport })
    totals.leagues += 1
    totals.created += r.playersCreated
    totals.present += r.playersAlreadyPresent
    totals.noLink += r.rostersSkippedNoLink
    totals.noPlayers += r.rostersSkippedNoPlayers
    console.log(
      `  ${l.id}  created ${String(r.playersCreated).padStart(4)}  ` +
        `linked ${r.rostersLinked}/${r.rostersConsidered}  ` +
        `no-link ${r.rostersSkippedNoLink}  no-players ${r.rostersSkippedNoPlayers}  ${l.name ?? ''}`,
    )
  }

  console.log('\n──────────')
  if (!apply) {
    console.log(`${totals.leagues} league(s) would be touched. Re-run with --apply to write.`)
  } else {
    console.log(`leagues touched      ${totals.leagues}`)
    console.log(`players created      ${totals.created}`)
    console.log(`already present      ${totals.present}`)
    /*
     * ⚠ THESE TWO ARE REPORTED, NOT HIDDEN. A roster with no link has nowhere to write and stays
     * unpriceable; a roster whose `playerData` is genuinely empty is a real empty roster. Both look
     * identical in a "created N players" summary, and they need different follow-ups.
     */
    console.log(`skipped, no link     ${totals.noLink}`)
    console.log(`skipped, no players  ${totals.noPlayers}`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
