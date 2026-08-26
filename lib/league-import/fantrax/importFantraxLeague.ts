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
  getFantraxLeagueInfo,
  getFantraxPlayerIds,
  getFantraxTeamRosters,
  resolveRosters,
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

  const [rosters, playerMap] = await Promise.all([
    getFantraxTeamRosters(args.leagueId),
    /* CFB, not NFL — different id spaces, and the wrong one resolves nothing
       and looks exactly like an empty league. */
    getFantraxPlayerIds('CFB'),
  ])
  if (!rosters.ok) return { ok: false, error: rosters.failure.message }
  if (!playerMap.ok) return { ok: false, error: playerMap.failure.message }

  const resolved = resolveRosters(rosters.data, playerMap.data)
  const total = resolved.reduce((a, r) => a + r.total, 0)
  const named = resolved.reduce((a, r) => a + r.resolved, 0)

  /*
   * ⚠ A LEAGUE WHERE ALMOST NOTHING RESOLVED IS THE WRONG SPORT MAP, NOT AN
   * EMPTY LEAGUE. Storing it would persist rosters of anonymous ids.
   */
  if (total > 0 && named / total < 0.5) {
    return {
      ok: false,
      error: `only ${named} of ${total} players could be named, which is the signature of the wrong sport map rather than a real league. Nothing was imported.`,
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
    sport: 'cfb',
    teamCount: resolved.length,
    userTeam: mine.teamName,
    isDevy: true,
    roster: mine.players as unknown as object,
    standings: summarise(resolved) as unknown as object,
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

function summarise(resolved: ResolvedRoster[]) {
  return resolved.map((r) => ({
    team: r.teamName,
    rosterCount: r.total,
    namedCount: r.resolved,
  }))
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
  if (claimed && claimed.linkId !== args.linkId) {
    return { ok: false, error: 'that league is already part of another franchise' }
  }

  const link = args.linkId
    ? await prisma.franchiseLink.findFirst({
        where: { id: args.linkId, ownerUserId: args.ownerUserId },
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
