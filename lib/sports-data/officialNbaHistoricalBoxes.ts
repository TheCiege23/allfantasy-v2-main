import type { PrismaClient } from '@prisma/client'
import { canonicalName } from '@/lib/draft-room/player-canonical-identity'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { writeRiGameRows, type RiGameWrite } from './writeRiGameRows'
import manifest from './reviewedNbaHistoricalGames.json'

export const OFFICIAL_NBA_HISTORY_SOURCE = 'nba_official_box'
type Target = {
  gameId: string; nbaId: string; day: string; home: string; away: string; homeScore: number; awayScore: number
  originalGameId?: string
  reversedProviderSides?: boolean
  previousScore?: number[]
  excludedAppearances?: { riId: string; nbaId: number; name: string; team: string; minutes: string }[]
  zeroMinutePlayerIds?: number[]
  corrections?: { riId: string; nbaId: string; changes: (string | number | null)[][] }[]
}
export const reviewedNbaHistoricalGames: Target[] = manifest.games
const gameSeason = (target: Target) => 2000 + Number(target.nbaId.slice(3, 5))
export function reviewedNbaHistoryGameIds(season?: number) {
  return reviewedNbaHistoricalGames.filter(game => season == null || gameSeason(game) === season).map(game => game.nbaId)
}
type Identity = { id: string; canonicalName: string; rollingInsightsId: string | null; dob: string | null }
type ReviewedPlayer = { official: string; name: string; riId: string; dob?: string; gameId?: string }
const overrides: Record<string, ReviewedPlayer> = manifest.players
const overrides2024: Record<string, ReviewedPlayer> = manifest.players2024
const overrides2023: Record<string, ReviewedPlayer> = manifest.players2023
const overrides2022: Record<string, ReviewedPlayer> = manifest.players2022
const overrides2021: Record<string, ReviewedPlayer> = manifest.players2021
const teamAliases: Record<string, string> = { GS: 'GSW', NO: 'NOP', SA: 'SAS', UTAH: 'UTA', NY: 'NYK', PHO: 'PHX', BRK: 'BKN', WSH: 'WAS' }
const teamCode = (value: string | null) => value && (teamAliases[value] ?? value)
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
function duration(value: unknown): number {
  // The official box can round a fractional second to :60.
  if (typeof value !== 'string' || !/^\d+:(?:[0-5]\d|60)$/.test(value)) throw Error('OFFICIAL_NBA_INVALID_MINUTES')
  const [minutes, seconds] = value.split(':').map(Number)
  return minutes * 60 + seconds
}
const fields = {
  points: 'points', field_goals_made: 'fieldGoalsMade', field_goals_attempted: 'fieldGoalsAttempted',
  three_points_made: 'threePointersMade', three_points_attempted: 'threePointersAttempted',
  free_throws_made: 'freeThrowsMade', free_throws_attempted: 'freeThrowsAttempted',
  offensive_rebounds: 'reboundsOffensive', defensive_rebounds: 'reboundsDefensive', total_rebounds: 'reboundsTotal',
  assists: 'assists', steals: 'steals', blocks: 'blocks', turnovers: 'turnovers', fouls: 'foulsPersonal',
}
const additive = ['points', 'field_goals_made', 'field_goals_attempted', 'three_points_made',
  'three_points_attempted', 'free_throws_made', 'free_throws_attempted', 'assists', 'steals', 'blocks'] as const

export function isReviewedNbaHistoryRow(row: {
  providerGameId: string | null; providerPlayerId: string | null; gameId: string; season: number; gameDate: Date | null
}): boolean {
  return !!row.providerPlayerId && /^\d+$/.test(row.providerPlayerId) &&
    reviewedNbaHistoricalGames.some(game => row.gameId === game.gameId && row.providerGameId === game.nbaId &&
      row.season === gameSeason(game) && row.gameDate?.toISOString().slice(0, 10) === game.day)
}

export function prepareOfficialNbaHistoricalBox(target: Target, payload: unknown, identities: Identity[], now = new Date()) {
  const box = record(record(payload).boxScoreTraditional)
  if (box.gameId !== target.nbaId) throw Error('OFFICIAL_NBA_GAME_MISMATCH')
  const rows: RiGameWrite[] = []
  const used = new Set<string>()
  const season = gameSeason(target)
  for (const side of ['home', 'away'] as const) {
    const opponent = side === 'home' ? target.away : target.home
    const team = record(box[side + 'Team'])
    const totals = record(team.statistics)
    if (team.teamTricode !== target[side] || !Array.isArray(team.players) ||
        totals.points !== (side === 'home' ? target.homeScore : target.awayScore)) {
      throw Error('OFFICIAL_NBA_TEAM_MISMATCH')
    }
    for (const excluded of target.excludedAppearances ?? []) {
      if (excluded.team !== target[side]) continue
      const player = team.players.map(record).find(line => line.personId === excluded.nbaId)
      if (!player || record(player.statistics).minutes !== '' ||
          typeof player.comment !== 'string' || !player.comment.startsWith('DNP')) {
        throw Error('OFFICIAL_NBA_PARTICIPANT_MISMATCH')
      }
    }
    const teamRows: Record<string, number>[] = []
    let teamSeconds = 0
    for (const raw of team.players) {
      const player = record(raw)
      const stats = record(player.statistics)
      const minutes = stats.minutes
      // Some real appearances round to zero. The official season log and exact
      // box must both place the player on the court for these reviewed cases.
      if (minutes === '') continue
      if ((minutes === '0:00' || minutes === '00:00') &&
        (player.comment !== '' || !target.zeroMinutePlayerIds?.includes(Number(player.personId)))) continue
      if (typeof player.personId !== 'number' || !Number.isSafeInteger(player.personId) || player.personId < 1 ||
          typeof player.firstName !== 'string' || typeof player.familyName !== 'string') throw Error('OFFICIAL_NBA_INVALID_LINE')
      const seconds = duration(minutes)
      teamSeconds += seconds
      const playingTime = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
      const official = `${player.firstName} ${player.familyName}`
      const key = String(player.personId)
      const override = (season === 2021 ? overrides2021[key] : undefined) ??
        (season <= 2022 ? overrides2022[key] : undefined) ??
        (season <= 2023 ? overrides2023[key] : undefined) ??
        (season <= 2024 ? overrides2024[key] : undefined) ?? overrides[key]
      const reviewed = override?.official === official && (!override.gameId || override.gameId === target.gameId) ? override : undefined
      const matches = identities.filter(identity => canonicalName(identity.canonicalName) === canonicalName(reviewed?.name ?? official) &&
        (!reviewed || identity.rollingInsightsId === reviewed.riId && (!reviewed.dob || reviewed.dob === identity.dob)))
      const identity = matches[0]
      if (matches.length !== 1 || !identity.rollingInsightsId) throw Error(`OFFICIAL_NBA_UNVERIFIED_PLAYER_${player.personId}`)
      if (used.has(identity.id)) throw Error('OFFICIAL_NBA_DUPLICATE_LINE')
      used.add(identity.id)
      const counts: Record<string, number> = {}
      for (const [key, field] of Object.entries(fields)) {
        const value = stats[field]
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw Error('OFFICIAL_NBA_INVALID_COUNT')
        counts[key] = value
      }
      teamRows.push(counts)
      rows.push({
        playerId: identity.id, sportType: 'NBA', gameId: target.gameId, providerGameId: target.nbaId, providerPlayerId: String(player.personId),
        season, weekOrRound: 0, statPayload: { player: official, minutes: playingTime, ...counts },
        normalizedStatMap: { stats: counts, seasonType: 'regular', scored: false }, source: OFFICIAL_NBA_HISTORY_SOURCE,
        confidence: 1, team: target[side], opponent, gameDate: new Date(`${target.day}T00:00:00Z`), fetchedAt: now,
      })
    }
    // The published player times can round independently by one second.
    if (teamRows.length < 5 || Math.abs(teamSeconds - duration(totals.minutes)) > teamRows.length ||
        additive.some(key => teamRows.reduce((sum, row) => sum + row[key], 0) !== totals[fields[key]])) {
      throw Error('OFFICIAL_NBA_TEAM_TOTAL_MISMATCH')
    }
  }
  if (target.zeroMinutePlayerIds?.some(id => !rows.some(row => row.providerPlayerId === String(id) &&
    record(row.statPayload).minutes === '0:00'))) throw Error('OFFICIAL_NBA_PARTICIPANT_MISMATCH')
  return rows
}

export async function storeOfficialNbaHistoricalBox(
  db: Pick<PrismaClient, '$transaction'>, target: Target, rows: RiGameWrite[], apply: boolean,
) {
  if (!rows.length || rows.some(row => row.source !== OFFICIAL_NBA_HISTORY_SOURCE ||
    row.gameId !== target.gameId || row.providerGameId !== target.nbaId || !isReviewedNbaHistoryRow(row))) {
    throw Error('OFFICIAL_NBA_UNREVIEWED_WRITE')
  }
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`NBA:${target.gameId}`}, 0))`
    const schedule = await tx.sportsGame.findUnique({
      where: { sport_externalId_source: { sport: 'NBA', externalId: target.gameId, source: 'rolling_insights' } },
    })
    const season = gameSeason(target)
    const reversed = target.reversedProviderSides && teamCode(schedule?.homeTeam ?? null) === target.away &&
      teamCode(schedule?.awayTeam ?? null) === target.home
    const scoreMatches = schedule?.homeScore === target.homeScore && schedule?.awayScore === target.awayScore
    const replaceScore = !scoreMatches && !!target.previousScore &&
      schedule?.homeScore === target.previousScore[0] && schedule?.awayScore === target.previousScore[1]
    if (!schedule || schedule.season !== season || schedule.seasonType !== 'regular' || schedule.status !== 'completed' ||
      (!reversed && (teamCode(schedule.homeTeam) !== target.home || teamCode(schedule.awayTeam) !== target.away)) ||
      (!scoreMatches && !replaceScore)) throw Error('OFFICIAL_NBA_SCHEDULE_MISMATCH')
    const keys = target.originalGameId ? [target.gameId, target.originalGameId] : [target.gameId]
    const existing = await tx.playerGameStat.findMany({ where: {
      sportType: 'NBA', OR: [{ gameId: { in: keys } }, { source: OFFICIAL_NBA_HISTORY_SOURCE, providerGameId: target.nbaId }],
    } })
    const supplied = new Map(rows.map(row => [row.playerId, row]))
    const matched = new Set<string>()
    const replacements: RiGameWrite[] = []
    const archiveOriginal = async (row: typeof existing[number], riId: string) => {
      const cacheKey = `provider-history-review:v1:NBA:${target.gameId}:${riId}`
      await tx.sportsDataCache.upsert({ where: { cacheKey }, update: {},
        create: { cacheKey, expiresAt: new Date(Date.now() + 400 * 86400000),
          data: toPrismaJsonInput({ source: row.source, providerPlayerId: row.providerPlayerId,
            team: row.team, opponent: row.opponent, statPayload: row.statPayload, normalizedStatMap: row.normalizedStatMap }) } })
    }
    let removed = 0
    for (const row of existing) {
      if (row.gameId !== target.gameId || row.season !== season) throw Error('OFFICIAL_NBA_STORAGE_CONFLICT')
      const payload = record(row.statPayload)
      const official = supplied.get(row.playerId)
      const excluded = !official && target.excludedAppearances?.find(line => line.riId === row.providerPlayerId)
      if (excluded) {
        const opponent = excluded.team === target.home ? target.away : target.home
        if (row.source !== 'rolling_insights_live' || row.providerGameId !== target.gameId ||
            teamCode(row.team) !== excluded.team || teamCode(row.opponent) !== opponent ||
            payload.player !== excluded.name || payload.minutes !== excluded.minutes ||
            !Object.keys(fields).every(key => payload[key] === 0) ||
            record(row.normalizedStatMap).scored !== false || row.fantasyPoints !== 0) {
          throw Error('OFFICIAL_NBA_STORAGE_CONFLICT')
        }
        if (apply) {
          await archiveOriginal(row, excluded.riId)
          await tx.playerGameStat.delete({ where: { id: row.id } })
        }
        removed += 1
        continue
      }
      if (!official && ['0', '0:00', '00:00'].includes(String(payload.minutes)) &&
        Object.keys(fields).every(key => Number(payload[key] ?? 0) === 0)) continue
      if (!official || !['rolling_insights_live', OFFICIAL_NBA_HISTORY_SOURCE].includes(row.source ?? '') ||
          (row.source === OFFICIAL_NBA_HISTORY_SOURCE && (row.providerPlayerId !== official.providerPlayerId || row.providerGameId !== target.nbaId))) {
        throw Error('OFFICIAL_NBA_STORAGE_CONFLICT')
      }
      const officialPayload = record(official.statPayload)
      const oldValues = { ...payload, team: teamCode(row.team), opponent: teamCode(row.opponent) } as Record<string, unknown>
      const newValues = { ...officialPayload, team: official.team, opponent: official.opponent } as Record<string, unknown>
      const differences = Object.keys(fields).filter(key => payload[key] == null || Number(payload[key]) !== officialPayload[key])
      const planned = target.corrections?.find(change => change.riId === row.providerPlayerId && change.nbaId === official.providerPlayerId)
      if (planned?.changes.some(([key]) => key === 'minutes') && payload.minutes !== officialPayload.minutes) differences.push('minutes')
      for (const key of ['team', 'opponent']) if (oldValues[key] !== newValues[key]) differences.push(key)
      if (differences.length) {
        const reviewedCorrection = planned && row.source === 'rolling_insights_live' && row.providerGameId === target.gameId &&
          differences.length === planned.changes.length && differences.every(key =>
            planned.changes.some(([field, from, to]) => field === key && (oldValues[key] ?? null) === from && newValues[key] === to)) &&
          (!differences.some(key => key === 'team' || key === 'opponent') || reversed) &&
          record(row.normalizedStatMap).scored === false && row.fantasyPoints === 0
        if (!reviewedCorrection) throw Error('OFFICIAL_NBA_STORAGE_CONFLICT')
        replacements.push(official)
        if (apply) await archiveOriginal(row, planned.riId)
      }
      matched.add(row.playerId)
    }
    const scheduleCorrected = Boolean(reversed || replaceScore)
    if (apply && scheduleCorrected) {
      const cacheKey = `provider-history-review:v1:NBA:${target.gameId}:schedule`
      const { homeTeam, awayTeam, homeTeamId, awayTeamId, homeScore, awayScore } = schedule
      await tx.sportsDataCache.upsert({ where: { cacheKey }, update: {}, create: {
        cacheKey, expiresAt: new Date(Date.now() + 400 * 86400000),
        data: { homeTeam, awayTeam, homeTeamId, awayTeamId, homeScore, awayScore },
      } })
      await tx.sportsGame.update({ where: { id: schedule.id },
        data: {
          ...(reversed ? { homeTeam: target.home, awayTeam: target.away, homeTeamId: awayTeamId, awayTeamId: homeTeamId } : {}),
          ...(replaceScore ? { homeScore: target.homeScore, awayScore: target.awayScore } : {}),
        } })
    }
    if (apply && replacements.length) await writeRiGameRows(tx, replacements)
    const missing = rows.filter(row => !matched.has(row.playerId))
    const added = apply ? await writeRiGameRows(tx, missing) : 0
    return { officialPlayers: rows.length, matchingRows: matched.size, missingRows: missing.length, added,
      corrected: replacements.length, removed, scheduleCorrected }
  }, { timeout: 30000 })
}
