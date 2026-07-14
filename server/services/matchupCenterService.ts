/**
 * Aggregates league hub Matchup tab payload: scores, lineups, standings context, light AI copy.
 * Does not mutate scoring rules — read-only assembly from Prisma + optional media resolution.
 */

import { prisma } from '@/lib/prisma'
import { buildRosterLabelMap } from '@/lib/scoring-engine/resolveTeamLabels'
import { getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'
import { attachPlayerMediaBatch } from '@/lib/player-media'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import type { MatchupCenterPayload, MatchupGameStatus, MatchupPlayerSlot, MatchupSidePayload } from '@/lib/matchup-center/types'
import { buildMatchupInsightsBlock } from '@/lib/matchup-center/matchupAiInsights'
import { applyMatchupCommandCenterMeta } from '@/lib/matchup-center/matchupAggregation'
import { sanitizeStarterRow } from '@/lib/matchup-center/validateMatchupPayload'
import { loadCanonicalPlayerScores } from '@/server/services/canonicalPlayerScores'
import { resolveRedraftMatchupContext } from '@/server/services/matchupSources/redraftMatchupSource'
import type { MatchupContextResult, MatchupSideContext } from '@/server/services/matchupSources/types'

type PlayerWeekScore = { points: number; statLine: unknown }

function projectionFromStatLine(statLine: unknown): number | null {
  if (!statLine || typeof statLine !== 'object' || Array.isArray(statLine)) return null
  const o = statLine as Record<string, unknown>
  for (const k of ['projectedPoints', 'projected_fantasy_points', 'projection', 'proj', 'pprProjection', 'halfPprProjection']) {
    const v = o[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string') {
      const n = parseFloat(v)
      if (Number.isFinite(n)) return n
    }
  }
  return null
}

function readStatLineString(statLine: unknown, keys: string[]): string | null {
  if (!statLine || typeof statLine !== 'object' || Array.isArray(statLine)) return null
  const o = statLine as Record<string, unknown>
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

function positionProjectionFallback(position: string): number {
  const p = position.toUpperCase()
  if (p === 'QB') return 17
  if (p === 'RB') return 12
  if (p === 'WR' || p === 'TE') return 10
  if (p === 'K') return 8
  if (p === 'DST' || p === 'DEF') return 9
  if (p === 'FLEX' || p === 'SUPER_FLEX' || p === 'SFLX' || p === 'SFLEX') return 11
  return 10
}

function resolveProjectedPoints(pts: number, statLine: unknown, position: string): number {
  const fromLine = projectionFromStatLine(statLine)
  if (fromLine != null) return Math.max(pts, fromLine)
  return Math.max(pts, positionProjectionFallback(position))
}

function slotAiInsight(pts: number, proj: number, injury: string | null): string | null {
  if (injury && /out|doubtful|ir\b|nfi\b|pup\b/i.test(injury)) return 'Injury flag — verify active status before lock.'
  if (proj - pts >= 8) return 'Ceiling game — still room to spike vs current score.'
  if (pts > proj + 5) return 'Outperforming projection — momentum is on your side.'
  return null
}

function weekFromSettings(settings: unknown): number {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return 1
  const w = (settings as Record<string, unknown>).currentWeek ?? (settings as Record<string, unknown>).current_week
  if (typeof w === 'number' && Number.isFinite(w)) return Math.max(1, Math.floor(w))
  if (typeof w === 'string') {
    const n = parseInt(w, 10)
    return Number.isFinite(n) ? Math.max(1, n) : 1
  }
  return 1
}

function recordWinPct(w: number, l: number, t: number): number {
  const denom = w + l + t
  if (denom <= 0) return 0
  return (w + t * 0.5) / denom
}

function parseStarterRows(playerData: unknown): Array<{ id: string; position: string; name?: string; team?: string }> {
  const sections = getNormalizedLineupSections(playerData)
  const starters = sections.starters ?? []
  return starters.map((row) => {
    const o = row as Record<string, unknown>
    const id = String(o.id ?? o.player_id ?? '').trim()
    return {
      id,
      position: String(o.position ?? 'FLEX').toUpperCase(),
      name: typeof o.name === 'string' ? o.name : undefined,
      team: typeof o.team === 'string' ? o.team : typeof o.team_abbr === 'string' ? o.team_abbr : undefined,
    }
  })
}

function inferGameStatus(totalPoints: number, weekStatus: string): MatchupGameStatus {
  const ws = String(weekStatus).toLowerCase()
  if (ws === 'final' || ws === 'complete') return 'final'
  if (ws === 'live' || ws === 'in_progress') return 'live'
  return 'upcoming'
}

export async function buildMatchupCenterPayload(params: {
  leagueId: string
  viewerUserId: string
  season?: number
  week?: number
}): Promise<MatchupCenterPayload | { error: string; status: number }> {
  const league = await prisma.league.findFirst({
    where: { id: params.leagueId },
    select: {
      id: true,
      season: true,
      sport: true,
      settings: true,
      leagueVariant: true,
      userId: true,
      teams: { select: { platformUserId: true } },
    },
  })
  if (!league) return { error: 'League not found', status: 404 }

  const memberIds = new Set(league.teams.map((t) => t.platformUserId).filter(Boolean) as string[])
  if (league.userId !== params.viewerUserId && !memberIds.has(params.viewerUserId)) {
    return { error: 'Forbidden', status: 403 }
  }

  const season = params.season ?? league.season
  const week = params.week ?? weekFromSettings(league.settings)

  const base: AssembleBase = {
    leagueId: params.leagueId,
    season,
    week,
    leagueSport: String(league.sport),
    conceptOverlay: league.leagueVariant ? `Concept: ${league.leagueVariant}` : null,
  }

  // 1) Concept-native source first (redraft-family: RedraftMatchup/RedraftRoster/
  //    RedraftRosterPlayer). Returns null when the league is not redraft-family →
  //    fall back to the generic TeamWeekResult/Roster source below.
  const redraftCtx = await resolveRedraftMatchupContext({
    leagueId: params.leagueId,
    viewerUserId: params.viewerUserId,
    season,
    week,
  })
  if (redraftCtx) return assembleFromContext(redraftCtx, base)

  // 2) Generic source — preserves prior TeamWeekResult/Roster behavior + 404s.
  const generic = await resolveGenericMatchupContext({
    leagueId: params.leagueId,
    viewerUserId: params.viewerUserId,
    season,
    week,
  })
  if ('error' in generic) return generic
  return assembleFromContext(generic, {
    ...base,
    conceptOverlay: league.leagueVariant ? `Format: ${league.leagueVariant}` : null,
  })
}

type AssembleBase = {
  leagueId: string
  season: number
  week: number
  leagueSport: string
  conceptOverlay: string | null
}

function normalizeContextWeekStatus(status: string | null | undefined): 'upcoming' | 'live' | 'final' {
  const s = String(status ?? '').toLowerCase()
  if (s === 'final' || s === 'complete' || s === 'completed') return 'final'
  if (s === 'live' || s === 'in_progress') return 'live'
  return 'upcoming'
}

/** Generic (non-redraft) source: pairing from TeamWeekResult, rosters from `Roster`. */
async function resolveGenericMatchupContext(params: {
  leagueId: string
  viewerUserId: string
  season: number
  week: number
}): Promise<MatchupContextResult | { error: string; status: number }> {
  const myRoster = await prisma.roster.findFirst({
    where: { leagueId: params.leagueId, platformUserId: params.viewerUserId },
    select: { id: true, playerData: true },
  })
  if (!myRoster) return { error: 'Roster not found', status: 404 }

  const [myResult, labels, standings] = await Promise.all([
    prisma.teamWeekResult.findUnique({
      where: {
        leagueId_season_week_rosterId: { leagueId: params.leagueId, season: params.season, week: params.week, rosterId: myRoster.id },
      },
    }),
    buildRosterLabelMap(params.leagueId),
    prisma.fantasyStanding.findMany({ where: { leagueId: params.leagueId, season: params.season } }),
  ])

  // Phase 34 fix: a missing TeamWeekResult ROW (no schedule data ever recorded for
  // this league/season/week/roster -- confirmed via real .env.test execution: this
  // table has 0 rows in that environment) is NOT evidence of a bye. It previously
  // fell through the same `!oppRosterId` branch as a real row that explicitly
  // records no opponent, silently overstating certainty ("bye" implies a confirmed
  // schedule fact). Mirrors the already-established, real distinction
  // resolveRedraftMatchupContext() makes for the exact same shape of problem: a
  // missing matchup ROW -> `none` (honest, explainable), a real row with no
  // opponent -> `bye` (positive evidence: the engine explicitly processed this
  // roster's week and recorded no opponent).
  if (!myResult) return { kind: 'none', reason: `no_team_week_result_for_week_${params.week}` }

  const selected = genericSide(myRoster, labels, standings, myResult, 'My team')
  const oppRosterId = myResult.opponentRosterId ?? null
  if (!oppRosterId) return { kind: 'bye', selected }

  const [oppRoster, oppResult] = await Promise.all([
    prisma.roster.findFirst({ where: { id: oppRosterId }, select: { id: true, playerData: true } }),
    prisma.teamWeekResult.findUnique({
      where: {
        leagueId_season_week_rosterId: { leagueId: params.leagueId, season: params.season, week: params.week, rosterId: oppRosterId },
      },
    }),
  ])
  if (!oppRoster) return { error: 'Opponent roster missing', status: 404 }

  return { kind: 'matchup', selected, opponent: genericSide(oppRoster, labels, standings, oppResult, 'Opponent') }
}

function genericSide(
  roster: { id: string; playerData: unknown },
  labels: Map<string, string>,
  standings: Array<{ rosterId: string; wins: number; losses: number; ties: number }>,
  tw: { status?: string | null; totalPoints?: number | null } | null,
  fallbackName: string,
): MatchupSideContext {
  const st = standings.find((s) => s.rosterId === roster.id)
  return {
    rosterId: roster.id,
    teamName: labels.get(roster.id) ?? fallbackName,
    avatarUrl: null,
    record: { wins: st?.wins ?? 0, losses: st?.losses ?? 0, ties: st?.ties ?? 0 },
    starters: parseStarterRows(roster.playerData),
    weekStatus: normalizeContextWeekStatus(tw?.status),
    engineTotalPoints: tw?.totalPoints ?? null,
  }
}

/** Shared payload assembly — scoring (canonical adapter) + media + payload — used by every source. */
async function assembleFromContext(ctx: MatchupContextResult, base: AssembleBase): Promise<MatchupCenterPayload> {
  if (ctx.kind === 'none') return buildEmptyMatchupPayload(base, ctx.reason)
  if (ctx.kind === 'bye') return assembleSidesPayload(base, ctx.selected, null)
  return assembleSidesPayload(base, ctx.selected, ctx.opponent)
}

async function assembleSidesPayload(
  base: AssembleBase,
  selected: MatchupSideContext,
  opponent: MatchupSideContext | null,
): Promise<MatchupCenterPayload> {
  const sport = normalizeToSupportedSport(base.leagueSport) ?? 'NFL'
  const allStarters = opponent ? [...selected.starters, ...opponent.starters] : selected.starters
  const mediaInputs = allStarters.map((p) => ({ playerId: p.id, teamAbbr: p.team ?? null, sport: sport.toLowerCase() }))
  let mediaMap: Awaited<ReturnType<typeof attachPlayerMediaBatch>> | null = null
  try {
    mediaMap = await attachPlayerMediaBatch(mediaInputs)
  } catch {
    mediaMap = null
  }

  const toSlot = (
    row: { id: string; position: string; name?: string; team?: string },
    pointsMap: ReadonlyMap<string, PlayerWeekScore>,
    weekStatus: string,
  ): MatchupPlayerSlot => {
    const rowScore = pointsMap.get(row.id)
    const pts = rowScore?.points ?? 0
    const statLine = rowScore?.statLine ?? null
    const proj = resolveProjectedPoints(pts, statLine, row.position)
    const headshot = mediaMap?.get(row.id)?.media.headshotUrl ?? null
    const opp =
      readStatLineString(statLine, ['opponent', 'opp', 'opponentAbbr', 'vs', 'opponentTeam']) ?? null
    const injuryStatus =
      readStatLineString(statLine, ['injuryStatus', 'injury', 'injury_status', 'injury_designation']) ?? null
    const newsBlurb =
      readStatLineString(statLine, ['newsBlurb', 'news', 'headline', 'trendingNews']) ?? null
    let weatherSummary =
      readStatLineString(statLine, ['weatherSummary', 'weather', 'weatherImpact']) ?? null
    if (!weatherSummary && (sport === 'NFL' || sport === 'NCAAF')) {
      const icon = readStatLineString(statLine, ['weatherIcon', 'conditions'])
      if (icon) weatherSummary = icon
    }
    return sanitizeStarterRow({
      playerId: row.id,
      name: row.name ?? row.id,
      position: row.position,
      team: row.team ?? null,
      opponent: opp,
      headshotUrl: headshot,
      currentPoints: pts,
      projectedPoints: proj,
      injuryStatus,
      newsBlurb,
      weatherSummary,
      gameStatus: inferGameStatus(pts, weekStatus),
      gameLabel: pts > 0 ? 'Scoring' : 'Scheduled',
      aiInsight: slotAiInsight(pts, proj, injuryStatus),
    })
  }

  const selScores = await loadCanonicalPlayerScores({
    leagueId: base.leagueId,
    sport: base.leagueSport,
    season: selected.scoreSeason ?? base.season,
    week: selected.scoreWeek ?? base.week,
    rosterId: selected.rosterId,
    players: selected.starters.map((s) => ({ playerId: s.id, position: s.position })),
  })
  const leftSlots = selected.starters.map((r) => toSlot(r, selScores, selected.weekStatus))
  const left: MatchupSidePayload = {
    rosterId: selected.rosterId,
    teamName: selected.teamName,
    avatarUrl: selected.avatarUrl,
    record: selected.record,
    winPct: recordWinPct(selected.record.wins, selected.record.losses, selected.record.ties),
    totalPoints: selected.engineTotalPoints ?? leftSlots.reduce((s, x) => s + x.currentPoints, 0),
    projectedTotal: leftSlots.reduce((s, x) => s + x.projectedPoints, 0),
    starters: leftSlots,
    remainingStarters: leftSlots.filter((s) => s.gameStatus !== 'final').length,
  }

  if (!opponent) {
    const byeRight: MatchupSidePayload = {
      rosterId: 'bye',
      teamName: 'No opponent',
      avatarUrl: null,
      record: { wins: 0, losses: 0, ties: 0 },
      winPct: 0,
      totalPoints: 0,
      projectedTotal: 0,
      starters: [],
      remainingStarters: 0,
    }
    return applyMatchupCommandCenterMeta({
      leagueId: base.leagueId,
      season: base.season,
      week: base.week,
      sport: base.leagueSport,
      matchupStatus: 'upcoming',
      conceptOverlay: base.conceptOverlay,
      left,
      right: byeRight,
      winProbabilityLeft: null,
      insights: buildMatchupInsightsBlock({ left, right: byeRight, sport: base.leagueSport }),
      partialData: true,
    })
  }

  const oppScores = await loadCanonicalPlayerScores({
    leagueId: base.leagueId,
    sport: base.leagueSport,
    season: opponent.scoreSeason ?? base.season,
    week: opponent.scoreWeek ?? base.week,
    rosterId: opponent.rosterId,
    players: opponent.starters.map((s) => ({ playerId: s.id, position: s.position })),
  })
  const rightSlots = opponent.starters.map((r) => toSlot(r, oppScores, opponent.weekStatus))
  const right: MatchupSidePayload = {
    rosterId: opponent.rosterId,
    teamName: opponent.teamName,
    avatarUrl: opponent.avatarUrl,
    record: opponent.record,
    winPct: recordWinPct(opponent.record.wins, opponent.record.losses, opponent.record.ties),
    totalPoints: opponent.engineTotalPoints ?? rightSlots.reduce((s, x) => s + x.currentPoints, 0),
    projectedTotal: rightSlots.reduce((s, x) => s + x.projectedPoints, 0),
    starters: rightSlots,
    remainingStarters: rightSlots.filter((s) => s.gameStatus !== 'final').length,
  }

  const ms =
    selected.weekStatus === 'final' && opponent.weekStatus === 'final'
      ? 'final'
      : selected.weekStatus === 'live' || opponent.weekStatus === 'live'
        ? 'live'
        : 'upcoming'

  const totalProj = left.projectedTotal + right.projectedTotal
  const winProb =
    totalProj > 0 ? Math.max(0.05, Math.min(0.95, left.projectedTotal / totalProj)) : null

  return applyMatchupCommandCenterMeta({
    leagueId: base.leagueId,
    season: base.season,
    week: base.week,
    sport: base.leagueSport,
    matchupStatus: ms,
    conceptOverlay: base.conceptOverlay,
    left,
    right,
    winProbabilityLeft: winProb,
    insights: buildMatchupInsightsBlock({ left, right, sport: base.leagueSport }),
    partialData: !mediaMap,
  })
}

/** Clear, non-crashing empty state when a concept source finds no matchup. */
function buildEmptyMatchupPayload(base: AssembleBase, reason: string): MatchupCenterPayload {
  const emptySide = (rosterId: string, teamName: string): MatchupSidePayload => ({
    rosterId,
    teamName,
    avatarUrl: null,
    record: { wins: 0, losses: 0, ties: 0 },
    winPct: 0,
    totalPoints: 0,
    projectedTotal: 0,
    starters: [],
    remainingStarters: 0,
  })
  const left = emptySide('none-left', 'Your team')
  const right = emptySide('none-right', 'No matchup')
  return applyMatchupCommandCenterMeta({
    leagueId: base.leagueId,
    season: base.season,
    week: base.week,
    sport: base.leagueSport,
    matchupStatus: 'upcoming',
    conceptOverlay: `No matchup this week (${reason})`,
    left,
    right,
    winProbabilityLeft: null,
    insights: buildMatchupInsightsBlock({ left, right, sport: base.leagueSport }),
    partialData: true,
  })
}
