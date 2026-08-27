/**
 * Import one Fantrax league from its id, and attach it to a franchise.
 *
 * The same work `scripts/import-fantrax-league.ts` does, callable from a
 * request so the connect-a-league flow can run it.
 *
 * ⚠ THE SECRET ID NEVER REACHES THIS MODULE. Discovery (getFantraxLeagues) hands
 * back league ids and stops; the import works from the league id alone, which is
 * not a credential. Nothing here stores, logs or forwards a Secret ID.
 */

import 'server-only'

import { prisma } from '@/lib/prisma'
import {
  flattenFantraxSchedule,
  getFantraxLeagueInfo,
  getFantraxPlayerIds,
  getFantraxStandings,
  getFantraxTeamRosters,
  resolveRosters,
  type FantraxStandingRow,
  type ResolvedRoster,
} from './fantraxApi'

export type FantraxImportOutcome =
  | {
      ok: true
      fantraxLeagueId: string
      leagueName: string
      season: number
      teamName: string
      resolved: number
      total: number
    }
  | { ok: false; error: string; teams?: string[] }

/**
 * Fetch, resolve and store one Fantrax league.
 *
 * ⚠ REFUSES TO GUESS WHICH TEAM IS THE USER'S. `teamName` must name a team the
 * league actually contains; the caller shows the list and the user picks.
 * Defaulting to the first roster attributes a stranger's players to them and
 * then grades trades against those players.
 */
export async function importFantraxLeague(args: {
  leagueId: string
  teamName: string
  appUserId: string
}): Promise<FantraxImportOutcome> {
  const info = await getFantraxLeagueInfo(args.leagueId)
  if (!info.ok) return { ok: false, error: info.failure.message }

  const [rosters, standings, cfb, nfl] = await Promise.all([
    getFantraxTeamRosters(args.leagueId),
    getFantraxStandings(args.leagueId),
    getFantraxPlayerIds('CFB'),
    getFantraxPlayerIds('NFL'),
  ])
  if (!rosters.ok) return { ok: false, error: rosters.failure.message }
  /* Only one map has to load. A league is one sport, so failing the whole
     import because the OTHER sport's map was unavailable would be wrong. */
  if (!cfb.ok && !nfl.ok) return { ok: false, error: cfb.failure.message }

  /*
   * ⚠ THE SPORT IS NOT IN THE LEAGUE INFO, SO IT IS MEASURED RATHER THAN
   * ASSUMED. `getLeagueInfo` returns a name, a season and teams — nothing that
   * says college or pro. The id spaces do not overlap at all (measured on a real
   * college league: 0 of 38 ids in the NFL map, 447 of 466 in CFB), so whichever
   * map names more players IS the sport. Hardcoding CFB made every NFL Fantrax
   * league look empty, which is why the tile could only ever claim college.
   */
  const candidates = [
    cfb.ok ? { sport: 'cfb' as const, isDevy: true, resolved: resolveRosters(rosters.data, cfb.data) } : null,
    nfl.ok ? { sport: 'nfl' as const, isDevy: false, resolved: resolveRosters(rosters.data, nfl.data) } : null,
  ].filter((c): c is NonNullable<typeof c> => c !== null)

  const scored = candidates
    .map((c) => ({ ...c, named: c.resolved.reduce((a, r) => a + r.resolved, 0) }))
    .sort((a, b) => b.named - a.named)

  const best = scored[0]
  const resolved = best.resolved
  const total = resolved.reduce((a, r) => a + r.total, 0)
  const named = best.named

  /*
   * ⚠ A LEAGUE WHERE ALMOST NOTHING RESOLVED IS THE WRONG SPORT MAP, NOT AN
   * EMPTY LEAGUE. Storing it would persist rosters of anonymous ids. Now that
   * both maps are tried, reaching here means NEITHER fits — so the message says
   * that rather than blaming one of them.
   */
  if (total > 0 && named / total < 0.5) {
    return {
      ok: false,
      error: `only ${named} of ${total} players could be named against either the college or the NFL player map, which is the signature of a sport we do not handle rather than a real league. Nothing was imported.`,
    }
  }

  const mine = resolved.find(
    (r) => r.teamName.toLowerCase() === args.teamName.trim().toLowerCase(),
  )
  if (!mine) {
    return {
      ok: false,
      error: `no team named "${args.teamName}" in that league`,
      teams: resolved.map((r) => r.teamName),
    }
  }

  const season = Number(info.data.seasonYear) || new Date().getFullYear()

  const fantraxUser = await prisma.fantraxUser.upsert({
    where: { fantraxUsername: mine.teamName },
    create: { fantraxUsername: mine.teamName, displayName: mine.teamName },
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
  /* Mirrors the upload route's rule: a snapshot owned by a different real
     account is never silently overwritten. */
  if (existing?.appUserId && existing.appUserId !== args.appUserId) {
    return { ok: false, error: 'that league snapshot is already owned by a different AllFantasy account' }
  }

  const payload = {
    appUserId: args.appUserId,
    sport: best.sport,
    teamCount: resolved.length,
    userTeam: mine.teamName,
    isDevy: best.isDevy,
    /*
     * ⚠ EVERY TEAM'S ROSTER, NOT JUST THE IMPORTER'S. The CSV export only ever
     * contained your own squad, so the column was shaped for one team and the
     * fetch service gave the other eleven an empty roster. The live API returns
     * all of them in the same call we already make, so throwing eleven away
     * meant importing a league whose opponents had no players — and an opponent
     * with no players cannot be scouted, matched up or traded with.
     *
     * Each row carries `teamName` so the reader can group them. A row without
     * one is a CSV-era roster and still belongs to the uploader's team, which is
     * how the old snapshots keep working.
     */
    roster: resolved.flatMap((r) =>
      r.players.map((pl) => ({ ...pl, teamName: r.teamName })),
    ) as unknown as object,
    standings: summarise(resolved, standings.ok ? standings.data : null) as unknown as object,
    /*
     * ⚠ THE SCHEDULE WAS ALREADY IN A RESPONSE WE FETCH AND WAS BEING DROPPED.
     * `getLeagueInfo` was read for the league name and the team list; it also
     * carries every period's fixtures and the real playoff boundary, so every
     * imported Fantrax league arrived with no schedule and no playoff structure
     * while the data sat in the same object.
     */
    matchups: flattenFantraxSchedule(info.data) as unknown as object,
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

  return {
    ok: true,
    fantraxLeagueId: row.id,
    leagueName: info.data.leagueName,
    season,
    teamName: mine.teamName,
    resolved: mine.resolved,
    total: mine.total,
  }
}

/**
 * The standings row per team, as the snapshot column stores it.
 *
 * ⚠ RANK USED TO BE ARRAY POSITION. This function returned only roster counts,
 * so the reader numbered teams 1..N in whatever order `getTeamRosters` happened
 * to return them and reported 0-0 records — a table that looks authoritative,
 * disagrees with the league, and is indistinguishable from a correct preseason
 * one until week one. Fantrax publishes the real thing on `getStandings`.
 *
 * ⚠ AND WHEN STANDINGS COULD NOT BE READ, RANK IS NULL RATHER THAN A GUESS. A
 * missing table should read as missing; inventing an order is what this is
 * fixing.
 */
function summarise(resolved: ResolvedRoster[], standings: FantraxStandingRow[] | null) {
  const byName = new Map(
    (standings ?? []).map((row) => [row.teamName.trim().toLowerCase(), row]),
  )
  return resolved.map((r) => {
    const row = byName.get(r.teamName.trim().toLowerCase()) ?? null
    return {
      team: r.teamName,
      rosterCount: r.total,
      namedCount: r.resolved,
      rank: row?.rank ?? null,
      wins: row?.wins ?? null,
      losses: row?.losses ?? null,
      ties: row?.ties ?? null,
      pointsFor: row?.pointsFor ?? null,
      /* Fantrax reports no points-against, and a zero would read as a real one. */
      pointsAgainst: null,
      /* The durable id, so a team rename does not create a new team. */
      fantraxTeamId: row?.teamId ?? null,
    }
  })
}

/**
 * Attach an imported league to a franchise, creating the franchise if needed.
 *
 * ⚠ `(platform, leagueId)` IS UNIQUE, so a league already attached to another
 * franchise is refused rather than moved. Silently re-parenting someone's league
 * would empty the franchise it came from.
 */
export async function attachToFranchise(args: {
  ownerUserId: string
  franchiseName: string
  linkId?: string | null
  role: 'pro' | 'college'
  platform: string
  leagueId: string
  teamExternalId: string
}): Promise<{ ok: true; linkId: string } | { ok: false; error: string }> {
  const claimed = await prisma.franchiseLeagueMember.findFirst({
    where: { platform: args.platform, leagueId: args.leagueId },
    select: { linkId: true },
  })
  /*
   * ⚠ THIS TOLD PEOPLE THEIR OWN LEAGUE BELONGED TO SOMEBODY ELSE.
   *
   * The check compared link IDs only, so a league already attached to a franchise
   * THIS SAME USER owns was refused exactly like one owned by a stranger. That is
   * precisely what a re-import hits: the first import creates the franchise link,
   * and every attempt afterwards dies on a message that reads as an ownership
   * conflict with another account. Measured on production 2026-08-27 — the single
   * Fantrax row in `franchise_league_members` is the owner's own Cream Bowl link,
   * and it was blocking that owner.
   *
   * The rule is about the OWNER, not the link id. Someone else's franchise is still
   * refused: silently re-parenting it would empty the franchise it came from, which
   * is what the uniqueness note above is protecting.
   */
  let reclaimedLinkId: string | null = null
  if (claimed && claimed.linkId !== args.linkId) {
    const owner = await prisma.franchiseLink.findFirst({
      where: { id: claimed.linkId },
      select: { id: true, ownerUserId: true },
    })
    if (!owner || owner.ownerUserId !== args.ownerUserId) {
      return { ok: false, error: 'that league is already part of another franchise' }
    }
    // Their own franchise — reuse it rather than creating a second one for the
    // same league, which is what the unique (platform, leagueId) would reject.
    reclaimedLinkId = owner.id
  }

  const effectiveLinkId = args.linkId ?? reclaimedLinkId

  const link = effectiveLinkId
    ? await prisma.franchiseLink.findFirst({
        where: { id: effectiveLinkId, ownerUserId: args.ownerUserId },
        select: { id: true },
      })
    : await prisma.franchiseLink.create({
        data: { ownerUserId: args.ownerUserId, name: args.franchiseName },
        select: { id: true },
      })

  if (!link) return { ok: false, error: 'Franchise not found' }

  const roleTaken = await prisma.franchiseLeagueMember.findFirst({
    where: { linkId: link.id, role: args.role },
    select: { id: true },
  })

  if (roleTaken) {
    await prisma.franchiseLeagueMember.update({
      where: { id: roleTaken.id },
      data: { platform: args.platform, leagueId: args.leagueId, teamExternalId: args.teamExternalId },
    })
  } else {
    await prisma.franchiseLeagueMember.create({
      data: {
        linkId: link.id,
        role: args.role,
        platform: args.platform,
        leagueId: args.leagueId,
        teamExternalId: args.teamExternalId,
      },
    })
  }

  return { ok: true, linkId: link.id }
}
