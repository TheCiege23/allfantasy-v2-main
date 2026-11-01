/**
 * The save-time check on a C2C campus lineup (lib/c2c/campusLineup.ts), run by
 * persistRosterLineupWithEngine. Campus starters are refused outside a native NFL or NBA C2C league; inside
 * one they must be the team's college players and fit the league's college lineup slots
 * (`C2CLeagueConfig.collegeActiveLineupSlots`). Positions come from the roster rows, not the client.
 */
import type { PrismaClient } from '@prisma/client'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { getC2CConfig } from '@/lib/merged-devy-c2c/C2CLeagueConfig'
import { campusSport, campusStarterIds, isC2CVariant, validateCampusLineup, type CampusLineupIssue } from './campusLineup'

type League = { id: string; platform: string | null; sport: string | null; leagueVariant: string | null }

export async function checkCampusSave(
  db: Pick<PrismaClient, 'redraftRosterPlayer'>,
  input: { league: League; redraftRosterId: string | null; before: unknown; after: unknown },
): Promise<CampusLineupIssue[]> {
  const campus = campusStarterIds(input.after)
  // Unchanged campus starters are not re-judged, so a commissioner narrowing the college slots never
  // blocks a manager's pro lineup save; the next campus change has to fit.
  if (campus.length === 0 || campus.join('\n') === campusStarterIds(input.before).join('\n')) return []
  if (!isNativePlatform(input.league.platform) || !input.redraftRosterId || !isC2CVariant(input.league.leagueVariant)) {
    return [{ code: 'campus_not_c2c', message: 'Campus lineups are only for Campus to Canton leagues.' }]
  }
  const sport = campusSport(input.league)
  const config = sport ? await getC2CConfig(input.league.id) : null
  const rows = sport
    ? await db.redraftRosterPlayer.findMany({
        where: { rosterId: input.redraftRosterId, droppedAt: null },
        select: { playerId: true, position: true, playerName: true },
      })
    : []
  const byId = new Map(rows.map((r) => [r.playerId, r]))
  return validateCampusLineup({
    before: input.before,
    after: input.after,
    slots: config?.collegeActiveLineupSlots,
    positionOf: (id) => byId.get(id)?.position ?? null,
    nameOf: (id) => byId.get(id)?.playerName ?? id,
    sport,
  })
}
