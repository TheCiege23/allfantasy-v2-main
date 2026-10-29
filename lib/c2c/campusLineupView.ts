/**
 * What the Team tab's campus lineup panel shows a native football C2C team (lib/c2c/campusLineup.ts):
 * the league's campus seats, the team's college players (its devy section) and which of them start on
 * campus, and the college weeks this NFL week counts (lib/c2c/campusWeeks.ts). Null for every other
 * league, so the panel never renders there. Positions come from the roster rows, the same ones the
 * save check (lib/c2c/campusLineupCheck.ts) judges by.
 */
import type { PrismaClient } from '@prisma/client'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { getC2CConfig } from '@/lib/merged-devy-c2c/C2CLeagueConfig'
import { campusSeats, campusStarterIds, collegePlayerIds, isFootballC2CLeague } from './campusLineup'
import { loadCfbWeeksForNflWeek } from './campusWeeks'

export type CampusLineupPlayer = { id: string; name: string; position: string; team: string | null }

export type CampusLineupView = {
  seats: string[]
  starterIds: string[]
  players: CampusLineupPlayer[]
  /** The college weeks the NFL week being scored counts; empty once the college season is over. */
  cfbWeeks: number[]
  nflWeek: number
}

export async function loadCampusLineupView(
  db: Pick<PrismaClient, 'redraftRosterPlayer' | 'redraftRoster' | 'sportsGame'>,
  input: {
    league: { id: string; platform: string | null; sport: string | null; leagueVariant: string | null }
    playerData: unknown
    redraftRosterId: string | null
  },
): Promise<CampusLineupView | null> {
  if (!input.redraftRosterId || !isNativePlatform(input.league.platform) || !isFootballC2CLeague(input.league)) return null
  const [config, rows, redraft] = await Promise.all([
    getC2CConfig(input.league.id),
    db.redraftRosterPlayer.findMany({
      where: { rosterId: input.redraftRosterId, droppedAt: null },
      select: { playerId: true, playerName: true, position: true, team: true },
    }),
    db.redraftRoster.findUnique({
      where: { id: input.redraftRosterId },
      select: { season: { select: { season: true, currentWeek: true } } },
    }),
  ])
  const college = collegePlayerIds(input.playerData)
  const players = rows
    .filter((r) => college.has(r.playerId))
    .map((r) => ({ id: r.playerId, name: r.playerName, position: r.position, team: r.team ?? null }))
  const onTeam = new Set(players.map((p) => p.id))
  const season = redraft?.season?.season ?? null
  const nflWeek = Math.max(1, redraft?.season?.currentWeek ?? 1)
  const cfbWeeks = season ? await loadCfbWeeksForNflWeek(db, { season, nflWeek }) : []
  return {
    seats: campusSeats(config?.collegeActiveLineupSlots),
    starterIds: campusStarterIds(input.playerData).filter((id) => onTeam.has(id)),
    players,
    cfbWeeks,
    nflWeek,
  }
}
