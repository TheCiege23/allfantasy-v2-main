/**
 * The extra matchup's database half: fix a week's pick, and read it back for the matchup screen and
 * the week board. The rules — settings, the pick itself, results — are lib/redraft/oddTeamExtraMatchupRules.ts,
 * whose header describes the feature.
 */

import { prisma } from '@/lib/prisma'
import { isOddTeamCount } from '@/lib/league/oddTeamLeagues'
import {
  completedWeekScores,
  extraMatchupForRoster,
  pickExtraMatchupOpponent,
  readExtraMatchupRecord,
  readExtraMatchupSettings,
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
 * The extra game a native roster is part of in `week` of a season, with both scores — for every
 * surface that does not already hold the week's rows. Null when there is none, and on any read
 * failure (the surfaces render without it).
 */
export async function readExtraMatchupViewForSeason(input: {
  seasonId: string
  week: number
  redraftRosterId: string
}): Promise<ExtraMatchupView | null> {
  try {
    const rows = await prisma.redraftMatchup.findMany({
      where: { seasonId: input.seasonId, week: input.week },
      select: { week: true, homeRosterId: true, awayRosterId: true, homeScore: true, awayScore: true, status: true, lineupSnapshots: true },
    })
    if (!rows.some((r) => !r.awayRosterId && readExtraMatchupRecord(r.lineupSnapshots))) return null
    const rosters = await prisma.redraftRoster.findMany({
      where: { seasonId: input.seasonId },
      select: { id: true, teamName: true, ownerName: true },
    })
    const names = new Map(rosters.map((r) => [r.id, r.teamName?.trim() || r.ownerName]))
    return extraMatchupForRoster(rows, input.week, input.redraftRosterId, (id) => names.get(id))
  } catch {
    return null
  }
}

/** The same, for a league's season by year (the matchup screen and the week board know the year). */
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
    return await readExtraMatchupViewForSeason({ seasonId: season.id, week: input.week, redraftRosterId: input.redraftRosterId })
  } catch {
    return null
  }
}
