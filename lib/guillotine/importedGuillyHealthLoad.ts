import 'server-only'

/**
 * Loads the imported Guilly check (./importedGuillyHealth.ts) for the league's Sync screen
 * (lib/core-app/leagueSync.ts). Null for a native league or a league that is not Guilly.
 *
 * Every id here is the PROVIDER's: `WeeklyMatchup` is keyed by the provider's league id and roster
 * id, and `LeagueTeam.externalId` is that roster id (the slot number, for Sleeper). A roster's player
 * count comes from our `Roster` row, joined to its team by the owner's platform user id.
 */
import { prisma } from '@/lib/prisma'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { resolveLeagueStage } from '@/lib/league-stage/leagueStage'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { assessImportedGuilly, importedGuillyFormat, type ImportedGuillyHealth } from './importedGuillyHealth'

export type ImportedGuillyHealthView = ImportedGuillyHealth & {
  /** Provider roster id → team name, for the card. */
  teamNames: Record<string, string>
}

export async function loadImportedGuillyHealth(
  league: {
    id: string
    platform: string | null
    platformLeagueId: string | null
    season: number | null
    leagueType: string | null
    guillotineMode: boolean | null
    settings: unknown
    status: string | null
    lifecycleState: string | null
  },
  lastReadAt: Date | null,
  now: Date = new Date(),
): Promise<ImportedGuillyHealthView | null> {
  if (isNativePlatform(league.platform)) return null
  if (!importedGuillyFormat(league)) return null

  const [rows, teams, rosters] = await Promise.all([
    league.platformLeagueId && league.season != null
      ? prisma.weeklyMatchup.findMany({
          where: { leagueId: league.platformLeagueId, seasonYear: league.season },
          select: { week: true, rosterId: true, pointsFor: true, matchupId: true },
        })
      : Promise.resolve([]),
    prisma.leagueTeam.findMany({ where: { leagueId: league.id }, select: { externalId: true, teamName: true, platformUserId: true } }),
    prisma.roster.findMany({ where: { leagueId: league.id }, select: { platformUserId: true, playerData: true } }),
  ])

  const playersByOwner = new Map(rosters.map((r) => [r.platformUserId, getRosterPlayerIds(r.playerData).length]))
  const teamRosters = teams
    .filter((t) => t.platformUserId && playersByOwner.has(t.platformUserId))
    .map((t) => ({ rosterId: String(t.externalId), players: playersByOwner.get(t.platformUserId!)! }))
  // The week being (or last) played: the latest week with any score. Chopped teams post zeros every week,
  // so "the first unplayed week" would stop at the first chop.
  const scoredWeeks = rows.filter((r) => r.pointsFor > 0).map((r) => r.week)
  const currentWeek = scoredWeeks.length ? Math.max(...scoredWeeks) : null

  const health = assessImportedGuilly({
    leagueType: league.leagueType,
    guillotineMode: league.guillotineMode,
    settings: league.settings,
    rows: rows.map((r) => ({ week: r.week, rosterId: String(r.rosterId), pointsFor: r.pointsFor, matchupId: r.matchupId })),
    rosters: teamRosters,
    currentWeek,
    lastReadAt,
    inSeason: resolveLeagueStage(league) === 'in_season',
    now,
  })
  if (!health) return null
  return { ...health, teamNames: Object.fromEntries(teams.map((t) => [String(t.externalId), t.teamName])) }
}
