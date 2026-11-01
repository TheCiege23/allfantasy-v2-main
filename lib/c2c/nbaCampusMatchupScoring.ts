import type { PrismaClient } from '@prisma/client'
import { normalizeGameStatus } from '@/lib/sports/gameStatus'
import { readRiScheduleWindow, scheduleKeyPrefix } from '@/lib/sports-data/riScheduleCache'
import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { bridgeNcaabCampusTeams } from '@/lib/redraft/ncaabCampusTeamBridge'
import { nbaCampusWeekCacheKey } from './storeNbaCampusWeekSnapshot'
import { nbaCampusGameMappingKey } from './refreshNbaCampusWeek'
import { ESPN_COLLEGE_BOX_KEY_PREFIX } from '@/lib/espn/ingestNcaabCollegeBoxes'
import { campusStarterIds } from './campusLineup'
import { nbaCampusScheduleCoversWindow } from './nbaCampusScheduleCoverage'
import { scoreEspnCampusEvidence, type EspnCampusPlayer } from './nbaEspnCampusScoring'
import type { EspnCollegeBoxScore } from '@/lib/espn/espnNcaabBoxScore'

type Db = Pick<PrismaClient, 'roster' | 'sportsDataCache' | 'teamProviderIdentity' | 'afRosterLineupAssignment'>
type TeamScore = { points: number; missingPlayerIds: string[]; allFinal: boolean }
const object = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {}

/** Read stored weekly campus evidence and ESPN boxes; this function never calls a provider. */
export async function nbaCampusPointsForMatchup(db: Db, input: {
  leagueId: string; season: number; week: number; homeRosterId: string; awayRosterId: string; now: Date
  scorer: (stats: Record<string, number>, position: string) => number
}): Promise<{ home: TeamScore; away: TeamScore } | null> {
  const redraftIds = [...new Set([input.homeRosterId, input.awayRosterId])]
  const rosters = await db.roster.findMany({ where: { leagueId: input.leagueId, redraftRosterId: { in: redraftIds } }, select: { id: true, redraftRosterId: true, playerData: true } })
  const rows = await db.afRosterLineupAssignment.findMany({ where: { rosterId: { in: rosters.map(r => r.id) }, season: input.season, week: input.week }, select: { rosterId: true, playerId: true, section: true } })
  const selected = new Map<string, string[]>()
  const unknown = new Map<string, string[]>()
  for (const redraftId of redraftIds) {
    const roster = rosters.find(r => r.redraftRosterId === redraftId)
    if (!roster) { unknown.set(redraftId, [`campus-roster:${redraftId}`]); selected.set(redraftId, []); continue }
    const rosterRows = rows.filter(r => r.rosterId === roster.id)
    const current = campusStarterIds(roster.playerData)
    if (!rosterRows.length && current.length) unknown.set(redraftId, current)
    selected.set(redraftId, rosterRows.filter(r => r.section === 'campus').map(r => r.playerId))
  }
  const snapshotKeys = rosters.map(r => nbaCampusWeekCacheKey(input.leagueId, r.id, input.season, input.week))
  const cacheKeys = [...snapshotKeys, nbaCampusGameMappingKey(input.season, input.week), `${scheduleKeyPrefix('NCAAB', input.season)}meta`]
  const cached = await db.sportsDataCache.findMany({ where: { cacheKey: { in: cacheKeys }, expiresAt: { gt: input.now } }, select: { cacheKey: true, data: true } })
  const byKey = new Map(cached.map(c => [c.cacheKey, c.data]))
  const players: EspnCampusPlayer[] = []
  const selectedAt = new Map<string, number>()
  const teamForPlayer = new Map<string, string>()
  for (const redraftId of redraftIds) {
    const roster = rosters.find(r => r.redraftRosterId === redraftId)
    if (!roster) continue
    const snapshot = object(byKey.get(nbaCampusWeekCacheKey(input.leagueId, roster.id, input.season, input.week)))
    const validSnapshot = snapshot.season === input.season && snapshot.week === input.week && Array.isArray(snapshot.players)
    const snapshotPlayers = validSnapshot ? snapshot.players : []
    const assigned = selected.get(redraftId) ?? []
    const snapshotIds = snapshotPlayers.map((p: any) => p?.id)
    if (!validSnapshot || snapshotIds.length !== assigned.length || snapshotIds.some((id: unknown) => typeof id !== 'string' || !assigned.includes(id))) unknown.set(redraftId, [...(unknown.get(redraftId) ?? []), `campus-lineup:${redraftId}`])
    for (const id of assigned) {
      const matches = snapshotPlayers.filter((p: any) => p?.id === id)
      const p = matches.length === 1 ? object(matches[0]) : {}
      if (!/^\d+$/.test(String(p.espnId ?? '')) || id !== `espn:ncaab:${p.espnId}` || !/^\d+$/.test(String(p.teamId ?? '')) || typeof p.position !== 'string' || !Number.isFinite(Date.parse(String(p.selectedAt ?? '')))) { unknown.set(redraftId, [...(unknown.get(redraftId) ?? []), id]); continue }
      selectedAt.set(id, Date.parse(String(p.selectedAt)))
      teamForPlayer.set(id, String(p.teamId))
      players.push({ id, espnId: String(p.espnId), espnTeamId: String(p.teamId), riTeamId: '', position: p.position })
    }
  }
  const bridge = await bridgeNcaabCampusTeams(db, [...new Set(teamForPlayer.values())])
  for (const player of players) player.riTeamId = bridge.resolved.get(player.espnTeamId) ?? ''
  const window = resolveDailySportWeekWindow('NBA', input.season, input.week)
  const schedule = window ? await readRiScheduleWindow(db as never, { sport: 'NCAAB', season: input.season, window }) : null
  const meta = object(byKey.get(`${scheduleKeyPrefix('NCAAB', input.season)}meta`))
  const scheduleCoversWindow = nbaCampusScheduleCoversWindow(meta, window)
  const mapping = object(byKey.get(nbaCampusGameMappingKey(input.season, input.week)))
  const mappings = mapping.season === input.season && mapping.week === input.week && Array.isArray(mapping.mappings) ? mapping.mappings : []
  const eventForGame = new Map<string, string>()
  for (const g of schedule ?? []) {
    const found = mappings.filter((m: any) => m?.gameId === g.gameId && m.day === g.day && m.homeTeamId === g.homeTeamId && m.awayTeamId === g.awayTeamId && /^\d+$/.test(String(m.eventId ?? '')))
    if (found.length === 1) eventForGame.set(g.gameId, String(found[0].eventId))
  }
  const eventIds = [...new Set(eventForGame.values())]
  const boxRows = eventIds.length ? await db.sportsDataCache.findMany({ where: { cacheKey: { in: eventIds.map(id => `${ESPN_COLLEGE_BOX_KEY_PREFIX}${id}`) }, expiresAt: { gt: input.now } }, select: { cacheKey: true, data: true } }) : []
  const boxes = new Map<string, EspnCollegeBoxScore>()
  for (const row of boxRows) {
    const box = object(row.data)
    if (typeof box.eventId === 'string' && row.cacheKey === `${ESPN_COLLEGE_BOX_KEY_PREFIX}${box.eventId}` && Array.isArray(box.players)) boxes.set(box.eventId, box as EspnCollegeBoxScore)
  }
  const scores = scoreEspnCampusEvidence({ players, games: schedule, eventForGame, boxes, scheduleCoversWindow, windowClosed: Boolean(window && input.now.getTime() >= window.end.getTime() + 6 * 60 * 60 * 1000), scorer: input.scorer })
  const allSelected = [...selected.values()].flat()
  for (const score of scores) {
    const player = players.find(p => p.id === score.playerId)!
    const games = (schedule ?? []).filter(g => (g.homeTeamId === player.riTeamId || g.awayTeamId === player.riTeamId) && normalizeGameStatus(g.status) !== 'cancelled')
    const tooLate = games.some(g => !g.startTime || !Number.isFinite(Date.parse(g.startTime)) || (selectedAt.get(player.id) ?? Infinity) > Date.parse(g.startTime))
    if (tooLate || allSelected.filter(id => id === score.playerId).length > 1) { score.missing = true; score.allFinal = false }
  }
  const scoreById = new Map(scores.map(s => [s.playerId, s]))
  const team = (id: string): TeamScore => {
    const assigned = selected.get(id) ?? []
    const values = assigned.map(p => scoreById.get(p)).filter((p): p is NonNullable<typeof p> => Boolean(p))
    const missing = [...(unknown.get(id) ?? []), ...values.filter(v => v.missing).map(v => v.playerId)]
    return { points: Math.round(values.reduce((sum, v) => sum + v.points, 0) * 100) / 100, missingPlayerIds: [...new Set(missing)], allFinal: missing.length === 0 && values.every(v => v.allFinal) }
  }
  return { home: team(input.homeRosterId), away: team(input.awayRosterId) }
}
