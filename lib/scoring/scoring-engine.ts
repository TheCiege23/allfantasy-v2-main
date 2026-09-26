import type { LeagueSport } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { computeRosterScoreForWeek } from '@/lib/multi-sport/MultiSportMatchupScoringService'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { selectBestBallLineupForRoster } from './best-ball-engine'

type JsonRecord = Record<string, unknown>
const prismaAny = prisma as any

function toJsonRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {}
}

function extractStarterIds(playerData: unknown): string[] {
  if (!playerData || typeof playerData !== 'object') return []
  const data = playerData as Record<string, unknown>
  if (Array.isArray(data.starters)) {
    return data.starters.map((entry) => String(entry)).filter(Boolean)
  }
  const lineupSections =
    data.lineup_sections && typeof data.lineup_sections === 'object'
      ? (data.lineup_sections as Record<string, unknown>)
      : null
  if (lineupSections && Array.isArray(lineupSections.starters)) {
    return lineupSections.starters
      .map((entry) => {
        if (typeof entry === 'string') return entry
        if (entry && typeof entry === 'object') {
          const record = entry as Record<string, unknown>
          return String(record.id ?? record.playerId ?? record.player_id ?? '')
        }
        return ''
      })
      .filter(Boolean)
  }
  return []
}

function isBestBallEnabled(settings: JsonRecord): boolean {
  return (
    settings.best_ball === true ||
    settings.bestBall === true ||
    String(settings.format_id ?? settings.league_type ?? '').toLowerCase() === 'best_ball'
  )
}

function resolveFormatType(leagueVariant: string | null, settings: JsonRecord): string | undefined {
  const variant = String(settings.league_variant ?? leagueVariant ?? '').trim()
  if (variant) return variant
  const formatId = String(settings.format_id ?? settings.league_type ?? '').trim()
  return formatId || undefined
}

export type LeagueWeekScoreResult = {
  leagueId: string
  season: number
  weekOrRound: number
  rosterCount: number
  updatedTeamCount: number
  locked: boolean
  /** `unavailable`: nothing was written for this week — see `unavailable` for which teams and why. */
  status: 'scored' | 'unavailable'
  unavailable: Array<{ rosterId: string; teamId: string | null; reason: string }>
}

export async function scoreLeagueWeek(input: {
  leagueId: string
  season: number
  weekOrRound: number
  lockScores?: boolean
}): Promise<LeagueWeekScoreResult> {
  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    include: {
      rosters: {
        select: {
          id: true,
          platformUserId: true,
          playerData: true,
        },
      },
      teams: {
        select: {
          id: true,
          externalId: true,
        },
      },
    },
  })

  if (!league) {
    return {
      leagueId: input.leagueId,
      season: input.season,
      weekOrRound: input.weekOrRound,
      rosterCount: 0,
      updatedTeamCount: 0,
      locked: false,
      status: 'unavailable',
      unavailable: [{ rosterId: '', teamId: null, reason: 'League not found.' }],
    }
  }

  const settings = toJsonRecord(league.settings)
  const formatType = resolveFormatType(league.leagueVariant, settings)
  const bestBallEnabled = isBestBallEnabled(settings)
  const teamIdByRosterExternalId = new Map(league.teams.map((team) => [team.externalId, team.id]))
  const teamScores = new Map<string, number>()

  /*
   * 🛑 SCORE EVERY TEAM FIRST, WRITE ONLY IF EVERY TEAM COULD BE SCORED.
   *
   * This used to upsert each roster as it went, and an unscoreable roster was written as 0 points:
   * a daily sport (whose game stats carry no week), a week nobody has played yet, or a roster whose
   * ids match no stat row. Those zeros then flowed into pointsFor and currentRank for the whole
   * league, and `lockScores` could seal them. An unscoreable week is now written NOT AT ALL —
   * a stale standings table is recoverable, a confident wrong one is not.
   */
  const pending: Array<{
    teamId: string
    points: number
    data: { starterIds: string[]; bestBallEnabled: boolean; bestBallStatus: string | null; byPlayerId: Record<string, number> }
  }> = []
  const unavailableTeams: LeagueWeekScoreResult['unavailable'] = []

  for (const roster of league.rosters) {
    const rosterPlayerIds = getRosterPlayerIds(roster.playerData)
    if (rosterPlayerIds.length === 0) continue
    // Only a roster with a team is ever written, so only it is scored or can block the week.
    const teamId = teamIdByRosterExternalId.get(roster.platformUserId)
    if (!teamId) continue

    // On UNAVAILABLE/unfillable the engine returns EMPTY starterIds by contract, so the
    // fallback below uses the roster's actual starters instead of an arbitrary all-zero
    // "optimized" lineup. The status is persisted so the stored score is auditable.
    const bestBallResult = bestBallEnabled
      ? await selectBestBallLineupForRoster({
          leagueId: league.id,
          leagueSport: league.sport as LeagueSport,
          season: input.season,
          weekOrRound: input.weekOrRound,
          rosterPlayerIds,
          formatType,
        })
      : null
    const derivedStarterIds = bestBallResult?.starterIds ?? []

    const starterIds = derivedStarterIds.length > 0 ? derivedStarterIds : extractStarterIds(roster.playerData)
    const score = await computeRosterScoreForWeek({
      leagueId: league.id,
      leagueSport: league.sport as LeagueSport,
      season: input.season,
      weekOrRound: input.weekOrRound,
      rosterPlayerIds,
      starterPlayerIds: starterIds.length > 0 ? starterIds : rosterPlayerIds,
      formatType,
    })

    if (score.status === 'UNAVAILABLE') {
      unavailableTeams.push({ rosterId: roster.id, teamId, reason: score.unavailableReason ?? 'unavailable' })
      continue
    }
    pending.push({
      teamId,
      points: score.totalPoints,
      data: {
        starterIds: starterIds.length > 0 ? starterIds : rosterPlayerIds,
        bestBallEnabled,
        bestBallStatus: bestBallResult?.status ?? null,
        byPlayerId: score.byPlayerId,
      },
    })
  }

  if (unavailableTeams.length > 0) {
    return {
      leagueId: league.id,
      season: input.season,
      weekOrRound: input.weekOrRound,
      rosterCount: league.rosters.length,
      updatedTeamCount: 0,
      locked: false,
      status: 'unavailable',
      unavailable: unavailableTeams,
    }
  }

  for (const { teamId, points, data } of pending) {
    teamScores.set(teamId, points)
    await prisma.teamPerformance.upsert({
      where: {
        teamId_season_week: {
          teamId,
          season: input.season,
          week: input.weekOrRound,
        },
      },
      update: {
        points,
        result: input.lockScores ? 'locked' : undefined,
        data,
      },
      create: {
        teamId,
        season: input.season,
        week: input.weekOrRound,
        points,
        result: input.lockScores ? 'locked' : null,
        data,
      },
    })
  }

  const allPerformances = await prisma.teamPerformance.findMany({
    where: {
      teamId: { in: Array.from(teamIdByRosterExternalId.values()) },
    },
    select: {
      teamId: true,
      points: true,
    },
  })

  const totalPointsByTeam = new Map<string, number>()
  for (const row of allPerformances) {
    totalPointsByTeam.set(row.teamId, (totalPointsByTeam.get(row.teamId) ?? 0) + Number(row.points ?? 0))
  }

  const rankedTeams = Array.from(totalPointsByTeam.entries()).sort((a, b) => b[1] - a[1])
  await Promise.all(
    rankedTeams.map(([teamId, pointsFor], index) =>
      prisma.leagueTeam.update({
        where: { id: teamId },
        data: {
          pointsFor,
          currentRank: index + 1,
        },
      })
    )
  )

  await prismaAny.scoringSettingsSnapshot.create({
    data: {
      leagueId: league.id,
      season: input.season,
      week: input.weekOrRound,
      formatKey: formatType ?? null,
      scoringMode: String(settings.scoring_mode ?? 'points'),
      scoringFormat: typeof settings.scoring_format === 'string' ? settings.scoring_format : null,
      templateId: typeof settings.scoring_template_id === 'string' ? settings.scoring_template_id : null,
      modifiers: Array.isArray(settings.format_modifiers)
        ? settings.format_modifiers.map((entry) => String(entry))
        : [],
      effectiveRules: toJsonRecord(settings.scoring_settings),
      overrides: toJsonRecord(settings.scoring_snapshot),
    },
  })

  if (input.lockScores) {
    await prisma.league.update({
      where: { id: league.id },
      data: {
        settings: {
          ...(settings as object),
          score_lock: {
            season: input.season,
            week: input.weekOrRound,
            lockedAt: new Date().toISOString(),
          },
        },
      },
    })
  }

  return {
    leagueId: league.id,
    season: input.season,
    weekOrRound: input.weekOrRound,
    rosterCount: league.rosters.length,
    updatedTeamCount: teamScores.size,
    locked: Boolean(input.lockScores),
    status: 'scored',
    unavailable: [],
  }
}
