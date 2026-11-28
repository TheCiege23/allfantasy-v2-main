import 'server-only'
import type { LeagueSport } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getPlayerPoolForLeague } from '@/lib/sport-teams/SportPlayerPoolResolver'
import { readAllFantasyAdpForLeague } from '@/lib/adp/readSnapshotForLeague'
import { buildPlayerKey } from '@/lib/adp/computeAllFantasyAdp'
import { resolveRosterDisplayNames } from '@/lib/guillotine/rosterDisplayNames'
import {
  buildPlayerPoolCsvRows,
  playerPoolCsvFilename,
  toPlayerPoolCsv,
  type CsvPoolPlayer,
  type CsvRoster,
} from './playerPoolCsv'

/**
 * The reads behind "Download player CSV" (lib/league-export/playerPoolCsv.ts). Same pool the draft room
 * and the waiver wire use (`getPlayerPoolForLeague`, so a college league's school scope applies), the
 * league's own rosters, and the league's AllFantasy ADP board.
 *
 * ⚠ ADP IS OPTIONAL. The board is empty for a league context nobody has drafted in, and a failed read
 * must not cost the member the rest of the file: the column is blank, never invented.
 *
 * ⚠ NAMES NEVER FALL BACK TO AN EMAIL — `resolveRosterDisplayNames` does not select one.
 */
const POOL_LIMIT = 5000

export async function loadLeaguePlayerPoolCsv(
  leagueId: string,
): Promise<{ filename: string; csv: string; rows: number } | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { name: true, season: true, sport: true },
  })
  if (!league) return null

  const [pool, rosters, teams, adp] = await Promise.all([
    getPlayerPoolForLeague(leagueId, league.sport as LeagueSport, { limit: POOL_LIMIT }),
    prisma.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true, playerData: true } }),
    prisma.leagueTeam.findMany({ where: { leagueId }, select: { externalId: true, teamName: true, ownerName: true } }),
    readAllFantasyAdpForLeague(leagueId).catch(() => null),
  ])
  const displayNames = await resolveRosterDisplayNames(
    leagueId,
    rosters.map((r) => r.id),
  ).catch(() => new Map<string, string>())

  const teamByExternal = new Map(teams.map((t) => [t.externalId, t]))
  const csvRosters: CsvRoster[] = rosters.map((r, i) => {
    const t = teamByExternal.get(r.platformUserId)
    const manager = t?.ownerName?.trim() || displayNames.get(r.id) || ''
    return {
      rosterId: r.id,
      teamName: t?.teamName?.trim() || manager || `Team ${i + 1}`,
      managerName: manager,
      playerData: r.playerData,
    }
  })

  const csvPool: CsvPoolPlayer[] = pool.map((p) => ({
    afId: p.player_id,
    sleeperId: p.sleeper_id ?? null,
    providerId: p.external_source_id ?? null,
    name: p.full_name,
    position: p.position,
    team: p.team_abbreviation ?? p.team ?? null,
    injury: p.injury_status ?? null,
  }))

  const adpByKey = new Map<string, number>()
  for (const e of adp?.entries ?? []) {
    const key = buildPlayerKey(e.playerName, e.position)
    if (!adpByKey.has(key)) adpByKey.set(key, e.adp)
  }

  const rows = buildPlayerPoolCsvRows({ pool: csvPool, rosters: csvRosters, adpByKey, playerKey: buildPlayerKey })
  return {
    filename: playerPoolCsvFilename(league.name, league.season ?? null),
    csv: toPlayerPoolCsv(rows),
    rows: rows.length,
  }
}
