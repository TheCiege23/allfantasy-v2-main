/**
 * Aggregates league hub Matchup tab payload: scores, lineups, standings context, light AI copy.
 * Does not mutate scoring rules — read-only assembly from Prisma + optional media resolution.
 */

import { prisma } from '@/lib/prisma'
import { resolveLeagueMembership } from '@/lib/league-access'
import { buildRosterLabelMap } from '@/lib/scoring-engine/resolveTeamLabels'
import { getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'
import { attachPlayerMediaBatch } from '@/lib/player-media'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import type { MatchupCenterPayload, MatchupGameStatus, MatchupPlayerSlot, MatchupSidePayload } from '@/lib/matchup-center/types'
import { buildMatchupInsightsBlock } from '@/lib/matchup-center/matchupAiInsights'
import { applyMatchupCommandCenterMeta } from '@/lib/matchup-center/matchupAggregation'
import { sanitizeStarterRow } from '@/lib/matchup-center/validateMatchupPayload'

type PlayerWeekScore = { points: number; statLine: unknown }

function buildPlayerWeekMap(rows: { playerId: string; points: number; statLine: unknown }[]): Map<string, PlayerWeekScore> {
  const m = new Map<string, PlayerWeekScore>()
  for (const r of rows) {
    m.set(r.playerId, { points: r.points, statLine: r.statLine ?? null })
  }
  return m
}

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
    },
  })
  if (!league) return { error: 'League not found', status: 404 }

  // Membership gate — the ONE canonical predicate (lib/league-access.ts).
  //
  // This used to build `memberIds` from `LeagueTeam.platformUserId`, which is `String?` and, more
  // importantly, covers a different population than `Roster`. Measured against production
  // 2026-07-20 that gate rejected 98 of 176 real Roster-backed members (55.7%) — a live 403 for
  // over half the members of this surface. The giveaway was three lines below: the very next query
  // reads `Roster.platformUserId`, the NOT NULL column, for the same viewer.
  const membership = await resolveLeagueMembership(params.leagueId, params.viewerUserId)
  if (!membership.ok) {
    return { error: 'Forbidden', status: 403 }
  }

  const season = params.season ?? league.season
  const week = params.week ?? weekFromSettings(league.settings)

  const myRoster = await prisma.roster.findFirst({
    where: { leagueId: params.leagueId, platformUserId: params.viewerUserId },
    select: { id: true, playerData: true },
  })
  if (!myRoster) return { error: 'Roster not found', status: 404 }

  const [myResult, labels, standings, myScores] = await Promise.all([
    prisma.teamWeekResult.findUnique({
      where: {
        leagueId_season_week_rosterId: {
          leagueId: params.leagueId,
          season,
          week,
          rosterId: myRoster.id,
        },
      },
    }),
    buildRosterLabelMap(params.leagueId),
    prisma.fantasyStanding.findMany({
      where: { leagueId: params.leagueId, season },
    }),
    prisma.weeklyScore.findMany({
      where: { leagueId: params.leagueId, season, week, rosterId: myRoster.id, isStarter: true },
    }),
  ])

  const tw = myResult
  const oppRosterId = tw?.opponentRosterId ?? null
  if (!oppRosterId) {
    const byeLeft: MatchupSidePayload = {
      rosterId: myRoster.id,
      teamName: labels.get(myRoster.id) ?? 'My team',
      avatarUrl: null,
      record: { wins: 0, losses: 0, ties: 0 },
      winPct: 0,
      totalPoints: 0,
      projectedTotal: 0,
      starters: [],
      remainingStarters: 0,
    }
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
      leagueId: params.leagueId,
      season,
      week,
      sport: String(league.sport),
      matchupStatus: 'upcoming',
      conceptOverlay: league.leagueVariant ? `Format: ${league.leagueVariant}` : null,
      left: byeLeft,
      right: byeRight,
      winProbabilityLeft: null,
      insights: buildMatchupInsightsBlock({ left: byeLeft, right: byeRight, sport: String(league.sport) }),
      partialData: true,
    })
  }

  const [oppRoster, oppResult, oppScores] = await Promise.all([
    prisma.roster.findFirst({
      where: { id: oppRosterId },
      select: { id: true, playerData: true },
    }),
    prisma.teamWeekResult.findUnique({
      where: {
        leagueId_season_week_rosterId: {
          leagueId: params.leagueId,
          season,
          week,
          rosterId: oppRosterId,
        },
      },
    }),
    prisma.weeklyScore.findMany({
      where: { leagueId: params.leagueId, season, week, rosterId: oppRosterId, isStarter: true },
    }),
  ])

  if (!oppRoster) return { error: 'Opponent roster missing', status: 404 }

  const myScoreByPlayer = buildPlayerWeekMap(
    myScores.map((r) => ({ playerId: r.playerId, points: r.points, statLine: r.statLine })),
  )
  const oppScoreByPlayer = buildPlayerWeekMap(
    oppScores.map((r) => ({ playerId: r.playerId, points: r.points, statLine: r.statLine })),
  )

  const myStarters = parseStarterRows(myRoster.playerData)
  const oppStarters = parseStarterRows(oppRoster.playerData)

  const sport = normalizeToSupportedSport(String(league.sport)) ?? 'NFL'
  const mediaInputs = [...myStarters, ...oppStarters].map((p) => ({
    playerId: p.id,
    teamAbbr: p.team ?? null,
    sport: sport.toLowerCase(),
  }))
  let mediaMap: Awaited<ReturnType<typeof attachPlayerMediaBatch>> | null = null
  try {
    mediaMap = await attachPlayerMediaBatch(mediaInputs)
  } catch {
    mediaMap = null
  }

  const toSlot = (
    row: { id: string; position: string; name?: string; team?: string },
    pointsMap: Map<string, PlayerWeekScore>,
    weekStatus: string,
  ): MatchupPlayerSlot => {
    const rowScore = pointsMap.get(row.id)
    const pts = rowScore?.points ?? 0
    const statLine = rowScore?.statLine ?? null
    const proj = resolveProjectedPoints(pts, statLine, row.position)
    const headshot = mediaMap?.get(row.id)?.media.headshotUrl ?? null
    const opponent =
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
      opponent,
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

  const leftSlots = myStarters.map((r) => toSlot(r, myScoreByPlayer, tw?.status ?? 'upcoming'))
  const rightSlots = oppStarters.map((r) => toSlot(r, oppScoreByPlayer, oppResult?.status ?? 'upcoming'))

  const stLeft = standings.find((s) => s.rosterId === myRoster.id)
  const stRight = standings.find((s) => s.rosterId === oppRosterId)

  const left: MatchupSidePayload = {
    rosterId: myRoster.id,
    teamName: labels.get(myRoster.id) ?? 'My team',
    avatarUrl: null,
    record: {
      wins: stLeft?.wins ?? 0,
      losses: stLeft?.losses ?? 0,
      ties: stLeft?.ties ?? 0,
    },
    winPct: recordWinPct(stLeft?.wins ?? 0, stLeft?.losses ?? 0, stLeft?.ties ?? 0),
    totalPoints: tw?.totalPoints ?? leftSlots.reduce((s, x) => s + x.currentPoints, 0),
    projectedTotal: leftSlots.reduce((s, x) => s + x.projectedPoints, 0),
    starters: leftSlots,
    remainingStarters: leftSlots.filter((s) => s.gameStatus !== 'final').length,
  }

  const right: MatchupSidePayload = {
    rosterId: oppRoster.id,
    teamName: labels.get(oppRoster.id) ?? 'Opponent',
    avatarUrl: null,
    record: {
      wins: stRight?.wins ?? 0,
      losses: stRight?.losses ?? 0,
      ties: stRight?.ties ?? 0,
    },
    winPct: recordWinPct(stRight?.wins ?? 0, stRight?.losses ?? 0, stRight?.ties ?? 0),
    totalPoints: oppResult?.totalPoints ?? rightSlots.reduce((s, x) => s + x.currentPoints, 0),
    projectedTotal: rightSlots.reduce((s, x) => s + x.projectedPoints, 0),
    starters: rightSlots,
    remainingStarters: rightSlots.filter((s) => s.gameStatus !== 'final').length,
  }

  const ms =
    tw?.status === 'final' && oppResult?.status === 'final'
      ? 'final'
      : tw?.status === 'live' || oppResult?.status === 'live'
        ? 'live'
        : 'upcoming'

  const totalProj = left.projectedTotal + right.projectedTotal
  const winProb =
    totalProj > 0 ? Math.max(0.05, Math.min(0.95, left.projectedTotal / totalProj)) : null

  return applyMatchupCommandCenterMeta({
    leagueId: params.leagueId,
    season,
    week,
    sport: String(league.sport),
    matchupStatus: ms,
    conceptOverlay: league.leagueVariant ? `Concept: ${league.leagueVariant}` : null,
    left,
    right,
    winProbabilityLeft: winProb,
    insights: buildMatchupInsightsBlock({ left, right, sport: String(league.sport) }),
    partialData: !mediaMap,
  })
}
