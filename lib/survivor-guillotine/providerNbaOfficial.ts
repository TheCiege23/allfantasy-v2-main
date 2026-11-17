import 'server-only'
import { prisma } from '@/lib/prisma'
import { canonicalName } from '@/lib/draft-room/player-canonical-identity'
import { fetchOfficialNbaSchedule, fetchOfficialNbaLiveBox } from '@/lib/workers/providers/officialNbaLive'
import { writeRiGameRows, type RiGameWrite } from '@/lib/sports-data/writeRiGameRows'
import { coverageGameKey, writeStatCoverage, type StatCoverage } from '@/lib/sports-data/statCoverage'
import { dailyTeamCode } from '@/lib/redraft/dailyTeamIdentity'
import type { SGScheduledGame } from './providerSchedule'

export const SG_OFFICIAL_NBA_SOURCE = 'nba_official_live'
type Obj = Record<string, any>
const obj = (value: unknown): Obj => value && typeof value === 'object' && !Array.isArray(value) ? value as Obj : {}
type OfficialGame = { id: string; home: string; away: string; start: string; season: number }
type Identity = { id: string; canonicalName: string; rollingInsightsId: string | null }
// Verified against the official November 14 boxes and the primary NBA player catalog.
// Each alias checks BOTH provider IDs and BOTH names; suffixes are never dropped globally.
const aliases: Record<string, { official: string; primary: string; riId: string }> = {
  '1629023': { official: 'P.J. Washington Jr.', primary: 'PJ Washington', riId: '1083' },
  '1641713': { official: 'GG Jackson', primary: 'GG Jackson II', riId: '1551' },
  '1626171': { official: 'Bobby Portis Jr.', primary: 'Bobby Portis', riId: '74' },
  '1641842': { official: 'Ronald Holland II', primary: 'Ron Holland II', riId: '1640' },
  '1642449': { official: 'Tolu Smith', primary: 'Tolu Smith III', riId: '1643' },
  '1631095': { official: 'Jabari Smith Jr.', primary: 'Jabari Smith', riId: '1478' },
}
const fail = (code: string): never => { throw Error('OFFICIAL_NBA_' + code) }
const count = (v: unknown): number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : fail('INVALID_COUNT')
const duration = (v: unknown): number => {
  const match = typeof v === 'string' ? /^PT(\d+)M(\d{2}(?:\.\d+)?)S$/.exec(v) : null
  if (!match || Number(match[2]) >= 60) return fail('INVALID_MINUTES')
  return Number(match[1]) * 60 + Number(match[2])
}
const fields: Record<string, string> = { points: 'points', field_goals_made: 'fieldGoalsMade', field_goals_attempted: 'fieldGoalsAttempted',
  free_throws_made: 'freeThrowsMade', free_throws_attempted: 'freeThrowsAttempted', three_points_made: 'threePointersMade', three_points_attempted: 'threePointersAttempted',
  assists: 'assists', steals: 'steals', blocks: 'blocks', offensive_rebounds: 'reboundsOffensive', defensive_rebounds: 'reboundsDefensive', total_rebounds: 'reboundsTotal', turnovers: 'turnovers', fouls: 'foulsPersonal' }

export function officialNbaSchedule(payload: unknown, season: number): OfficialGame[] {
  const schedule = obj(obj(payload).leagueSchedule)
  if (String(schedule.seasonYear).slice(0,4) !== String(season) || !Array.isArray(schedule.gameDates)) return fail('SCHEDULE_SEASON_MISMATCH')
  const games: OfficialGame[] = schedule.gameDates.flatMap((day: Obj) => Array.isArray(day.games) ? day.games : []).flatMap((g: Obj) => {
    if (!String(g.gameId).startsWith('002' + String(season).slice(2))) return []
    // Published Cup placeholders have teamId=0; they cannot match a real league game.
    if (obj(g.homeTeam).teamId === 0 || obj(g.awayTeam).teamId === 0) return []
    const home = dailyTeamCode('NBA', obj(g.homeTeam).teamTricode), away = dailyTeamCode('NBA', obj(g.awayTeam).teamTricode), start = String(g.gameDateTimeUTC)
    if (!/^002\d{7}$/.test(String(g.gameId)) || !/^[A-Z]{3}$/.test(home) || !/^[A-Z]{3}$/.test(away) || home === away || !Number.isFinite(Date.parse(start))) return fail('INVALID_SCHEDULE_GAME')
    return [{ id: String(g.gameId), home, away, start, season }]
  })
  if (!games.length || new Set(games.map(g => g.id)).size !== games.length) return fail('DUPLICATE_OR_EMPTY_SCHEDULE')
  return games
}

export function matchOfficialNbaGame(expected: SGScheduledGame, games: OfficialGame[]) {
  const matches = games.filter(g => g.home === dailyTeamCode('NBA', expected.homeTeam) && g.away === dailyTeamCode('NBA', expected.awayTeam) && Date.parse(g.start) === expected.startTime.getTime())
  if (matches.length !== 1) return fail('SCHEDULE_GAME_MISMATCH')
  return matches[0]
}

export function prepareSGOfficialNbaBox(expected: SGScheduledGame, match: OfficialGame, payload: unknown, identities: Identity[], now = new Date()) {
  const game = obj(obj(payload).game), startTime = new Date(match.start)
  if (game.gameId !== match.id || game.gameStatus !== 3 || game.regulationPeriods !== 4 || !Number.isInteger(game.period) || game.period < 4 ||
      Date.parse(game.gameTimeUTC) !== startTime.getTime() || startTime.getTime() > now.getTime()) return fail('GAME_NOT_VERIFIED_FINAL')
  const expectedSeconds = 14400 + (game.period - 4) * 1500, rows: RiGameWrite[] = [], seen = new Set<string>(), officialIds = new Set<number>()
  const names = new Map<string, Identity[]>()
  for (const i of identities) if (i.rollingInsightsId) { const key = canonicalName(i.canonicalName); names.set(key, [...(names.get(key) ?? []), i]) }
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(startTime)
  for (const side of ['home', 'away'] as const) {
    const team = obj(game[side + 'Team']), totals = obj(team.statistics), code = match[side], opponent = side === 'home' ? match.away : match.home
    if (dailyTeamCode('NBA', team.teamTricode) !== code || !Array.isArray(team.players) || count(team.score) !== count(totals.points) || duration(totals.minutes) !== expectedSeconds) return fail('TEAM_MISMATCH')
    const counts: Array<Record<string, number>> = []; let seconds = 0
    for (const value of team.players) {
      const p = obj(value), stats = obj(p.statistics)
      if (p.played !== '1' && p.played !== '0') return fail('UNKNOWN_PARTICIPATION')
      if (p.played === '0') {
        if (duration(stats.minutes) !== 0 || Object.keys(fields).some(k => count(stats[fields[k]]) !== 0)) return fail('INCONSISTENT_DNP')
        continue
      }
      if (!Number.isSafeInteger(p.personId) || p.personId <= 0 || officialIds.has(p.personId) || typeof p.name !== 'string') return fail('INVALID_PLAYER')
      officialIds.add(p.personId)
      const alias = aliases[String(p.personId)]
      const reviewed = alias && canonicalName(alias.official) === canonicalName(p.name) ? alias : null
      const found = reviewed ? identities.filter(i => i.rollingInsightsId === reviewed.riId && canonicalName(i.canonicalName) === canonicalName(reviewed.primary)) : names.get(canonicalName(p.name)) ?? []
      if (found.length !== 1 || seen.has(found[0].id)) return fail('UNRESOLVED_PLAYER_' + p.personId)
      const identity = found[0], time = duration(stats.minutes), line = Object.fromEntries(Object.entries(fields).map(([key, source]) => [key, count(stats[source])]))
      if (line.points !== line.field_goals_made * 2 + line.three_points_made + line.free_throws_made || line.total_rebounds !== line.offensive_rebounds + line.defensive_rebounds ||
          line.field_goals_made > line.field_goals_attempted || line.free_throws_made > line.free_throws_attempted || line.three_points_made > line.three_points_attempted) return fail('PLAYER_TOTAL_MISMATCH')
      counts.push(line); seconds += time; seen.add(identity.id)
      rows.push({ playerId: identity.id, sportType: 'NBA', gameId: expected.externalId, providerGameId: expected.externalId, providerPlayerId: String(p.personId), season: match.season, weekOrRound: 0,
        statPayload: { ...line, player: p.name, minutes: String(stats.minutes), officialGameId: match.id, officialPlayerId: String(p.personId) },
        normalizedStatMap: { stats: line, seasonType: 'regular', scored: false, gameStartTimeUtc: startTime.toISOString(), officialGameId: match.id },
        source: SG_OFFICIAL_NBA_SOURCE, confidence: 1, team: code, opponent, gameDate: new Date(day + 'T00:00:00Z'), fetchedAt: now })
    }
    if (counts.length < 5 || Math.abs(seconds - expectedSeconds) > counts.length) return fail('TEAM_MINUTES_MISMATCH')
    for (const [key, source] of Object.entries(fields)) {
      // Official team reboundsTotal includes dead-ball/team rebounds; personal is the player sum.
      const totalKey = key === 'total_rebounds' ? 'reboundsPersonal' : source
      if (counts.reduce((n, line) => n + line[key], 0) !== count(totals[totalKey])) return fail('TEAM_TOTAL_MISMATCH_' + key)
    }
  }
  const coverage: StatCoverage = { sport: 'NBA', source: SG_OFFICIAL_NBA_SOURCE, periodId: expected.externalId, kind: 'game', identitySpace: 'canonical', season: match.season, week: null,
    startTime, endTime: startTime, teams: [match.home, match.away], participantIds: [...seen].sort(), gameKeys: [coverageGameKey({homeTeam:match.home,awayTeam:match.away,startTime}, v => v)] }
  return { rows, coverage, officialGameId: match.id, homeScore: count(obj(game.homeTeam).score), awayScore: count(obj(game.awayTeam).score) }
}

/** Only incomplete final primary boxes use this independently validated, atomic replacement. */
export async function recoverSGOfficialNbaGames(season: number, expected: SGScheduledGame[]) {
  if (!expected.length) return []
  const key = 'sg:nba-official-schedule:' + season, cached = await prisma.sportsDataCache.findUnique({where:{cacheKey:key}})
  let games: OfficialGame[]
  if (cached && cached.expiresAt > new Date() && Array.isArray(obj(cached.data).games)) games = obj(cached.data).games
  else {
    games = officialNbaSchedule(await fetchOfficialNbaSchedule(), season)
    const data = { games }, expiresAt = new Date(Date.now()+600000)
    await prisma.sportsDataCache.upsert({where:{cacheKey:key},create:{cacheKey:key,data,expiresAt},update:{data,expiresAt}})
  }
  const identities = await prisma.playerIdentityMap.findMany({where:{sport:'NBA',rollingInsightsId:{not:null}},select:{id:true,canonicalName:true,rollingInsightsId:true}})
  const results = []
  for (const target of expected) {
    const match = matchOfficialNbaGame(target,games), prepared = prepareSGOfficialNbaBox(target,match,await fetchOfficialNbaLiveBox(match.id),identities)
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`NBA:${target.externalId}`},0))`
      const schedule = await tx.sportsGame.findUnique({where:{sport_externalId_source:{sport:'NBA',externalId:target.externalId,source:'rolling_insights'}}})
      if (!schedule || schedule.season !== season || schedule.startTime?.getTime() !== target.startTime.getTime() || dailyTeamCode('NBA',schedule.homeTeam) !== match.home || dailyTeamCode('NBA',schedule.awayTeam) !== match.away) return fail('STORAGE_SCHEDULE_CHANGED')
      const previous = await tx.playerGameStat.findMany({where:{sportType:'NBA',gameId:target.externalId},select:{source:true}})
      if (previous.some(row=>!['rolling_insights_live',SG_OFFICIAL_NBA_SOURCE].includes(row.source??''))) return fail('STORAGE_SOURCE_CONFLICT')
      await tx.playerGameStat.deleteMany({where:{sportType:'NBA',gameId:target.externalId,playerId:{notIn:prepared.rows.map(row=>row.playerId)}}})
      await writeRiGameRows(tx,prepared.rows)
      await tx.sportsGame.update({where:{id:schedule.id},data:{homeScore:prepared.homeScore,awayScore:prepared.awayScore,status:'completed'}})
      await writeStatCoverage(tx,prepared.coverage)
    },{timeout:30000})
    results.push({gameId:target.externalId,officialGameId:match.id,source:SG_OFFICIAL_NBA_SOURCE,lines:prepared.rows.length,boxCertified:true,committed:true})
  }
  return results
}
