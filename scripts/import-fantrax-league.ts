/**
 * Import one Fantrax league by id, via the public fxea API.
 *
 * ⚠ THE REPO ASSUMED FANTRAX WAS A CSV UPLOAD. `parseFantraxFiles` takes
 * multipart CSVs and `FantraxLeagueFetchService` reads the resulting rows. There
 * is a live unauthenticated JSON API instead — see lib/league-import/fantrax/
 * fantraxApi.ts — so a league can be imported from its id alone, with no export
 * step and no file handling.
 *
 * ⚠ LEAGUE IDS ARE CASE-SENSITIVE. Take the id from the league URL exactly:
 *
 *     https://www.fantrax.com/fantasy/league/<id>/home
 *
 * An uppercased id returns HTTP 400 with a web page rather than a JSON error.
 *
 * ⚠ WRITES TO WHATEVER DATABASE THE ENV POINTS AT, and in this repo `.env.local`
 * IS PRODUCTION. The write is a single idempotent upsert keyed on
 * (userId, leagueName, season), so re-running replaces the snapshot rather than
 * duplicating it. Use --dry-run first; it fetches everything and writes nothing.
 *
 * Usage:
 *   npx tsx scripts/import-fantrax-league.ts --league=<id> --email=<you> [--dry-run]
 */

import { PrismaClient } from '@prisma/client'

import {
  getFantraxLeagueInfo,
  getFantraxPlayerIds,
  getFantraxTeamRosters,
  resolveRosters,
} from '../lib/league-import/fantrax/fantraxApi'

class ImportAbort extends Error {}

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}

async function main() {
  const leagueId = arg('league')
  const email = arg('email')
  const teamNameArg = arg('team')
  const dryRun = process.argv.includes('--dry-run')

  if (!leagueId) throw new ImportAbort('--league=<fantrax league id> is required')
  if (!email) throw new ImportAbort('--email=<your allfantasy email> is required')

  console.log(`Fantrax league : ${leagueId}`)
  console.log(`mode           : ${dryRun ? 'DRY RUN — nothing will be written' : 'WRITE'}`)

  const info = await getFantraxLeagueInfo(leagueId)
  if (!info.ok) throw new ImportAbort(`${info.failure.kind}: ${info.failure.message}`)

  const [rosters, playerMap] = await Promise.all([
    getFantraxTeamRosters(leagueId),
    /* CFB, not NFL — they are different id spaces and the wrong one resolves
       nothing, which looks exactly like an empty league. */
    getFantraxPlayerIds('CFB'),
  ])
  if (!rosters.ok) throw new ImportAbort(`${rosters.failure.kind}: ${rosters.failure.message}`)
  if (!playerMap.ok) throw new ImportAbort(`${playerMap.failure.kind}: ${playerMap.failure.message}`)

  const resolved = resolveRosters(rosters.data, playerMap.data)
  const total = resolved.reduce((a, r) => a + r.total, 0)
  const named = resolved.reduce((a, r) => a + r.resolved, 0)

  console.log(`league name    : ${info.data.leagueName}`)
  console.log(`season         : ${info.data.seasonYear}`)
  console.log(`teams          : ${resolved.length}`)
  console.log(`players        : ${named}/${total} named (${Math.round((named / total) * 100)}%)`)

  /*
   * ⚠ A LEAGUE WHERE ALMOST NOTHING RESOLVED IS THE WRONG SPORT MAP, NOT AN
   * EMPTY LEAGUE. Importing it would store rosters of anonymous ids.
   */
  if (total > 0 && named / total < 0.5) {
    throw new ImportAbort(
      `only ${named} of ${total} players could be named. That is the signature of the wrong ` +
        `sport map rather than a real league, so nothing was written.`,
    )
  }

  const prisma = new PrismaClient()
  try {
    const appUser = await prisma.appUser.findFirst({ where: { email }, select: { id: true } })
    if (!appUser) throw new ImportAbort(`no AllFantasy account found for ${email}`)

    /* Which team is the importer's. Named explicitly, or inferred only when the
       account's email local-part matches exactly one team. */
    const local = email.split('@')[0].toLowerCase()
    const candidates = resolved.filter((r) => r.teamName.toLowerCase() === (teamNameArg ?? '').toLowerCase())
    const inferred = teamNameArg
      ? candidates
      : resolved.filter((r) => r.teamName.toLowerCase().includes(local))
    if (inferred.length !== 1) {
      throw new ImportAbort(
        `could not identify your team. Pass --team="<exact team name>". Teams: ${resolved
          .map((r) => r.teamName)
          .join(', ')}`,
      )
    }
    const myTeam = inferred[0]
    console.log(`your team      : ${myTeam.teamName} (${myTeam.resolved}/${myTeam.total} named)`)

    if (dryRun) {
      console.log('\nDRY RUN — nothing written.')
      return
    }

    const season = Number(info.data.seasonYear) || new Date().getFullYear()

    const fantraxUser = await prisma.fantraxUser.upsert({
      where: { fantraxUsername: myTeam.teamName },
      create: { fantraxUsername: myTeam.teamName, displayName: myTeam.teamName },
      update: {},
      select: { id: true },
    })

    const existing = await prisma.fantraxLeague.findUnique({
      where: {
        userId_leagueName_season: {
          userId: fantraxUser.id,
          leagueName: info.data.leagueName,
          season,
        },
      },
      select: { appUserId: true },
    })
    /* Mirrors the upload route's ownership rule: a snapshot already owned by a
       different real account is never silently overwritten. */
    if (existing?.appUserId && existing.appUserId !== appUser.id) {
      throw new ImportAbort('this league snapshot is already owned by a different AllFantasy account')
    }

    const payload = {
      appUserId: appUser.id,
      sport: 'cfb',
      teamCount: resolved.length,
      userTeam: myTeam.teamName,
      isDevy: true,
      roster: myTeam.players as unknown as object,
      standings: resolved.map((r) => ({
        team: r.teamName,
        rosterCount: r.total,
        namedCount: r.resolved,
      })) as unknown as object,
      matchups: (info.data as unknown as { matchups?: unknown }).matchups as object,
    }

    const row = await prisma.fantraxLeague.upsert({
      where: {
        userId_leagueName_season: {
          userId: fantraxUser.id,
          leagueName: info.data.leagueName,
          season,
        },
      },
      create: { userId: fantraxUser.id, leagueName: info.data.leagueName, season, ...payload },
      update: payload,
      select: { id: true },
    })

    console.log(`\nimported. FantraxLeague id: ${row.id}`)
    console.log('⚠ This is a snapshot, not a live sync. Re-run to refresh it.')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error(err instanceof ImportAbort ? `\nABORTED — ${err.message}` : `import failed: ${err}`)
  process.exitCode = 1
})
