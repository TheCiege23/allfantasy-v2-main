/**
 * What the Team tab's campus lineup panel shows a native C2C team (lib/c2c/campusLineup.ts): the
 * league's campus seats, the team's college players (its devy section) and which of them start on
 * campus, and what this week counts — the college football weeks of this NFL week
 * (lib/c2c/campusWeeks.ts), or for NBA C2C the dates whose college basketball games count. Null for every other
 * league, so the panel never renders there. Positions come from the roster rows, the same ones the
 * save check (lib/c2c/campusLineupCheck.ts) judges by.
 */
import type { PrismaClient } from '@prisma/client'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { getC2CConfig } from '@/lib/merged-devy-c2c/C2CLeagueConfig'
import { campusSeats, campusSport, campusStarterIds, collegePlayerIds, type CampusSport } from './campusLineup'
import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { ensureDailySportSeasonStart } from '@/lib/season-week/deriveDailySportSeasonStart'
import { loadCfbWeeksForNflWeek } from './campusWeeks'

export type CampusLineupPlayer = { id: string; name: string; position: string; team: string | null }

export type CampusLineupView = {
  /** Football (NFL C2C) or basketball (NBA C2C): which seat rules and which "this week counts" line apply. */
  sport: CampusSport
  seats: string[]
  starterIds: string[]
  players: CampusLineupPlayer[]
  /** The college weeks the NFL week being scored counts; empty once the college season is over. */
  cfbWeeks: number[]
  nflWeek: number
  /** Basketball: the `[start, end)` dates (ISO) of this week whose college games count; null when unknown. */
  window?: { start: string; end: string } | null
}

export async function loadCampusLineupView(
  db: Pick<PrismaClient, 'redraftRosterPlayer' | 'redraftRoster' | 'sportsGame' | 'sportsDataCache'>,
  input: {
    league: { id: string; platform: string | null; sport: string | null; leagueVariant: string | null }
    playerData: unknown
    redraftRosterId: string | null
  },
): Promise<CampusLineupView | null> {
  const sport = campusSport(input.league)
  if (!input.redraftRosterId || !isNativePlatform(input.league.platform) || !sport) return null
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
  const cfbWeeks = season && sport === 'football' ? await loadCfbWeeksForNflWeek(db, { season, nflWeek }) : []
  let window: CampusLineupView['window'] = undefined
  if (sport === 'basketball') {
    if (season) await ensureDailySportSeasonStart('NBA', season, { db: db as never }).catch(() => null)
    const dates = season ? resolveDailySportWeekWindow('NBA', season, nflWeek) : null
    window = dates ? { start: dates.start.toISOString(), end: dates.end.toISOString() } : null
  }
  return {
    sport,
    seats: campusSeats(config?.collegeActiveLineupSlots),
    starterIds: campusStarterIds(input.playerData).filter((id) => onTeam.has(id)),
    players,
    cfbWeeks,
    nflWeek,
    ...(sport === 'basketball' ? { window } : {}),
  }
}
