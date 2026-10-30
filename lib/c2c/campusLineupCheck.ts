/**
 * The save-time check on a C2C campus lineup (lib/c2c/campusLineup.ts), run by
 * persistRosterLineupWithEngine. Campus starters are refused outside a native football C2C league; inside
 * one they must be the team's college players and fit the league's college lineup slots
 * (`C2CLeagueConfig.collegeActiveLineupSlots`). Positions come from the roster rows, not the client.
 */
import type { PrismaClient } from '@prisma/client'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { getC2CConfig } from '@/lib/merged-devy-c2c/C2CLeagueConfig'
import { currentNcaabRosterEvidence } from '@/lib/devy/ncaabRosterPool'
import { bridgeNcaabCampusTeams } from '@/lib/redraft/ncaabCampusTeamBridge'
import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { readRiScheduleWindow } from '@/lib/sports-data/riScheduleCache'
import { nbaCampusMoveLock } from './nbaCampusMoveLock'
import { campusStarterIds, isC2CVariant, isFootballC2CLeague, isBasketballC2CLeague, validateCampusLineup, type CampusLineupIssue } from './campusLineup'

type League = { id: string; platform: string | null; sport: string | null; leagueVariant: string | null }

export async function checkCampusSave(
  db: Pick<PrismaClient, 'redraftRosterPlayer' | 'sportsDataCache' | 'teamProviderIdentity'>,
  input: { league: League; redraftRosterId: string | null; before: unknown; after: unknown; season?: number; week?: number; now?: Date },
): Promise<CampusLineupIssue[]> {
  const campus = campusStarterIds(input.after)
  // Unchanged campus starters are not re-judged, so a commissioner narrowing the college slots never
  // blocks a manager's pro lineup save; the next campus change has to fit.
  if (campus.length === 0 || campus.join('\n') === campusStarterIds(input.before).join('\n')) return []
  if (!isNativePlatform(input.league.platform) || !input.redraftRosterId || !isC2CVariant(input.league.leagueVariant)) {
    return [{ code: 'campus_not_c2c', message: 'Campus lineups are only for Campus to Canton leagues.' }]
  }
  const football = isFootballC2CLeague(input.league)
  const basketball = isBasketballC2CLeague(input.league)
  const config = football || basketball ? await getC2CConfig(input.league.id) : null
  const rows = football || basketball
    ? await db.redraftRosterPlayer.findMany({
        where: { rosterId: input.redraftRosterId, droppedAt: null },
        select: { playerId: true, position: true, playerName: true },
      })
    : []
  const byId = new Map(rows.map((r) => [r.playerId, r]))
  const issues = validateCampusLineup({
    before: input.before,
    after: input.after,
    slots: config?.collegeActiveLineupSlots,
    positionOf: (id) => byId.get(id)?.position ?? null,
    nameOf: (id) => byId.get(id)?.playerName ?? id,
    football,
    basketball,
  })
  if (issues.length || !basketball) return issues
  const before = new Set(campusStarterIds(input.before))
  const after = new Set(campus)
  const changed = [...new Set([...before, ...after])].filter(id => before.has(id) !== after.has(id))
  const window = input.season && input.week ? resolveDailySportWeekWindow('NBA', input.season, input.week) : null
  if (!window) return [{ code: 'campus_ineligible', message: 'College game schedule is unavailable; try again when the schedule is ready.' }]
  try {
    const now = input.now ?? new Date()
    const [evidence, games] = await Promise.all([
      currentNcaabRosterEvidence(db, now),
      readRiScheduleWindow(db as never, { sport: 'NCAAB', season: input.season!, window }),
    ])
    const athletes = new Map(evidence.athletes.map(a => [a.id, a]))
    const teamIds = changed.map(id => athletes.get(id)?.teamId).filter((id): id is string => Boolean(id))
    const teamBridge = await bridgeNcaabCampusTeams(db, teamIds)
    const teamForPlayer = new Map<string, string>()
    for (const id of changed) { const teamId = athletes.get(id)?.teamId; const ri = teamId ? teamBridge.resolved.get(teamId) : null; if (ri) teamForPlayer.set(id, ri) }
    const lock = nbaCampusMoveLock({ changedPlayerIds: changed, teamForPlayer, games, now })
    if (lock.lockedPlayerIds.length) return [{ code: 'campus_ineligible', message: 'A college player’s game has started, so that campus spot is locked.' }]
    if (lock.unknownPlayerIds.length) return [{ code: 'campus_ineligible', message: 'College game or roster information is unavailable; try again when it refreshes.' }]
    return []
  } catch {
    return [{ code: 'campus_ineligible', message: 'College game or roster information is unavailable; try again when it refreshes.' }]
  }
}
