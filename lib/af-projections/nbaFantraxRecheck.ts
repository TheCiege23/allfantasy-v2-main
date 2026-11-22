import 'server-only'
import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { mapWithConcurrency } from '@/lib/concurrency/mapWithConcurrency'
import { canonicalName } from '@/lib/draft-room/player-canonical-identity'
import { prisma } from '@/lib/prisma'
import { dailyTeamCode } from '@/lib/redraft/dailyTeamIdentity'
import { resolveSportWeek } from '@/lib/season-week/seasonWeekService'
import { redactAndCap } from '@/lib/security/redactSecrets'
import { easternCalendarDay } from '@/lib/sports-data/easternGameDay'
import { officialNbaSchedule, prepareOfficialNbaFinalBox } from '@/lib/survivor-guillotine/providerNbaOfficial'
import { fetchOfficialNbaGameLog, fetchOfficialNbaLiveBox, fetchOfficialNbaPlayer,
  fetchOfficialNbaRoster, fetchOfficialNbaSchedule } from '@/lib/workers/providers/officialNbaLive'
import { MIN_PROJECTION_GAMES } from './buildAfProjection'
import { NBA_VERIFIED_BOX_SOURCE, readVerifiedNbaInactiveSince } from './nbaVerifiedSeasonLines'
import { writeAfProjectionSnapshots } from './writeAfProjectionSnapshots'

const SPORT = 'NBA'
export const NBA_FANTRAX_RECHECK_CONFIG = 'af:nba-fantrax-weekly-recheck:cohort'
const playerSelect = { id: true, canonicalName: true, dob: true, position: true, fantraxId: true,
  rollingInsightsId: true, sleeperNbaId: true } as const

function dictionary(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readTable(payload: unknown, name: string, requiredColumns: readonly string[]) {
  const sets = dictionary(payload).resultSets
  const set = Array.isArray(sets) ? sets.map(dictionary).find(row => row.name === name) : undefined
  const headers = set?.headers
  const values = set?.rowSet
  if (!Array.isArray(headers) || !Array.isArray(values) || !requiredColumns.every(column => headers.includes(column))) {
    throw new Error('Official NBA table is missing required columns: ' + name)
  }
  return values.map((row: unknown) => {
    if (!Array.isArray(row) || row.length !== headers.length) throw new Error('Invalid official NBA table row: ' + name)
    return Object.fromEntries(headers.map((column, i) => [column, row[i]])) as Record<string, unknown>
  })
}

function officialId(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid NBA person ID')
  return String(value)
}

function birthDay(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4}-\d{2}-\d{2})(?:T|$)/.exec(value.trim())
  return match?.[1] ?? null
}

function stableHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

const columns = {
  PTS: 'points', FGM: 'field_goals_made', FGA: 'field_goals_attempted', FG3M: 'three_points_made', FG3A: 'three_points_attempted',
  FTM: 'free_throws_made', FTA: 'free_throws_attempted', OREB: 'offensive_rebounds', DREB: 'defensive_rebounds',
  REB: 'total_rebounds', AST: 'assists', STL: 'steals', BLK: 'blocks', TOV: 'turnovers', PF: 'fouls',
} as const
const boxFields = Object.entries(columns)
type Appearance = { gameId: string; date: string; team: string; logVersion: string; totals: number[] }
type VerifiedAppearance = Omit<Appearance, 'totals'> & { seconds: number; stats: Record<string, number> }
type Game = ReturnType<typeof officialNbaSchedule>[number]

function readRoster(payload: unknown, teams: Set<string>) {
  const rows = readTable(payload, 'CommonAllPlayers', ['PERSON_ID', 'DISPLAY_FIRST_LAST', 'ROSTERSTATUS', 'TEAM_ID', 'TEAM_ABBREVIATION'])
  const roster = rows.map(row => {
    const id = officialId(row.PERSON_ID)
    const name = canonicalName(typeof row.DISPLAY_FIRST_LAST === 'string' ? row.DISPLAY_FIRST_LAST : null)
    const team = dailyTeamCode(SPORT, typeof row.TEAM_ABBREVIATION === 'string' ? row.TEAM_ABBREVIATION : null)
    if (!name || (row.ROSTERSTATUS !== 0 && row.ROSTERSTATUS !== 1)) throw new Error('Invalid official NBA roster entry')
    if (row.ROSTERSTATUS === 1 && typeof row.TEAM_ID === 'number' && row.TEAM_ID > 0 && teams.has(team)) return { id, name, team }
    // A roster inconsistency is different from an explicit inactive player with no NBA team.
    return { id, name, team: null, inactive: row.ROSTERSTATUS === 0 && row.TEAM_ID === 0 }
  })
  // An empty or truncated roster must not be interpreted as players losing their NBA eligibility.
  if (roster.filter(row => row.team).length < 300 || new Set(roster.map(row => row.id)).size !== roster.length) {
    throw new Error('Official NBA roster is incomplete or contains duplicate IDs')
  }
  return roster
}

function readAppearances(payload: unknown, season: number, schedule: Map<string, Game>) {
  const rows = readTable(payload, 'LeagueGameLog', ['SEASON_ID', 'PLAYER_ID', 'GAME_ID', 'GAME_DATE', 'TEAM_ABBREVIATION', 'MIN', ...Object.keys(columns)])
  const byPlayer = new Map<string, Appearance[]>()
  const seen = new Set<string>()
  for (const row of rows) {
    const gameId = row.GAME_ID
    if (typeof gameId !== 'string' || !gameId.startsWith('002' + String(season).slice(-2))) continue
    const game = schedule.get(gameId)
    if (!game?.final) continue
    const id = officialId(row.PLAYER_ID)
    const date = easternCalendarDay(new Date(game.start))?.toISOString().slice(0, 10)
    const team = dailyTeamCode(SPORT, typeof row.TEAM_ABBREVIATION === 'string' ? row.TEAM_ABBREVIATION : null)
    const totals = boxFields.map(([key]) => row[key])
    const key = id + ':' + gameId
    if (seen.has(key) || String(row.SEASON_ID) !== '2' + season || !date || date !== row.GAME_DATE ||
      (team !== game.home && team !== game.away) || totals.some(n => typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0)) {
      throw new Error('Invalid or duplicate official NBA game-log row for ' + gameId)
    }
    seen.add(key)
    const logVersion = stableHash([team, row.MIN, totals])
    const appearances = byPlayer.get(id) ?? []
    appearances.push({ gameId, date, team, logVersion, totals: totals as number[] })
    byPlayer.set(id, appearances)
  }
  if (schedule.size && !seen.size && [...schedule.values()].some(game => game.final)) throw new Error('Official NBA game log has no final games')
  return byPlayer
}

function verifyAppearance(id: string, names: Set<string>, appearance: Appearance,
  box: ReturnType<typeof prepareOfficialNbaFinalBox>): VerifiedAppearance | null {
  const player = box.players.find(row => row.id === id)
  if (!player && appearance.totals.every(n => n === 0)) return null // An official DNP is excluded by the box parser.
  if (!player || !names.has(canonicalName(player.name)) || player.team !== appearance.team || box.day !== appearance.date ||
    boxFields.some(([, field], i) => player.stats[field] !== appearance.totals[i])) {
    throw new Error('NBA final box and game log disagree for ' + appearance.gameId)
  }
  if (!player.seconds) return null
  const { totals: _totals, ...verified } = appearance
  return { ...verified, seconds: player.seconds, stats: player.stats }
}

function retainVerifiedGames(old: Record<string, unknown>, refs: Appearance[], id: string) {
  const cached = new Map<string, VerifiedAppearance>()
  if (old.officialPlayerId !== id || !Array.isArray(old.verifiedBoxes)) return cached
  const refsByGame = new Map(refs.map(ref => [ref.gameId, ref]))
  for (const value of old.verifiedBoxes) {
    const row = dictionary(value)
    const ref = typeof row.gameId === 'string' ? refsByGame.get(row.gameId) : undefined
    const stats = dictionary(row.stats)
    if (ref && row.date === ref.date && row.team === ref.team && row.logVersion === ref.logVersion &&
      typeof row.seconds === 'number' && Number.isFinite(row.seconds) && row.seconds > 0 &&
      boxFields.every(([, field], i) => stats[field] === ref.totals[i])) {
      cached.set(ref.gameId, { gameId: ref.gameId, date: ref.date, team: ref.team, logVersion: ref.logVersion,
        seconds: row.seconds, stats: stats as Record<string, number> })
    }
  }
  return cached
}

export async function runNbaFantraxProjectionRecheck(now = new Date()) {
  const config = await prisma.sportsDataCache.findUniqueOrThrow({ where: { cacheKey: NBA_FANTRAX_RECHECK_CONFIG }, select: { data: true } })
  const { leagueId, rosterIds } = dictionary(config.data)
  if (typeof leagueId !== 'string' || !Array.isArray(rosterIds) || !rosterIds.length || rosterIds.length > 150 ||
      rosterIds.some(id => typeof id !== 'string' || !/^[a-z0-9]+$/i.test(id)) || new Set(rosterIds).size !== rosterIds.length) {
    throw new Error('Invalid NBA Fantrax projection recheck configuration')
  }
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId }, select: { sport: true, season: true, platform: true } })
  if (league.sport !== SPORT || league.platform !== 'fantrax' || league.season == null) throw new Error('Expected an NBA Fantrax league')
  const season = league.season
  const signal = await resolveSportWeek(SPORT, season, { now })
  if (!signal.ok) throw new Error('NBA calendar: ' + signal.reason)
  const week = signal.state === 'played' ? signal.nextSportWeek : signal.sportWeek
  const result = { sport: SPORT, season, week: week ?? undefined, checked: rosterIds.length, linked: 0, projected: 0,
    weeklyWindow: signal.seasonType === 'regular' && week != null, activeWithGameLog: 0, activeVerified: 0, awaitingIdentity: 0,
    boxesVerified: 0, writer: [{ written: 0, seasonLinesWritten: 0 }], warnings: [] as string[] }
  if (!result.weeklyWindow || week == null) return result

  const owners = await prisma.playerIdentityMap.findMany({ where: { sport: SPORT, fantraxId: { in: rosterIds } }, select: playerSelect })
  const matches = owners.filter(owner => owners.filter(other => other.fantraxId === owner.fantraxId).length === 1)
  result.linked = matches.length
  if (matches.length !== rosterIds.length) result.warnings.push('Some monitored NBA Fantrax IDs do not have a unique AF identity')
  const playerIds = matches.map(row => row.id)
  const [directory, oldLines, snapshots, rosterResponse, logResponse, scheduleResponse] = await Promise.all([
    prisma.sportsPlayer.findMany({ where: { sport: SPORT, OR: [
      { source: 'sleeper', sleeperId: { in: matches.flatMap(row => row.sleeperNbaId ?? []) } },
      { source: 'rolling_insights', externalId: { in: matches.flatMap(row => row.rollingInsightsId ?? []) } },
    ] }, select: { source: true, externalId: true, sleeperId: true, name: true, dob: true } }),
    prisma.fantasyStatLine.findMany({ where: { playerId: { in: playerIds }, sport: SPORT, season: String(season), week: 0, source: NBA_VERIFIED_BOX_SOURCE },
      select: { playerId: true, stats: true } }),
    prisma.aFProjectionSnapshot.findMany({ where: { playerId: { in: playerIds }, sport: SPORT, season, week: null, eventId: null },
      select: { playerId: true, adjustmentFactors: true } }),
    fetchOfficialNbaRoster(season), fetchOfficialNbaGameLog(season), fetchOfficialNbaSchedule(),
  ])
  const groups = new Map(officialNbaSchedule(scheduleResponse, season).map(game => [game.id, game]))
  const roster = readRoster(rosterResponse, new Set([...groups.values()].flatMap(game => [game.home, game.away])))
  const logs = readAppearances(logResponse, season, groups)
  const linesByPlayer = new Map(oldLines.map(row => [row.playerId, dictionary(row.stats)]))
  const snapshotsByPlayer = new Map(snapshots.map(row => [row.playerId, dictionary(row.adjustmentFactors)]))
  const currentDay = easternCalendarDay(now)!.toISOString().slice(0, 10)
  const rebuild: string[] = []
  const requests = new Map<string, Promise<ReturnType<typeof prepareOfficialNbaFinalBox>>>()
  const readFinalBox = (gameId: string) => {
    let request = requests.get(gameId)
    if (!request) {
      request = fetchOfficialNbaLiveBox(gameId).then(payload => prepareOfficialNbaFinalBox(groups.get(gameId)!, payload, now))
      requests.set(gameId, request)
    }
    return request
  }

  await mapWithConcurrency(matches, 4, async (owner) => {
    try {
      const old = linesByPlayer.get(owner.id) ?? {}
      const sources = directory.filter(row => row.source === 'sleeper' ? row.sleeperId === owner.sleeperNbaId : row.externalId === owner.rollingInsightsId)
      const names = new Set([owner.canonicalName, ...sources.map(row => row.name)].map(canonicalName))
      const priorOfficialId = typeof old.officialPlayerId === 'string' ? old.officialPlayerId : null
      const candidates = roster.filter(row => (priorOfficialId ? row.id === priorOfficialId : names.has(row.name)) &&
        (row.id === priorOfficialId || row.team && (logs.get(row.id)?.length ?? 0) >= MIN_PROJECTION_GAMES))
      if (!candidates.length) return
      if (candidates.some(row => row.team && (logs.get(row.id)?.length ?? 0) >= MIN_PROJECTION_GAMES)) result.activeWithGameLog++
      const dates = new Set([owner.dob, ...sources.map(row => row.dob)].map(birthDay).filter(Boolean))
      if (dates.size !== 1 || !owner.position) {
        result.awaitingIdentity++
        return
      }
      const [dob] = dates
      const verified = []
      for (const candidate of candidates) {
        if (candidate.id === priorOfficialId) {
          verified.push(candidate)
          names.add(candidate.name)
          continue
        }
        const profile = readTable(await fetchOfficialNbaPlayer(candidate.id), 'CommonPlayerInfo', ['PERSON_ID', 'DISPLAY_FIRST_LAST', 'BIRTHDATE'])
        const bio = profile[0]
        if (profile.length === 1 && officialId(bio.PERSON_ID) === candidate.id && birthDay(bio.BIRTHDATE) === dob &&
          typeof bio.DISPLAY_FIRST_LAST === 'string' && names.has(canonicalName(bio.DISPLAY_FIRST_LAST))) verified.push(candidate)
      }
      if (verified.length !== 1) {
        result.awaitingIdentity++
        return
      }
      const person = verified[0]
      const refs = logs.get(person.id) ?? []
      let stats: Prisma.InputJsonObject
      let team: string | null = person.team
      if (!team) {
        // Reviewed inactive lines already carry their actual departure date.
        if (!person.inactive || old.nbaRecheckVerified !== true || typeof old.verifiedNbaTeam !== 'string') return
        team = old.verifiedNbaTeam
        const inactive = readVerifiedNbaInactiveSince(old) ?? currentDay
        stats = { ...old as Prisma.InputJsonObject, verifiedNbaInactiveSince: inactive,
          verifiedBoxVersion: stableHash([person.id, team, old.verifiedBoxes, inactive]) }
      } else {
        if (refs.length < MIN_PROJECTION_GAMES) return
        const cached = retainVerifiedGames(old, refs, person.id)
        const changes = refs.filter(ref => !cached.has(ref.gameId))
        const settled = await mapWithConcurrency(changes, 5, async ref => {
          try {
            return { box: verifyAppearance(person.id, names, ref, await readFinalBox(ref.gameId)) }
          } catch (error) {
            return { error }
          }
        })
        const failed = settled.find(read => 'error' in read)
        if (failed) throw failed.error
        for (const { box } of settled) {
          if (!box) continue
          cached.set(box.gameId, box)
          result.boxesVerified++
        }
        const boxes = [...cached.values()].sort((a, b) => a.gameId.localeCompare(b.gameId))
        if (boxes.length < MIN_PROJECTION_GAMES) return
        const gameIds = boxes.map(box => box.gameId)
        // An incomplete league game log cannot erase a previously verified appearance.
        if (Array.isArray(old.verifiedGameIds) && old.verifiedGameIds.some(id => !gameIds.includes(id))) {
          throw new Error('Official NBA activity omitted a previously verified box')
        }
        result.activeVerified++
        const totals = Object.fromEntries(boxFields.map(([, field]) => [field, boxes.reduce((n, box) => n + box.stats[field], 0)]))
        const seconds = Math.round(boxes.reduce((n, box) => n + box.seconds, 0) * 1000) / 1000
        stats = {
          riPlayerName: owner.canonicalName, position: owner.position, riTeam: team,
          regular_season: { ...totals, minutes: seconds, games_played: boxes.length },
          officialPlayerId: person.id, verifiedNbaTeam: team, nbaRecheckVerified: true,
          providerAtVerification: { source: 'nba_official_live', games: boxes.length, seconds },
          verifiedGameIds: gameIds, verifiedBoxes: boxes, verifiedThrough: boxes.map(box => box.date).sort().at(-1)!,
          verifiedBoxVersion: stableHash([person.id, team, boxes]),
        }
      }
      const version = stats.verifiedBoxVersion
      if (old.verifiedBoxVersion !== version) {
        const id = { playerId: owner.id, sport: SPORT, season: String(season), week: 0, source: NBA_VERIFIED_BOX_SOURCE }
        const data = { team, stats, fetchedAt: now, expiresAt: new Date(now.getTime() + 800 * 86400_000), fantasyPointsByScoringPreset: {} }
        await prisma.fantasyStatLine.upsert({ where: { uniq_fantasy_stat_line_player_week_source: id },
          create: { ...id, ...data }, update: data })
        result.writer[0].seasonLinesWritten++
      }
      const snapshot = snapshotsByPlayer.get(owner.id)
      if (snapshot?.verifiedBoxVersion !== version || snapshot.sourceSeason !== season) rebuild.push(owner.id)
    } catch (error) {
      result.warnings.push(redactAndCap(owner.canonicalName + ': ' + (error instanceof Error ? error.message : 'NBA final verification failed'), 250))
    }
  })
  if (rebuild.length) {
    const outcome = await writeAfProjectionSnapshots({ sport: SPORT, targetSeason: season, targetWeek: week,
      playerIds: rebuild, writeWeeklySnapshots: false })
    result.writer[0].written = outcome.written
    if (outcome.errors.length || outcome.written !== rebuild.length) {
      result.warnings.push(redactAndCap('NBA AF projection writer: ' + JSON.stringify({
        requested: rebuild.length, written: outcome.written, errors: outcome.errors, refusals: outcome.refusalsByReason,
      }), 300))
    }
  }
  // The league-scored AF board is the production read path for OS, Chimmy and league tools.
  const { loadLeaguePlayerMetrics } = await import('./leaguePlayerMetrics')
  const metrics = await loadLeaguePlayerMetrics({ leagueId, week, rosterIds, limit: rosterIds.length, includeTradeValues: false, now })
  if (metrics?.week === week && metrics.season === season) result.projected = metrics.rows.filter(row => row.weekly != null).length
  else result.warnings.push('NBA AF projection board was unavailable')
  return result
}
