/**
 * REDRAFT AF WAR ROOM — canonical context builder.
 *
 * This is the ONLY file in the War Room that performs DB I/O. It assembles a
 * deterministic, serializable `RedraftWarRoomContext` from the native redraft
 * data layer (RedraftSeason/Roster/Player/Matchup), the resolved roster template,
 * config-driven scoring, and best-effort provider tables (projections/injuries).
 *
 * It NEVER calls OpenAI and NEVER fabricates values. When a data source is empty
 * it sets the matching `availability` flag to 'missing' and records a human-readable
 * `missingDataFlags` entry so engines and the AI layer degrade safely.
 *
 * See lib/redraft-war-room/types.ts for the contract.
 */

import { prisma } from '@/lib/prisma'
import { getEffectiveLeagueRosterTemplate } from '@/lib/league/getEffectiveLeagueRosterTemplate'
import { resolveLeagueAccess } from '@/lib/league-access'
import { buildPlayerKey } from '@/lib/adp/computeAllFantasyAdp'
import {
  fetchAdpByPlayerKey,
  fetchRedraftFreeAgentPool,
  rosteredPlayerKeys,
} from './redraftFreeAgentPool'
import { fetchRedraftInjuryNews, injuryNameKey } from './redraftInjuryNews'
import { buildAllFantasyProjection } from '@/lib/redraft/projectionEngine'
import { getCanonicalNflDataCoverage } from '@/lib/nfl-data-foundation/nflDataCoverage'
import type {
  DataState,
  RedraftDataAvailability,
  RedraftLineupSlot,
  RedraftMatchupSummary,
  RedraftPlayerFact,
  RedraftRosterSettings,
  RedraftScoringSettings,
  RedraftTeamSummary,
  RedraftWaiverSettings,
  RedraftWarRoomContext,
} from './types'

const SUPERFLEX_RE = /^SUPER[_\s]?FLEX$|^SUPERFLEX$|^SFLEX$/i
const FLEX_RE = /FLEX|^UTIL$|^SUPER_UTIL$/i

function isStarterSlotType(slotType: string | null | undefined): boolean {
  const s = String(slotType ?? '').toLowerCase()
  return s !== 'bench' && s !== 'taxi' && s !== 'devy' && s !== 'ir' && s !== 'reserve'
}

/** Read the league's config-driven scoring summary without recomputing points. */
function resolveScoring(sport: string, settings: Record<string, unknown> | null | undefined): RedraftScoringSettings {
  const sc = (settings?.sportConfig as Record<string, unknown> | undefined) ?? {}
  const preset = String(sc.scoringPreset ?? 'PPR').toUpperCase()
  const overrides =
    typeof sc.categoryPoints === 'object' && sc.categoryPoints !== null
      ? (sc.categoryPoints as Record<string, number>)
      : {}
  let ppr: number | null =
    overrides.rec != null
      ? Number(overrides.rec)
      : preset === 'PPR'
        ? 1
        : preset === 'HALF_PPR'
          ? 0.5
          : preset === 'STANDARD'
            ? 0
            : null
  if (ppr != null && !Number.isFinite(ppr)) ppr = null
  return {
    sport,
    scoringPreset: preset,
    pointsPerReception: ppr,
    superflex: sc.enableSuperflex === true,
    tePremium: sc.enableTEPremium === true,
    idp: sc.enableIDP === true,
  }
}

/** Distribute FLEX slot counts across RB/WR/TE the way league-decision-context does. */
function buildRosterSettings(
  slots: RedraftLineupSlot[],
): RedraftRosterSettings {
  const requiredByPosition: Record<string, number> = {}
  let totalStarterSlots = 0
  let flexCount = 0
  let superflexCount = 0

  for (const slot of slots) {
    const count = slot.starterCount ?? 0
    if (count <= 0) continue
    totalStarterSlots += count
    if (slot.isSuperflex) {
      superflexCount += count
      continue
    }
    if (slot.isFlex) {
      flexCount += count
      continue
    }
    // Dedicated positional slot: attribute to its single allowed position when unambiguous.
    const pos = slot.allowedPositions.length === 1 ? slot.allowedPositions[0] : slot.slotName
    requiredByPosition[pos] = (requiredByPosition[pos] ?? 0) + count
  }

  if (flexCount > 0) {
    requiredByPosition.RB = (requiredByPosition.RB ?? 0) + Math.ceil(flexCount * 0.4)
    requiredByPosition.WR = (requiredByPosition.WR ?? 0) + Math.ceil(flexCount * 0.4)
    requiredByPosition.TE = (requiredByPosition.TE ?? 0) + Math.ceil(flexCount * 0.2)
  }
  if (superflexCount > 0) {
    requiredByPosition.QB = (requiredByPosition.QB ?? 0) + superflexCount
  }

  return {
    totalStarterSlots,
    benchSlots: 0, // filled by caller from template bench rows
    irSlots: 0,
    lineupSlots: slots,
    requiredByPosition,
  }
}

function resolveWaivers(settings: Record<string, unknown> | null | undefined): RedraftWaiverSettings {
  const sc = (settings?.sportConfig as Record<string, unknown> | undefined) ?? {}
  const raw =
    String(sc.waiverType ?? (settings?.waiverType as string | undefined) ?? '').toLowerCase()
  const type: RedraftWaiverSettings['type'] = raw.includes('faab')
    ? 'faab'
    : raw.includes('roll')
      ? 'rolling'
      : raw.includes('rev')
        ? 'reverse'
        : 'unknown'
  const budgetRaw = sc.waiverBudget ?? settings?.waiverBudget
  const faabBudget = typeof budgetRaw === 'number' && Number.isFinite(budgetRaw) ? budgetRaw : null
  return { type, faabBudget }
}

export interface BuildRedraftWarRoomContextInput {
  leagueId: string
  userId: string | null | undefined
  /** Optional explicit season id; defaults to the most recent season for the league. */
  seasonId?: string
}

export type BuildRedraftWarRoomContextResult =
  | { ok: true; context: RedraftWarRoomContext }
  | { ok: false; status: 401 | 403 | 404; error: string }

/**
 * Build the canonical redraft War Room context. Enforces league membership.
 * Commissioners see league-wide team rosters; members see all teams but only their own
 * roster is flagged `isUserTeam` for personalized recommendations.
 */
export async function buildRedraftWarRoomContext(
  input: BuildRedraftWarRoomContextInput,
): Promise<BuildRedraftWarRoomContextResult> {
  const { leagueId, userId } = input
  if (!userId) return { ok: false, status: 401, error: 'Unauthorized' }

  const access = await resolveLeagueAccess(leagueId, userId)
  if (!access?.isMember) return { ok: false, status: 403, error: 'Forbidden' }

  // The generated Prisma client types are loose for these nested includes in this
  // repo, so we pin the shape we rely on to keep this module fully type-safe.
  type RosterPlayerRow = {
    playerId: string
    playerName: string
    position: string
    team: string | null
    slotType: string
    injuryStatus: string | null
    byeWeek: number | null
  }
  type RosterRow = {
    id: string
    ownerId: string
    ownerName: string
    teamName: string | null
    wins: number
    losses: number
    ties: number
    pointsFor: number
    pointsAgainst: number
    streak: string | null
    playoffSeed: number | null
    faabBalance: number | null
    waiverPriority: number
    isEliminated: boolean
    players: RosterPlayerRow[]
  }
  type MatchupRow = {
    id: string
    week: number
    status: string
    homeRosterId: string
    awayRosterId: string | null
    homeScore: number
    awayScore: number
    homeProjected: number | null
    awayProjected: number | null
  }
  type SeasonWithRelations = {
    id: string
    sport: string
    season: number
    status: string
    currentWeek: number
    totalWeeks: number
    playoffStartWeek: number
    rosters: RosterRow[]
    schedule: MatchupRow[]
  }

  const season = (await prisma.redraftSeason.findFirst({
    where: { leagueId, ...(input.seasonId ? { id: input.seasonId } : {}) },
    orderBy: { createdAt: 'desc' },
    include: {
      rosters: { include: { players: { where: { droppedAt: null } } } },
      schedule: true,
    },
  })) as SeasonWithRelations | null
  if (!season) return { ok: false, status: 404, error: 'No redraft season for this league' }
  const resolvedSeason = season

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settings: true, sport: true },
  })
  const settings = (league?.settings as Record<string, unknown> | null) ?? null

  // Roster template → lineup slots.
  let lineupSlots: RedraftLineupSlot[] = []
  let benchSlots = 0
  let irSlots = 0
  let rosterRulesState: DataState = 'available'
  try {
    const tmpl = await getEffectiveLeagueRosterTemplate(leagueId)
    for (const s of tmpl.template.slots) {
      const name = String(s.slotName ?? '')
      const isSuper = SUPERFLEX_RE.test(name)
      const isFlex = !isSuper && (s.isFlexibleSlot || FLEX_RE.test(name))
      if ((s.starterCount ?? 0) > 0) {
        lineupSlots.push({
          slotName: name,
          allowedPositions: (s.allowedPositions ?? []).map((p) => p.toUpperCase()),
          starterCount: s.starterCount,
          isFlex,
          isSuperflex: isSuper,
        })
      }
      benchSlots += s.benchCount ?? 0
      irSlots += s.reserveCount ?? 0
    }
  } catch {
    rosterRulesState = 'missing'
  }

  const roster = buildRosterSettings(lineupSlots)
  roster.benchSlots = benchSlots
  roster.irSlots = irSlots

  const scoring = resolveScoring(season.sport, settings)
  const waivers = resolveWaivers(settings)

  // --- provider data (best-effort, flagged when empty) ---
  const seasonStr = String(season.season)
  const allPlayerIds = season.rosters.flatMap((r) => r.players.map((p) => p.playerId))
  const week = season.currentWeek > 0 ? season.currentWeek : 1

  // Projections for the current week.
  type ProjectionRow = { playerId: string; projectedPoints: number; fetchedAt: Date }
  const projectionRows: ProjectionRow[] = allPlayerIds.length
    ? ((await prisma.fantasyProjection
        .findMany({
          where: { sport: season.sport, season: seasonStr, week, playerId: { in: allPlayerIds } },
          select: { playerId: true, projectedPoints: true, fetchedAt: true },
        })
        .catch(() => [])) as ProjectionRow[])
    : []
  const projectionByPlayer = new Map(projectionRows.map((p) => [p.playerId, p.projectedPoints]))
  type AfProjectionRow = {
    playerId: string
    afProjection: number
    confidenceLevel: string
    computedAt: Date
  }
  const afProjectionRows: AfProjectionRow[] = allPlayerIds.length
    ? ((await prisma.aFProjectionSnapshot
        .findMany({
          where: { sport: season.sport, season: season.season, week, playerId: { in: allPlayerIds } },
          orderBy: { computedAt: 'desc' },
          select: { playerId: true, afProjection: true, confidenceLevel: true, computedAt: true },
        })
        .catch(() => [])) as AfProjectionRow[])
    : []
  const afProjectionByPlayer = new Map<string, AfProjectionRow>()
  for (const row of afProjectionRows) {
    if (!afProjectionByPlayer.has(row.playerId)) afProjectionByPlayer.set(row.playerId, row)
  }
  let projectionsAsOf =
    projectionRows.length > 0
      ? projectionRows.reduce<Date | null>((max, r) => (!max || r.fetchedAt > max ? r.fetchedAt : max), null)
      : null
  for (const row of afProjectionRows) {
    if (!projectionsAsOf || row.computedAt > projectionsAsOf) projectionsAsOf = row.computedAt
  }

  // Season-to-date actuals (finalized weekly scores) → average per player.
  type ScoreRow = { playerId: string; fantasyPts: number; updatedAt: Date }
  const scoreRows: ScoreRow[] = allPlayerIds.length
    ? ((await prisma.playerWeeklyScore
        .findMany({
          where: {
            sport: season.sport,
            season: season.season,
            isFinalized: true,
            playerId: { in: allPlayerIds },
          },
          select: { playerId: true, fantasyPts: true, updatedAt: true },
        })
        .catch(() => [])) as ScoreRow[])
    : []
  const actualAgg = new Map<string, { sum: number; n: number }>()
  let statsAsOf: Date | null = null
  for (const row of scoreRows) {
    const cur = actualAgg.get(row.playerId) ?? { sum: 0, n: 0 }
    cur.sum += row.fantasyPts
    cur.n += 1
    actualAgg.set(row.playerId, cur)
    if (!statsAsOf || row.updatedAt > statsAsOf) statsAsOf = row.updatedAt
  }

  type SeasonStatsRow = {
    playerId: string
    fantasyPointsPerGame: number | null
    gamesPlayed: number | null
    stats: unknown
    fetchedAt: Date
    source: string
  }
  const seasonStatRows: SeasonStatsRow[] = allPlayerIds.length
    ? ((await prisma.playerSeasonStats
        .findMany({
          where: {
            sport: season.sport,
            season: seasonStr,
            seasonType: 'regular',
            playerId: { in: allPlayerIds },
          },
          orderBy: [{ source: 'desc' }, { fetchedAt: 'desc' }],
          select: {
            playerId: true,
            fantasyPointsPerGame: true,
            gamesPlayed: true,
            stats: true,
            fetchedAt: true,
            source: true,
          },
        })
        .catch(() => [])) as SeasonStatsRow[])
    : []
  const seasonStatsByPlayer = new Map<string, SeasonStatsRow>()
  for (const row of seasonStatRows) {
    const existing = seasonStatsByPlayer.get(row.playerId)
    const rowIsRi = row.source === 'rolling_insights'
    const existingIsRi = existing?.source === 'rolling_insights'
    if (!existing || (rowIsRi && !existingIsRi) || (rowIsRi === existingIsRi && row.fetchedAt > existing.fetchedAt)) {
      seasonStatsByPlayer.set(row.playerId, row)
    }
    if (!statsAsOf || row.fetchedAt > statsAsOf) statsAsOf = row.fetchedAt
  }

  // Injuries + news: real provider data from injury_reports / player_news (populated
  // by the import-injuries / import-news cron), joined by normalized player name.
  const injuryNews = await fetchRedraftInjuryNews(season.sport)
  const injuryByName = injuryNews.injuryByName
  const injuriesAsOf = injuryNews.injuriesAsOf
  const newsCount = injuryNews.newsCount

  // ADP / ranking value signal (real, sport-isolated) keyed by name|position.
  const adpByKey = await fetchAdpByPlayerKey(season.sport, season.season)

  function toPlayerFact(p: {
    playerId: string
    playerName: string
    position: string
    team: string | null
    slotType: string
    injuryStatus: string | null
    byeWeek: number | null
  }): RedraftPlayerFact {
    const proj = projectionByPlayer.get(p.playerId)
    const af = afProjectionByPlayer.get(p.playerId)
    const seasonStats = seasonStatsByPlayer.get(p.playerId)
    const agg = actualAgg.get(p.playerId)
    const seasonAvg = agg && agg.n > 0 ? Math.round((agg.sum / agg.n) * 100) / 100 : null
    const injuryStatus = p.injuryStatus ?? injuryByName.get(injuryNameKey(p.playerName))?.status ?? null
    const adp = adpByKey.get(buildPlayerKey(p.playerName, p.position)) ?? null
    const projection = buildAllFantasyProjection({
      playerId: p.playerId,
      playerName: p.playerName,
      sport: resolvedSeason.sport,
      position: p.position,
      team: p.team,
      currentWeek: week,
      totalWeeks: resolvedSeason.totalWeeks,
      byeWeek: p.byeWeek,
      injuryStatus,
      adp,
      providerWeeklyProjection: proj,
      allFantasyWeeklyProjection: af?.afProjection ?? null,
      allFantasyConfidenceLevel: af?.confidenceLevel ?? null,
      seasonAvgActual: seasonAvg,
      rollingInsightsFantasyPointsPerGame: seasonStats?.fantasyPointsPerGame ?? null,
      rollingInsightsGamesPlayed: seasonStats?.gamesPlayed ?? null,
      rollingInsightsStats: seasonStats?.stats ?? null,
    })
    const weekProjection = projection.weeklyProjection
    return {
      playerId: p.playerId,
      playerName: p.playerName,
      position: (p.position || 'UNK').toUpperCase(),
      team: p.team,
      slotType: p.slotType,
      isStarterSlot: isStarterSlotType(p.slotType),
      injuryStatus,
      byeWeek: p.byeWeek,
      weekProjection,
      restOfSeasonProjection: projection.restOfSeasonProjection,
      floorProjection: projection.floorProjection,
      ceilingProjection: projection.ceilingProjection,
      projectionConfidenceScore: projection.confidenceScore,
      projectionConfidenceLevel: projection.confidenceLevel,
      projectionSource: projection.source,
      projectionReasons: projection.reasons,
      seasonAvgActual: seasonAvg,
      adp,
      hasNoValueSignal: weekProjection == null && seasonAvg == null && adp == null,
    }
  }

  const teams: RedraftTeamSummary[] = season.rosters.map((r) => ({
    rosterId: r.id,
    ownerId: r.ownerId,
    ownerName: r.ownerName,
    teamName: r.teamName,
    wins: r.wins,
    losses: r.losses,
    ties: r.ties,
    pointsFor: r.pointsFor,
    pointsAgainst: r.pointsAgainst,
    streak: r.streak,
    playoffSeed: r.playoffSeed ?? null,
    faabBalance: r.faabBalance ?? null,
    waiverPriority: r.waiverPriority,
    isEliminated: r.isEliminated,
    isUserTeam: r.ownerId === userId,
    players: r.players.map(toPlayerFact),
  }))

  const userRosterId = teams.find((t) => t.isUserTeam)?.rosterId ?? null

  // Matchups for the user (or league when commissioner-only view).
  function toMatchupSummary(m: MatchupRow): RedraftMatchupSummary {
    const isUser =
      userRosterId != null && (m.homeRosterId === userRosterId || m.awayRosterId === userRosterId)
    const opponent =
      userRosterId == null
        ? null
        : m.homeRosterId === userRosterId
          ? m.awayRosterId
          : m.awayRosterId === userRosterId
            ? m.homeRosterId
            : null
    return {
      matchupId: m.id,
      week: m.week,
      status: m.status,
      homeRosterId: m.homeRosterId,
      awayRosterId: m.awayRosterId,
      homeScore: m.homeScore,
      awayScore: m.awayScore,
      homeProjected: m.homeProjected ?? null,
      awayProjected: m.awayProjected ?? null,
      isUserMatchup: isUser,
      opponentRosterId: opponent,
    }
  }
  const userSchedule = season.schedule
    .filter((m) => userRosterId != null && (m.homeRosterId === userRosterId || m.awayRosterId === userRosterId))
    .sort((a, b) => a.week - b.week)
  const upcomingMatchup =
    userSchedule.find((m) => m.week >= week && m.status !== 'final') ??
    userSchedule.find((m) => m.week >= week) ??
    null
  const recentMatchup =
    [...userSchedule].reverse().find((m) => m.week < week || m.status === 'final') ?? null

  // --- real free-agent pool (ADP-ranked, sport-isolated, minus rostered) ---
  const allRosterPlayers = teams.flatMap((t) => t.players)
  const rosteredKeys = rosteredPlayerKeys(
    allRosterPlayers.map((p) => ({ playerName: p.playerName, position: p.position })),
  )
  const freeAgentRows = await fetchRedraftFreeAgentPool({
    sport: season.sport,
    season: season.season,
    rosteredKeys,
    scoringFormat: scoring.scoringPreset.toLowerCase(),
    limit: 60,
  })
  const freeAgents: RedraftPlayerFact[] = freeAgentRows.map((fa) => {
    const injuryStatus = injuryByName.get(injuryNameKey(fa.playerName))?.status ?? null
    const projection = buildAllFantasyProjection({
      playerId: fa.playerKey,
      playerName: fa.playerName,
      sport: season.sport,
      position: fa.position,
      team: fa.team,
      currentWeek: week,
      totalWeeks: season.totalWeeks,
      injuryStatus,
      adp: fa.adp,
    })
    return {
      playerId: fa.playerKey,
      playerName: fa.playerName,
      position: fa.position,
      team: fa.team,
      slotType: 'free_agent',
      isStarterSlot: false,
      injuryStatus,
      byeWeek: null,
      weekProjection: projection.weeklyProjection,
      restOfSeasonProjection: projection.restOfSeasonProjection,
      floorProjection: projection.floorProjection,
      ceilingProjection: projection.ceilingProjection,
      projectionConfidenceScore: projection.confidenceScore,
      projectionConfidenceLevel: projection.confidenceLevel,
      projectionSource: projection.source,
      projectionReasons: projection.reasons,
      seasonAvgActual: null,
      adp: fa.adp,
      hasNoValueSignal: false, // ADP/ranking signal present
    }
  })

  // --- availability contract ---
  const adpAvailable = adpByKey.size > 0
  const allFantasyProjectionCount =
    teams.flatMap((t) => t.players).filter((p) => p.weekProjection != null).length +
    freeAgents.filter((p) => p.weekProjection != null).length
  const availability: RedraftDataAvailability = {
    scoringRules: 'available',
    rosterRules: rosterRulesState,
    standings: 'available',
    schedule: season.schedule.length > 0 ? 'available' : 'missing',
    playerStats: actualAgg.size > 0 || seasonStatsByPlayer.size > 0 ? 'available' : 'missing',
    projections: allFantasyProjectionCount > 0 ? 'available' : 'missing',
    injuries:
      injuryByName.size > 0 || teams.some((t) => t.players.some((p) => p.injuryStatus))
        ? 'available'
        : 'missing',
    news: newsCount > 0 ? 'available' : 'missing',
    waiverPool: freeAgents.length > 0 ? 'available' : 'missing',
    tradeValues:
      allFantasyProjectionCount > 0 || actualAgg.size > 0 || adpAvailable ? 'available' : 'missing',
  }

  const missingDataFlags: string[] = []
  if (availability.rosterRules === 'missing') missingDataFlags.push('Roster template could not be resolved.')
  if (availability.projections === 'missing')
    missingDataFlags.push(
      adpAvailable
        ? 'No weekly projections — start/sit uses season actuals and ADP/ranking value as fallback.'
        : 'No player projections available — start/sit falls back to season actuals where present.',
    )
  if (
    availability.projections === 'available' &&
    projectionByPlayer.size === 0 &&
    afProjectionByPlayer.size === 0 &&
    seasonStatsByPlayer.size === 0 &&
    adpAvailable
  ) {
    missingDataFlags.push('Weekly projections are low-confidence ADP/ranking fallbacks until provider stats arrive.')
  }
  if (availability.playerStats === 'missing')
    missingDataFlags.push('No finalized player stats yet (preseason or pre-ingestion).')
  if (availability.waiverPool === 'missing')
    missingDataFlags.push('Free-agent pool unavailable for this sport/season — specific add targets cannot be listed.')
  if (availability.injuries === 'missing') missingDataFlags.push('No injury data available.')

  const nflDataCoverage =
    season.sport.toUpperCase() === 'NFL'
      ? await getCanonicalNflDataCoverage({
          season: season.season,
          week,
          prismaClient: prisma,
        }).catch(() => null)
      : null
  if (nflDataCoverage) {
    for (const field of nflDataCoverage.missingFields) {
      missingDataFlags.push(`NFL data foundation missing ${field}.`)
    }
    for (const field of nflDataCoverage.staleFields) {
      missingDataFlags.push(`NFL data foundation ${field} is stale.`)
    }
  } else if (season.sport.toUpperCase() === 'NFL') {
    missingDataFlags.push('NFL data foundation coverage could not be loaded.')
  }

  const hasValueSignal =
    availability.projections === 'available' || availability.playerStats === 'available' || adpAvailable

  const context: RedraftWarRoomContext = {
    leagueId,
    leagueType: 'redraft',
    sport: season.sport,
    season: season.season,
    currentWeek: season.currentWeek,
    totalWeeks: season.totalWeeks,
    playoffStartWeek: season.playoffStartWeek,
    seasonStatus: season.status,
    scoring,
    roster,
    waivers,
    userRosterId,
    isCommissioner: access.isCommissioner,
    teams,
    upcomingMatchup: upcomingMatchup ? toMatchupSummary(upcomingMatchup) : null,
    recentMatchup: recentMatchup ? toMatchupSummary(recentMatchup) : null,
    freeAgents,
    availability,
    freshness: {
      generatedAt: new Date().toISOString(),
      statsAsOf: statsAsOf ? statsAsOf.toISOString() : null,
      projectionsAsOf: projectionsAsOf ? projectionsAsOf.toISOString() : null,
      injuriesAsOf: injuriesAsOf ? injuriesAsOf.toISOString() : null,
    },
    missingDataFlags,
    nflDataCoverage,
    featureAvailability: {
      teamNeeds: availability.rosterRules === 'available',
      lineup: availability.rosterRules === 'available',
      waivers: availability.waiverPool === 'available',
      tradeAnalyze: true, // roster-fit facts work even without values; the missing value signal is flagged
      tradeFind: hasValueSignal,
    },
  }

  return { ok: true, context }
}
