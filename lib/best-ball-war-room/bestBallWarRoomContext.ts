/**
 * BEST BALL AF WAR ROOM — canonical context builder.
 *
 * The ONLY file in the best-ball War Room that performs DB I/O. It assembles a
 * deterministic, serializable `BestBallWarRoomContext` from:
 *  - the legacy `Roster.playerData` draft roster (best ball is draft-only),
 *  - the best-ball profile (auto-optimal lineup slots + recommended sizes) and settings,
 *  - redraft ADP for value (ADP-implied round = ceil(adp / teamCount)),
 *  - real weekly scores for spike-week ceiling/variance (when played),
 *  - `SportsPlayer` for position/team enrichment (team → stack/correlation), injuries/news.
 *
 * It NEVER calls OpenAI and NEVER fabricates projections/ADP/stacks/bye weeks. Best ball
 * has an AUTOMATIC optimal lineup — this context offers NO manual start/sit. When a source
 * is empty it sets the matching `availability` flag and records a `missingDataFlags` entry.
 */

import { prisma } from '@/lib/prisma'
import { isOrphanPlatformUserId } from '@/lib/orphan-ai-manager/orphan-platform-ids'
import { resolveLeagueAccess } from '@/lib/league-access'
import { getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'
import { buildPlayerKey } from '@/lib/adp/computeAllFantasyAdp'
import { getBestBallSportProfile, normalizeBestBallSettings } from '@/lib/bestball/rules'
import { fetchAdpByPlayerKey } from '@/lib/redraft-war-room/redraftFreeAgentPool'
import { fetchRedraftInjuryNews, injuryNameKey } from '@/lib/redraft-war-room/redraftInjuryNews'
import type {
  BestBallDataAvailability,
  BestBallLineupSlot,
  BestBallPlayerFact,
  BestBallRosterSettings,
  BestBallScoringSettings,
  BestBallSettings,
  BestBallTeamSummary,
  BestBallWarRoomContext,
  DataState,
} from './types'

export interface BuildBestBallWarRoomContextInput {
  leagueId: string
  userId: string | null | undefined
}

export type BuildBestBallWarRoomContextResult =
  | { ok: true; context: BestBallWarRoomContext }
  | { ok: false; status: 401 | 403 | 404; error: string }

function pickStr(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

function pickNum(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return null
}

interface RawRosterPlayer {
  playerId: string
  playerName: string | null
  position: string | null
  team: string | null
  byeWeek: number | null
}

/** Tolerant parse of a best-ball legacy roster playerData (lineup_sections ∪ flat players[]). */
function parseRosterPlayers(playerData: unknown): RawRosterPlayer[] {
  const out: RawRosterPlayer[] = []
  const seen = new Set<string>()
  const push = (item: unknown) => {
    if (typeof item === 'string') {
      if (item && !seen.has(item)) {
        seen.add(item)
        out.push({ playerId: item, playerName: null, position: null, team: null, byeWeek: null })
      }
      return
    }
    if (!item || typeof item !== 'object') return
    const o = item as Record<string, unknown>
    const id = pickStr(o, ['id', 'playerId', 'player_id'])
    if (!id || seen.has(id)) return
    seen.add(id)
    out.push({
      playerId: id,
      playerName: pickStr(o, ['name', 'full_name', 'fullName', 'playerName', 'displayName']),
      position: pickStr(o, ['position', 'pos']),
      team: pickStr(o, ['team', 'nflTeam', 'proTeam', 'teamAbbr']),
      byeWeek: pickNum(o, ['byeWeek', 'bye_week', 'bye']),
    })
  }
  // lineup_sections (all sections count as roster in best ball — there is no manual lineup).
  const sections = getNormalizedLineupSections(playerData)
  for (const sec of ['starters', 'bench', 'ir', 'taxi', 'devy'] as const) for (const item of sections[sec]) push(item)
  // flat players[] fallback (the shape the best-ball league API reads).
  if (playerData && typeof playerData === 'object' && !Array.isArray(playerData)) {
    const players = (playerData as Record<string, unknown>).players
    if (Array.isArray(players)) for (const item of players) push(item)
  }
  return out
}

function buildRosterSettings(sport: string): BestBallRosterSettings {
  const profile = getBestBallSportProfile(sport)
  const lineupSlots: BestBallLineupSlot[] = profile.lineupSlots.map((s) => ({
    code: s.code,
    count: s.count,
    allowedPositions: s.allowedPositions.map((p) => p.toUpperCase()),
  }))
  const requiredByPosition: Record<string, number> = {}
  const flexSlots: Array<{ code: string; count: number; allowedPositions: string[] }> = []
  let startingSlots = 0
  for (const s of lineupSlots) {
    startingSlots += s.count
    if (s.allowedPositions.length === 1) {
      requiredByPosition[s.allowedPositions[0]] = (requiredByPosition[s.allowedPositions[0]] ?? 0) + s.count
    } else {
      flexSlots.push(s)
    }
  }
  return {
    lineupSlots,
    startingSlots,
    recommendedRosterSize: profile.recommendedRosterSize,
    recommendedBenchSize: profile.recommendedBenchSize,
    requiredByPosition,
    flexSlots,
  }
}

export async function buildBestBallWarRoomContext(
  input: BuildBestBallWarRoomContextInput,
): Promise<BuildBestBallWarRoomContextResult> {
  const { leagueId, userId } = input
  if (!userId) return { ok: false, status: 401, error: 'Unauthorized' }

  const access = await resolveLeagueAccess(leagueId, userId)
  if (!access?.isMember) return { ok: false, status: 403, error: 'Forbidden' }

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      sport: true,
      season: true,
      leagueSize: true,
      bestBallMode: true,
      bbMatchupFormat: true,
      bbScoringPeriod: true,
      settings: true,
      rosters: { select: { id: true, platformUserId: true, playerData: true } },
      teams: { select: { teamName: true, ownerName: true, platformUserId: true } },
    },
  })
  if (!league) return { ok: false, status: 404, error: 'League not found' }
  if (!league.bestBallMode) return { ok: false, status: 404, error: 'Not a Best Ball league' }

  const sport = String(league.sport ?? 'NFL')
  const season = Number(league.season ?? new Date().getFullYear())
  const teamCount = league.leagueSize ?? league.rosters.length ?? 12

  const settingsRecord =
    league.settings && typeof league.settings === 'object' && !Array.isArray(league.settings)
      ? (league.settings as Record<string, unknown>)
      : {}
  const bbSettings = normalizeBestBallSettings({
    sport,
    conceptSetup: (settingsRecord.best_ball_settings as Record<string, unknown> | null) ?? null,
    draftType: typeof settingsRecord.canonical_draft_mode === 'string' ? settingsRecord.canonical_draft_mode : 'snake',
  })
  const roster = buildRosterSettings(sport)

  const scoring: BestBallScoringSettings = {
    sport,
    scoringPreset: String((settingsRecord.scoringSettings as Record<string, unknown> | undefined)?.preset ?? bbSettings.mode ?? 'PPR').toUpperCase(),
    scoringPeriod: String(league.bbScoringPeriod ?? bbSettings.scoringPeriod ?? 'weekly'),
    matchupFormat: String(league.bbMatchupFormat ?? bbSettings.matchupFormat ?? 'h2h'),
    cumulative: bbSettings.cumulativeScoring,
  }

  // --- parse rosters ---
  const rawByRoster = new Map<string, RawRosterPlayer[]>()
  for (const r of league.rosters) rawByRoster.set(r.id, parseRosterPlayers(r.playerData))

  const allRaw = [...rawByRoster.values()].flat()
  const allIds = allRaw.map((p) => p.playerId)
  const allNames = Array.from(new Set(allRaw.map((p) => p.playerName).filter((n): n is string => Boolean(n))))

  // --- enrich position/team/name via SportsPlayer (by id, then name) ---
  type Sp = { id: string; name: string; position: string | null; team: string | null }
  const spById = new Map<string, Sp>()
  const spByName = new Map<string, Sp>()
  if (allIds.length || allNames.length) {
    const sportVar = [sport, sport.toUpperCase(), sport.toLowerCase()]
    const rows = (await prisma.sportsPlayer
      .findMany({
        where: { OR: [{ id: { in: allIds } }, { sport: { in: sportVar }, name: { in: allNames } }] },
        select: { id: true, name: true, position: true, team: true },
      })
      .catch(() => [])) as Sp[]
    for (const s of rows) {
      spById.set(s.id, s)
      const nk = s.name.trim().toLowerCase()
      if (!spByName.has(nk)) spByName.set(nk, s)
    }
  }

  // --- ADP value ---
  const adpByKey = await fetchAdpByPlayerKey(sport, season)
  const injuryNews = await fetchRedraftInjuryNews(sport)

  // --- weekly scores → spike-week ceiling (real, when present) ---
  type WSRow = { playerId: string; points: number; isStarter: boolean; createdAt: Date }
  const wsRows = allIds.length
    ? ((await prisma.weeklyScore
        .findMany({
          where: { leagueId, season, playerId: { in: allIds } },
          select: { playerId: true, points: true, isStarter: true, createdAt: true },
        })
        .catch(() => [])) as WSRow[])
    : []
  const wsAgg = new Map<string, { sum: number; n: number; max: number; started: number }>()
  let scoresAsOf: Date | null = null
  for (const row of wsRows) {
    const cur = wsAgg.get(row.playerId) ?? { sum: 0, n: 0, max: 0, started: 0 }
    cur.sum += row.points
    cur.n += 1
    if (row.points > cur.max) cur.max = row.points
    if (row.isStarter) cur.started += 1
    wsAgg.set(row.playerId, cur)
    if (!scoresAsOf || row.createdAt > scoresAsOf) scoresAsOf = row.createdAt
  }

  // --- projections (current/most-recent week) ---
  type ProjRow = { playerId: string; projectedPoints: number }
  const projRows = allIds.length
    ? ((await prisma.fantasyProjection
        .findMany({
          where: { sport, season: String(season), playerId: { in: allIds } },
          select: { playerId: true, projectedPoints: true },
          orderBy: { week: 'desc' },
          take: 2000,
        })
        .catch(() => [])) as ProjRow[])
    : []
  const projByPlayer = new Map<string, number>()
  for (const p of projRows) if (!projByPlayer.has(p.playerId)) projByPlayer.set(p.playerId, p.projectedPoints)

  // --- standings ---
  type StandingRow = { rosterId: string; rank: number | null; wins: number; losses: number; ties: number; pointsFor: number }
  const standings = (await prisma.fantasyStanding
    .findMany({ where: { leagueId, season }, select: { rosterId: true, rank: true, wins: true, losses: true, ties: true, pointsFor: true } })
    .catch(() => [])) as StandingRow[]
  const standingByRoster = new Map(standings.map((s) => [s.rosterId, s]))

  const teamByUser = new Map<string, { teamName: string; ownerName: string }>()
  for (const t of league.teams) if (t.platformUserId) teamByUser.set(t.platformUserId, { teamName: t.teamName, ownerName: t.ownerName })

  function toPlayerFact(raw: RawRosterPlayer): BestBallPlayerFact {
    const sp = spById.get(raw.playerId) ?? (raw.playerName ? spByName.get(raw.playerName.trim().toLowerCase()) : undefined)
    const playerName = raw.playerName ?? sp?.name ?? raw.playerId
    const position = (raw.position ?? sp?.position ?? 'UNK').toUpperCase()
    const team = (raw.team ?? sp?.team ?? null)?.toUpperCase() ?? null
    const adp = adpByKey.get(buildPlayerKey(playerName, position)) ?? null
    const agg = wsAgg.get(raw.playerId)
    const proj = projByPlayer.get(raw.playerId)
    return {
      playerId: raw.playerId,
      playerName,
      position,
      team,
      byeWeek: raw.byeWeek,
      injuryStatus: injuryNews.injuryByName.get(injuryNameKey(playerName))?.status ?? null,
      adp,
      adpRound: adp != null ? Math.max(1, Math.ceil(adp / teamCount)) : null,
      avgPoints: agg && agg.n > 0 ? Math.round((agg.sum / agg.n) * 100) / 100 : null,
      maxPoints: agg && agg.n > 0 ? Math.round(agg.max * 100) / 100 : null,
      startedWeeks: agg ? agg.started : null,
      weekProjection: typeof proj === 'number' ? Math.round(proj * 100) / 100 : null,
      hasNoValueSignal: adp == null && !agg && proj == null,
    }
  }

  type RosterRow = { id: string; platformUserId: string | null; playerData: unknown }
  const teams: BestBallTeamSummary[] = (league.rosters as RosterRow[]).map((r) => {
    const meta = r.platformUserId ? teamByUser.get(r.platformUserId) : undefined
    const standing = standingByRoster.get(r.id)
    return {
      rosterId: r.id,
      ownerId: r.platformUserId ?? r.id,
      // An orphan's key is a placeholder, not a name.
      ownerName: meta?.ownerName ?? (isOrphanPlatformUserId(r.platformUserId ?? '') ? null : r.platformUserId) ?? 'Team',
      teamName: meta?.teamName ?? null,
      wins: standing?.wins ?? 0,
      losses: standing?.losses ?? 0,
      ties: standing?.ties ?? 0,
      pointsFor: standing?.pointsFor ?? 0,
      playoffSeed: standing?.rank ?? null,
      isUserTeam: r.platformUserId === userId,
      players: (rawByRoster.get(r.id) ?? []).map(toPlayerFact),
    }
  })

  const userRosterId = teams.find((t) => t.isUserTeam)?.rosterId ?? null
  const allPlayers = teams.flatMap((t) => t.players)

  const draftComplete = teams.length > 0 && teams.every((t) => t.players.length >= roster.startingSlots)

  // --- availability contract ---
  const adpAvailable = adpByKey.size > 0
  const teamDataAvailable = allPlayers.some((p) => p.team)
  const byeAvailable = allPlayers.some((p) => p.byeWeek != null)
  const scoresAvailable = wsAgg.size > 0
  const availability: BestBallDataAvailability = {
    scoringRules: 'available',
    rosterRules: 'available',
    rosters: league.rosters.length > 0 ? 'available' : 'missing',
    playerValues: adpAvailable ? 'available' : 'missing',
    weeklyScores: scoresAvailable ? 'available' : 'missing',
    projections: projByPlayer.size > 0 ? 'available' : 'missing',
    injuries: injuryNews.injuryByName.size > 0 || allPlayers.some((p) => p.injuryStatus) ? 'available' : 'missing',
    news: injuryNews.newsCount > 0 ? 'available' : 'missing',
    teamData: teamDataAvailable ? 'available' : 'missing',
    byeWeeks: byeAvailable ? 'available' : 'missing',
    standings: standings.length > 0 ? 'available' : 'missing',
  }

  const missingDataFlags: string[] = []
  if (availability.rosters === 'missing') missingDataFlags.push('No drafted rosters found for this league yet.')
  if (availability.playerValues === 'missing')
    missingDataFlags.push('No ADP/ranking values for this sport/season — upside is ranked by available scores only.')
  if (availability.weeklyScores === 'missing')
    missingDataFlags.push('No weekly scores yet — spike-week ceiling uses ADP as a proxy until games are played.')
  if (availability.teamData === 'missing')
    missingDataFlags.push('Player team data unavailable — stack/correlation analysis is limited.')
  if (availability.byeWeeks === 'missing')
    missingDataFlags.push('Bye-week data is not available — bye-cluster risk cannot be assessed.')
  if (!bbSettings.waiversEnabled) missingDataFlags.push('Waivers are disabled in this best-ball league (draft-only).')
  if (!bbSettings.tradesEnabled) missingDataFlags.push('Trades are disabled in this best-ball league (draft-only).')

  const bestBall: BestBallSettings = {
    mode: bbSettings.mode,
    draftMode: bbSettings.draftMode,
    contestStructure: bbSettings.contestStructure,
    waiversEnabled: bbSettings.waiversEnabled,
    tradesEnabled: bbSettings.tradesEnabled,
    substitutionsEnabled: bbSettings.substitutionsEnabled,
    regularSeasonLength: bbSettings.regularSeasonLength,
    draftComplete,
  }

  const hasValueSignal = adpAvailable || scoresAvailable || projByPlayer.size > 0

  const context: BestBallWarRoomContext = {
    leagueId,
    leagueType: 'best_ball',
    sport,
    season,
    teamCount,
    draftComplete,
    scoring,
    roster,
    bestBall,
    userRosterId,
    isCommissioner: access.isCommissioner,
    teams,
    availability,
    freshness: {
      generatedAt: new Date().toISOString(),
      scoresAsOf: scoresAsOf ? scoresAsOf.toISOString() : null,
      injuriesAsOf: injuryNews.injuriesAsOf ? injuryNews.injuriesAsOf.toISOString() : null,
    },
    missingDataFlags,
    featureAvailability: {
      rosterConstruction: availability.rosters === 'available',
      depth: availability.rosters === 'available',
      upside: availability.rosters === 'available' && hasValueSignal,
      draftPlan: availability.rosters === 'available',
      stacks: availability.rosters === 'available' && teamDataAvailable,
      waivers: bbSettings.waiversEnabled,
      tradeAnalyze: bbSettings.tradesEnabled,
      tradeFind: bbSettings.tradesEnabled && hasValueSignal,
    },
  }

  return { ok: true, context }
}
