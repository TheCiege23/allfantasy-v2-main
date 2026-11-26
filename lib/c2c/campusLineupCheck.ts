/**
 * The save-time check on a C2C campus lineup (lib/c2c/campusLineup.ts), run by
 * persistRosterLineupWithEngine. Campus starters are refused outside a native NFL or NBA C2C league; inside
 * one they must be the team's college players and fit the league's college lineup slots
 * (`C2CLeagueConfig.collegeActiveLineupSlots`). Positions come from the roster rows, not the client.
 */
import type { PrismaClient } from '@prisma/client'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { getC2CConfig } from '@/lib/merged-devy-c2c/C2CLeagueConfig'
import { currentNcaabRosterEvidence } from '@/lib/devy/ncaabRosterPool'
import { bridgeNcaabCampusTeams } from '@/lib/redraft/ncaabCampusTeamBridge'
import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { readRiScheduleWindow, scheduleKeyPrefix } from '@/lib/sports-data/riScheduleCache'
import { nbaCampusScheduleCoversWindow } from './nbaCampusScheduleCoverage'
import { nbaCampusMoveLock } from './nbaCampusMoveLock'
import { footballCampusMoveLock } from './footballCampusMoveLock'
import { loadCfbWeeksForNflWeek } from './campusWeeks'
import { bridgeNcaafRosterIdsToCfbdIds } from '@/lib/redraft/ncaafGameLogIdBridge'
import { campusSport, campusStarterIds, isC2CVariant, validateCampusLineup, type CampusLineupIssue } from './campusLineup'

type League = { id: string; platform: string | null; sport: string | null; leagueVariant: string | null }

export async function checkCampusSave(
  db: Pick<PrismaClient, 'redraftRosterPlayer' | 'sportsDataCache' | 'teamProviderIdentity' | 'sportsGame' | 'sportsPlayer' | 'playerIdentityMap'>,
  input: { league: League; redraftRosterId: string | null; before: unknown; after: unknown; season?: number; week?: number; now?: Date },
): Promise<CampusLineupIssue[]> {
  const campus = campusStarterIds(input.after)
  // Unchanged campus starters are not re-judged, so a commissioner narrowing the college slots never
  // blocks a manager's pro lineup save; the next campus change has to fit.
  if (campus.join('\n') === campusStarterIds(input.before).join('\n')) return []
  // Emptying the campus lineup is free outside a native C2C league. Inside one it is still a move, so the
  // kickoff lock below judges it (2026-11-24: football used to skip the lock when the lineup emptied).
  if (campus.length === 0 && !(campusSport(input.league) && isNativePlatform(input.league.platform))) return []
  if (!isNativePlatform(input.league.platform) || !input.redraftRosterId || !isC2CVariant(input.league.leagueVariant)) {
    return [{ code: 'campus_not_c2c', message: 'Campus lineups are only for Campus to Canton leagues.' }]
  }
  const sport = campusSport(input.league)
  const basketball = sport === 'basketball'
  const config = sport ? await getC2CConfig(input.league.id) : null
  const rows = sport
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
    sport,
  })
  if (issues.length) return issues
  const before = new Set(campusStarterIds(input.before))
  const after = new Set(campus)
  const changed = [...new Set([...before, ...after])].filter(id => before.has(id) !== after.has(id))
  if (!basketball) return checkFootballCampusLock(db, { changed, season: input.season, week: input.week, now: input.now ?? new Date() })
  const window = input.season && input.week ? resolveDailySportWeekWindow('NBA', input.season, input.week) : null
  if (!window) return [{ code: 'campus_ineligible', message: 'College game schedule is unavailable; try again when the schedule is ready.' }]
  try {
    const now = input.now ?? new Date()
    const [evidence, games, meta] = await Promise.all([
      currentNcaabRosterEvidence(db, now),
      readRiScheduleWindow(db as never, { sport: 'NCAAB', season: input.season!, window }),
      db.sportsDataCache.findUnique({ where: { cacheKey: `${scheduleKeyPrefix('NCAAB', input.season!)}meta` } }),
    ])
    if (!meta || meta.expiresAt <= now || !nbaCampusScheduleCoversWindow(meta.data, window)) return [{ code: 'campus_ineligible', message: 'College game schedule is unavailable; try again when the schedule is ready.' }]
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

const FOOTBALL_LOCKED = 'A college player’s game has started, so that campus spot is locked.'
const FOOTBALL_UNKNOWN = 'College game or school information is unavailable; try again when it refreshes.'

/**
 * NFL C2C: a campus starter moved in or out must not have kicked off yet this NFL week (owner's decision,
 * 2026-11-24, per-player kickoff lock). His school comes from the CFBD pool through the same roster-id →
 * CFBD-id bridge campus scoring uses; the games are the college weeks this NFL week counts.
 */
async function checkFootballCampusLock(
  db: Pick<PrismaClient, 'sportsGame' | 'sportsPlayer' | 'playerIdentityMap'>,
  input: { changed: string[]; season?: number; week?: number; now: Date },
): Promise<CampusLineupIssue[]> {
  if (input.changed.length === 0) return []
  if (!input.season || !input.week) return [{ code: 'campus_ineligible', message: FOOTBALL_UNKNOWN }]
  try {
    const cfbWeeks = await loadCfbWeeksForNflWeek(db, { season: input.season, nflWeek: input.week })
    // No college week counts in this NFL week (before the college season, or after it): nothing kicks off.
    if (cfbWeeks.length === 0) return []
    const bridge = await bridgeNcaafRosterIdsToCfbdIds(db as never, input.changed, 'pool')
    const [pool, games] = await Promise.all([
      bridge.cfbdIds.length
        ? db.sportsPlayer.findMany({
            where: { sport: { in: ['NCAAF', 'ncaaf'] }, source: 'cfbd', externalId: { in: bridge.cfbdIds } },
            select: { externalId: true, college: true, team: true },
          })
        : Promise.resolve([] as Array<{ externalId: string; college: string | null; team: string | null }>),
      // The whole season's games: a school with no game THIS week is on a bye only if the schedule knows
      // the school at all; a name the schedule has never seen is "could not check", not "no game".
      db.sportsGame.findMany({
        where: { sport: 'NCAAF', source: 'cfbd', season: input.season, seasonType: 'regular' },
        select: { homeTeam: true, awayTeam: true, startTime: true, status: true, week: true },
      }),
    ])
    const norm = (v: string | null | undefined) => String(v ?? '').trim().toLowerCase()
    const knownSchools = new Set(games.flatMap((g) => [norm(g.homeTeam), norm(g.awayTeam)]).filter(Boolean))
    const thisWeek = games.filter((g) => g.week != null && cfbWeeks.includes(g.week))
    const schoolForPlayer = new Map<string, string>()
    for (const row of pool) {
      const rosterId = bridge.rosterIdFor(row.externalId)
      const school = row.college ?? row.team
      if (rosterId && school && !bridge.ambiguous.includes(rosterId) && knownSchools.has(norm(school))) schoolForPlayer.set(rosterId, school)
    }
    const lock = footballCampusMoveLock({ changedPlayerIds: input.changed, schoolForPlayer, games: thisWeek, now: input.now })
    if (lock.lockedPlayerIds.length) return [{ code: 'campus_ineligible', message: FOOTBALL_LOCKED }]
    if (lock.unknownPlayerIds.length) return [{ code: 'campus_ineligible', message: FOOTBALL_UNKNOWN }]
    return []
  } catch {
    return [{ code: 'campus_ineligible', message: FOOTBALL_UNKNOWN }]
  }
}
