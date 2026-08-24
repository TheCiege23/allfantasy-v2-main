import { prisma } from '@/lib/prisma'
import { buildPlayerKey } from '@/lib/adp/computeAllFantasyAdp'
import {
  canonicalName,
  canonicalPosition,
  canonicalTeam,
  isFreeAgentTeam,
  strictIdentityKey,
} from '@/lib/draft-room/player-canonical-identity'
import { getResolvedDraftPoolForLeague } from '@/lib/draft-room/getResolvedDraftPoolForLeague'
import { buildAllFantasyProjection } from '@/lib/redraft/projectionEngine'
import { getCanonicalNflDataCoverage } from './nflDataCoverage'
import type {
  CanonicalNflAiContext,
  CanonicalNflAiPlayerFact,
  CanonicalNflDataCoverage,
  CanonicalNflDraftPoolPlayer,
  CanonicalNflPlayer,
  CanonicalNflPlayerStats,
  CanonicalNflProjection,
  CanonicalNflProviderIds,
  CanonicalNflRosterPlayer,
  CanonicalNflTradeAsset,
  CanonicalNflTradeContext,
  CanonicalNflWaiverPlayer,
} from './types'

type DbClient = typeof prisma

type SportsPlayerRow = {
  id: string
  sport: string
  externalId: string
  name: string
  position: string | null
  team: string | null
  teamId: string | null
  number: number | null
  imageUrl: string | null
  sleeperId: string | null
  status: string | null
  source: string
  fetchedAt: Date
  expiresAt: Date
  updatedAt: Date
}

type IdentityMapRow = {
  canonicalName: string
  normalizedName: string
  position: string | null
  currentTeam: string | null
  sleeperId: string | null
  fantasyCalcId: string | null
  rollingInsightsId: string | null
  status: string | null
  lastSyncedAt: Date
}

type ProjectionSignalInput = {
  playerId: string
  providerPlayerId?: string | null
  playerName: string
  position?: string | null
  team?: string | null
  week: number
  season: number
  providerWeeklyProjection?: number | null
  afWeeklyProjection?: number | null
  afConfidenceLevel?: string | null
  seasonAvgActual?: number | null
  rollingInsightsFantasyPointsPerGame?: number | null
  rollingInsightsGamesPlayed?: number | null
  rollingInsightsStats?: unknown
  adp?: number | null
  byeWeek?: number | null
  injuryStatus?: string | null
  depthChartRank?: number | null
  opponentPointsAgainst?: number | null
  opponentGamesPlayed?: number | null
  dataSources?: string[]
  staleDataWarnings?: string[]
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function iso(value: Date | null | undefined): string | null {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null
}

function uniq(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((v) => String(v ?? '').trim()).filter(Boolean))]
}

function staleWarning(label: string, fetchedAt: Date | null | undefined, maxAgeHours: number, now = new Date()): string | null {
  if (!fetchedAt) return null
  if (now.getTime() - fetchedAt.getTime() <= maxAgeHours * 60 * 60 * 1000) return null
  return `${label} data is stale as of ${fetchedAt.toISOString()}.`
}

function sourceRank(source: string | null | undefined): number {
  const s = String(source ?? '').toLowerCase()
  if (s.includes('rolling')) return 60
  if (s.includes('sleeper')) return 50
  if (s.includes('thesportsdb')) return 45
  if (s.includes('backfill')) return 35
  return 10
}

function scoreSportsPlayer(row: SportsPlayerRow): number {
  let score = sourceRank(row.source)
  if (row.sleeperId) score += 25
  if (row.externalId) score += 15
  if (row.team && !isFreeAgentTeam(row.team)) score += 15
  if (row.imageUrl && /^https?:\/\//i.test(row.imageUrl)) score += 10
  return score
}

function chooseBestSportsPlayer(rows: SportsPlayerRow[]): SportsPlayerRow | null {
  return [...rows].sort((a, b) => scoreSportsPlayer(b) - scoreSportsPlayer(a))[0] ?? null
}

export function canonicalNflIdentityKey(input: {
  playerId?: string | null
  rollingInsightsId?: string | null
  sleeperId?: string | null
  fantasyCalcId?: string | null
  name?: string | null
  position?: string | null
  team?: string | null
}): string {
  const rolling = String(input.rollingInsightsId ?? '').trim()
  if (rolling) return `ri:${rolling}`
  const sleeper = String(input.sleeperId ?? '').trim()
  if (sleeper) return `sleeper:${sleeper}`
  const fantasyCalc = String(input.fantasyCalcId ?? '').trim()
  if (fantasyCalc) return `fantasycalc:${fantasyCalc}`
  const name = canonicalName(input.name)
  const position = canonicalPosition(input.position)
  const team = canonicalTeam(input.team)
  if (name && position && team) return `name:${name}|${position}|${team}`
  const playerId = String(input.playerId ?? '').trim()
  if (playerId) return `af:${playerId}`
  return `name:${name}|${position}|${team}`
}

function canonicalNflDedupeKey(input: {
  playerId?: string | null
  playerName?: string | null
  position?: string | null
  team?: string | null
  providerIds?: Partial<CanonicalNflProviderIds> | null
}): string {
  const name = canonicalName(input.playerName)
  const position = canonicalPosition(input.position)
  const team = canonicalTeam(input.team)
  if (name && position) return `name:${name}|${position}|${team}`
  return canonicalNflIdentityKey({
    playerId: input.playerId,
    rollingInsightsId: input.providerIds?.rollingInsightsId,
    sleeperId: input.providerIds?.sleeperId,
    fantasyCalcId: input.providerIds?.fantasyCalcId,
    name: input.playerName,
    position: input.position,
    team: input.team,
  })
}

function canonicalNflCandidateScore(player: {
  providerIds?: Partial<CanonicalNflProviderIds> | null
  team?: string | null
  headshotUrl?: string | null
  projection?: { projectedPoints?: number | null; confidence?: number | null } | null
  seasonStats?: { fantasyPointsPerGame?: number | null } | null
  tradeValue?: number | null
}): number {
  return [
    player.providerIds?.rollingInsightsId ? 40 : 0,
    player.providerIds?.sleeperId ? 34 : 0,
    player.providerIds?.fantasyCalcId ? 26 : 0,
    player.team && !isFreeAgentTeam(player.team) ? 16 : 0,
    player.projection?.projectedPoints != null ? 14 : 0,
    player.seasonStats?.fantasyPointsPerGame != null ? 12 : 0,
    player.tradeValue != null ? 8 : 0,
    player.headshotUrl ? 4 : 0,
    Math.min(10, Math.max(0, Number(player.projection?.confidence ?? 0) / 10)),
  ].reduce((sum, value) => sum + value, 0)
}

export function resolveCanonicalNflDuplicateGroups<T extends Pick<CanonicalNflPlayer, 'playerId' | 'playerName' | 'position' | 'team' | 'providerIds'>>(
  players: T[],
): Array<{ key: string; selected: T; duplicates: T[] }> {
  const groups = new Map<string, T[]>()
  for (const player of players) {
    const key = canonicalNflDedupeKey({
      playerId: player.playerId,
      providerIds: player.providerIds,
      playerName: player.playerName,
      position: player.position,
      team: player.team,
    })
    const group = groups.get(key) ?? []
    group.push(player)
    groups.set(key, group)
  }
  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({
      key,
      selected: [...group].sort((a, b) => canonicalNflCandidateScore(b as never) - canonicalNflCandidateScore(a as never))[0]!,
      duplicates: group,
    }))
}

export function dedupeCanonicalNflPlayers<T extends Pick<CanonicalNflPlayer, 'playerId' | 'playerName' | 'position' | 'team' | 'providerIds'>>(
  players: T[],
): T[] {
  const best = new Map<string, T>()
  for (const player of players) {
    const key = canonicalNflDedupeKey({
      playerId: player.playerId,
      playerName: player.playerName,
      position: player.position,
      team: player.team,
      providerIds: player.providerIds,
    })
    const current = best.get(key)
    if (!current || canonicalNflCandidateScore(player as never) > canonicalNflCandidateScore(current as never)) {
      best.set(key, player)
    }
  }
  return [...best.values()]
}

export function dedupeCanonicalNflDraftPoolEntries<T extends Record<string, any>>(entries: T[]): T[] {
  const best = new Map<string, T>()
  for (const entry of entries) {
    const display = entry.display && typeof entry.display === 'object' ? entry.display : null
    const canonical = entry.canonicalNfl && typeof entry.canonicalNfl === 'object' ? entry.canonicalNfl : null
    const providerIds = canonical?.providerIds as Partial<CanonicalNflProviderIds> | undefined
    const key = canonicalNflDedupeKey({
      playerId: String(providerIds?.allFantasyId ?? entry.playerId ?? entry.id ?? ''),
      playerName: String(entry.name ?? display?.displayName ?? ''),
      position: String(entry.position ?? display?.metadata?.position ?? ''),
      team: String(entry.team ?? display?.team?.abbreviation ?? ''),
      providerIds,
    })
    const current = best.get(key)
    const scoreEntry = (row: T) =>
      canonicalNflCandidateScore({
        providerIds: row.canonicalNfl?.providerIds,
        team: row.team ?? row.display?.team?.abbreviation,
        headshotUrl: row.headshotUrl ?? row.display?.assets?.headshotUrl,
        projection: row.canonicalNfl?.projection,
        tradeValue: row.canonicalNfl?.tradeValue,
      })
    if (!current || scoreEntry(entry) > scoreEntry(current)) best.set(key, entry)
  }
  return [...best.values()]
}

function reasonCodeFromText(text: string): string {
  const normalized = text.toLowerCase()
  if (normalized.includes('bye week')) return 'bye_week'
  if (normalized.includes('adp')) return 'adp_fallback'
  if (normalized.includes('rollinginsights')) return 'rolling_insights_season_stats'
  if (normalized.includes('injur') || normalized.includes('listed')) return 'injury_status_adjustment'
  if (normalized.includes('provider')) return 'provider_projection'
  if (normalized.includes('cached')) return 'allfantasy_cached_projection'
  return normalized.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'projection_note'
}

function injuryUnavailable(status: string | null | undefined): boolean {
  const s = String(status ?? '').toLowerCase()
  return s.includes('out') || s.includes('ir') || s.includes('injured reserve') || s.includes('inactive')
}

function injuryRisk(status: string | null | undefined): 'low' | 'medium' | 'high' | 'unknown' {
  const s = String(status ?? '').toLowerCase()
  if (!s) return 'unknown'
  if (injuryUnavailable(s) || s.includes('doubtful')) return 'high'
  if (s.includes('questionable') || s.includes('limited')) return 'medium'
  return 'low'
}

export function buildCanonicalNflProjection(input: ProjectionSignalInput): CanonicalNflProjection {
  const built = buildAllFantasyProjection({
    playerId: input.playerId,
    playerName: input.playerName,
    sport: 'NFL',
    position: input.position ?? 'UNK',
    team: input.team,
    currentWeek: input.week,
    totalWeeks: 17,
    byeWeek: input.byeWeek,
    injuryStatus: input.injuryStatus,
    adp: input.adp,
    providerWeeklyProjection: input.providerWeeklyProjection,
    allFantasyWeeklyProjection: input.afWeeklyProjection,
    allFantasyConfidenceLevel: input.afConfidenceLevel,
    seasonAvgActual: input.seasonAvgActual,
    rollingInsightsFantasyPointsPerGame: input.rollingInsightsFantasyPointsPerGame,
    rollingInsightsGamesPlayed: input.rollingInsightsGamesPlayed,
    rollingInsightsStats: input.rollingInsightsStats,
  })

  const dataSources = new Set<string>(input.dataSources ?? [])
  if (input.providerWeeklyProjection != null) dataSources.add('fantasy_projections')
  if (input.afWeeklyProjection != null) dataSources.add('af_projection_snapshots')
  if (input.rollingInsightsFantasyPointsPerGame != null || input.rollingInsightsStats != null) dataSources.add('rolling_insights')
  if (input.adp != null) dataSources.add('allfantasy_adp')
  if (input.depthChartRank != null) dataSources.add('depth_charts')
  if (input.opponentPointsAgainst != null) dataSources.add('team_season_stats')

  const reasonCodes = new Set<string>(built.reasons.map(reasonCodeFromText))
  for (const flag of built.missingDataFlags) reasonCodes.add(reasonCodeFromText(flag))

  let projectedPoints = built.weeklyProjection
  let floor = built.floorProjection
  let ceiling = built.ceilingProjection
  let restOfSeason = built.restOfSeasonProjection
  let confidence = built.confidenceScore

  const depthRank = input.depthChartRank
  if (projectedPoints != null && projectedPoints > 0 && depthRank != null && depthRank > 1) {
    const multiplier = depthRank === 2 ? 0.92 : depthRank === 3 ? 0.84 : 0.76
    projectedPoints = round1(projectedPoints * multiplier)
    floor = floor != null ? round1(floor * multiplier) : floor
    ceiling = ceiling != null ? round1(ceiling * multiplier) : ceiling
    restOfSeason = restOfSeason != null ? round1(restOfSeason * multiplier) : restOfSeason
    confidence = clamp(confidence - Math.min(16, depthRank * 3), 1, 96)
    reasonCodes.add('depth_chart_role_adjustment')
  }

  const pointsAgainst = input.opponentPointsAgainst
  const opponentGames = input.opponentGamesPlayed
  if (
    projectedPoints != null &&
    projectedPoints > 0 &&
    pointsAgainst != null &&
    opponentGames != null &&
    opponentGames > 0
  ) {
    const allowed = pointsAgainst / opponentGames
    const multiplier = allowed >= 25 ? 1.03 : allowed <= 18 ? 0.97 : 1
    if (multiplier !== 1) {
      projectedPoints = round1(projectedPoints * multiplier)
      floor = floor != null ? round1(floor * multiplier) : floor
      ceiling = ceiling != null ? round1(ceiling * multiplier) : ceiling
      restOfSeason = restOfSeason != null ? round1(restOfSeason * multiplier) : restOfSeason
      reasonCodes.add('opponent_context_adjustment')
    } else {
      reasonCodes.add('opponent_context_checked')
    }
  }

  if ((input.staleDataWarnings ?? []).some((warning) => /schedule data is unavailable/i.test(warning))) {
    confidence = clamp(confidence - 6, 1, 96)
    reasonCodes.add('schedule_unavailable_confidence_discount')
  }
  if ((input.staleDataWarnings ?? []).some((warning) => /season stats as the projection baseline/i.test(warning))) {
    confidence = clamp(confidence - 5, 1, 96)
    reasonCodes.add('previous_season_stats_baseline')
  }

  const unavailable =
    (input.byeWeek != null && Number(input.byeWeek) === Number(input.week)) ||
    injuryUnavailable(input.injuryStatus) ||
    built.source === 'missing'

  return {
    playerId: input.playerId,
    providerPlayerId: input.providerPlayerId ?? null,
    playerName: input.playerName,
    position: input.position ?? null,
    team: input.team ?? null,
    week: input.week,
    season: input.season,
    projectedPoints,
    floor,
    ceiling,
    restOfSeason,
    // Labeled origin columns — surfaced only because this builder already fetched both.
    providerWeeklyProjection: input.providerWeeklyProjection ?? null,
    afWeeklyProjection: input.afWeeklyProjection ?? null,
    confidence,
    confidenceLevel: confidence >= 78 ? 'high' : confidence >= 58 ? 'medium' : confidence > 0 ? 'low' : 'none',
    unavailable,
    reasonCodes: [...reasonCodes].filter(Boolean),
    dataSources: [...dataSources],
    staleDataWarnings: input.staleDataWarnings ?? [],
    projectionSource: built.source,
    generatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
  }
}

async function findIdentityById(db: DbClient, id: string): Promise<IdentityMapRow | null> {
  const value = String(id ?? '').trim()
  if (!value) return null
  return ((await (db as any).playerIdentityMap
    .findFirst({
      where: {
        sport: 'NFL',
        OR: [
          { rollingInsightsId: value },
          { sleeperId: value },
          { fantasyCalcId: value },
          { apiSportsId: value },
          { espnId: value },
          { clearSportsId: value },
        ],
      },
      orderBy: { updatedAt: 'desc' },
    })
    .catch(() => null)) ?? null) as IdentityMapRow | null
}

async function findSportsPlayerByAnyId(
  db: DbClient,
  ids: Array<string | null | undefined>,
): Promise<SportsPlayerRow | null> {
  const values = uniq(ids)
  if (!values.length) return null
  const rows = (await (db as any).sportsPlayer
    .findMany({
      where: {
        sport: 'NFL',
        OR: [
          { id: { in: values } },
          { externalId: { in: values } },
          { sleeperId: { in: values } },
        ],
      },
      take: 20,
      orderBy: [{ updatedAt: 'desc' }],
    })
    .catch(() => [])) as SportsPlayerRow[]
  return chooseBestSportsPlayer(rows)
}

async function findIdentityByNameTeam(
  db: DbClient,
  name: string,
  team?: string | null,
  position?: string | null,
): Promise<IdentityMapRow | null> {
  const normalizedName = canonicalName(name)
  if (!normalizedName) return null
  const normalizedTeam = canonicalTeam(team)
  const normalizedPosition = canonicalPosition(position)
  const rows = (await (db as any).playerIdentityMap
    .findMany({
      where: {
        sport: 'NFL',
        normalizedName,
        ...(normalizedTeam ? { currentTeam: normalizedTeam } : {}),
        ...(normalizedPosition ? { position: normalizedPosition } : {}),
      },
      take: 5,
      orderBy: { updatedAt: 'desc' },
    })
    .catch(() => [])) as IdentityMapRow[]
  return rows[0] ?? null
}

async function findSportsPlayerByNameTeam(
  db: DbClient,
  name: string,
  team?: string | null,
  position?: string | null,
): Promise<SportsPlayerRow | null> {
  const nameKey = canonicalName(name)
  if (!nameKey) return null
  const teamKey = canonicalTeam(team)
  const posKey = canonicalPosition(position)
  const rows = (await (db as any).sportsPlayer
    .findMany({
      where: {
        sport: 'NFL',
        ...(teamKey ? { team: teamKey } : {}),
      },
      take: teamKey ? 500 : 2500,
      orderBy: [{ updatedAt: 'desc' }],
    })
    .catch(() => [])) as SportsPlayerRow[]
  return chooseBestSportsPlayer(
    rows.filter((row) => {
      if (canonicalName(row.name) !== nameKey) return false
      if (posKey && canonicalPosition(row.position) !== posKey) return false
      if (teamKey && canonicalTeam(row.team) !== teamKey && canonicalTeam(row.teamId) !== teamKey) return false
      return true
    }),
  )
}

function providerIdsFor(row: SportsPlayerRow, identity: IdentityMapRow | null): CanonicalNflProviderIds {
  return {
    allFantasyId: row.id,
    providerPlayerId: row.externalId ?? null,
    rollingInsightsId:
      identity?.rollingInsightsId ??
      (String(row.source ?? '').toLowerCase().includes('rolling') ? row.externalId : null),
    sleeperId:
      identity?.sleeperId ??
      row.sleeperId ??
      (String(row.source ?? '').toLowerCase().includes('sleeper') ? row.externalId : null),
    fantasyCalcId: identity?.fantasyCalcId ?? null,
  }
}

function candidateIds(row: SportsPlayerRow, ids: CanonicalNflProviderIds): string[] {
  return uniq([row.id, row.externalId, row.sleeperId, ids.rollingInsightsId, ids.sleeperId, ids.fantasyCalcId])
}

async function loadSeasonStats(
  db: DbClient,
  player: SportsPlayerRow,
  ids: CanonicalNflProviderIds,
  season: number,
): Promise<CanonicalNflPlayerStats | null> {
  const candidates = candidateIds(player, ids)
  const seasons = [String(season), String(season - 1)]
  const rows = (await (db as any).playerSeasonStats
    .findMany({
      where: {
        sport: 'NFL',
        season: { in: seasons },
        seasonType: 'regular',
        OR: [{ playerId: { in: candidates } }, { playerName: player.name }],
      },
      take: 12,
      orderBy: [{ season: 'desc' }, { source: 'desc' }, { fetchedAt: 'desc' }],
    })
    .catch(() => [])) as Array<{
    playerId: string
    season: string
    fantasyPoints: number | null
    fantasyPointsPerGame: number | null
    gamesPlayed: number | null
    stats: unknown
    source: string
    fetchedAt: Date
  }>
  const row =
    rows.find((r) => r.season === String(season) && r.source === 'rolling_insights') ??
    rows.find((r) => r.season === String(season)) ??
    rows.find((r) => r.source === 'rolling_insights') ??
    rows[0] ??
    null
  if (!row) return null
  return {
    playerId: row.playerId,
    season: Number(row.season ?? season),
    gamesPlayed: row.gamesPlayed ?? null,
    fantasyPoints: row.fantasyPoints ?? null,
    fantasyPointsPerGame: row.fantasyPointsPerGame ?? null,
    source: row.source ?? null,
    fetchedAt: iso(row.fetchedAt),
    stale: Boolean(staleWarning('season stats', row.fetchedAt, 72)),
  }
}

async function loadInjuryStatus(
  db: DbClient,
  player: SportsPlayerRow,
  ids: CanonicalNflProviderIds,
  season: number,
  week: number,
): Promise<{ status: string | null; fetchedAt: Date | null }> {
  const candidates = candidateIds(player, ids)
  const sportsInjury = (await (db as any).sportsInjury
    .findFirst({
      where: {
        sport: 'NFL',
        OR: [{ playerId: { in: candidates } }, { playerName: player.name }],
        AND: [
          { OR: [{ season }, { season: null }] },
          { OR: [{ week }, { week: null }] },
        ],
      },
      orderBy: { fetchedAt: 'desc' },
      select: { status: true, fetchedAt: true },
    })
    .catch(() => null)) as { status: string | null; fetchedAt: Date | null } | null
  if (sportsInjury) return sportsInjury

  const injuryReport = (await (db as any).injuryReportRecord
    .findFirst({
      where: {
        sport: 'NFL',
        AND: [
          { OR: [{ playerId: { in: candidates } }, { playerName: player.name }] },
          { OR: [{ week }, { week: null }] },
        ],
      },
      orderBy: { reportDate: 'desc' },
      select: { status: true, reportDate: true },
    })
    .catch(() => null)) as { status: string | null; reportDate: Date | null } | null
  return {
    status: injuryReport?.status ?? null,
    fetchedAt: injuryReport?.reportDate ?? null,
  }
}

function findDepthRank(players: unknown, player: SportsPlayerRow, ids: CanonicalNflProviderIds): number | null {
  if (!Array.isArray(players)) return null
  const idSet = new Set(candidateIds(player, ids))
  const nameKey = canonicalName(player.name)
  for (let i = 0; i < players.length; i += 1) {
    const raw = players[i]
    const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
    const rawId = String(obj.id ?? obj.player_id ?? obj.playerId ?? obj.externalId ?? '').trim()
    const rawName = String(obj.player ?? obj.name ?? obj.full_name ?? '').trim()
    if ((rawId && idSet.has(rawId)) || (rawName && canonicalName(rawName) === nameKey)) {
      return i + 1
    }
  }
  return null
}

function depthRole(rank: number | null): string | null {
  if (rank == null) return null
  if (rank === 1) return 'starter'
  if (rank === 2) return 'primary_backup'
  if (rank <= 4) return 'depth'
  return 'reserve'
}

async function loadDepthChart(
  db: DbClient,
  player: SportsPlayerRow,
  ids: CanonicalNflProviderIds,
  season: number,
): Promise<{ rank: number | null; role: string | null; fetchedAt: Date | null }> {
  const team = canonicalTeam(player.team)
  const position = canonicalPosition(player.position)
  if (!team || !position) return { rank: null, role: null, fetchedAt: null }
  const rows = (await (db as any).depthChart
    .findMany({
      where: {
        sport: 'NFL',
        team,
        position,
        OR: [{ season: String(season) }, { season: null }],
      },
      orderBy: { fetchedAt: 'desc' },
      take: 4,
    })
    .catch(() => [])) as Array<{ players: unknown; fetchedAt: Date }>
  for (const row of rows) {
    const rank = findDepthRank(row.players, player, ids)
    if (rank != null) return { rank, role: depthRole(rank), fetchedAt: row.fetchedAt }
  }
  return { rank: null, role: null, fetchedAt: rows[0]?.fetchedAt ?? null }
}

async function loadScheduleContext(
  db: DbClient,
  team: string | null,
  season: number,
  week: number,
): Promise<{ byeWeek: number | null; opponent: string | null; hasWeekSchedule: boolean }> {
  const teamKey = canonicalTeam(team)
  if (!teamKey) return { byeWeek: null, opponent: null, hasWeekSchedule: false }
  const [weekGames, game] = await Promise.all([
    (db as any).gameSchedule.count({ where: { sportType: 'NFL', season, weekOrRound: week } }).catch(() => 0),
    (db as any).gameSchedule
      .findFirst({
        where: {
          sportType: 'NFL',
          season,
          weekOrRound: week,
          OR: [{ homeTeam: teamKey }, { awayTeam: teamKey }],
        },
        select: { homeTeam: true, awayTeam: true },
      })
      .catch(() => null),
  ])
  const hasWeekSchedule = Number(weekGames) > 0
  if (!game && hasWeekSchedule) return { byeWeek: week, opponent: null, hasWeekSchedule }
  if (!game) return { byeWeek: null, opponent: null, hasWeekSchedule }
  const opponent = canonicalTeam(game.homeTeam) === teamKey ? game.awayTeam : game.homeTeam
  return { byeWeek: null, opponent: opponent ?? null, hasWeekSchedule }
}

async function loadOpponentTeamStats(
  db: DbClient,
  opponent: string | null,
  season: number,
): Promise<{ pointsAgainst: number | null; gamesPlayed: number | null; fetchedAt: Date | null }> {
  const team = canonicalTeam(opponent)
  if (!team) return { pointsAgainst: null, gamesPlayed: null, fetchedAt: null }
  const row = (await (db as any).teamSeasonStats
    .findFirst({
      where: {
        sport: 'NFL',
        team,
        season: String(season),
        seasonType: 'regular',
      },
      orderBy: { fetchedAt: 'desc' },
      select: { pointsAgainst: true, gamesPlayed: true, fetchedAt: true },
    })
    .catch(() => null)) as { pointsAgainst: number | null; gamesPlayed: number | null; fetchedAt: Date | null } | null
  return {
    pointsAgainst: row?.pointsAgainst ?? null,
    gamesPlayed: row?.gamesPlayed ?? null,
    fetchedAt: row?.fetchedAt ?? null,
  }
}

async function loadProjectionRows(
  db: DbClient,
  player: SportsPlayerRow,
  ids: CanonicalNflProviderIds,
  season: number,
  week: number,
): Promise<{
  providerWeeklyProjection: number | null
  providerFetchedAt: Date | null
  afWeeklyProjection: number | null
  afConfidenceLevel: string | null
  afFetchedAt: Date | null
}> {
  const candidates = candidateIds(player, ids)
  const [provider, af] = await Promise.all([
    (db as any).fantasyProjection
      .findFirst({
        // source filter: this value is the PROVIDER column; the AF mirror (source
        // 'allfantasy') already reaches this builder via AFProjectionSnapshot below.
        where: { sport: 'NFL', season: String(season), week, playerId: { in: candidates }, source: { not: 'allfantasy' } },
        orderBy: { fetchedAt: 'desc' },
        select: { projectedPoints: true, fetchedAt: true },
      })
      .catch(() => null),
    (db as any).aFProjectionSnapshot
      .findFirst({
        where: { sport: 'NFL', season, week, playerId: { in: candidates } },
        orderBy: { computedAt: 'desc' },
        select: { afProjection: true, confidenceLevel: true, computedAt: true },
      })
      .catch(() => null),
  ])
  return {
    providerWeeklyProjection: asNumber(provider?.projectedPoints),
    providerFetchedAt: provider?.fetchedAt ?? null,
    afWeeklyProjection: asNumber(af?.afProjection),
    afConfidenceLevel: af?.confidenceLevel ?? null,
    afFetchedAt: af?.computedAt ?? null,
  }
}

async function loadAdp(db: DbClient, player: SportsPlayerRow, season: number): Promise<number | null> {
  const key = buildPlayerKey(player.name, player.position ?? '')
  if (!key) return null
  const row = (await (db as any).allFantasyAdpSnapshot
    .findFirst({
      where: {
        sport: 'NFL',
        leagueType: 'redraft',
        season: String(season),
        playerKey: key,
        draftMode: 'real',
      },
      orderBy: { lastUpdatedAt: 'desc' },
      select: { averageOverallPick: true },
    })
    .catch(() => null)) as { averageOverallPick: number | null } | null
  return row?.averageOverallPick ?? null
}

async function loadTradeValue(db: DbClient, player: SportsPlayerRow, ids: CanonicalNflProviderIds): Promise<number | null> {
  const candidates = candidateIds(player, ids)
  const row = (await (db as any).sportsPlayerRecord
    .findFirst({
      where: {
        sport: 'NFL',
        dynastyValue: { not: null },
        OR: [{ id: { in: candidates } }, { name: player.name }],
      },
      orderBy: { lastUpdated: 'desc' },
      select: { dynastyValue: true },
    })
    .catch(() => null)) as { dynastyValue: number | null } | null
  return row?.dynastyValue ?? null
}

async function buildCanonicalPlayerFromRow(
  row: SportsPlayerRow,
  identity: IdentityMapRow | null,
  options: { season: number; week: number; prismaClient: DbClient },
): Promise<CanonicalNflPlayer> {
  const db = options.prismaClient
  const providerIds = providerIdsFor(row, identity)
  const stats = await loadSeasonStats(db, row, providerIds, options.season)
  const injury = await loadInjuryStatus(db, row, providerIds, options.season, options.week)
  const depth = await loadDepthChart(db, row, providerIds, options.season)
  const schedule = await loadScheduleContext(db, row.team, options.season, options.week)
  const adp = await loadAdp(db, row, options.season)
  const tradeValue = await loadTradeValue(db, row, providerIds)
  const projectionRows = await loadProjectionRows(db, row, providerIds, options.season, options.week)
  const opponentStats = await loadOpponentTeamStats(db, schedule.opponent, options.season)

  const dataSources = new Set<string>(['sports_players'])
  if (identity) dataSources.add('player_identity_map')
  if (stats?.source) dataSources.add(stats.source)
  if (injury.status) dataSources.add('injuries')
  if (depth.rank != null) dataSources.add('depth_charts')
  if (schedule.byeWeek != null || schedule.opponent) dataSources.add('game_schedules')
  if (adp != null) dataSources.add('allfantasy_adp')
  if (tradeValue != null) dataSources.add('fantasycalc')

  const staleDataWarnings = [
    staleWarning('player profile', row.fetchedAt, 24 * 7),
    staleWarning('injury', injury.fetchedAt, 24),
    staleWarning('depth chart', depth.fetchedAt, 48),
    staleWarning('opponent team stats', opponentStats.fetchedAt, 72),
    schedule.hasWeekSchedule ? null : `NFL schedule data is unavailable for week ${options.week}.`,
    stats && stats.season !== options.season
      ? `Using ${stats.season} season stats as the projection baseline for ${options.season}.`
      : null,
  ].filter((v): v is string => Boolean(v))

  const projection = buildCanonicalNflProjection({
    playerId: row.id,
    providerPlayerId: row.externalId,
    playerName: row.name,
    position: row.position,
    team: row.team,
    season: options.season,
    week: options.week,
    providerWeeklyProjection: projectionRows.providerWeeklyProjection,
    afWeeklyProjection: projectionRows.afWeeklyProjection,
    afConfidenceLevel: projectionRows.afConfidenceLevel,
    rollingInsightsFantasyPointsPerGame: stats?.fantasyPointsPerGame ?? null,
    rollingInsightsGamesPlayed: stats?.gamesPlayed ?? null,
    adp,
    byeWeek: schedule.byeWeek,
    injuryStatus: injury.status ?? row.status,
    depthChartRank: depth.rank,
    opponentPointsAgainst: opponentStats.pointsAgainst,
    opponentGamesPlayed: opponentStats.gamesPlayed,
    dataSources: [...dataSources],
    staleDataWarnings,
  })

  return {
    playerId: row.id,
    playerName: row.name,
    normalizedName: canonicalName(row.name),
    position: row.position ?? null,
    team: row.team ?? null,
    teamId: row.teamId ?? null,
    jerseyNumber: row.number ?? null,
    status: row.status ?? identity?.status ?? null,
    injuryStatus: injury.status ?? row.status ?? null,
    headshotUrl: row.imageUrl ?? null,
    byeWeek: schedule.byeWeek,
    opponent: schedule.opponent,
    depthChartRank: depth.rank,
    depthChartRole: depth.role,
    providerIds,
    seasonStats: stats,
    projection,
    adp,
    tradeValue,
    dataSources: [...dataSources],
    staleDataWarnings,
  }
}

export async function getCanonicalNflPlayerContext(
  playerId: string,
  options?: { season?: number; week?: number; prismaClient?: DbClient },
): Promise<CanonicalNflPlayer | null> {
  const db = (options?.prismaClient ?? prisma) as DbClient
  const season = Number(options?.season ?? new Date().getUTCFullYear())
  const week = Math.max(1, Number(options?.week ?? 1))
  const identity = await findIdentityById(db, playerId)
  const row = await findSportsPlayerByAnyId(db, [
    playerId,
    identity?.rollingInsightsId,
    identity?.sleeperId,
    identity?.fantasyCalcId,
  ])
  if (!row) return null
  return buildCanonicalPlayerFromRow(row, identity, { season, week, prismaClient: db })
}

export async function getCanonicalNflPlayerByNameTeam(
  name: string,
  team?: string | null,
  options?: { position?: string | null; season?: number; week?: number; prismaClient?: DbClient },
): Promise<CanonicalNflPlayer | null> {
  const db = (options?.prismaClient ?? prisma) as DbClient
  const season = Number(options?.season ?? new Date().getUTCFullYear())
  const week = Math.max(1, Number(options?.week ?? 1))
  const identity = await findIdentityByNameTeam(db, name, team, options?.position)
  const row =
    (identity
      ? await findSportsPlayerByAnyId(db, [identity.rollingInsightsId, identity.sleeperId, identity.fantasyCalcId])
      : null) ??
    (await findSportsPlayerByNameTeam(db, name, team, options?.position))
  if (!row) return null
  return buildCanonicalPlayerFromRow(row, identity, { season, week, prismaClient: db })
}

export async function getCanonicalNflProjectionContext(
  playerIds: string[],
  week: number,
  season: number,
  options?: { prismaClient?: DbClient },
): Promise<CanonicalNflProjection[]> {
  const db = (options?.prismaClient ?? prisma) as DbClient
  const players = await Promise.all(
    uniq(playerIds).map((playerId) => getCanonicalNflPlayerContext(playerId, { week, season, prismaClient: db })),
  )
  return players
    .filter((p): p is CanonicalNflPlayer => Boolean(p))
    .map((p) => p.projection)
    .filter((p): p is CanonicalNflProjection => Boolean(p))
}

export async function persistCanonicalNflProjection(
  projection: CanonicalNflProjection,
  options?: { prismaClient?: DbClient },
): Promise<boolean> {
  if (projection.projectedPoints == null) return false
  const db = (options?.prismaClient ?? prisma) as DbClient
  const expiresAt = projection.expiresAt ? new Date(projection.expiresAt) : new Date(Date.now() + 12 * 60 * 60 * 1000)
  const snapshotLookupKey = `${projection.playerId}|${projection.season}|${projection.week}|nfl-data-foundation`
  await (db as any).aFProjectionSnapshot.upsert({
    where: { snapshotLookupKey },
    create: {
      playerId: projection.playerId,
      playerName: projection.playerName,
      sport: 'NFL',
      position: projection.position ?? 'UNK',
      week: projection.week,
      season: projection.season,
      eventId: 'nfl-data-foundation',
      baselineProjection: projection.projectedPoints,
      afProjection: projection.projectedPoints,
      adjustmentFactors: {
        floor: projection.floor,
        ceiling: projection.ceiling,
        restOfSeason: projection.restOfSeason,
        reasonCodes: projection.reasonCodes,
        dataSources: projection.dataSources,
        staleDataWarnings: projection.staleDataWarnings,
      },
      adjustmentReason: projection.reasonCodes.join(', ') || null,
      confidenceLevel: projection.confidenceLevel,
      isOutdoorGame: false,
      venueOverride: false,
      validUntil: expiresAt,
      snapshotLookupKey,
    },
    update: {
      playerName: projection.playerName,
      position: projection.position ?? 'UNK',
      baselineProjection: projection.projectedPoints,
      afProjection: projection.projectedPoints,
      adjustmentFactors: {
        floor: projection.floor,
        ceiling: projection.ceiling,
        restOfSeason: projection.restOfSeason,
        reasonCodes: projection.reasonCodes,
        dataSources: projection.dataSources,
        staleDataWarnings: projection.staleDataWarnings,
      },
      adjustmentReason: projection.reasonCodes.join(', ') || null,
      confidenceLevel: projection.confidenceLevel,
      computedAt: new Date(),
      validUntil: expiresAt,
    },
  })
  return true
}

export async function persistCanonicalNflRosProjection(
  projection: CanonicalNflProjection,
  options?: { prismaClient?: DbClient },
): Promise<boolean> {
  if (projection.restOfSeason == null) return false
  const db = (options?.prismaClient ?? prisma) as DbClient
  const expiresAt = projection.expiresAt ? new Date(projection.expiresAt) : new Date(Date.now() + 72 * 60 * 60 * 1000)
  const snapshotLookupKey = `${projection.playerId}|${projection.season}|ros|nfl-data-foundation`
  await (db as any).aFProjectionSnapshot.upsert({
    where: { snapshotLookupKey },
    create: {
      playerId: projection.playerId,
      playerName: projection.playerName,
      sport: 'NFL',
      position: projection.position ?? 'UNK',
      week: null,
      season: projection.season,
      eventId: 'nfl-data-foundation-ros',
      baselineProjection: projection.restOfSeason,
      afProjection: projection.restOfSeason,
      adjustmentFactors: {
        weeklyProjectedPoints: projection.projectedPoints,
        floor: projection.floor,
        ceiling: projection.ceiling,
        reasonCodes: projection.reasonCodes,
        dataSources: projection.dataSources,
        staleDataWarnings: projection.staleDataWarnings,
      },
      adjustmentReason: projection.reasonCodes.join(', ') || null,
      confidenceLevel: projection.confidenceLevel,
      isOutdoorGame: false,
      venueOverride: false,
      validUntil: expiresAt,
      snapshotLookupKey,
    },
    update: {
      playerName: projection.playerName,
      position: projection.position ?? 'UNK',
      baselineProjection: projection.restOfSeason,
      afProjection: projection.restOfSeason,
      adjustmentFactors: {
        weeklyProjectedPoints: projection.projectedPoints,
        floor: projection.floor,
        ceiling: projection.ceiling,
        reasonCodes: projection.reasonCodes,
        dataSources: projection.dataSources,
        staleDataWarnings: projection.staleDataWarnings,
      },
      adjustmentReason: projection.reasonCodes.join(', ') || null,
      confidenceLevel: projection.confidenceLevel,
      computedAt: new Date(),
      validUntil: expiresAt,
    },
  })
  return true
}

export async function generateAndPersistCanonicalNflProjections(options?: {
  season?: number
  week?: number
  limit?: number
  write?: boolean
  prismaClient?: DbClient
}): Promise<{ generated: number; persisted: number; rosPersisted: number; skipped: number }> {
  const db = (options?.prismaClient ?? prisma) as DbClient
  const season = Number(options?.season ?? new Date().getUTCFullYear())
  const week = Math.max(1, Number(options?.week ?? 1))
  const limit = Math.min(Math.max(Number(options?.limit ?? 500), 1), 10000)
  const rowsRaw = (await (db as any).sportsPlayer
    .findMany({
      where: { sport: 'NFL' },
      orderBy: [{ updatedAt: 'desc' }],
      take: limit,
    })
    .catch(() => [])) as SportsPlayerRow[]
  const grouped = new Map<string, SportsPlayerRow[]>()
  for (const row of rowsRaw) {
    const key = `${canonicalName(row.name)}|${canonicalPosition(row.position)}|${canonicalTeam(row.team)}`
    const group = grouped.get(key) ?? []
    group.push(row)
    grouped.set(key, group)
  }
  const rows = [...grouped.values()].map((group) => chooseBestSportsPlayer(group)).filter((row): row is SportsPlayerRow => Boolean(row))
  const write = options?.write !== false
  let generated = 0
  let persisted = 0
  let rosPersisted = 0
  let skipped = 0
  for (const row of rows) {
    const identity = await findIdentityById(db, row.externalId).catch(() => null)
    const player = await buildCanonicalPlayerFromRow(row, identity, { season, week, prismaClient: db })
    if (!player.projection) {
      skipped += 1
      continue
    }
    generated += 1
    if (!write) continue
    if (await persistCanonicalNflProjection(player.projection, { prismaClient: db })) persisted += 1
    else skipped += 1
    if (await persistCanonicalNflRosProjection(player.projection, { prismaClient: db })) rosPersisted += 1
  }
  return { generated, persisted, rosPersisted, skipped }
}

function canonicalFact(player: CanonicalNflPlayer): CanonicalNflAiPlayerFact {
  return {
    playerId: player.playerId,
    playerName: player.playerName,
    position: player.position,
    team: player.team,
    injuryStatus: player.injuryStatus,
    byeWeek: player.byeWeek,
    projectedPoints: player.projection?.projectedPoints ?? null,
    restOfSeason: player.projection?.restOfSeason ?? null,
    confidence: player.projection?.confidence ?? 0,
    projectionSource: player.projection?.projectionSource ?? null,
    tradeValue: player.tradeValue,
    depthChartRole: player.depthChartRole,
    dataSources: player.dataSources,
    staleDataWarnings: player.staleDataWarnings,
  }
}

export async function getCanonicalNflRosterContext(
  rosterId: string,
  options?: { week?: number; season?: number; prismaClient?: DbClient },
): Promise<CanonicalNflRosterPlayer[]> {
  const db = (options?.prismaClient ?? prisma) as DbClient
  const roster = (await (db as any).redraftRoster
    .findUnique({
      where: { id: rosterId },
      include: { players: { where: { droppedAt: null } }, season: true },
    })
    .catch(() => null)) as
    | {
        season: { season: number; currentWeek: number }
        players: Array<{
          playerId: string
          playerName: string
          position: string
          team: string | null
          slotType: string | null
          isLocked: boolean
          injuryStatus: string | null
        }>
      }
    | null
  if (!roster) return []
  const season = Number(options?.season ?? roster.season.season)
  const week = Number(options?.week ?? roster.season.currentWeek ?? 1)
  const players = await Promise.all(
    roster.players.map(async (row) => {
      const player =
        (await getCanonicalNflPlayerContext(row.playerId, { season, week, prismaClient: db })) ??
        (await getCanonicalNflPlayerByNameTeam(row.playerName, row.team, {
          position: row.position,
          season,
          week,
          prismaClient: db,
        }))
      if (!player) return null
      const warnings: string[] = []
      if (row.isLocked) warnings.push('Player is locked for the current scoring period.')
      if (player.byeWeek === week) warnings.push('Player is on bye this week.')
      if (injuryUnavailable(row.injuryStatus ?? player.injuryStatus)) warnings.push('Player is unavailable by injury status.')
      return {
        ...player,
        rosterId,
        slotType: row.slotType,
        isLocked: row.isLocked,
        injuryStatus: row.injuryStatus ?? player.injuryStatus,
        lineupWarnings: warnings,
      } satisfies CanonicalNflRosterPlayer
    }),
  )
  return players.filter((p): p is CanonicalNflRosterPlayer => Boolean(p))
}

export async function getCanonicalNflRosteredIdentityKeysForLeague(
  leagueId: string,
  options?: { seasonId?: string | null; prismaClient?: DbClient },
): Promise<Set<string>> {
  const db = (options?.prismaClient ?? prisma) as DbClient
  const rows = (await (db as any).redraftRosterPlayer
    .findMany({
      where: {
        droppedAt: null,
        roster: {
          leagueId,
          ...(options?.seasonId ? { seasonId: options.seasonId } : {}),
        },
      },
      select: { playerId: true, playerName: true, position: true, team: true },
    })
    .catch(() => [])) as Array<{ playerId: string; playerName: string; position: string; team: string | null }>
  const keys = new Set<string>()
  for (const row of rows) {
    keys.add(String(row.playerId ?? '').trim())
    keys.add(strictIdentityKey(row.playerName, row.position))
    keys.add(`name:${canonicalName(row.playerName)}|${canonicalPosition(row.position)}|${canonicalTeam(row.team)}`)
  }
  keys.delete('')
  return keys
}

export function playerMatchesRosteredKeys(
  player: { id?: string | null; playerId?: string | null; name?: string | null; playerName?: string | null; position?: string | null; team?: string | null },
  rosteredKeys: ReadonlySet<string>,
): boolean {
  const id = String(player.id ?? player.playerId ?? '').trim()
  if (id && rosteredKeys.has(id)) return true
  if (rosteredKeys.has(strictIdentityKey(player.name ?? player.playerName, player.position))) return true
  return rosteredKeys.has(
    `name:${canonicalName(player.name ?? player.playerName)}|${canonicalPosition(player.position)}|${canonicalTeam(player.team)}`,
  )
}

export async function enrichCanonicalNflDraftPoolEntries<T extends Record<string, any>>(
  _leagueId: string,
  entries: T[],
  options?: { season?: number; week?: number; prismaClient?: DbClient },
): Promise<T[]> {
  if (!entries.length) return entries
  const db = (options?.prismaClient ?? prisma) as DbClient
  const season = Number(options?.season ?? new Date().getUTCFullYear())
  const week = Math.max(1, Number(options?.week ?? 1))
  const enriched = await Promise.all(
    entries.map(async (entry, index) => {
      const display = entry.display && typeof entry.display === 'object' ? entry.display : null
      const playerId = String(display?.playerId ?? entry.playerId ?? entry.sleeperId ?? entry.id ?? '').trim()
      const name = String(entry.name ?? display?.displayName ?? '').trim()
      const team = String(entry.team ?? display?.team?.abbreviation ?? '').trim() || null
      const position = String(entry.position ?? display?.metadata?.position ?? '').trim() || null
      const canonical =
        (playerId ? await getCanonicalNflPlayerContext(playerId, { season, week, prismaClient: db }) : null) ??
        (name ? await getCanonicalNflPlayerByNameTeam(name, team, { position, season, week, prismaClient: db }) : null)
      if (!canonical) return entry
      const projection = canonical.projection
      const stats =
        display?.stats && typeof display.stats === 'object'
          ? {
              ...display.stats,
              canonicalProjectedPoints: projection?.projectedPoints ?? null,
              canonicalProjectionConfidence: projection?.confidence ?? null,
              canonicalProjectionSource: projection?.projectionSource ?? null,
              canonicalRestOfSeason: projection?.restOfSeason ?? null,
            }
          : display?.stats
      return {
        ...entry,
        draftRank: entry.draftRank ?? index + 1,
        display: display ? { ...display, stats } : display,
        canonicalNfl: {
          playerId: canonical.playerId,
          providerIds: canonical.providerIds,
          projection,
          injuryStatus: canonical.injuryStatus,
          byeWeek: canonical.byeWeek,
          depthChartRole: canonical.depthChartRole,
          dataSources: canonical.dataSources,
          staleDataWarnings: canonical.staleDataWarnings,
        },
      }
    }),
  )
  return enriched
}

export async function getCanonicalNflLeaguePlayerPool(
  leagueId: string,
  options?: { season?: number; week?: number; limit?: number; prismaClient?: DbClient },
): Promise<CanonicalNflDraftPoolPlayer[]> {
  const resolved = await getResolvedDraftPoolForLeague(leagueId, { limit: options?.limit ?? 300 })
  if (resolved.sport !== 'NFL') return []
  const entries = await enrichCanonicalNflDraftPoolEntries(leagueId, resolved.entries as Array<Record<string, any>>, options)
  const players: CanonicalNflDraftPoolPlayer[] = []
  entries.forEach((entry, index) => {
    const c = entry.canonicalNfl as { projection?: CanonicalNflProjection; providerIds?: CanonicalNflProviderIds } | undefined
    const display = entry.display as Record<string, any> | undefined
    if (!c?.providerIds) return
    players.push({
      playerId: String(c.providerIds.allFantasyId),
      playerName: String(entry.name ?? display?.displayName ?? ''),
      normalizedName: canonicalName(String(entry.name ?? display?.displayName ?? '')),
      position: String(entry.position ?? display?.metadata?.position ?? '') || null,
      team: String(entry.team ?? display?.team?.abbreviation ?? '') || null,
      teamId: null,
      jerseyNumber: null,
      status: null,
      injuryStatus: (entry.injuryStatus as string | null | undefined) ?? null,
      headshotUrl: (entry.headshotUrl as string | null | undefined) ?? null,
      byeWeek: asNumber(entry.byeWeek ?? entry.bye),
      opponent: null,
      depthChartRank: null,
      depthChartRole: (entry.canonicalNfl as any)?.depthChartRole ?? null,
      providerIds: c.providerIds,
      seasonStats: null,
      projection: c.projection ?? null,
      adp: asNumber(entry.adp),
      aiAdp: asNumber(entry.aiAdp),
      tradeValue: null,
      draftRank: index + 1,
      available: true,
      dataSources: ((entry.canonicalNfl as any)?.dataSources ?? []) as string[],
      staleDataWarnings: ((entry.canonicalNfl as any)?.staleDataWarnings ?? []) as string[],
    })
  })
  return dedupeCanonicalNflPlayers<CanonicalNflDraftPoolPlayer>(players)
}

export async function getCanonicalNflFreeAgents(
  leagueId: string,
  seasonId?: string | null,
  options?: { season?: number; week?: number; limit?: number; prismaClient?: DbClient },
): Promise<CanonicalNflWaiverPlayer[]> {
  const rosteredKeys = await getCanonicalNflRosteredIdentityKeysForLeague(leagueId, {
    seasonId,
    prismaClient: options?.prismaClient,
  })
  const pool = await getCanonicalNflLeaguePlayerPool(leagueId, options)
  return pool
    .filter((player) => !playerMatchesRosteredKeys(player, rosteredKeys))
    .map((player) => {
      const projected = player.projection?.projectedPoints ?? 0
      const confidence = player.projection?.confidence ?? 0
      return {
        ...player,
        rostered: false,
        faabRecommendation:
          projected > 0 ? clamp(Math.round((projected * Math.max(confidence, 30)) / 120), 1, 35) : null,
        addConfidence: confidence,
        dropCandidatePlayerId: null,
      } satisfies CanonicalNflWaiverPlayer
    })
}

export async function getCanonicalNflTradeContext(
  proposalAssets: CanonicalNflTradeAsset[],
  options?: { season?: number; week?: number; prismaClient?: DbClient },
): Promise<CanonicalNflTradeContext> {
  const season = Number(options?.season ?? new Date().getUTCFullYear())
  const week = Math.max(1, Number(options?.week ?? 1))
  const db = (options?.prismaClient ?? prisma) as DbClient
  const assets = await Promise.all(
    proposalAssets.map(async (asset) => {
      if (asset.assetType !== 'player') {
        return {
          ...asset,
          canonicalPlayer: null,
          weeklyProjectionDelta: null,
          restOfSeasonProjection: null,
          fantasyCalcValue: null,
          injuryRisk: 'unknown' as const,
          starterImpact: null,
          benchImpact: null,
        }
      }
      const canonical =
        (asset.playerId
          ? await getCanonicalNflPlayerContext(asset.playerId, { season, week, prismaClient: db })
          : null) ??
        (asset.playerName
          ? await getCanonicalNflPlayerByNameTeam(asset.playerName, asset.team, {
              position: asset.position,
              season,
              week,
              prismaClient: db,
            })
          : null)
      const projected = canonical?.projection?.projectedPoints ?? null
      return {
        ...asset,
        canonicalPlayer: canonical,
        weeklyProjectionDelta: projected,
        restOfSeasonProjection: canonical?.projection?.restOfSeason ?? null,
        fantasyCalcValue: canonical?.tradeValue ?? null,
        injuryRisk: injuryRisk(canonical?.injuryStatus ?? null),
        starterImpact: projected != null ? round1(projected) : null,
        benchImpact: projected != null ? round1(projected * 0.45) : null,
      }
    }),
  )
  const dataSources = new Set<string>()
  const missingDataWarnings: string[] = []
  for (const asset of assets) {
    if (asset.canonicalPlayer) {
      for (const source of asset.canonicalPlayer.dataSources) dataSources.add(source)
      if (asset.fantasyCalcValue == null) missingDataWarnings.push(`Missing FantasyCalc value for ${asset.canonicalPlayer.playerName}.`)
      if (asset.weeklyProjectionDelta == null) missingDataWarnings.push(`Missing projection for ${asset.canonicalPlayer.playerName}.`)
    } else if (asset.assetType === 'player') {
      missingDataWarnings.push(`Unresolved player asset: ${asset.playerName ?? asset.playerId ?? 'unknown'}.`)
    }
  }
  return {
    assets,
    dataSources: [...dataSources],
    missingDataWarnings: [...new Set(missingDataWarnings)],
  }
}

export async function getCanonicalNflMatchupContext(
  input: { matchupId?: string | null; seasonId?: string | null; week?: number | null },
  options?: { prismaClient?: DbClient },
): Promise<{
  matchupId: string | null
  week: number | null
  homeRosterId: string | null
  awayRosterId: string | null
  homeProjectedTotal: number | null
  awayProjectedTotal: number | null
  projectedWinnerRosterId: string | null
  confidence: number
  playerBreakdown: CanonicalNflAiPlayerFact[]
  missingDataWarnings: string[]
}> {
  const db = (options?.prismaClient ?? prisma) as DbClient
  const matchup = (await (db as any).redraftMatchup
    .findFirst({
      where: {
        ...(input.matchupId ? { id: input.matchupId } : {}),
        ...(input.seasonId ? { seasonId: input.seasonId } : {}),
        ...(input.week != null ? { week: Number(input.week) } : {}),
      },
      orderBy: { week: 'asc' },
    })
    .catch(() => null)) as { id: string; week: number; homeRosterId: string; awayRosterId: string | null } | null
  if (!matchup) {
    return {
      matchupId: null,
      week: input.week ?? null,
      homeRosterId: null,
      awayRosterId: null,
      homeProjectedTotal: null,
      awayProjectedTotal: null,
      projectedWinnerRosterId: null,
      confidence: 0,
      playerBreakdown: [],
      missingDataWarnings: ['Matchup context unavailable.'],
    }
  }
  const [home, away] = await Promise.all([
    getCanonicalNflRosterContext(matchup.homeRosterId, { week: matchup.week, prismaClient: db }),
    matchup.awayRosterId
      ? getCanonicalNflRosterContext(matchup.awayRosterId, { week: matchup.week, prismaClient: db })
      : Promise.resolve([]),
  ])
  const total = (players: CanonicalNflRosterPlayer[]) =>
    round1(players.reduce((sum, p) => sum + (p.projection?.projectedPoints ?? 0), 0))
  const homeTotal = total(home)
  const awayTotal = matchup.awayRosterId ? total(away) : null
  const playerBreakdown = [...home, ...away].map(canonicalFact)
  const missingDataWarnings = playerBreakdown.filter((p) => p.projectedPoints == null).map((p) => `Missing projection for ${p.playerName}.`)
  return {
    matchupId: matchup.id,
    week: matchup.week,
    homeRosterId: matchup.homeRosterId,
    awayRosterId: matchup.awayRosterId,
    homeProjectedTotal: homeTotal,
    awayProjectedTotal: awayTotal,
    projectedWinnerRosterId:
      awayTotal == null ? matchup.homeRosterId : homeTotal === awayTotal ? null : homeTotal > awayTotal ? matchup.homeRosterId : matchup.awayRosterId,
    confidence: playerBreakdown.length
      ? Math.round(playerBreakdown.reduce((sum, p) => sum + p.confidence, 0) / playerBreakdown.length)
      : 0,
    playerBreakdown,
    missingDataWarnings,
  }
}

export async function getCanonicalNflAiContext(input: {
  leagueId: string
  rosterId?: string | null
  week?: number | null
  purpose?: CanonicalNflAiContext['purpose']
  season?: number | null
  prismaClient?: DbClient
}): Promise<CanonicalNflAiContext> {
  const db = (input.prismaClient ?? prisma) as DbClient
  const week = Math.max(1, Number(input.week ?? 1))
  const season = Number(input.season ?? new Date().getUTCFullYear())
  const [coverage, rosterPlayers, waiverPlayers] = await Promise.all([
    getCanonicalNflDataCoverage({ season, week, prismaClient: db }),
    input.rosterId
      ? getCanonicalNflRosterContext(input.rosterId, { season, week, prismaClient: db })
      : Promise.resolve([]),
    getCanonicalNflFreeAgents(input.leagueId, null, { season, week, limit: 30, prismaClient: db }).catch(() => []),
  ])
  const playerFacts = rosterPlayers.map(canonicalFact)
  const waiverFacts = waiverPlayers.slice(0, 12).map(canonicalFact)
  const rosterNeeds = inferRosterNeeds(playerFacts)
  const dataWarnings = [
    ...coverage.missingFields.map((field) => `Missing ${field}.`),
    ...coverage.staleFields.map((field) => `Stale ${field}.`),
    ...playerFacts.flatMap((p) => p.staleDataWarnings),
    ...waiverFacts.flatMap((p) => p.staleDataWarnings),
  ]
  return {
    leagueId: input.leagueId,
    rosterId: input.rosterId ?? null,
    week,
    purpose: input.purpose ?? 'general',
    players: playerFacts,
    waiverOptions: waiverFacts,
    rosterNeeds,
    coverage,
    dataWarnings: [...new Set(dataWarnings)],
    promptRules: [
      'Use only normalized canonical NFL facts in this context.',
      'Say when projections, injuries, schedules, scores, or trade values are missing or stale.',
      'Do not invent injuries, projections, schedules, scores, depth-chart roles, or trade values.',
      'Keep redraft trade advice season-focused; do not use dynasty language.',
    ],
  }
}

function inferRosterNeeds(players: CanonicalNflAiPlayerFact[]): string[] {
  const byPos = new Map<string, number>()
  for (const player of players) {
    const pos = canonicalPosition(player.position)
    if (!pos) continue
    byPos.set(pos, (byPos.get(pos) ?? 0) + 1)
  }
  const needs: string[] = []
  if ((byPos.get('QB') ?? 0) < 1) needs.push('QB depth')
  if ((byPos.get('RB') ?? 0) < 4) needs.push('RB depth')
  if ((byPos.get('WR') ?? 0) < 4) needs.push('WR depth')
  if ((byPos.get('TE') ?? 0) < 1) needs.push('TE depth')
  return needs
}

export function sanitizeCanonicalNflAiContext(context: CanonicalNflAiContext): CanonicalNflAiContext {
  return {
    ...context,
    players: context.players.map((p) => ({ ...p })),
    waiverOptions: context.waiverOptions.map((p) => ({ ...p })),
    coverage: { ...context.coverage },
    dataWarnings: [...context.dataWarnings],
    promptRules: [...context.promptRules],
  }
}

export async function getCanonicalNflCoverageForAi(options?: {
  season?: number
  week?: number | null
  prismaClient?: DbClient
}): Promise<CanonicalNflDataCoverage> {
  return getCanonicalNflDataCoverage(options)
}
