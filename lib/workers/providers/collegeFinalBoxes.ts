import { isDeepStrictEqual } from 'node:util'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { easternCalendarDay } from '@/lib/sports-data/easternGameDay'
import { parseRiScheduleSeason } from '@/lib/sports-data/riSeasonSchedule'
import { isFinalRiStatus, normalizedStatMapFor, normalizeRiGameBox } from '@/lib/sports-data/rollingInsightsGameLogs'
import { buildNcaabSchoolIndex, schoolForAppearance, schoolKey } from '@/lib/player-identity/ncaabSchoolCodes'
import { cfbdScheduleTeamKeys } from '@/lib/sports-data/collegeTeamNames'
import { riFetchRows } from './rollingInsightsRest'

export type CollegeSport = 'NCAAF' | 'NCAAB'
export type WatchedPlayer = { rosterId: string; name: string; acceptedNames: string[]; riId?: string; dates: string[] }

const nameKey = (value: string) => value.normalize('NFD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
const identitySelect = { id: true, canonicalName: true, currentTeam: true, position: true,
  rollingInsightsId: true, fantraxId: true, cfbdId: true } as const
type Identity = Prisma.PlayerIdentityMapGetPayload<{ select: typeof identitySelect }>

function matches(watch: WatchedPlayer, name: string | null) {
  return name != null && watch.acceptedNames.some(known => nameKey(known) === nameKey(name))
}

export function collegeBoxDates(players: WatchedPlayer[], now: Date, knownDates: string[] = []) {
  const today = easternCalendarDay(now)!
  const recent = [0, 1, 2].map(days => new Date(today.getTime() - days * 86400_000).toISOString().slice(0, 10))
  const logged = [...players.flatMap(p => p.dates), ...knownDates].filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day) && day < recent[2]!)
  const backlog = [...new Set(logged.sort().reverse())]
  const start = backlog.length > 5 ? Math.floor(now.getTime() / 3600_000) % backlog.length : 0
  return [...recent, ...backlog.slice(start), ...backlog.slice(0, start)].slice(0, 8)
}

export function hasCollegeBoxParticipation(sport: CollegeSport, stats: Record<string, number>) {
  if (sport === 'NCAAB') return stats.minutes > 0 && typeof stats.points === 'number'
  return ['passing_attempts', 'rushing_attempts', 'receptions', 'tackles', 'sacks', 'interceptions',
    'kick_returns', 'punt_returns', 'extra_points_attempted', 'field_goals_attempted'].some(key => stats[key] > 0)
}

async function watchIdentities(sport: CollegeSport, players: WatchedPlayer[]) {
  const owners = await prisma.playerIdentityMap.findMany({
    where: { sport, fantraxId: { in: players.map(p => p.rosterId) } }, select: identitySelect,
  })
  const unlinked = sport === 'NCAAB' ? players.filter(watch => !owners.some(owner => owner.fantraxId === watch.rosterId)) : []
  const linkedIds = [...new Set([...players.flatMap(p => p.riId ? [p.riId] : []), ...owners.flatMap(p => p.rollingInsightsId ? [p.rollingInsightsId] : [])])]
  const [sourceIdentities, teams] = await Promise.all([
    prisma.playerIdentityMap.findMany({ where: { sport, OR: [{ rollingInsightsId: { in: linkedIds } }, ...unlinked.flatMap(watch => watch.acceptedNames.map(name => ({ canonicalName: { equals: name, mode: 'insensitive' as const } })))] }, select: identitySelect }),
    prisma.sportsTeam.findMany({ where: { sport, source: 'rolling_insights' }, select: { name: true, shortName: true, externalId: true, source: true } }),
  ])
  const schools = buildNcaabSchoolIndex(teams)
  const ready = new Map<string, { watch: WatchedPlayer; owner: Identity; source: Identity; school: string; matchesGame: (team: string | null, id: string) => boolean }>()
  const schoolOf = (team: string | null) => sport === 'NCAAF' ? cfbdScheduleTeamKeys(team).exact : schoolKey(team)
  const matchesGame = (school: string) => (team: string | null, id: string) => schoolOf(schoolForAppearance(schools, team, id)) === school
  for (const watch of players) {
    const claims = owners.filter(row => row.fantraxId === watch.rosterId)
    if (claims.length !== 1 || !matches(watch, claims[0]!.canonicalName)) continue
    const owner = claims[0]!
    const riId = watch.riId ?? owner.rollingInsightsId
    if (!riId || (owner.rollingInsightsId && owner.rollingInsightsId !== riId)) continue
    const sources = sourceIdentities.filter(row => row.rollingInsightsId === riId)
    if (sources.length !== 1) continue
    const source = sources[0]!
    const school = schoolOf(source.currentTeam)
    if (!school || schoolOf(owner.currentTeam) !== school || !matches(watch, source.canonicalName)) continue
    if (source.fantraxId && source.fantraxId !== watch.rosterId) continue
    ready.set(riId, { watch, owner, source, school, matchesGame: matchesGame(school) })
  }
  // Collect the provider's own facts under its registry ID. The basketball planner still has to prove the roster link.
  for (const watch of unlinked) {
    for (const source of sourceIdentities) {
      const id = source.rollingInsightsId
      const school = schoolOf(source.currentTeam)
      if (!id || !school || source.fantraxId || !matches(watch, source.canonicalName) || ready.has(id)) continue
      if (sourceIdentities.filter(row => row.rollingInsightsId === id).length !== 1) continue
      ready.set(id, { watch, owner: source, source, school, matchesGame: matchesGame(school) })
    }
  }
  return ready
}

async function seasonScheduleForEmptyDates(sport: CollegeSport, season: number) {
  const response = await riFetchRows('schedule_season', { sport, season, timeoutMs: 12_000 })
  if (response.error || !response.rows.length) return null
  const games = parseRiScheduleSeason(response.rows)
  if (games.length !== response.rows.length) return null
  const regularDays = games.filter(game => game.seasonType === 'regular').map(game => game.day).sort()
  const first = regularDays[0], last = regularDays.at(-1)
  const bounds = sport === 'NCAAF'
    ? [`${season}-08-01`, `${season}-09-30`, `${season}-11-20`, `${season}-12-31`]
    : [`${season}-10-01`, `${season}-11-30`, `${season + 1}-03-01`, `${season + 1}-04-30`]
  if (!first || !last || first < bounds[0]! || first > bounds[1]! || last < bounds[2]! || last > bounds[3]!) return null
  return { first, last, scheduledDays: new Set(games.map(game => game.day)) }
}

/** Game finality and the roster-to-player and player-to-school joins must all agree. */
export async function ingestCollegeFinalBoxes(
  sport: CollegeSport, season: number, players: WatchedPlayer[], now = new Date(),
) {
  const ready = await watchIdentities(sport, players)
  const result = { written: 0, warnings: [] as string[], noGameDates: [] as string[], players: [...ready.values()] }
  if (!ready.size) return result

  const historical = await prisma.playerGameStat.findMany({
    where: { sportType: sport, season, source: 'rolling_insights_live', playerId: { in: result.players.map(p => p.source.id) },
      gameDate: { lt: now }, normalizedStatMap: { path: ['seasonType'], equals: 'regular' } },
    select: { gameDate: true }, distinct: ['gameDate'], take: 150,
  })
  const knownDates = historical.flatMap(row => row.gameDate ? [row.gameDate.toISOString().slice(0, 10)] : [])
  const dates = collegeBoxDates(players, now, knownDates)
  const appearanceDates = new Set([...knownDates, ...players.flatMap(player => player.dates)])
  let seasonSchedule: ReturnType<typeof seasonScheduleForEmptyDates> | undefined
  const verified = new Map<string, Prisma.PlayerGameStatCreateManyInput>()
  const ambiguous = new Set<string>()
  for (let offset = 0; offset < dates.length; offset += 3) {
    const batch = await Promise.all(dates.slice(offset, offset + 3).map(async date => ({
      date, ...await riFetchRows('live', { sport, date, timeoutMs: 12_000 }),
    })))
    for (const { date, rows, error, notModified } of batch) {
      if (error) {
        // A 304 or 404 alone says nothing about whether a game was played.
        if ((notModified || /^HTTP 404 live\//.test(error)) && !appearanceDates.has(date)) {
          seasonSchedule ??= seasonScheduleForEmptyDates(sport, season)
          const schedule = await seasonSchedule
          if (schedule && date >= schedule.first && date <= schedule.last && !schedule.scheduledDays.has(date)) {
            result.noGameDates.push(date)
            continue
          }
        }
        result.warnings.push(sport + ' final box feed unavailable for ' + date)
        continue
      }
      for (const raw of rows ?? []) {
        const box = normalizeRiGameBox(raw)
        if (!box || !isFinalRiStatus(box.status) || box.season !== season || box.seasonType !== 'regular') continue
        if (!box.gameDate || box.gameDate >= now || box.gameDay?.toISOString().slice(0, 10) !== date) continue
        for (const line of box.lines) {
          const player = ready.get(line.providerPlayerId)
          if (!player || line.group !== 'all' || !matches(player.watch, line.playerName)) continue
          if (!player.matchesGame(line.team, box.providerGameId)) continue
          const normalized = normalizedStatMapFor(line, box)
          const stats = normalized.stats as Record<string, number>
          if (!hasCollegeBoxParticipation(sport, stats)) continue
          const input: Prisma.PlayerGameStatCreateManyInput = {
            playerId: player.source.id, sportType: sport, gameId: box.providerGameId,
            providerGameId: box.providerGameId, providerPlayerId: line.providerPlayerId, season,
            weekOrRound: box.weekOrRound, team: line.team, opponent: line.opponent, gameDate: box.gameDay,
            source: 'rolling_insights_live', confidence: 0.1, fetchedAt: now,
            statPayload: JSON.parse(JSON.stringify(line.raw)),
            normalizedStatMap: JSON.parse(JSON.stringify({ ...normalized, gameFinal: true })),
          }
          const key = input.playerId + ':' + input.gameId
          const previous = verified.get(key)
          if (previous && !isDeepStrictEqual(previous, input)) ambiguous.add(key)
          verified.set(key, input)
        }
      }
    }
  }
  for (const key of ambiguous) verified.delete(key)
  if (ambiguous.size) result.warnings.push(sport + ' conflicting final box lines: ' + ambiguous.size)
  if (!verified.size) return result
  const stored = await prisma.playerGameStat.findMany({
    where: { sportType: sport, season, playerId: { in: result.players.map(p => p.source.id) },
      gameId: { in: [...verified.values()].map(row => row.gameId) } },
    select: { playerId: true, gameId: true, source: true, normalizedStatMap: true },
  })
  const existing = new Map(stored.map(row => [row.playerId + ':' + row.gameId, row]))
  for (const [key, input] of verified) {
    const prior = existing.get(key)
    if (prior && (prior.source !== input.source || isDeepStrictEqual(prior.normalizedStatMap, input.normalizedStatMap))) continue
    const { playerId, sportType, gameId, ...data } = input
    await prisma.playerGameStat.upsert({
      where: { playerId_sportType_gameId: { playerId, sportType, gameId } },
      create: input, update: data,
    })
    result.written++
  }
  return result
}
