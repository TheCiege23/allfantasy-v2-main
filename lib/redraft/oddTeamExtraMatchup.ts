/**
 * The extra matchup's database half: fix a week's pick, and read it back for the matchup screen and
 * the week board. The rules — settings, the pick itself, results — are lib/redraft/oddTeamExtraMatchupRules.ts,
 * whose header describes the feature.
 */

import { prisma } from '@/lib/prisma'
import { isOddTeamCount } from '@/lib/league/oddTeamLeagues'
import {
  completedWeekScores,
  describeExtraMatchupReason,
  pickExtraMatchupOpponent,
  readExtraMatchupRecord,
  readExtraMatchupSettings,
  type ExtraMatchupReason,
  type ExtraMatchupRecord,
  type ExtraMatchupView,
} from '@/lib/redraft/oddTeamExtraMatchupRules'

function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

export type AssignExtraMatchupOutcome =
  | { status: 'assigned'; record: ExtraMatchupRecord; matchupId: string }
  | { status: 'already_assigned'; record: ExtraMatchupRecord; matchupId: string }
  | { status: 'skipped'; reason: string }

const EXTRA_MATCHUP_LEAGUE_TYPES = new Set(['redraft', 'keeper'])

/**
 * Fix the leftover team's extra opponent for `week`. Idempotent: a bye row that already carries a pick
 * is left exactly as it is. Best-effort for its callers — it never throws for a league it does not
 * apply to; it says why it skipped.
 */
export async function assignExtraMatchupForWeek(input: {
  seasonId: string
  week: number
  now?: Date
}): Promise<AssignExtraMatchupOutcome> {
  const season = await prisma.redraftSeason.findUnique({
    where: { id: input.seasonId },
    select: {
      id: true,
      leagueId: true,
      playoffStartWeek: true,
      league: { select: { settings: true, leagueType: true } },
    },
  })
  if (!season) return { status: 'skipped', reason: 'season_not_found' }
  const settings = readExtraMatchupSettings(season.league?.settings)
  if (!settings.enabled) return { status: 'skipped', reason: 'disabled' }
  if (!EXTRA_MATCHUP_LEAGUE_TYPES.has(String(season.league?.leagueType ?? 'redraft'))) {
    return { status: 'skipped', reason: 'format_not_supported' }
  }
  // Points leagues only: the extra game is decided on points, like the league median.
  if (String(obj(season.league?.settings)?.scoring_mode ?? 'points') !== 'points') {
    return { status: 'skipped', reason: 'not_points_scoring' }
  }
  if (!(input.week >= 1) || input.week >= season.playoffStartWeek) return { status: 'skipped', reason: 'not_regular_season' }

  const rosters = await prisma.redraftRoster.findMany({
    where: { seasonId: season.id },
    select: { id: true, playoffSeed: true },
  })
  if (!isOddTeamCount(rosters.length)) return { status: 'skipped', reason: 'even_team_count' }

  const rows = await prisma.redraftMatchup.findMany({
    where: { seasonId: season.id, week: { in: [input.week - 1, input.week] } },
    select: {
      id: true, week: true, type: true, homeRosterId: true, awayRosterId: true, homeScore: true, awayScore: true,
      homeProjected: true, awayProjected: true, status: true, lineupSnapshots: true,
    },
    orderBy: { id: 'asc' },
  })
  const bye = rows.find((r) => r.week === input.week && !r.awayRosterId)
  if (!bye) return { status: 'skipped', reason: 'no_bye_this_week' }
  const existing = readExtraMatchupRecord(bye.lineupSnapshots)
  if (existing) return { status: 'already_assigned', record: existing, matchupId: bye.id }

  const standingsOrder = [...rosters]
    .sort((a, b) => (a.playoffSeed ?? Number.MAX_SAFE_INTEGER) - (b.playoffSeed ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id))
    .map((r) => r.id)
  const previousWeekScores = input.week > 1 ? completedWeekScores(rows, input.week - 1) : null
  const projections = new Map<string, number>()
  for (const r of rows.filter((x) => x.week === input.week)) {
    if (typeof r.homeProjected === 'number') projections.set(r.homeRosterId, r.homeProjected)
    if (r.awayRosterId && typeof r.awayProjected === 'number') projections.set(r.awayRosterId, r.awayProjected)
  }
  const pick = pickExtraMatchupOpponent({
    leagueId: season.leagueId,
    week: input.week,
    leftoverRosterId: bye.homeRosterId,
    rule: settings.opponent,
    rosterIds: rosters.map((r) => r.id),
    previousWeekScores,
    standingsOrder,
    projections,
  })
  if (!pick) return { status: 'skipped', reason: 'no_candidate' }

  const record: ExtraMatchupRecord = {
    opponentRosterId: pick.opponentRosterId,
    rule: settings.opponent,
    reason: pick.reason,
    scoring: settings.scoring,
    basisWeek: pick.reason === 'top_scorer' || pick.reason === 'median' ? input.week - 1 : null,
    decidedAt: (input.now ?? new Date()).toISOString(),
  }
  await prisma.redraftMatchup.update({
    where: { id: bye.id },
    data: {
      lineupSnapshots: {
        ...(obj(bye.lineupSnapshots) ?? {}),
        extraMatchup: record,
      },
    },
  })
  return { status: 'assigned', record, matchupId: bye.id }
}

/**
 * The extra game a native roster is part of in `week`, for the matchup screen and the week board.
 * Null when there is none, and on any read failure (the screens render without it).
 */
export async function readExtraMatchupView(input: {
  leagueId: string
  season: number
  week: number
  redraftRosterId: string
}): Promise<ExtraMatchupView | null> {
  try {
    const season = await prisma.redraftSeason.findFirst({
      where: { leagueId: input.leagueId, season: input.season },
      select: { id: true },
    })
    if (!season) return null
    const byes = await prisma.redraftMatchup.findMany({
      where: { seasonId: season.id, week: input.week, awayRosterId: null },
      select: { homeRosterId: true, lineupSnapshots: true },
    })
    for (const bye of byes) {
      const record = readExtraMatchupRecord(bye.lineupSnapshots)
      if (!record) continue
      const role = bye.homeRosterId === input.redraftRosterId ? 'leftover' : record.opponentRosterId === input.redraftRosterId ? 'opponent' : null
      if (!role) continue
      const otherId = role === 'leftover' ? record.opponentRosterId : bye.homeRosterId
      const other = await prisma.redraftRoster.findFirst({ where: { id: otherId }, select: { teamName: true, ownerName: true } })
      const teamName = other?.teamName?.trim() || other?.ownerName || 'another team'
      const why = describeExtraMatchupReason(record.reason)
      const countsForYou = role === 'leftover' || record.scoring === 'both'
      return {
        role,
        teamName,
        reason: record.reason,
        countsForYou,
        label: role === 'leftover'
          ? `Extra matchup vs ${teamName} (${why})`
          : `Extra matchup: ${teamName} plays you this week (you were ${why})${countsForYou ? ' — it counts for you too' : ' — only your own game counts for you'}`,
      }
    }
    return null
  } catch {
    return null
  }
}
